// popup.js
(async function () {
  const toggle = document.getElementById("toggle");
  const status = document.getElementById("status");
  const dot = document.getElementById("dot");

  // 读取启用状态
  const { enabled = true } = await chrome.storage.local.get("enabled");
  setToggle(enabled);

  toggle.addEventListener("click", async () => {
    const next = !toggle.classList.contains("on");
    await chrome.storage.local.set({ enabled: next });
    setToggle(next);
  });

  // 拉取当前状态
  function refresh() {
    chrome.runtime.sendMessage({ type: "get_state" }, (resp) => {
      if (chrome.runtime.lastError || !resp) {
        status.textContent = "未连接到 background。";
        return;
      }
      setStatus(resp);
    });
  }
  refresh();

  // 监听 storage 变化，保持 popup 同步
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.enabled) {
      setToggle(changes.enabled.newValue);
    }
  });

  // 简单轮询状态（service worker 不会主动 push 到 popup）
  setInterval(refresh, 1000);

  function setToggle(on) {
    toggle.classList.toggle("on", on);
  }

  function setStatus(s) {
    dot.classList.toggle("active", s.micActive && s.enabled);
    if (!s.enabled) {
      status.textContent = "已关闭 — 不会自动暂停";
      return;
    }
    const mic = s.micActive
      ? `麦克风使用中：${s.sources.join(", ")}`
      : "麦克风空闲";
    // native host 没连上时只能检测到浏览器内的麦克风，桌面应用不会触发暂停。
    const native = s.nativeConnected
      ? ""
      : `\n⚠ 未连接 native host，桌面应用的麦克风无法检测${s.nativeError ? `（${s.nativeError}）` : ""}`;
    status.textContent = mic + native;
  }
})();