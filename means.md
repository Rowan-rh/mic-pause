# Git 提交与发布流程

本仓库按 `develop` 开发、`master` 发布的流程协作。

## 开发与推送

1. 开始开发前同步 `develop`，并从它创建开发分支。分支名使用 `codex/<简短主题>`。

   ```bash
   git switch develop
   git pull --ff-only origin develop
   git switch -c codex/<简短主题>
   ```

2. 在开发分支完成实现和自审。提交应包含完整改动；按任务需要完成语法、构建或测试检查。

3. 将开发分支合入 `develop` 并推送：

   ```bash
   git switch develop
   git pull --ff-only origin develop
   git merge --no-ff codex/<简短主题>
   git push origin develop
   ```

## 发布 PR

1. 创建以 `develop` 为源分支、`master` 为目标分支的 PR。PR 创建后不自动合并。
2. PR 标题使用中文描述，并以英文标签 `[effects]` 开头，例如：

   ```text
   [effects] 提升麦克风检测可靠性
   ```

3. PR 正文保留可审查的信息：改动目的、主要变更、验证结果，以及已知限制或注意事项。不要只写“更新”或“修复”。
4. 创建 PR 前自审开发分支到 `master` 的完整差异；创建后再核对 PR 标题、正文、源/目标分支和 CI 状态。

## 分支初始化

如果仓库尚无 `develop` 或 `master`，先从当前默认分支的稳定基线创建并推送缺失分支，再按上述流程开发。创建前确认远程分支列表，避免覆盖已有分支。
