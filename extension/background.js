// background.js (service worker / module)
// 职责：
//   1. 连接 native messaging host，监听系统级麦克风占用事件
//   2. 接收并转发 getUserMedia 拦截事件（来自 content script）
//   3. 汇总"麦克风是否在用"的全局状态，向所有受控 tab 同步 pause/play
//   4. 处理 popup 设置同步

const NATIVE_HOST_NAME = "com.micpause.host";
const TAB_URL_PATTERNS = ["http://*/*", "https://*/*"];
// 单个 tab 迟迟不响应时不能阻塞其它 tab 的同步。
const SEND_TIMEOUT_MS = 3000;

const state = {
  // 麦克风占用来源（用于多源场景：Zoom 在用 + 浏览器录音同时进行）
  // 网页来源按 frame 区分：tab:<tabId>:<frameId>
  micSources: new Set(),
  // 设置
  enabled: true,
  // native port
  port: null,
  nativeConnected: false,
  nativeError: "",
  // 重连 backoff
  reconnectTimer: null,
  // tab 同步：同一时刻只跑一轮，期间状态变化则在结束后按最新状态再跑一轮
  syncRunning: false,
  syncPending: false,
  // 上一次同步给 tab 的状态，只有状态翻转时才广播
  lastActive: false,
  // service worker 重启后 tab 里可能还留着上一轮的暂停状态，拿到首个确定状态后强制同步一次
  initialSynced: false,
};

// ---------- Native messaging ----------

function connectNative() {
  if (state.port) return;
  try {
    const port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    state.port = port;
    port.onMessage.addListener(onNativeMessage);
    port.onDisconnect.addListener(() => {
      const err = chrome.runtime.lastError;
      console.warn("[mic-pause] native host disconnected", err?.message);
      if (state.port === port) state.port = null;
      state.nativeConnected = false;
      state.nativeError = err?.message || "native host 已断开";
      // native 断开后不再有人报告 mic_stopped，避免 system 来源残留导致视频一直暂停。
      state.micSources.delete("system");
      onMicSourcesChanged();
      scheduleReconnect();
    });
    console.log("[mic-pause] native host connecting");
  } catch (e) {
    console.error("[mic-pause] connectNative failed", e);
    state.port = null;
    state.nativeConnected = false;
    state.nativeError = String(e?.message || e);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (state.reconnectTimer) return;
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    connectNative();
  }, 2000);
}

function onNativeMessage(msg) {
  if (!msg || typeof msg !== "object") return;
  state.nativeConnected = true;
  state.nativeError = "";
  switch (msg.type) {
    case "init":
      console.log("[mic-pause] native init, running=", msg.running);
      if (msg.running) state.micSources.add("system");
      else state.micSources.delete("system");
      onMicSourcesChanged();
      break;
    case "mic_started":
      addMicSource("system");
      break;
    case "mic_stopped":
      removeSystemSourceAndStaleTabSources();
      break;
    case "error":
      console.error("[mic-pause] native error:", msg.message);
      break;
    default:
      break;
  }
}

function removeSystemSourceAndStaleTabSources() {
  state.micSources.delete("system");
  // Native CoreAudio 已确认所有输入设备都停止。网页有时只会 mute track，
  // 不会及时发出 stopped 事件，这些残留标记不能阻塞视频恢复。
  for (const source of state.micSources) {
    if (source.startsWith("tab:")) state.micSources.delete(source);
  }
  onMicSourcesChanged();
}

// ---------- Mic source aggregation ----------

function isMicActive() {
  return state.micSources.size > 0 && state.enabled;
}

function addMicSource(src) {
  if (state.micSources.has(src)) return;
  state.micSources.add(src);
  onMicSourcesChanged();
}

function removeMicSource(src) {
  if (!state.micSources.delete(src)) return;
  onMicSourcesChanged();
}

function removeTabSources(tabId) {
  const prefix = `tab:${tabId}:`;
  let changed = false;
  for (const source of state.micSources) {
    if (source.startsWith(prefix)) {
      state.micSources.delete(source);
      changed = true;
    }
  }
  if (changed) onMicSourcesChanged();
}

function onMicSourcesChanged() {
  if (!state.initialSynced || isMicActive() !== state.lastActive) {
    state.initialSynced = true;
    syncTabs();
  }
  refreshIcon();
}

// ---------- Tab sync ----------

// 始终按"当前"状态同步，而不是排队执行历史指令：麦克风短暂开关时，
// 不会出现 play 先到、pause 后到导致视频一直被暂停的情况。
async function syncTabs() {
  if (state.syncRunning) {
    state.syncPending = true;
    return;
  }
  state.syncRunning = true;
  try {
    do {
      state.syncPending = false;
      state.lastActive = isMicActive();
      const action = state.lastActive ? "pause" : "play";
      const tabs = await getControlledTabs();
      await Promise.allSettled(tabs.map((tab) => sendCommand(tab.id, action)));
    } while (state.syncPending);
  } finally {
    state.syncRunning = false;
  }
}

