# mic-pause 项目开发与发布规则

## 分支与推送

- 开发基线为 `develop`。开始前检查工作区和远程分支，从最新基线创建 `codex/<简短主题>` 分支。
- 在开发分支完成实现、自审和适当验证；不要直接在共享基线分支上开发。
- `Rowan-rh/*` 是用户的个人仓库命名空间。推送前核对 remote URL，只能把 `codex/<简短主题>` 推送到 `Rowan-rh/*` 下的个人仓库。
- 不得推送 `develop`、`main` 或其他共享基线分支；不得向其他组织或用户的原仓库/上游仓库推送。可以从已确认的 `upstream` 获取基线，但不能向它推送。
- 个人仓库或推送目标无法确认时，停止并向用户核实，不要猜测。

## Pull Request

- PR 源分支使用个人仓库中的 `codex/<简短主题>`；目标仓库使用 `Rowan-rh/*` 下的个人仓库，目标分支为 `main`。不得向原仓库/上游仓库提 PR。
- 标题使用中文描述，并以 Conventional Commits 类型标签开头，例如 `[feat] 支持站点例外设置`。根据改动选择 `feat`、`fix`、`docs`、`style`、`refactor`、`perf`、`test`、`build`、`ci`、`chore` 或 `revert`。
- 正文说明改动目的、主要内容、验证结果和已知限制。创建前自审完整差异；创建后核对源/目标仓库与分支、标题、正文和 CI 状态。
- 创建 PR 不代表同意合并；除非用户明确要求，否则不要合并 PR。

PR 标题使用方括号类型；提交消息使用 Conventional Commits 格式 `type(scope): description`，不加方括号。
