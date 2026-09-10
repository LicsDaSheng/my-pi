# pi-subagents config.json 完整配置指南

配置文件路径：

```text
~/.pi/agent/extensions/subagent/config.json
```

---

## 一、运行模式与基础行为

### `asyncByDefault`（默认后台执行）

```json
{ "asyncByDefault": true }
```

- **含义**：当调用 `subagent()` 时未指定 `async` 参数，默认以**后台**还是**前台**启动。
- **默认**：`true`（后台）
- **场景**：
  - 设为 `false`：希望 subagent 像普通工具一样同步返回结果，适合快速查看代码、review diff 等短任务。
  - 保持 `true`（默认）：适合长时间运行 worker、并行多任务，不阻塞父会话。
- **最佳实践**：新手建议先设 `false`，熟悉后再开后台。

### `defaultSubagentContext`（默认上下文模式）

```json
{ "defaultSubagentContext": "fresh" }
```

- **可选值**：`"fresh"` 或 `"fork"`
- **含义**：未指定 `context` 时的默认启动模式。
  - `fresh`：全新会话，干净 slate。
  - `fork`：继承父会话上下文（历史消息、打开的文件等）。
- **场景**：
  - `fresh`：任务独立，不需要父会话上下文，如 scout 探查代码。
  - `fork`：需要子 agent 理解当前讨论上下文，如让 reviewer 审阅你正在写的代码。
- **最佳实践**：默认 `fresh` 更安全；只有子 agent 需要"理解你刚才说了什么"时才 fork。

### `forkContext`（fork 模式的剪枝策略）

```json
{
  "forkContext": {
    "mode": "pruned",
    "model": "provider/model-id"
  }
}
```

- **含义**：fork 时继承的上下文超过 64 KiB 时的处理策略。
  - `full`：完整继承（可能超 token 预算）。
  - `pruned`：溢出部分由指定模型压缩为摘要。
- **场景**：父会话很长，fork 后子 agent 需要知道上下文但装不下全部。
- **最佳实践**：`pruned` 配合一个低成本模型，避免 fork 把长对话的 token 吃光；具体模型 ID 放在用户级配置中管理，不写入项目文档。

---

## 二、超时与工具控制

### `timeoutMs`（全局运行超时）

```json
{ "timeoutMs": 3600000 }
```

- **含义**：单个 subagent 运行的默认超时时间（毫秒），默认 30 分钟。
- **场景**：
  - 编译型项目 build + test 可能需要 1 小时，设为 `3600000`。
  - 快速 review 设为 `300000`（5 分钟）防止挂起。
- **最佳实践**：比你的任务实际耗时长 20%，给一点缓冲，但不要无限长。

### `toolTimeoutMs`（单次工具调用硬超时）

```json
{ "toolTimeoutMs": 600000 }
```

- **含义**：单次 `read`/`bash`/`edit` 等工具调用的强制超时（毫秒）。
- **默认**：`read`/`ls` 等快工具默认 5 分钟；`bash` 等慢工具无默认。
- **场景**：
  - 防止 `bash` 命令（如 `npm test`）卡住不动。
  - 数据库迁移、大规模构建等长任务可适当放宽。
- **最佳实践**：设为你的任务最长可容忍的等待时间 + 一点余量。`contact_supervisor`、`intercom`、`bg_wait` 不受此限制。

---

## 三、并发与资源控制

### `globalConcurrencyLimit`（全局并发数）

```json
{ "globalConcurrencyLimit": 20 }
```

- **含义**：同时运行的子 agent 数量上限。
- **默认**：`20`
- **场景**：
  - 大规模并行 review（如 "review every file in src/"）。
  - 多任务流水线（先 scout 5 个模块，再并行 worker）。
- **最佳实践**：根据你的 API rate limit 和本地 CPU/内存调整。大多数场景 4–8 就够了，20 是给重度用户用的。

### `maxSubagentSpawnsPerRun`（单次运行子 agent 上限）

```json
{ "maxSubagentSpawnsPerRun": 64 }
```

