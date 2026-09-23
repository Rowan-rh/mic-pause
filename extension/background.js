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
  excludedSites: [],
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

function addMicSource(src) {
  if (state.micSources.has(src)) return;
  const wasInactive = state.micSources.size === 0;
  state.micSources.add(src);
  if (wasInactive) syncControlledTabs();
  refreshIcon();
}

function removeMicSource(src) {
  if (!state.micSources.has(src)) return;
  state.micSources.delete(src);
  if (state.micSources.size === 0) syncControlledTabs();
  refreshIcon();
}

// ---------- Tab broadcast ----------

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

async function syncControlledTabs() {
  const controlled = await getControlledTabs();
  const shouldPause = state.enabled && state.micSources.size > 0;
  await Promise.all(controlled.map((tab) => sendTabCommand(
    tab,
    shouldPause && !isExcludedUrl(tab.url) ? "pause" : "play"
  )));
}

async function sendTabCommand(tab, action) {
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "cmd", action });
  } catch (_error) {
    // tab 可能还没加载 content script 或已关闭
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

function getTabMicSource(sender) {
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId)) return null;
  const frameId = Number.isInteger(sender.frameId) ? sender.frameId : 0;
  return frameId === 0 ? `tab:${tabId}` : `tab:${tabId}:frame:${frameId}`;
}

function removeTabMicSources(tabId) {
  const topFrameSource = `tab:${tabId}`;
  const childFramePrefix = `${topFrameSource}:frame:`;
  for (const source of [...state.micSources]) {
    if (source === topFrameSource || source.startsWith(childFramePrefix)) {
      removeMicSource(source);
    }
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return;

  // content script 上报：当前 tab 里的 getUserMedia 已成功打开/释放
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
  if (msg.type === "get_state") {
    sendResponse({
      micActive: state.micSources.size > 0,
      sources: [...state.micSources],
      enabled: state.enabled,
      excludedSites: [...state.excludedSites],
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
  if (changeInfo.status !== "complete" || !state.enabled || state.micSources.size === 0) {
    return;
  }
  if (tab) sendTabCommand(tab, isExcludedUrl(tab.url) ? "play" : "pause");
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
    state.enabled = !!changes.enabled.newValue;
    syncControlledTabs();
  }
  if (changes.excludedSites) {
    const value = changes.excludedSites.newValue;
    state.excludedSites = Array.isArray(value) ? value.map(normalizeHost).filter(Boolean) : [];
    syncControlledTabs();
  }
});

// ---------- Boot ----------

(async () => {
  await loadSettings();
  connectNative();
  refreshIcon();
})();
