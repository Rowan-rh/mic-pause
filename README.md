# Mic Pause

检测 macOS 系统级麦克风占用，自动暂停浏览器中正在播放的视频；麦克风释放后只恢复由插件暂停的视频。

## 功能

- **双通道检测**：浏览器内 `getUserMedia` 拦截 + macOS 系统级 CoreAudio 监听
- **桌面应用全覆盖**：Zoom / 飞书 / QQ / 腾讯会议 / 任何占用输入设备的 app 都会触发
- **前提保护**：视频原本不在播就不暂停；用户主动暂停的视频不会被强行恢复
- **多源聚合**：多个麦克风源同时占用时，等全部释放才恢复播放
- **浏览器页面全覆盖**：普通 HTTP/HTTPS 页面上的 `<video>` 都会处理，YouTube、Bilibili、Vimeo、Netflix 有专用适配器
- **适配器架构**：每个站点单独写 selector / player API，便于按需扩展

## 工作流

```
麦克风开始使用 ──┬──► Chrome (getUserMedia 劫持) ──┐
                │                                  ▼
                └──► CoreAudio (kAudioDevicePropertyDeviceIsRunningSomewhere)
                                                       │
                                                       ▼
                          background.js 聚合 micSources 集合
                                                       │
                                       micSources 非空 ──► 暂停所有受控 tab
                                       micSources 为空 ──► 恢复被我们暂停的 tab
```

## 目录结构

```
mic-pause/
├── extension/
│   ├── manifest.json
│   ├── background.js          # service worker：native host + tab 调度
│   ├── content.js             # 接收麦克风状态 + 视频暂停/恢复
│   ├── page-bridge.js         # 主世界 getUserMedia 状态桥接
│   ├── popup.html / popup.js  # 开关 + 状态显示
│   ├── adapters/
│   │   ├── index.js           # 路由
│   │   ├── youtube.js
│   │   ├── bilibili.js
│   │   ├── vimeo.js
│   │   ├── netflix.js
│   │   └── generic.js         # 兜底：任意 <video>
│   └── icons/
└── native-host/
    ├── mic-monitor.swift      # Swift + CoreAudio
    ├── build.sh               # 编译到当前目录的 mic-monitor
    ├── install.sh             # 注册到 Chrome NativeMessagingHosts
    └── com.micpause.host.json
```

## 安装

### 1. 加载扩展并复制扩展 ID

1. 打开 `chrome://extensions`
2. 开启右上角"开发者模式"
3. 点击"加载已解压的扩展程序"，选择 `extension/` 目录
4. 复制扩展 ID（一串 32 位字母）

### 2. 编译并注册 native host

```bash
cd native-host
./install.sh <扩展 ID>
```

这一步会：

- 编译 `mic-monitor.swift` 到 `native-host/mic-monitor`
- 写入 manifest 到 `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.micpause.host.json`

然后在 `chrome://extensions` 点击扩展的刷新按钮。已打开的网页会自动补注入脚本，无需逐个刷新。

注意事项：

- 解压加载的扩展 ID 由目录路径决定。**移动项目目录后扩展 ID 会变**，需要用新 ID 重跑 `install.sh`。
- 不要把项目放在 `/tmp`、`~/Downloads`、`~/Desktop`、`~/Documents` 下：可能被系统清理，或因 macOS 隐私保护导致浏览器无法启动 native host。
- 脚本总会写入 Google Chrome 的配置；若检测到 Chrome Beta/Canary、Chromium、Edge、Brave 的配置目录，也会一并写入。
- 点击扩展图标，若提示"未连接 native host"，说明只能检测浏览器内的麦克风，桌面应用不会触发暂停，括号里是 Chrome 给出的具体原因。

如果 Chrome 弹出麦克风权限提示，请允许；桌面应用的麦克风使用由 macOS CoreAudio 监听，不需要网页权限。

也可以手动编辑：

```bash
vim ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.micpause.host.json
```

把 `EXTENSION_ID_HERE` 替换成实际 ID。

### 3. 重启 Chrome（如果 native host 仍未连接）

让 Chrome 重新加载 native messaging 配置。

## 验证

打开终端手动跑一次：

```bash
./native-host/mic-monitor
```

应该看到第一行输出 JSON 到 stdout（Chrome 模式下），如果直接终端跑会被 CoreAudio 调用阻塞，没问题。

更直观的测试：
1. 打开任意网页视频，先确认它正在播放
2. 在任意桌面应用调麦克风（如 QuickTime、Zoom、飞书、腾讯会议）
3. 视频应该暂停
4. 关闭麦克风占用，视频应该继续播放

或者用 QuickTime Player 的"新建音频录制"——这是系统级麦克风占用，会触发 macOS CoreAudio 回调。

## 添加新站点

`content.js` 会先筛选出所有应当暂停的正在播放的 `<video>`（`candidates`），再交给站点适配器；适配器可以用播放器自己的 API 暂停主视频，没处理到的候选视频由 `content.js` 兜底直接暂停。恢复播放由 `content.js` 统一处理，只恢复由插件暂停的视频，适配器不需要实现。

每个适配器是一个对象，导出 `match/pause`：

```js
window.MicPauseAdapter.example = {
  match() { return location.hostname.endsWith("example.com"); },
  pause(candidates = []) {
    const v = candidates.find((v) => v.matches(".main-player video")) || candidates[0];
    if (!v || v.paused) return { paused: false, reason: "not playing" };
    v.pause();
    return { paused: true, elementId: "ex-video" };
  },
};
```

然后在 `manifest.json` 的 `content_scripts` 加对应 match pattern 和 `js` 列表。

## 已知限制

- **只支持 macOS**：native host 用了 CoreAudio。Linux/Windows 需要重写 monitor（PulseAudio / WASAPI）。
- **Chrome 105+**：用了 Manifest V3、主世界内容脚本，并依赖 native messaging 连接让 service worker 保持存活。
- **权限范围**：扩展需要 `<all_urls>` 才能控制任意网页视频；Native host 只监听麦克风输入设备的使用状态，不读取或保存音频内容。
- **service worker 重启**：Chrome 105+ 中 native messaging 连接会让 service worker 保持存活；若 service worker 仍被重启，重新连接后 `init` 消息会重新汇报状态。
- **iframe / Shadow DOM**：内容脚本注入所有 frame（`all_frames`），iframe 内的视频也会暂停；open shadow root 内的视频会被找到，closed shadow root 无法访问。
- **不暂停的视频**：网页会议的实时画面（`srcObject` 为 `MediaStream`）、尺寸小于 200×100 且静音的视频（通常是预览或装饰动画）。
- **耳麦类设备**：同时带输入和输出的设备（USB/蓝牙耳麦）在不支持 CoreAudio 进程对象的旧版 macOS 上只能用设备级状态判断，播放声音也可能被误判为麦克风占用。

## 调试

扩展日志：

```bash
chrome://extensions → Mic Pause → service worker → Inspect
```

Native host 日志写到 stderr（Chrome 不读 stderr，所以你看 Chrome 调试日志是看不到的）。手动跑：

```bash
./native-host/mic-monitor 2>/tmp/mic-monitor.log
```

## License

MIT
