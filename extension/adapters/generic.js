// adapters/generic.js
// 通用兜底：暂停 content.js 筛选出的所有正在播放的 <video>。
// 注意：前提是用户在调用麦克风前视频就在播放，否则不暂停。

(function () {
  const ADAPTER = (window.MicPauseAdapter = window.MicPauseAdapter || {});

  ADAPTER.generic = {
    name: "generic",
    // 永远匹配，作为兜底
    match() { return true; },

    pause(candidates = []) {
      const playing = candidates.filter((v) => !v.paused && !v.ended);
      if (playing.length === 0) {
        return { paused: false, reason: "no playing video" };
      }
      const elementIds = playing.map((v, i) => v.id || `vid-${i}`);
      playing.forEach((v) => v.pause());
      return { paused: true, elementId: elementIds.join(",") };
    },
  };
})();
