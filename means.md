# Git 提交与发布流程

本仓库按 `develop` 开发、`master` 发布的流程协作。

## 开发与推送

1. 开始开发前确认工作区状态并同步 `develop`，从最新的 `develop` 创建 `codex/<简短主题>` 开发分支。
2. 在开发分支完成实现、自审和适当验证，不直接在 `develop` 或 `master` 上开发。
3. 开发完成后，将开发分支合入 `develop` 并推送到远程 `origin/develop`。

## 发布 PR

1. 创建以 `develop` 为源分支、`master` 为目标分支的 PR。创建 PR 后保持未合并，除非用户明确要求合并。
2. PR 标题使用中文描述，并在开头加 Conventional Commits 类型标签。按变更性质选择，例如 `[feat] 支持站点例外设置`、`[fix] 修复麦克风状态检测`、`[perf] 优化页面加载速度`。
3. 可用类型包括 `feat`、`fix`、`docs`、`style`、`refactor`、`perf`、`test`、`build`、`ci`、`chore`、`revert`。选择最符合实际改动的一项，不固定使用 `feat`。
4. PR 正文保留改动目的、主要变更、验证结果和已知限制或注意事项，不要只写“更新”或“修复”。
5. 创建 PR 前自审开发分支到 `master` 的完整差异；创建后核对标题、正文、源/目标分支和 CI 状态。

方括号类型标签是本仓库的 PR 标题格式。提交消息使用 Conventional Commits 格式 `type(scope): description`，不加方括号。

## 分支初始化

如果仓库尚无 `develop` 或 `master`，先检查远程分支和项目约定，再决定如何初始化；不要覆盖已有分支。若项目采用其他分支模型，遵循该项目的贡献指南。
