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
  micSources: new Set(),
  // 设置
  enabled: true,
  excludedSites: [],
  // native port
  port: null,
  nativeConnected: false,
  nativeError: "",
  // 重连 backoff
  reconnectTimer: null,
  // tab 同步：同一时刻只跑一轮，期间有变化则在结束后按最新状态再跑一轮
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
      removeMicSource("system");
      break;
    case "error":
      console.error("[mic-pause] native error:", msg.message);
      break;
    default:
      break;
  }
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

function onMicSourcesChanged() {
  if (!state.initialSynced || isMicActive() !== state.lastActive) {
    state.initialSynced = true;
    syncControlledTabs();
  }
  refreshIcon();
}

// ---------- Tab sync ----------

function normalizeHost(host) {
  return String(host || "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");
}

function isExcludedUrl(url) {
  try {
    const host = normalizeHost(new URL(url).hostname);
    return state.excludedSites.some((site) => {
      const excludedHost = normalizeHost(site);
      return host === excludedHost || host.endsWith(`.${excludedHost}`);
    });
  } catch (_error) {
    return false;
  }
}

function shouldPauseUrl(url) {
  return isMicActive() && !isExcludedUrl(url);
}

// 始终按"当前"状态同步，而不是排队执行历史指令：麦克风短暂开关时，
// 不会出现 play 先到、pause 后到导致视频一直被暂停的情况。
async function syncControlledTabs() {
  if (state.syncRunning) {
    state.syncPending = true;
    return;
  }
  state.syncRunning = true;
  try {
    do {
      state.syncPending = false;
      state.lastActive = isMicActive();
      const controlled = await getControlledTabs();
      await Promise.allSettled(controlled.map((tab) => sendTabCommand(
        tab,
        shouldPauseUrl(tab.url) ? "pause" : "play"
      )));
    } while (state.syncPending);
  } finally {
    state.syncRunning = false;
  }
}

function sendTabCommand(tab, action) {
  const send = chrome.tabs.sendMessage(tab.id, { type: "cmd", action });
  const timeout = new Promise((resolve) => setTimeout(resolve, SEND_TIMEOUT_MS));
  // tab 可能还没加载 content script 或已关闭
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

function getTabMicSource(sender) {
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId)) return null;
  const frameId = Number.isInteger(sender.frameId) ? sender.frameId : 0;
  return frameId === 0 ? `tab:${tabId}` : `tab:${tabId}:frame:${frameId}`;
}

function removeTabMicSources(tabId) {
  const topFrameSource = `tab:${tabId}`;
  const childFramePrefix = `${topFrameSource}:frame:`;
  let changed = false;
  for (const source of [...state.micSources]) {
    if (source === topFrameSource || source.startsWith(childFramePrefix)) {
      state.micSources.delete(source);
      changed = true;
    }
  }
  if (changed) onMicSourcesChanged();
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return;

  // content script 上报：当前 frame 里的 getUserMedia 已成功打开/释放
  if (msg.type === "getusermedia_started") {
    const source = getTabMicSource(sender);
    if (source) addMicSource(source);
    sendResponse({ ok: !!source });
    return;
  }
  if (msg.type === "getusermedia_stopped") {
    const source = getTabMicSource(sender);
    if (source) removeMicSource(source);
    sendResponse({ ok: !!source });
    return;
  }
  if (msg.type === "ensure_content_scripts") {
    ensureContentScripts()
      .then(sendResponse)
      .catch((e) => sendResponse({ error: String(e?.message || e) }));
    return true; // 异步响应
  }
  if (msg.type === "get_state") {
    // content script 查询时按所在页面判断（例外网站不暂停）。
    const pageUrl = sender.tab?.url || sender.url;
    sendResponse({
      micActive: state.micSources.size > 0,
      shouldPause: pageUrl ? shouldPauseUrl(pageUrl) : isMicActive(),
      sources: [...state.micSources],
      enabled: state.enabled,
      excludedSites: [...state.excludedSites],
      nativeConnected: state.nativeConnected,
      nativeError: state.nativeError,
    });
    return;
  }
});

// tab 关闭清理
chrome.tabs.onRemoved.addListener((tabId) => {
  removeTabMicSources(tabId);
});

// 页面导航会销毁旧文档中的 MediaStreamTrack；清掉该 tab 的旧 GUM 标记，
// 但不让 CoreAudio 的状态变化覆盖仍有效的网页来源。
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading") {
    removeTabMicSources(tabId);
    return;
  }

  // 麦克风已经在使用时，新打开或刚完成加载的页面也要立即暂停视频。
  if (changeInfo.status !== "complete" || !isMicActive()) {
    return;
  }
  if (tab) sendTabCommand(tab, isExcludedUrl(tab.url) ? "play" : "pause");
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
  const { enabled = true, excludedSites = [] } = await chrome.storage.local.get([
    "enabled",
    "excludedSites",
  ]);
  state.enabled = enabled;
  state.excludedSites = Array.isArray(excludedSites)
    ? excludedSites.map(normalizeHost).filter(Boolean)
    : [];
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.enabled) {
    state.enabled = changes.enabled.newValue !== false;
    onMicSourcesChanged();
  }
  if (changes.excludedSites) {
    const value = changes.excludedSites.newValue;
    state.excludedSites = Array.isArray(value) ? value.map(normalizeHost).filter(Boolean) : [];
    // 例外列表变化不改变全局状态，但会改变具体 tab 的指令，需要直接同步。
    syncControlledTabs();
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
