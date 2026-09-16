# Contributing to Mic Pause

感谢你的贡献。Mic Pause 是一个 macOS + Chrome 扩展项目，欢迎提交 bug 报告、播放器适配器和改进建议。

## 本地开发

1. 按 [README.md](README.md) 加载扩展并注册 Native Messaging host。
2. 修改代码后，在 `chrome://extensions` 刷新扩展，并刷新目标网页。
3. 运行以下检查：

```bash
for file in extension/*.js extension/adapters/*.js; do node --check "$file"; done
bash -n native-host/build.sh native-host/install.sh
native-host/build.sh
```

## 提交说明

- 一个提交尽量只解决一个问题。
- 不要提交 `native-host/mic-monitor`、本机路径、扩展 ID、日志或个人配置。
- 新增站点时，优先添加独立适配器，并保证用户主动暂停的视频不会被恢复。
