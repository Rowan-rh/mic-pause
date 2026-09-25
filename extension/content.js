// content.js
// 职责：
//   1. 接收 page-bridge.js 转发的网页 getUserMedia 状态
//   2. 监听 background 发送的 pause/play 指令
//   3. 只恢复在麦克风占用期间由本插件暂停过的视频

(function () {
  "use strict";

  // 扩展重载 / 补注入时可能已有旧实例，先让旧实例停止工作。
  try { window.__micPauseContent?.dispose?.(); } catch (_error) {}

  // 扩展被重载或卸载后，旧 content script 的 chrome.runtime 会失效。
  function isExtensionAlive() {
    try { return !!chrome.runtime?.id; } catch (_error) { return false; }
  }

  // ---------- getUserMedia 状态桥接 ----------
  // page-bridge.js 在网页主世界中监听 getUserMedia，再用 DOM 事件转到这里。
  let micReportedActive = false;
  function reportMic(type) {
    if (!isExtensionAlive()) return;
    try { chrome.runtime.sendMessage({ type }).catch(() => {}); } catch (_error) {}
  }

  const onMicStarted = () => {
    micReportedActive = true;
    reportMic("getusermedia_started");
  };
  const onMicStopped = () => {
    micReportedActive = false;
    reportMic("getusermedia_stopped");
  };
  const onPageHide = () => {
    if (!micReportedActive) return;
    micReportedActive = false;
    reportMic("getusermedia_stopped");
  };
  document.addEventListener("micpause:microphone-started", onMicStarted);
  document.addEventListener("micpause:microphone-stopped", onMicStopped);
  window.addEventListener("pagehide", onPageHide);

  // ---------- 后台指令 ----------
  const pausedByUs = new Set();
  // HTMLMediaElement 的 pause 事件是异步派发的，不能只靠 pauseInProgress
  // 判断，否则事件到达时会误删 pausedByUs。
  const expectedPauses = new Set();
  const watchedVideos = new Map();
  let micActive = false;
  let pauseInProgress = false;
  let enforceTimer = null;
  let disposed = false;

  function isPlaying(video) {
    // 不要求 readyState：正在缓冲的视频缓冲完会继续播放，同样需要暂停。
    return video && !video.paused && !video.ended;
  }

  // 网页会议的远端/本地画面（srcObject 是 MediaStream）不是"视频内容"，不能暂停。
  function isLiveStream(video) {
    return typeof MediaStream !== "undefined" && video.srcObject instanceof MediaStream;
  }

  function isVisible(video) {
    if (video === document.pictureInPictureElement) return true;
    const rect = video.getBoundingClientRect();
    return rect.width > 200 && rect.height > 100;
  }

  // 尺寸较小但有声音的视频（小窗播放器、音频型视频）也属于正在播放的内容。
  function isAudible(video) {
    return !video.muted && video.volume > 0;
  }

  function watchVideo(video) {
    if (watchedVideos.has(video)) return;

    const onPause = () => {
      // 这是我们发出的 pause()，保留“由我们暂停”的标记。
      if (!pauseInProgress && !expectedPauses.has(video)) {
        pausedByUs.delete(video);
      }
    };
    const onPlay = () => {
      if (!micActive || pauseInProgress) return;
      queuePauseCheck(0);
    };

    video.addEventListener("pause", onPause);
    video.addEventListener("play", onPlay);
    // 缓冲结束真正开始播放时会触发 playing，这里再检查一次。
    video.addEventListener("playing", onPlay);
    watchedVideos.set(video, { onPause, onPlay });
  }

  function unwatchAll() {
    for (const [video, { onPause, onPlay }] of watchedVideos) {
      video.removeEventListener("pause", onPause);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("playing", onPlay);
    }
    watchedVideos.clear();
  }

  // 包含 open shadow root 里的 video（部分播放器用 Web Components 封装）。
  function collectVideos(root, out) {
    for (const video of root.querySelectorAll("video")) out.push(video);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.shadowRoot) collectVideos(node.shadowRoot, out);
    }
    return out;
  }

  function findPlayingVideos() {
    return collectVideos(document, []).filter((video) => {
      watchVideo(video);
      return isPlaying(video) && !isLiveStream(video) && (isVisible(video) || isAudible(video));
    });
  }

  // 动态视频站点会持续改 DOM。DOM 变化触发的检查限制扫描频率，避免麦克风打开时
  // 因播放器和广告节点更新造成额外布局读取；play 事件和首次 pause 指令立即执行。
  function queuePauseCheck(delay) {
    if (enforceTimer !== null || disposed) return;
    enforceTimer = setTimeout(() => {
      enforceTimer = null;
      if (!isExtensionAlive()) {
        dispose();
        return;
      }
      if (micActive) pauseVideos();
    }, delay);
  }

  async function pauseVideos() {
    const candidates = findPlayingVideos();
    if (candidates.length === 0) return { paused: false, reason: "no playing video" };

    candidates.forEach((video) => expectedPauses.add(video));
    pauseInProgress = true;
    let result;
    try {
      // 站点适配器可能调用播放器自身的 API；它只处理自己认定的主视频。
      result = await Promise.resolve(window.MicPauseRouter?.pause?.(candidates));
    } catch (error) {
      result = { reason: String(error) };
    }
    // 适配器没处理到的（选错了 video、多个视频等）直接暂停，保证不漏。
    for (const video of candidates) {
      if (!video.paused) {
        try { video.pause(); } catch (_error) {}
      }
    }
    pauseInProgress = false;

    const paused = candidates.filter((video) => video.paused && !video.ended);
    paused.forEach((video) => pausedByUs.add(video));
    candidates
      .filter((video) => !paused.includes(video))
      .forEach((video) => expectedPauses.delete(video));
    return {
      ...(result || {}),
      paused: paused.length > 0,
      elementId: paused.map((video) => video.id || "video").join(","),
    };
  }

  async function resumeVideos() {
    const candidates = [...pausedByUs];
    pausedByUs.clear();
    expectedPauses.clear();
    let resumed = false;
    for (const video of candidates) {
      if (!video.isConnected || video.ended || !video.paused) continue;
      try {
        await video.play();
        resumed = true;
      } catch (_error) {}
    }
    return { resumed };
  }

  const observer = new MutationObserver(() => {
    // DOM 变化可能非常频繁，合并成一次检查。
    if (micActive) queuePauseCheck(50);
  });

  function startWatchingPageChanges() {
    observer.observe(document, { childList: true, subtree: true });
  }

  function stopWatchingPageChanges() {
    observer.disconnect();
    if (enforceTimer !== null) {
      clearTimeout(enforceTimer);
      enforceTimer = null;
    }
  }

  function onMessage(msg, _sender, sendResponse) {
    if (disposed || !msg) return;
    // background 用来确认本页面的 content script 仍在工作。
    if (msg.type === "ping") {
      sendResponse({ ok: true });
      return;
    }
    if (msg.type !== "cmd") return;
    if (msg.action === "pause") {
      micActive = true;
      startWatchingPageChanges();
      pauseVideos()
        .then(sendResponse)
        .catch((error) => sendResponse({ paused: false, reason: String(error) }));
      return true; // 异步响应
    }
    if (msg.action === "play") {
      micActive = false;
      stopWatchingPageChanges();
      resumeVideos()
        .then(sendResponse)
        .catch((error) => sendResponse({ resumed: false, reason: String(error) }));
      return true;
    }
  }
  chrome.runtime.onMessage.addListener(onMessage);

  function dispose() {
    if (disposed) return;
    disposed = true;
    micActive = false;
    observer.disconnect();
    if (enforceTimer !== null) clearTimeout(enforceTimer);
    enforceTimer = null;
    unwatchAll();
    document.removeEventListener("micpause:microphone-started", onMicStarted);
    document.removeEventListener("micpause:microphone-stopped", onMicStopped);
    window.removeEventListener("pagehide", onPageHide);
    try { chrome.runtime.onMessage.removeListener(onMessage); } catch (_error) {}
  }

  window.__micPauseContent = { dispose };

  // 麦克风已经在使用时，新打开的页面 / iframe 也要暂停之后开始播放的视频。
  try {
    chrome.runtime.sendMessage({ type: "get_state" }).then((resp) => {
      if (disposed || !resp?.shouldPause) return;
      micActive = true;
      startWatchingPageChanges();
      queuePauseCheck(0);
    }).catch(() => {});
  } catch (_error) {}
})();
