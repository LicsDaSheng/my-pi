# my-pi

个人 pi 扩展包仓库，用于沉淀自用的 extensions、skills、prompts 和 themes。

## 引用社区的package

| Package                                                                                                                      | Description                                                                                    |
|------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------|
| [pi-mcp-adapter](https://pi.dev/packages/pi-mcp-adapter?name=pi-mcp-adapter)                                                 | mcp 适配器                                                                                     |
| [pi-memory](https://pi.dev/packages/pi-memory?name=pi-memory)                                                                | 记忆扩展 - 支持基于 QMD 的语义检索，可作用于日常日志、长期记忆以及临时便签区                   |
| [@juicesharp/rpiv-ask-user-question](https://pi.dev/packages/@juicesharp/rpiv-ask-user-question?name=rpiv-ask-user-question) | 提供结构化问卷，模型可以在原本进行猜测的情况下，向您提出问卷，提供可输入的选项，而不是自由作答 |
| [@narumitw/pi-goal](https://pi.dev/packages/@narumitw/pi-goal?name=%40narumitw%2Fpi-goal)                                    | /goal 目标任务                                                                                 |
| [pi-subagents](https://pi.dev/packages/pi-subagents?name=pi-subagents)                                                       | 用于单代理委托和脚本化多代理工作流的 Pi 扩展                                                   |

## 目录结构

```text
extensions/  # pi TypeScript 扩展
skills/      # 自定义技能（每个技能目录包含 SKILL.md）
prompts/     # Prompt 模板
themes/      # 主题 JSON
```

## 内置扩展

- `extensions/operation-guard.ts` —— `rm` 操作门禁，命中后等待用户确认。
- `extensions/context-mode/` —— 移植自 [mksglu/context-mode](https://github.com/mksglu/context-mode)，仅保留 pi 原生适配：
  - 会话连续性：事件写入 SQLite（含 FTS5），压缩前生成续借快照，下一轮注入恢复上下文；
  - 路由拦截：拦下 bash 里的内联 HTTP 客户端（fetch / curl / wget 等）以避免原始响应体灌进上下文；
  - think-in-code 引导锚：大输出导向「写文件 + read/grep 抽需求片段」；
  - 命令：`/ctx-stats`、`/ctx-doctor`，原生日志工具：`ctx_search`。

  依赖 `better-sqlite3`（原生模块，含 FTS5）。

## 内置技能

- `skills/gitlab-mr-flow/` —— GitLab MR 流程。
- `skills/tdd-workflow/` —— 测试驱动开发工作流。
- `skills/no-negative-echo/` —— 防止最终交付中残留被否方案。
- `skills/context-mode/` —— 上下文节约模式：对大输出走「写文件 + 按需读取」。


## 本地开发

```bash
# 运行单元测试
npm test

# 类型检查
npm run typecheck

# 临时加载扩展测试
pi -e ./extensions/operation-guard.ts
pi -e ./extensions/context-mode/index.ts

# 或安装为本地包
pi install ./
```

修改后在 pi 中使用 `/reload` 重新加载。

## 从 GitHub 安装

发布到 GitHub 后可使用：

```bash
pi install git:github.com/LicsDaSheng/my-pi
```

如需固定版本，给仓库打 tag 后安装：

```bash
pi install git:github.com/LicsDaSheng/my-pi@v0.1.0
```
