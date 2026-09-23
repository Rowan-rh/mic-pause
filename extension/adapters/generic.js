// adapters/generic.js
// 通用兜底：找页面上任何一个可见、正在播放的 <video>。
// 注意：前提是用户在调用麦克风前视频就在播放，否则不暂停。

(function () {
  const ADAPTER = (window.MicPauseAdapter = window.MicPauseAdapter || {});

  function isVisible(v) {
    if (!v) return false;
    const rect = v.getBoundingClientRect();
    return rect.width > 200 && rect.height > 100;
  }

  function findPlayingVideos(candidates) {
    const videos = candidates || [...document.querySelectorAll("video")];
    return videos.filter((v) =>
      !v.paused && !v.ended && v.readyState >= 2 && (candidates || isVisible(v))
    );
  }

  ADAPTER.generic = {
    name: "generic",
    // 永远匹配，作为兜底
    match() { return true; },

    pause(candidates) {
      const playing = findPlayingVideos(candidates);
      if (playing.length === 0) {
        return { paused: false, reason: "no playing video" };
      }
      const elementIds = [];
      for (const v of playing) {
        const id = v.id || `vid-${playing.indexOf(v)}`;
        v.pause();
        elementIds.push(id);
      }
      return { paused: true, elementId: elementIds.join(",") };
    },

    play() {
      const videos = [...document.querySelectorAll("video")];
      for (const v of videos) {
        if (v.paused) v.play().catch(() => {});
      }
      return { resumed: true };
    },
  };
})();