- **含义**：一个顶层 `subagent` 调用及其所有后代，累计最多 spawn 多少个逻辑子 agent。
- **默认**：`64`
- **场景**：防止递归或动态 fanout 失控（如 workflow 脚本里 `runs.all` 无限循环）。
- **最佳实践**：保持默认。只有在做大规模自动化时才需要调。

### `maxSubagentSpawnsPerSession`（单次会话累计上限）

```json
{ "maxSubagentSpawnsPerSession": 100 }
```

- **含义**：整个 Pi 会话累计 spawn 的子 agent 总数（包括已完成和失败的）。
- **默认**：无限
- **场景**：控制整个工作日的 token 消耗，防止脚本误操作。
- **最佳实践**：设为合理的日预算。`0` 表示取消限制。

### `maxActiveAsyncRunsPerSession`（同时活跃异步任务上限）

```json
{ "maxActiveAsyncRunsPerSession": 4 }
```

- **含义**：同时活跃的顶层异步子 agent 数量限制。
- **场景**：后台运行了 4 个 review，第 5 个会排队。
- **最佳实践**：配合 `globalConcurrencyLimit` 使用。这个控制"排队数"，那个控制"并发数"。

---

## 四、展示与交互

### `toolDescriptionMode`（工具描述模式）

```json
{ "toolDescriptionMode": "compact" }
```

- **可选值**：`"full"` / `"compact"` / `"custom"`
- **含义**：注册给 Pi 模型的 `subagent` 工具描述长度。
  - `full`：完整描述（最详细）。
  - `compact`：精简描述（推荐）。
  - `custom`：读取自定义模板 `subagent-tool-description.md`。
- **场景**：
  - `full`：新手需要知道所有参数。
  - `compact`：节省 prompt token，防止描述太长挤占上下文。
  - `custom`：团队有统一规范时。
- **最佳实践**：用 `compact`，需要时再切 `full`。

### `inlineToolDisplay`（内联显示模式）

```json
{ "inlineToolDisplay": "summary" }
```

- **可选值**：`"rich"`（默认） / `"summary"`
- **含义**：`subagent` 工具结果的聊天内联显示方式。
  - `rich`：动态展示运行状态、预览输出。
  - `summary`：仅一行文本（如 `✓ reviewer · completed`）。
- **场景**：
  - `summary`：后台跑 10 个 agent 时避免刷屏。
  - `rich`：前台跑单任务，想看实时进度。
- **最佳实践**：后台跑多用 `summary`，前台用 `rich`。

### `mainWindowRenderer`（主窗口渲染器微调）

```json
{
  "mainWindowRenderer": {
    "horizontalSpacing": 0,
    "compactResultMaxLines": 4
  }
}
```

- **含义**：控制主聊天窗口中 `subagent` 结果卡片的间距和行数。
- **场景**：TUI 界面紧凑时需要更少的空白。
- **最佳实践**：通常不用改，除非你觉得结果卡片太占空间。

### `fleetView` / `fleetViewPlacement` / `fleetKeybindings`（舰队视图）

```json
{ "fleetView": true }
{ "fleetViewPlacement": "belowEditor" }
{
  "fleetKeybindings": {
    "pageUp": ["u"],
    "pageDown": ["d"]
  }
}
```

- **含义**：底部/顶部持久显示当前活跃子 agent 的列表视图。
- **场景**：同时跑多个后台任务时一目了然。
- **最佳实践**：打开 `fleetView`，`placement` 根据你的屏幕布局选 `belowEditor` 或 `aboveEditor`。`fleetKeybindings` 用 vi 风格 `j/k` 或自定义。

### `asyncWidget`（异步任务小部件）

```json
{ "asyncWidget": true }
```

- **含义**：编辑器下方显示活跃后台任务的迷你状态条。
- **最佳实践**：开着，随时知道有没有任务在跑。

---

## 五、工作空间与隔离

### `worktreeBaseDir` / `worktreeProvider`（Git 工作树隔离）

```json
{
  "worktreeBaseDir": "/Users/matt/code/.worktrees/pi-subagents",
  "worktreeProvider": "auto",
  "worktreeBranchPrefix": "pi-subagents/"
}
```

