// adapters/youtube.js
// YouTube 适配：
//   - 优先使用 iframe API 的 postMessage 控制（movie_player / yt-player）
//   - 兜底：直接控制 <video> 元素的 pause/play
//   - 必须只在视频原本就在播放时才暂停（前提条件）

(function () {
  const ADAPTER = (window.MicPauseAdapter = window.MicPauseAdapter || {});

  function findVideo() {
    return document.querySelector("video.html5-main-video, video");
  }

  function postToPlayer(player, cmd, args = []) {
    try {
      player.contentWindow.postMessage(
        JSON.stringify({ event: "command", func: cmd, args }),
        "*"
      );
    } catch (e) {}
  }

  ADAPTER.youtube = {
    name: "youtube",
    match() {
      return /(^|\.)youtube\.com$/.test(location.hostname) ||
             location.hostname === "m.youtube.com" ||
             location.hostname === "youtube.com";
    },

    pause() {
      const v = findVideo();
      if (!v) return { paused: false, reason: "no video" };
      // 前提：原本在播放
      if (v.paused || v.ended || v.readyState < 2) {
        return { paused: false, reason: "not playing" };
      }

      const elementId = v.id || "yt-main";
      // 优先尝试 iframe player API（custom player）
      const iframe = document.querySelector("#movie_player, .html5-video-player iframe");
      if (iframe && iframe.contentWindow) {
        postToPlayer(iframe, "pauseVideo");
      }
      v.pause();
      return { paused: true, elementId };
    },

    play() {
      const v = findVideo();
      if (!v) return { resumed: false };
      // 只恢复原本在播放的（避免拉起用户主动暂停的视频）
      if (v.paused) {
        const iframe = document.querySelector("#movie_player, .html5-video-player iframe");
        if (iframe && iframe.contentWindow) {
          postToPlayer(iframe, "playVideo");
        }
        v.play().catch(() => {});
      }
      return { resumed: true };
    },
  };
})();