// adapters/bilibili.js
// B站适配：B 站把 video 元素放在 bpx-player 容器里。
// 优先选播放器容器内的 video，其余候选视频由 content.js 兜底暂停。

(function () {
  const ADAPTER = (window.MicPauseAdapter = window.MicPauseAdapter || {});

  const PLAYER_VIDEO = ".bpx-player-video-wrap video, .bpx-player-video-area video";

  function findVideo(candidates) {
    return (
      candidates.find((v) => v.matches(PLAYER_VIDEO)) ||
      candidates[0] ||
      document.querySelector(PLAYER_VIDEO) ||
      document.querySelector("video")
    );
  }

  ADAPTER.bilibili = {
    name: "bilibili",
    match() {
      return /(^|\.)bilibili\.com$/.test(location.hostname);
    },

    pause(candidates = []) {
      const v = findVideo(candidates);
      if (!v) return { paused: false, reason: "no video" };
      if (v.paused || v.ended) {
        return { paused: false, reason: "not playing" };
      }
      v.pause();
      return { paused: true, elementId: "bili-video" };
    },
  };
})();
