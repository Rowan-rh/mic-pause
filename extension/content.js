// content.js
// 职责：
//   1. 接收 page-bridge.js 转发的网页 getUserMedia 状态
//   2. 监听 background 发送的 pause/play 指令
//   3. 只恢复在麦克风占用期间由本插件暂停过的视频

(function () {
  "use strict";

  // ---------- getUserMedia 状态桥接 ----------
  // page-bridge.js 在网页主世界中监听 getUserMedia，再用 DOM 事件转到这里。
  function reportMic(type) {
    try { chrome.runtime.sendMessage({ type }); } catch (_error) {}
  }

  document.addEventListener("micpause:microphone-started", () => {
    reportMic("getusermedia_started");
  });
  document.addEventListener("micpause:microphone-stopped", () => {
    reportMic("getusermedia_stopped");
  });

  // ---------- 后台指令 ----------
  const pausedByUs = new Set();
  // HTMLMediaElement 的 pause 事件是异步派发的，不能只靠 pauseInProgress
  // 判断，否则事件到达时会误删 pausedByUs。
  const expectedPauses = new Set();
  const videoHandlers = new WeakMap();
  let micActive = false;
  let pauseInProgress = false;
  let enforceTimer = null;

  function isPlaying(video) {
    return video && !video.paused && !video.ended && video.readyState >= 2;
  }

  function isVisible(video) {
    if (video === document.pictureInPictureElement) return true;
    const rect = video.getBoundingClientRect();
    return rect.width > 200 && rect.height > 100;
  }

  function watchVideo(video) {
    if (videoHandlers.has(video)) return;

    const onPause = () => {
      // 这是我们发出的 pause()，保留“由我们暂停”的标记。
      if (!pauseInProgress && !expectedPauses.has(video)) {
        pausedByUs.delete(video);
      }
    };
    const onPlay = () => {
      if (!micActive || pauseInProgress) return;
      queuePauseCheck();
    };

    video.addEventListener("pause", onPause);
    video.addEventListener("play", onPlay);
    videoHandlers.set(video, { onPause, onPlay });
  }

  function findPlayingVideos() {
    return [...document.querySelectorAll("video")].filter((video) => {
      watchVideo(video);
      return isPlaying(video) && isVisible(video);
    });
  }

  function queuePauseCheck() {
    if (enforceTimer !== null) return;
    enforceTimer = setTimeout(() => {
      enforceTimer = null;
      if (micActive) pauseVideos();
    }, 0);
  }

  async function pauseVideos() {
    const candidates = findPlayingVideos();
    if (candidates.length === 0) return { paused: false, reason: "no playing video" };

    candidates.forEach((video) => expectedPauses.add(video));
    pauseInProgress = true;
    let result;
    try {
      result = await Promise.resolve(window.MicPauseRouter?.pause?.());
    } catch (error) {
      candidates.forEach((video) => expectedPauses.delete(video));
      return { paused: false, reason: String(error) };
    } finally {
      pauseInProgress = false;
    }

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
    if (micActive) queuePauseCheck();
  });
  observer.observe(document, { childList: true, subtree: true });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== "cmd") return;
    if (msg.action === "pause") {
      micActive = true;
      pauseVideos()
        .then(sendResponse)
        .catch((error) => sendResponse({ paused: false, reason: String(error) }));
      return true; // 异步响应
    }
    if (msg.action === "play") {
      micActive = false;
      resumeVideos()
        .then(sendResponse)
        .catch((error) => sendResponse({ resumed: false, reason: String(error) }));
      return true;
    }
  });
})();
