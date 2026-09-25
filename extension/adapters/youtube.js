// adapters/youtube.js
// YouTube 适配：
//   - 优先暂停主播放器 video.html5-main-video，避免选中首页悬停预览等其它 video
//   - 必须只在视频原本就在播放时才暂停（前提条件）
//   - 适配器没处理到的候选视频由 content.js 兜底暂停

(function () {
  const ADAPTER = (window.MicPauseAdapter = window.MicPauseAdapter || {});

  function findVideo(candidates) {
    return (
      candidates.find((v) => v.matches("video.html5-main-video")) ||
      candidates[0] ||
      document.querySelector("video.html5-main-video") ||
      document.querySelector("video")
    );
  }

  ADAPTER.youtube = {
    name: "youtube",
    match() {
      return /(^|\.)youtube\.com$/.test(location.hostname);
    },

    pause(candidates = []) {
      const v = findVideo(candidates);
      if (!v) return { paused: false, reason: "no video" };
      // 前提：原本在播放
      if (v.paused || v.ended) {
        return { paused: false, reason: "not playing" };
      }
      v.pause();
      return { paused: true, elementId: v.id || "yt-main" };
    },
  };
})();
