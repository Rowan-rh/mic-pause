# Mic Pause

**检测到任意应用正在使用麦克风时，自动暂停浏览器视频；麦克风空闲后，只恢复由 Mic Pause 暂停的视频。**

Mic Pause 由 Chrome 扩展和一个轻量级 macOS 原生程序组成。它会检测桌面应用和网页的麦克风活动，并在麦克风使用期间暂停浏览器标签页中可见的视频。

[English](README.md) · [贡献指南](CONTRIBUTING.md)

## 功能

- 监听 macOS 输入设备的使用状态，包括应用自行选择的输入设备。
- 检测网页通过 `getUserMedia` 建立的音频流。
- 暂停 HTTP 和 HTTPS 标签页中的可见视频，包括静音视频。
- 只恢复自己暂停的视频；用户原本暂停的视频会保持暂停。
- 所有检测到的麦克风来源都停止后，才恢复视频。
- 支持 YouTube、Bilibili、Vimeo、Netflix，并提供通用 HTML 视频适配器。
- 可设置例外域名；添加一个域名后，其子域名也会被排除。

## 环境要求

- macOS
- Google Chrome 102 或更高版本
- Xcode Command Line Tools，用于提供编译原生程序所需的 Swift 编译器

扩展使用 Manifest V3。仓库提供的安装脚本会为 Google Chrome 注册原生程序。其他 Chromium 浏览器可能需要将原生程序手动注册到对应浏览器的 Native Messaging 目录。

## 从源码安装

1. 下载或克隆仓库源码。
2. 在 Chrome 打开 `chrome://extensions`，开启**开发者模式**，点击**加载已解压的扩展程序**，选择仓库中的 `extension` 目录。
3. 复制扩展卡片上显示的扩展 ID。
4. 在终端中用该 ID 编译并注册原生程序：

   ~~~sh
   cd native-host
   ./install.sh YOUR_EXTENSION_ID
   ~~~

   脚本会编译 `mic-monitor`，并将 Native Messaging 配置写入 Chrome 当前用户的配置目录，不需要管理员权限。
5. 回到 `chrome://extensions` 并重新加载 Mic Pause。刷新已经打开的网页。如果 Chrome 仍找不到原生程序，请完全退出并重新打开 Chrome。

原生程序配置只允许 `install.sh` 收到的扩展 ID。扩展 ID 变更后，请用新的 ID 再运行一次脚本。

## 使用

Mic Pause 默认启用。点击工具栏中的扩展图标，可以：

- 暂时关闭自动暂停。
- 查看麦克风是否正在使用。
- 添加或移除例外域名。例如，排除 `example.com` 后，它的子域名也会被排除。

扩展运行期间，设置变更会立即生效。安装扩展或更新后，请刷新已经打开的网页，以加载新版内容脚本。

## 权限与隐私

Mic Pause 使用以下 Chrome 权限：

- **Native messaging**：连接扩展与本机 macOS 监听程序。
- **Tabs**：查找受支持的浏览器标签页，并发送暂停或恢复指令。
- **Storage**：将启用状态和例外域名保存在 Chrome 的本地扩展存储中。
- **访问所有网站**：用于检测网页麦克风流，并控制 HTTP 和 HTTPS 页面中的视频。Chrome 内部页面及其他受限页面仍无法访问。

原生程序检查 macOS 音频输入设备是否正在使用，并向扩展报告麦克风状态。网页桥接脚本只观察网页是否有通过 `getUserMedia` 建立的活动音频流。两者都不会读取、录制或上传麦克风音频。当前源码不会发送遥测信息或发起网络请求。设置保存在 Chrome 本地。

## 限制

- 随附的安装方式需要 macOS 和 Google Chrome 102 或更高版本。
- 由于 Chrome 的访问限制，扩展无法控制 `chrome://` 等浏览器内部页面、Chrome 网上应用店页面以及部分受 sandbox 限制的 frame。
- 不同网站的播放器行为各异。通用适配器处理可见的 HTML video 元素；网站播放器更新后可能需要调整对应适配器。
- 原生程序只报告麦克风是否正在使用，不会识别具体由哪个应用使用。

## 故障排查

- **弹窗提示原生程序不可用：**确认 `install.sh` 已成功完成，传入的是当前扩展 ID，然后重启 Chrome。
- **Chrome 提示无权访问原生程序：**从 `chrome://extensions` 的 Mic Pause 扩展卡片确认 ID，再运行 `./install.sh YOUR_EXTENSION_ID`。
- **已打开的视频没有响应：**刷新标签页。安装扩展或更新前打开的网页没有加载最新内容脚本。
- **某个页面无法控制：**确认它不是浏览器内部页面或其他受限页面。

查看 service worker 日志：打开 `chrome://extensions`，找到 Mic Pause，然后点击**检查视图**下的 **service worker**。

## 开发

本地检查和贡献说明见[贡献指南](CONTRIBUTING.md)。GitHub Actions 会检查 JavaScript 语法、扩展 manifest、shell 脚本和 Swift 原生程序的构建。

## 许可证

MIT，详见 [LICENSE](LICENSE)。
