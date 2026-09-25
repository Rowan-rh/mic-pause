// adapters/vimeo.js
// Vimeo 适配：有 Vimeo Player API（window.Vimeo.Player）时顺带通知播放器暂停，
// 同时直接暂停 <video>。

(function () {
  const ADAPTER = (window.MicPauseAdapter = window.MicPauseAdapter || {});

  function findVideo(candidates) {
    return candidates[0] || document.querySelector("video");
  }

  function findVimeoPlayer() {
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
      return /(^|\.)vimeo\.com$/.test(location.hostname);
    },

    pause(candidates = []) {
      const v = findVideo(candidates);
      if (!v) return { paused: false, reason: "no video" };
      if (v.paused || v.ended) {
        return { paused: false, reason: "not playing" };
      }
      // 不等待 Player API：播放器未就绪时它的 Promise 可能一直不返回。
      findVimeoPlayer()?.pause().catch(() => {});
      v.pause();
      return { paused: true, elementId: "vimeo-video" };
    },
  };
})();
