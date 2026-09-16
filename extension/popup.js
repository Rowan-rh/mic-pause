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
  chrome.runtime.sendMessage({ type: "get_state" }, (resp) => {
    if (!resp) {
      status.textContent = "未连接到 background。";
      return;
    }
    setStatus(resp);
  });

  // 监听 storage 变化，保持 popup 同步
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.enabled) {
      setToggle(changes.enabled.newValue);
    }
  });

  // 简单轮询状态（service worker 不会主动 push 到 popup）
  setInterval(() => {
    chrome.runtime.sendMessage({ type: "get_state" }, (resp) => {
      if (resp) setStatus(resp);
    });
  }, 1000);

  function setToggle(on) {
    toggle.classList.toggle("on", on);
  }

  function setStatus(s) {
    dot.classList.toggle("active", s.micActive && s.enabled);
    if (!s.enabled) {
      status.textContent = "已关闭 — 不会自动暂停";
      return;
    }
    if (s.micActive) {
      status.textContent = `麦克风使用中：${s.sources.join(", ")}`;
    } else {
      status.textContent = "麦克风空闲";
    }
  }
})();