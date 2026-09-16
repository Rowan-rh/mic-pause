// adapters/vimeo.js
// Vimeo 适配：优先用 Vimeo Player API（@vimeo/player 或 window.Vimeo.Player），
// 兜底 <video>。

(function () {
  const ADAPTER = (window.MicPauseAdapter = window.MicPauseAdapter || {});

  function findVideo() {
    return document.querySelector("video");
  }

  function findVimeoPlayer() {
    // Vimeo Player JS 会在 player 元素上挂 __vimeoPlayer 或通过事件
    if (window.Vimeo?.Player) {
      const iframe = document.querySelector("iframe[src*='player.vimeo.com']");
      if (iframe) {
        try { return new window.Vimeo.Player(iframe); } catch (e) {}
      }
    }
    return null;
  }

  ADAPTER.vimeo = {
    name: "vimeo",
    match() {
      return location.hostname.endsWith("vimeo.com");
    },

    async pause() {
      const v = findVideo();
      if (!v) return { paused: false, reason: "no video" };
      if (v.paused || v.ended || v.readyState < 2) {
        return { paused: false, reason: "not playing" };
      }
      const player = findVimeoPlayer();
      if (player) {
        try { await player.pause(); } catch (e) {}
      }
      v.pause();
      return { paused: true, elementId: "vimeo-video" };
    },

    async play() {
      const v = findVideo();
      if (!v) return { resumed: false };
      if (!v.paused) return { resumed: false };
      const player = findVimeoPlayer();
      if (player) {
        try { await player.play(); } catch (e) {}
      } else {
        v.play().catch(() => {});
      }
      return { resumed: true };
    },
  };
})();