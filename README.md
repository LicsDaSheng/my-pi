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

## 本地开发

```bash
# 临时加载扩展测试
pi -e ./extensions/operation-guard.ts

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
