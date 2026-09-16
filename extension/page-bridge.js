// page-bridge.js
// 运行在网页主世界：监听网页自己的 getUserMedia 调用。
// 主世界不能直接调用 chrome.runtime，因此通过 DOM 事件通知隔离世界的 content.js。

(function () {
  "use strict";

  if (window.__micPausePageBridgeInstalled) return;
  window.__micPausePageBridgeInstalled = true;

  const mediaDevices = navigator.mediaDevices;
  if (!mediaDevices || typeof mediaDevices.getUserMedia !== "function") return;

  const original = mediaDevices.getUserMedia.bind(mediaDevices);
  const activeStreams = new Set();

  function emit(name) {
    document.dispatchEvent(new CustomEvent(name));
  }

  function release(stream) {
    if (!activeStreams.delete(stream)) return;
    if (activeStreams.size === 0) emit("micpause:microphone-stopped");
  }

  function watch(stream) {
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) return;

    const checkReleased = () => {
      if (audioTracks.every((track) => track.readyState === "ended")) {
        release(stream);
      }
    };

    activeStreams.add(stream);
    if (activeStreams.size === 1) emit("micpause:microphone-started");

    for (const track of audioTracks) {
      track.addEventListener("ended", checkReleased);

      // MediaStreamTrack.stop() normally does not fire "ended".
      try {
        const originalStop = track.stop.bind(track);
        track.stop = function (...args) {
          const result = originalStop(...args);
          checkReleased();
          return result;
        };
      } catch (_error) {
        // A page may expose a non-writable track object; the ended listener
        // still handles the normal device-release path.
      }
    }
  }

  mediaDevices.getUserMedia = function (...args) {
    const constraints = args[0];
    const wantsAudio = constraints && (
      constraints.audio === true || typeof constraints.audio === "object"
    );

    const request = original(...args);
    if (!wantsAudio) return request;

    return request.then((stream) => {
      watch(stream);
      return stream;
    });
  };
})();
