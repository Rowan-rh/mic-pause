// adapters/index.js
// 适配器路由：根据当前页面 URL 选择对应 adapter
// 所有 adapter 暴露同一个接口：
//   match():  boolean
//   pause():  Promise<{ paused: boolean, reason?: string, elementId?: string }>
//   play():   Promise<{ resumed: boolean }>

(function () {
  const adapters = [];
  if (window.MicPauseAdapter?.youtube) adapters.push(window.MicPauseAdapter.youtube);
  if (window.MicPauseAdapter?.bilibili) adapters.push(window.MicPauseAdapter.bilibili);
  if (window.MicPauseAdapter?.vimeo) adapters.push(window.MicPauseAdapter.vimeo);
  if (window.MicPauseAdapter?.netflix) adapters.push(window.MicPauseAdapter.netflix);
  if (window.MicPauseAdapter?.generic) adapters.push(window.MicPauseAdapter.generic);

  function pick() {
    return adapters.find((a) => {
      try { return a.match(); } catch { return false; }
    }) || null;
  }

  window.MicPauseRouter = {
    pause(videos) {
      const a = pick();
      if (!a) return Promise.resolve({ paused: false, reason: "no adapter" });
      return Promise.resolve(a.pause(videos));
    },
    play() {
      const a = pick();
      if (!a) return Promise.resolve({ resumed: false });
      return Promise.resolve(a.play());
    },
  };
})();