function sendCommand(tabId, action) {
  const send = chrome.tabs.sendMessage(tabId, { type: "cmd", action });
  const timeout = new Promise((resolve) => setTimeout(resolve, SEND_TIMEOUT_MS));
  // tab 可能没加载 content script 或已关闭
  return Promise.race([send, timeout]).catch(() => {});
}

async function getControlledTabs() {
  try {
    // 不再限制 audible：静音视频、刚开始加载的视频也应被暂停。
    return await chrome.tabs.query({ url: TAB_URL_PATTERNS });
  } catch (e) {
    return [];
  }
}

// ---------- Content script messages ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return;

  // content script 上报：当前 frame 里的 getUserMedia 已成功打开/释放
  if (msg.type === "getusermedia_started" || msg.type === "getusermedia_stopped") {
    if (sender.tab?.id !== undefined) {
      const source = `tab:${sender.tab.id}:${sender.frameId ?? 0}`;
      if (msg.type === "getusermedia_started") addMicSource(source);
      else removeMicSource(source);
    }
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === "ensure_content_scripts") {
    ensureContentScripts()
      .then(sendResponse)
      .catch((e) => sendResponse({ error: String(e?.message || e) }));
    return true; // 异步响应
  }
  if (msg.type === "get_state") {
    sendResponse({
      micActive: state.micSources.size > 0,
      shouldPause: isMicActive(),
      sources: [...state.micSources],
      enabled: state.enabled,
      nativeConnected: state.nativeConnected,
      nativeError: state.nativeError,
    });
    return;
  }
});

// tab 关闭清理
chrome.tabs.onRemoved.addListener((tabId) => {
  removeTabSources(tabId);
});

// ---------- Existing tabs ----------

// 安装、更新、重载或重新启用扩展后，已打开页面里的 content script 缺失或已失效，
// 用户不刷新页面就不会生效。这里先 ping，只给没有响应的页面补注入：
// 仍在工作的页面不重复注入，避免丢失"哪些视频由插件暂停"的状态。
const PING_TIMEOUT_MS = 1000;

function pingTab(tabId) {
  const ping = chrome.tabs.sendMessage(tabId, { type: "ping" }).then((r) => !!r?.ok);
  const timeout = new Promise((resolve) => setTimeout(() => resolve(false), PING_TIMEOUT_MS));
  return Promise.race([ping, timeout]).catch(() => false);
}

async function injectIntoTab(tabId) {
  const manifest = chrome.runtime.getManifest();
  for (const script of manifest.content_scripts || []) {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: !!script.all_frames },
      files: script.js,
      world: script.world || "ISOLATED",
    });
  }
}

async function ensureContentScripts() {
  // 被内存节省模式丢弃的 tab 重新激活时会重新加载，届时会自然注入。
  const tabs = (await getControlledTabs()).filter((tab) => !tab.discarded);
  const results = await Promise.allSettled(tabs.map(async (tab) => {
    if (await pingTab(tab.id)) return false;
    await injectIntoTab(tab.id);
    return true;
  }));
  const injected = results.filter((r) => r.status === "fulfilled" && r.value).length;
  const failed = results.filter((r) => r.status === "rejected").length;
  // 新注入的 content script 启动时会自己查询 get_state，麦克风在用时会立即暂停。
  return { total: tabs.length, injected, failed };
}

// 浏览器启动时唤醒 service worker 并连接 native host（boot 代码会在唤醒时执行）。
chrome.runtime.onStartup.addListener(() => {});

// ---------- Icon ----------

async function refreshIcon() {
  const active = isMicActive();
  try {
    await chrome.action.setBadgeText({ text: active ? "•" : "" });
    await chrome.action.setBadgeBackgroundColor({
      color: active ? "#e74c3c" : "#888888",
    });
  } catch (e) {}
}

// ---------- Settings ----------

async function loadSettings() {
  const { enabled = true } = await chrome.storage.local.get("enabled");
  state.enabled = enabled;
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.enabled) {
    state.enabled = changes.enabled.newValue !== false;
    onMicSourcesChanged();
  }
});

// ---------- Boot ----------

(async () => {
  await loadSettings();
  connectNative();
  refreshIcon();
  // 每次 service worker 启动（含安装、更新、重载、重新启用）都检查一遍已打开的页面。
  ensureContentScripts().catch((e) => {
    console.warn("[mic-pause] ensure content scripts failed", e);
  });
})();
