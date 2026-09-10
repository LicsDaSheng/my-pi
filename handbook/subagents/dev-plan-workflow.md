# /dev-plan：开发方案工作流

`/dev-plan <原始需求>` 让主会话完成“探索 → 访谈 → 设计 → 独立评审 → 修订复核 → 交付”。它只产出方案，不调用 worker、不编码、不提交。确认方案也不是编码授权。

## 安装与更新边界

my-pi 是配置源码，不是 pi 本体。需要已安装并启用社区 `pi-subagents` 和 `@juicesharp/rpiv-ask-user-question`（实际工具 `ask_user_question`），并在用户级 pi settings 中为下表角色配置 `subagents.agentOverrides`。没有 UI 的会话可能没有问卷工具，此时流程暂停。

源码中新增：
- [`agents/development-designer.md`](../../agents/development-designer.md)：唯一新增 agent；通过 package.json 的 `pi-subagents.agents: ["./agents"]` 注册。不是不存在的 `pi.agents`。
- [`prompts/dev-plan.md`](../../prompts/dev-plan.md)：主会话提示词入口，内含完整契约和评审 schema，不依赖目标 cwd 下的配套文件。

Git 安装副本与此源码工作区不同。源码内容进入可更新的包版本后，需要用户在 pi 中执行 `pi update --extensions` 更新 my-pi 的安装副本，再按运行环境重新加载。`/reload` 不能把另一个源码工作区的未提交文件搬进 Git 安装副本。本次开发不执行更新、安装或修改全局配置；当前未提交内容不会因更新远程包自动生效。需要体验未提交版本时，由用户另行选择显式本地包安装方式。

更新后先检查 `/dev-plan` 出现在提示词列表，并由主会话确认目标仓库绝对路径。所有配置预检 list/models/必要 get 与后续 workflow 执行必须显式使用同一 targetCwd；即使主会话位于另一仓库，也不能省略 cwd：

```js
const targetCwd = "<目标仓库绝对路径>" // 替换为已确认的实际绝对路径
subagent({ action: "list", capabilities: true, cwd: targetCwd })
subagent({ action: "models", cwd: targetCwd })
// 必要时核实有效配置，agent 替换为待核实的精确角色名
subagent({ action: "get", agent: "development-designer", cwd: targetCwd })
```

确认目标 cwd 下 scout、development-designer、reviewer 被发现，检查其有效同名 agent 覆盖、工具权限、用户级 settings 角色覆盖路由和 fallbackModels，而不只是包内默认定义。designer 的有效工具必须符合下文严格白名单，scout/reviewer 也须符合各自角色契约；三个角色的有效模型必须来自用户级 pi settings 中对应 `subagents.agentOverrides`，且不允许静默自动 fallback。任何同名覆盖不合规、模型／工具／权限缺失或路由无法保证都暂停报告，不修改目标项目配置。可用 `/subagents-doctor` 辅助诊断。此检查不证明模型认证或真实调用一定成功。

## 使用

在目标项目的交互式 pi 主会话输入：

```text
/dev-plan 为订单导出增加日期范围筛选，保持现有权限和 CSV 格式
```

也可在需求中注明目标仓库绝对路径。不要用 `/prompt-workflow` 把整个入口交给子 agent。入口自包含，安装后可从任意目标仓库使用，不需要把 my-pi 的 prompts/handbook 复制进去。

空输入会先索取需求；仓库不明会询问。主会话保存需求原文及基线，只读探索现有代码、测试与风险，不会运行可能修改项目的命令。原始参数经模板展开可能规范化空白，逐字格式重要的需求请提供原始消息或附件。

## 角色与模型

| 职责 | agent | 模型路由来源 |
|---|---|---|
| 定向代码探索 | builtin `scout` | 用户级 pi settings 的对应 `subagents.agentOverrides` |
| clarify / draft / revise | 新增 `development-designer` | 用户级 pi settings 的对应 `subagents.agentOverrides` |
| 独立方案评审 | builtin `reviewer` | 用户级 pi settings 的对应 `subagents.agentOverrides` |
| 编排、问卷、裁决、交付 | 当前主会话 | 保持当前模型 |

不修改 builtin scout/reviewer、目标项目配置或主会话默认模型；不要在 workflow 的 `runs.run` 中传 per-run model 参数。designer 的严格工具白名单仅为 `read, grep, find, ls, contact_supervisor`；无需 write/bash/UI/subagent。scout 通过任务级约束只读探索，builtin 自身仍具备较宽工具权限；这不是新的权限沙箱。

## 暂停与恢复

设计 agent 决定问题、选项、理由及追问，主会话调用 `ask_user_question`，保存并原样回传回答。只询问影响范围、行为、技术设计或验收的事项；代码能回答的先查，不重复询问。取消、跳过、没有回答都不代表同意推荐项。

所有阶段用 `async: true`、`cwd: targetCwd` 分阶段 workflowScript（与配置预检相同的目标绝对路径），完成通知后主会话推进；脚本不直接弹问卷。首次探索、首次设计、每次独立评审均 fresh。