- **含义**：当调用时指定 `worktree: true` 时，Pi 会创建独立 Git 工作树（类似 `git worktree`），避免子 agent 污染主分支。
- **场景**：
  - 让 worker 在隔离分支做实验性修改，主分支保持干净。
  - 并行跑多个实验，每个实验独立工作树。
- **最佳实践**：`worktreeProvider` 用 `auto`（自动选 Pi 原生或 Worktrunk）。`worktreeBaseDir` 设到仓库外，如 `~/worktrees/`。

### `worktreeSetupHook`（工作树初始化钩子）

```json
{
  "worktreeSetupHook": "./scripts/setup-worktree.mjs",
  "worktreeSetupHookTimeoutMs": 45000
}
```

- **含义**：每个工作树创建后运行一次自定义脚本（如 `npm install`、复制 `.env`）。
- **场景**：新工作树需要初始化环境。
- **最佳实践**：脚本必须是**有限**的，不能启动常驻服务。返回 JSON 可声明 `syntheticPaths`（如 `.venv`）避免 diff 污染。

---

## 六、调度与任务

### `scheduledRuns`（定时任务）

```json
{
  "scheduledRuns": {
    "enabled": true,
    "maxPending": 20,
    "storeRoot": "~/.local/share/pi-subagents/schedules"
  }
}
```

- **含义**：支持定时/周期性启动 subagent（如每天凌晨跑一次 reviewer）。
- **场景**：
  - 定时审查代码。
  - 周期性监控任务。
- **最佳实践**：`storeRoot` 设为绝对路径（如 `~/...`），不要放在项目仓库里，避免误提交。

---

## 七、会话与产物管理

### `defaultSessionDir`（会话目录）

```json
{ "defaultSessionDir": "~/.pi/agent/sessions/subagent/" }
```

- **含义**：子 agent 会话日志的存放路径。
- **最佳实践**：保持默认（或省略），Pi 会自动管理。

### `singleRunOutputBaseDir`（单任务输出目录）

```json
{ "singleRunOutputBaseDir": "~/.pi/subagent-outputs" }
```

- **含义**：`output` 参数指定相对路径时的根目录。
- **场景**：你希望所有 subagent 的输出集中到一个地方。
- **最佳实践**：设到 Pi agent 目录下，如 `~/.pi/subagent-outputs`，方便清理。

### `artifactDir`（产物目录策略）

```json
{ "artifactDir": "session" }
```

- **可选值**：`"project"` / `"session"` / `"temp"`
- **含义**：产物（输入、输出、transcript、元数据）存在哪。
- **场景**：
  - `session`（默认）：存在 Pi 会话目录，工作区干净。
  - `project`：存在 `<cwd>/.pi/subagents/artifacts/`，便于 CI/CD 或团队协作。
  - `temp`：临时目录，自动清理。
- **最佳实践**：默认 `session`。如果产物需要共享或归档，改为 `project`，但记得加 `.npmignore`。

---

## 八、通信与协调

### `intercomBridge`（子 agent 通信桥）

```json
{
  "intercomBridge": {
    "mode": "always",
    "resultDelivery": false
  }
}
```

- **可选值**：`"always"` / `"fork-only"` / `"off"`
- **含义**：是否在子 agent 中注入协调指令（如 `contact_supervisor` 目标）。
- **场景**：
  - `always`：所有子 agent 都能联系父会话。
  - `fork-only`：只有 fork 上下文的子 agent 能联系。
  - `off`：完全关闭通信桥。
- **最佳实践**：`always` 适合需要实时协调的 workflow。如果只是简单后台任务，可设 `off` 减少干扰。

---

## 九、权限与安全

### `authorityPolicy`（操作授权策略）

```json
{
  "authorityPolicy": {
    "discardWorktree": "confirm",
    "destructiveCleanup": "confirm",
    "spawnBudgetGrant": "confirm",
    "scheduleCreate": "auto",
    "stopRun": "auto",
    "steerRun": "auto"
  }
}
```

