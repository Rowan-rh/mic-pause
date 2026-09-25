// adapters/netflix.js
// Netflix 适配：直接控制 <video>。Netflix 用 EME/DRM，pause 元素本身没问题。

(function () {
  const ADAPTER = (window.MicPauseAdapter = window.MicPauseAdapter || {});

  function findVideo(candidates) {
    return candidates[0] || document.querySelector("video");
  }

  ADAPTER.netflix = {
    name: "netflix",
    match() {
      return /(^|\.)netflix\.com$/.test(location.hostname);
    },

    pause(candidates = []) {
      const v = findVideo(candidates);
      if (!v) return { paused: false, reason: "no video" };
      if (v.paused || v.ended) {
        return { paused: false, reason: "not playing" };
      }
      v.pause();
      return { paused: true, elementId: "nf-video" };
    },
  };
})();