每次继续设计前先 `children.list`：仅恢复标记 resumable 的最新 runId，每轮用新 key，并更新返回的新 runId。恢复继承原角色／工具，模型继续来自用户级 settings，不能覆盖；无法恢复时以同角色 fresh 加完整交接包重开，并记录原因。真实执行错误先暂停，报告精确错误和运行状态，不能偷偷换模型、CLI 或跳过评审。

状态保存在同一运行时 mission 的 `state` 中，每次阶段及问卷边界更新。保留 missionId、原需求、仓库／分支／提交／脏状态、代码证据、原始问题和回答、决策／假设、方案版本、评审轮数、处置、最新子任务 runId、真实产物引用和下一步。主会话中断后提供 missionId／状态引用即可先检查恢复；跨会话不保证旧子任务可恢复，不能依赖隐藏历史。附件已被清理或基线变化时暂停补证据，不能凭摘要冒充完整交接。

## 最多三次评审

默认最多 **3 次，含首次**；每次发起前计数，失败或格式错误也不重置额度。无实质问题直接通过，不强制修改。

reviewer 使用入口内的 `outputSchema` 返回 `reviewed_version`、`verdict`（pass / revise / needs_user_decision）、`findings` 和覆盖总结。主会话从 `structuredOutput` 判断；缺失、错误、版本不符、pass 与阻塞意见矛盾都 fail closed，不搜索自然语言“通过”。

主会话分类意见：技术缺陷交 designer 修订；产品／范围决策先问用户。修订逐条回应意见并输出完整新版本，然后 fresh reviewer 复核。最终交付的版本必须正好被评审通过；主会话修改接口、范围或验收语义也需要重评并计数。

上限仍阻塞时只交付“待决策草案 + 阻塞清单”，不标可开发，不无限循环；不得因用户后来回答问题而把未复核的新版本直接变成已通过。

## 交付与保存

一个入口、一份主方案、可追溯附件：
- `development-plan.md`：状态／版本／基线、需求与成功标准、范围、决策与假设、代码复用、技术设计、开发任务依赖、验收映射、风险、最终评审引用。
- 附件：探索报告、原始问卷和回答／决策、各版本评审、意见处置。
- REQ/AC 编号跨版本稳定；AC 包含关联需求、场景、前置条件、操作、可观察预期及测试层级，覆盖适用的正常、异常、边界和回归。

各阶段用唯一 output 名，运行时保存到受管目录；只读 agent 在最终响应返回完整内容即可。使用返回的真实 outputReference/outputPathMapping/artifactPaths，不把请求的相对名当成文件链接。主会话可在受管目录保存访谈附件和状态导出，不写目标项目文件。

目录可能清理，需要长期保存时用户先确认持久化位置。最终聊天给核心结论、范围边界、评审状态／未决项、主方案及附件链接，并请求确认方案。流程到此结束。

## 验证与已知限制

无需模型调用的可重复检查（在 my-pi 源码目录）：

```bash
npm test
npm run typecheck
```

普通 `npm test` 已覆盖 `/dev-plan` 静态契约：包注册、唯一 development-designer、agent 权限及模式、无默认 model、prompt 参数、自包含契约、clarify/draft/revise、配置预检 list/models/get 与 workflow 执行的同一 targetCwd、有效覆盖／工具／fallbackModels 检查约束、ask_user_question、async/fresh/resume、structuredOutput/fail closed、评审上限、state/mission/outputReference、REQ/AC、方案确认不授权编码、评审 schema、项目契约文件不含具体模型硬编码、workflow 不传 per-run model 参数与文档链接。静态校验只能证明契约存在与元数据可解析，不能证明 LLM 总会正确编排。

真实 pi-subagents discovery 检查已拆为 opt-in 集成测试；未设置环境变量时普通测试会跳过，不依赖本机安装或源码。显式设置 `PI_SUBAGENTS_ROOT` 为 pi-subagents 源码或安装包根绝对路径后才执行；配置了但路径错误、包名不匹配或源码加载失败会失败：

```bash
PI_SUBAGENTS_ROOT=/absolute/path/to/pi-subagents npm run test -- tests/dev-plan.integration.test.ts
```

集成测试在临时隔离目录模拟其他目标 repo 的包发现，不修改用户配置、node_modules 或全局设置；测试内使用 Node 内置 `registerHooks` / `stripTypeScriptTypes`，且 loader 仅转换传入 pi-subagents 根目录下的 `.ts` 文件。没有可加载的 pi-subagents 路径时仅运行静态检查并如实记录 discovery 未验证，不安装依赖或改 node_modules。

本实现是提示词与 agent 配置，不是新的确定性工作流引擎／权限扩展。它依赖主会话遵循阶段、计数、问卷和门禁契约，以及已安装 pi-subagents API（对照 0.66.0）。没有自动 E2E 或付费模型链路验证；更新后的问卷 UI、模型认证、异步输出与跨会话恢复仍需用户在真实环境手动验收。不将计划测试描述为已执行。