- **可选值**：`"auto"` / `"confirm"` / `"forbid"`
- **含义**：关键操作的授权级别。
  - `auto`：自动执行。
  - `confirm`：需要用户确认。
  - `forbid`：禁止执行。
- **场景**：
  - `discardWorktree: "confirm"`：删除工作树前确认，防止误删。
  - `stopRun: "auto"`：停止任务不需要确认，响应更快。
- **最佳实践**：破坏性操作（删除、清理、授权额度）用 `confirm`，管理操作（停止、调度）用 `auto`。

### `permissions`（子 agent 工具权限）

- 指向 `watchdog.md` 中定义的细粒度权限规则。
- **场景**：限制子 agent 只能访问特定目录、不能运行危险命令。

---

## 十、高级与边缘配置

### `modelResponseAliases`（模型响应别名）

```json
{
  "modelResponseAliases": {
    "provider/model-id": ["provider-returned-alias"]
  }
}
```

- **场景**：代理或网关返回的模型 ID 与请求不一致时，用来声明等价性。
- **最佳实践**：只有遇到 `model_verification_failed` 错误时才需要配置。

### `modelExclusions`（模型排除缓存）

```json
{ "modelExclusions": { "defaultTtlMs": 300000 } }
```

- **含义**：某个模型失败后被临时排除的时长。
- **默认**：24 小时
- **场景**：某模型频繁报错时自动跳过。

### `forceTopLevelAsync`（强制顶层异步）

```json
{ "forceTopLevelAsync": true }
```

- **含义**：所有顶层调用强制转为后台模式，并跳过 `clarify` 确认。
- **场景**：自动化脚本、CI 流水线。
- **最佳实践**：交互式会话不要开，否则你看不到实时反馈。

### `waitTool`（等待工具）

```json
{
  "waitTool": {
    "enabled": true,
    "defaultTimeoutMs": 120000
  }
}
```

- **含义**：`bg_wait` 工具的默认行为。
- **场景**：等待后台任务完成。`nonBlocking: true` 用于订阅而不阻塞。
- **最佳实践**：保持 `enabled: true`。`defaultTimeoutMs` 设为你愿意等待的最长时间。

### `completionBatch`（完成通知批处理）

```json
{
  "completionBatch": {
    "enabled": true,
    "debounceMs": 150,
    "maxWaitMs": 1000
  }
}
```

- **含义**：多个后台任务几乎同时完成时，合并为一条通知。
- **场景**：并行跑 10 个 review，几乎同时完成时避免 10 条消息刷屏。
- **最佳实践**：开着，默认参数就很好。

### `maxSubagentDepth`（最大嵌套深度）

```json
{ "maxSubagentDepth": 1 }
```

- **含义**：子 agent 再启动子 agent 的最大递归深度。
- **场景**：防止无限递归。
- **最佳实践**：默认 1（子 agent 不能继续 spawn）。特殊 workflow 需要时再放宽。

---

## 推荐的新手起步配置

```json
{
  "asyncByDefault": false,
  "defaultSubagentContext": "fresh",
  "timeoutMs": 600000,
  "toolTimeoutMs": 300000,
  "fleetView": true,
  "fleetViewPlacement": "belowEditor",
  "asyncWidget": true,
  "toolDescriptionMode": "compact",
  "inlineToolDisplay": "summary",
  "waitTool": {
    "enabled": true,
    "defaultTimeoutMs": 120000
  },
  "artifactDir": "session",
  "authorityPolicy": {
    "discardWorktree": "confirm",
    "destructiveCleanup": "confirm",
    "spawnBudgetGrant": "confirm",
    "scheduleCreate": "auto",
    "stopRun": "auto",
    "steerRun": "auto"
  }
}
```

**解释**：
- `asyncByDefault: false`：先同步体验，熟悉后再开后台。
- `compact` + `summary`：减少 prompt 噪音和界面混乱。
- `fleetView` + `asyncWidget`：随时知道后台有什么在跑。
- `authorityPolicy` 的破坏性操作加 `confirm`：安全第一。

修改后重启 Pi 或 `/reload` 生效，然后用 `/subagents-doctor` 验证配置是否正确加载。
