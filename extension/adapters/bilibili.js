// adapters/bilibili.js
// B站适配：B 站把 video 元素放在 bpx-player 容器里，有时被 Shadow DOM 包裹。
// 这里直接走 document 范围的 video 元素，加上 B 站特定 class 兜底。

(function () {
  const ADAPTER = (window.MicPauseAdapter = window.MicPauseAdapter || {});

  function findVideo() {
    return (
      document.querySelector("bpx-player-video video") ||
      document.querySelector(".bpx-player-video-wrap video") ||
      document.querySelector("video[src], video") ||
      null
    );
  }

  // B 站的 player JS 全局对象
  function getBiliPlayer() {
    return window.player || window.__BiliPlayer__ || null;
  }

  ADAPTER.bilibili = {
    name: "bilibili",
    match() {
      return location.hostname.endsWith("bilibili.com");
    },

    pause() {
      const v = findVideo();
      if (!v) return { paused: false, reason: "no video" };
      if (v.paused || v.ended || v.readyState < 2) {
        return { paused: false, reason: "not playing" };
      }
      const elementId = "bili-video";
      v.pause();
      return { paused: true, elementId };
    },

    play() {
      const v = findVideo();
      if (!v) return { resumed: false };
      if (v.paused) v.play().catch(() => {});
      return { resumed: true };
    },
  };
})();