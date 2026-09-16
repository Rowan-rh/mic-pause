// adapters/netflix.js
// Netflix 适配：直接控制 <video>。Netflix 用 EME/DRM，pause 元素本身没问题。

(function () {
  const ADAPTER = (window.MicPauseAdapter = window.MicPauseAdapter || {});

  function findVideo() {
    return document.querySelector("video");
  }

  ADAPTER.netflix = {
    name: "netflix",
    match() {
      return location.hostname.endsWith("netflix.com");
    },

    pause() {
      const v = findVideo();
      if (!v) return { paused: false, reason: "no video" };
      if (v.paused || v.ended || v.readyState < 2) {
        return { paused: false, reason: "not playing" };
      }
      v.pause();
      return { paused: true, elementId: "nf-video" };
    },

    play() {
      const v = findVideo();
      if (!v) return { resumed: false };
      if (v.paused) v.play().catch(() => {});
      return { resumed: true };
    },
  };
})();