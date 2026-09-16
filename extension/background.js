// background.js (service worker / module)
// 职责：
//   1. 连接 native messaging host，监听系统级麦克风占用事件
//   2. 接收并转发 getUserMedia 拦截事件（来自 content script）
//   3. 汇总"麦克风是否在用"的全局状态，向所有受控 tab 广播 pause/play
//   4. 处理 popup 设置同步

const NATIVE_HOST_NAME = "com.micpause.host";

const state = {
  // 麦克风占用来源计数（用于多源场景：Zoom 在用 + 浏览器录音同时进行）
  micSources: new Set(),
  // 设置
  enabled: true,
  // native port
  port: null,
  // 重连 backoff
  reconnectTimer: null,
};

// ---------- Native messaging ----------

function connectNative() {
  if (state.port) return;
  try {
    state.port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    state.port.onMessage.addListener(onNativeMessage);
    state.port.onDisconnect.addListener(() => {
      const err = chrome.runtime.lastError;
      console.warn("[mic-pause] native host disconnected", err?.message);
      state.port = null;
      scheduleReconnect();
    });
    console.log("[mic-pause] native host connected");
  } catch (e) {
    console.error("[mic-pause] connectNative failed", e);
    state.port = null;
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
  switch (msg.type) {
    case "init":
      console.log("[mic-pause] native init, running=", msg.running);
      if (msg.running) addMicSource("system");
      else removeMicSource("system");
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
  if (state.micSources.size === 0 && state.enabled) broadcastPlay();
  refreshIcon();
}

// ---------- Mic source aggregation ----------

function addMicSource(src) {
  if (state.micSources.has(src)) return;
  const wasInactive = state.micSources.size === 0;
  state.micSources.add(src);
  if (wasInactive && state.enabled) broadcastPause();
  refreshIcon();
}

function removeMicSource(src) {
  if (!state.micSources.has(src)) return;
  state.micSources.delete(src);
  if (state.micSources.size === 0) {
    if (state.enabled) broadcastPlay();
  }
  refreshIcon();
}

// ---------- Tab broadcast ----------

async function broadcastPause() {
  // 受控站点列表
  const controlled = await getControlledTabs();
  for (const tab of controlled) {
    // 跳过已经在播放的就跳过：content script 内部判断
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "cmd", action: "pause" });
    } catch (e) {
      // tab 可能没加载 content script 或已关闭
    }
  }
}

async function broadcastPlay() {
  const controlled = await getControlledTabs();
  for (const tab of controlled) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "cmd", action: "play" });
    } catch (e) {}
  }
}

async function getControlledTabs() {
  try {
    // 不再限制 audible：静音视频、刚开始加载的视频也应被暂停。
    return await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  } catch (e) {
    return [];
  }
}

// ---------- Content script messages ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return;

  // content script 上报：当前 tab 里的 getUserMedia 已成功打开/释放
  if (msg.type === "getusermedia_started") {
    addMicSource(`tab:${sender.tab?.id}`);
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === "getusermedia_stopped") {
    removeMicSource(`tab:${sender.tab?.id}`);
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === "get_state") {
    sendResponse({
      micActive: state.micSources.size > 0,
      sources: [...state.micSources],
      enabled: state.enabled,
    });
    return;
  }
});

// tab 关闭清理
chrome.tabs.onRemoved.addListener((tabId) => {
  removeMicSource(`tab:${tabId}`);
});

// 麦克风已经在使用时，新打开或刚完成加载的页面也要立即暂停视频。
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete" || !state.enabled || state.micSources.size === 0) {
    return;
  }
  chrome.tabs.sendMessage(tabId, { type: "cmd", action: "pause" }).catch(() => {});
});

// ---------- Icon ----------

async function refreshIcon() {
  const active = state.micSources.size > 0 && state.enabled;
  // 简单的占位：Chrome 暂未提供程序化修改 action 图标的便利 API（除非用 declarativeNetRequest 之类的）
  // 实际项目里可以用 chrome.action.setIcon / setBadgeText
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
    state.enabled = !!changes.enabled.newValue;
    if (!state.enabled && state.micSources.size > 0) {
      broadcastPlay();
    } else if (state.enabled && state.micSources.size > 0) {
      broadcastPause();
    }
  }
});

// ---------- Boot ----------

(async () => {
  await loadSettings();
  connectNative();
  refreshIcon();
})();
