# Agent 指南

本仓库面向 AI / 自动化代理。修改代码或提交前，请遵循以下约定。

## 提交信息

所有提交必须遵循 [`rules/commit-messages.mdc`](rules/commit-messages.mdc)：

- 使用 Conventional Commits + 中文摘要：`type(scope): 简短中文说明`
- 主题保持一行、尽量 ≤ 50 个中文字符；说明 **why / 用户可见结果**，不要罗列文件
- 可选 body 使用短 bullets；不要使用 `--no-verify`
- 不要 amend 已推送的提交，除非用户明确要求

提交前运行相关验证（`npm test`、`npm run typecheck`，必要时 `npm run build`）。

## 规则目录

`rules/` 下的规则均适用于本仓库；新增规则请放入 `rules/` 并在此登记。
