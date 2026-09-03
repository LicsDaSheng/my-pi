---
name: gitlab-mr-flow
description: 当用户需要创建上游 GitLab Issue、创建对应的本地/origin issue-{id} 分支、提交本地改动、推送分支、创建或更新 GitLab MR，或通过 MR 关闭上游 Issue 时使用。该技能要求先同步 upstream 默认分支，检查 issue 分支命名与上游 Issue 是否存在，只向 origin 推送 issue 分支，在 MR 描述末尾使用 closure 行，并在完成前做验证；同时严格禁止把真实 GitLab/API token 或其他密钥提交到仓库。
---

# GitLab MR 流程

## 使用目标

当任务涉及 GitLab Issue、分支、提交、推送、MR 创建/更新时，使用本技能。

核心目标：

- 从最新的 `upstream` 默认分支开始工作。
- `issue-{id}` 分支只作为本地与 `origin`/fork 的源分支。
- 不在 `upstream` 创建或推送 issue 分支。
- 不重复创建 Issue 或 MR。
- 不虚构 Issue/MR 状态，必须以工具/API 返回为准。
- 不把真实 token、密钥或凭据写入仓库、Issue、MR 或日志。

优先遵守当前仓库自己的约定。如果仓库的 `AGENTS.md` 或项目说明要求使用 `rtk` 等命令包装器，所有 shell 命令都要按该约定执行。

## 绝对禁止：泄露 token 和密钥

任何 GitLab/API token、私钥、cookie、session ID、OAuth 凭据、个人访问令牌都不能写入：

- 本技能文件
- 代码或配置文件
- Git commit
- Issue/MR 标题或描述
- 终端日志
- 截图
- 示例内容

执行要求：

- 示例中需要 token 时，只能使用 `<GITLAB_TOKEN_PLACEHOLDER>` 这类占位符。
- 不要创建会被提交的真实凭据配置文件。
- 认证信息应放在仓库外：环境变量、本机 keychain、Git credential helper、MCP/CLI 的本地认证存储等。
- 提交前必须检查 `git diff --cached`，确认 staged 内容里没有真实 token/secret。
- 如果发现 worktree 或 Git 历史中已经有密钥，立即停止；先让用户确认如何移除并轮换密钥，再考虑推送。

## 标准流程

### 1. 先检查本地仓库状态

在创建 Issue、提交、推送、创建/更新 MR 之前，必须先执行：

```bash
git status --short --branch
```

并确认：

- 当前分支是什么。
- 工作区是否干净。
- 哪些文件发生了变化。
- 是否存在与本任务无关的改动。

处理原则：

- 不要回滚用户已有改动。
- 只有当用户明确要求“包含当前所有改动”时，才把无关改动一起提交。
- 如果要 amend 或强制更新分支，先查看最新提交：

```bash
git log -1 --oneline
```

### 2. 创建上游 Issue 与 issue 分支

当用户要求“创建上游 Issue 并实现”时，按以下步骤：

1. 查看当前分支：

   ```bash
   git branch --show-current
   ```

2. 如果当前不在上游默认分支（通常是 `master` 或 `main`），只有在确认工作区干净或改动已被妥善保存后，才能切换过去。
3. 查看远端：

   ```bash
   git remote -v
   ```

4. 必须确认存在 `upstream`。如果没有，停止并让用户配置；不要猜测 upstream URL。
5. 更新所有远端：

   ```bash
   git fetch --all
   ```

6. 将本地默认分支 rebase 到上游默认分支，例如：

   ```bash
   git rebase upstream/master
   # 或
   git rebase upstream/main
   ```

   如果 rebase 失败或产生冲突，停止并报告具体阻塞。

7. 用 GitLab MCP/API 在 `upstream` 项目中创建 Issue。标题和描述要简洁，并基于当前代码和用户需求。
8. GitLab 返回 Issue IID 后，从已同步的默认分支创建并切换到：

   ```text
   issue-{id}
   ```

9. `issue-{id}` 只用于本地和 `origin`/fork，不要在 `upstream` 创建或推送该分支。
10. 不要在默认分支上开始实现。

如果用户只是要求创建 Issue，创建 Issue 和分支后就停止，除非用户明确要求继续实现。

### 3. 校验当前分支命名

获取当前分支：

```bash
git branch --show-current
```

如果分支符合：

```text
issue-{id}
```

则提取 `{id}`，并在创建/更新 MR 前检查上游 Issue 是否存在。

如果分支不符合 `issue-{id}`：

- 不要自行编造 Issue ID。
- 询问用户：继续使用当前分支，还是创建/切换到 `issue-{id}` 分支。
- 如果用户要求关闭某个 Issue，但当前分支无法提供 ID，则要求用户明确 Issue ID。

### 4. 检查上游 Issue 是否存在

对于 `issue-{id}` 分支，必须通过 GitLab MCP/API 检查 `upstream` 项目中的 Issue `{id}`：

- 优先使用 GitLab MCP 的 Issue 工具。
- 如果没有直接 get issue 的工具，就 list/search issues，并精确匹配 IID。
- 默认把 `upstream` 远端对应的 GitLab 项目视为 Issue 来源，除非仓库配置或用户另有说明。

如果 Issue 存在：

- 在 MR 描述的 closure 行中使用该 ID。
- 不要重复创建 Issue。

如果 Issue 不存在：

- 明确告诉用户：上游 Issue `{id}` 未找到。
- 询问是否要在上游项目中新建 Issue。
- 如果用户同意，基于当前分支/改动创建简洁 Issue。
- 如果 GitLab 返回了不同 IID，应创建或切换到 `issue-{new_id}` 后再推送/MR。

没有 API/工具确认前，不要声称 Issue 已存在或已创建。

### 5. 提交前检查与 commit 规则

提交前必须：

1. 根据改动类型运行相关测试/检查；如果无法运行，要说明原因。
2. 检查空白与补丁问题：

   ```bash
   git diff --check
   ```

3. 按范围 stage 文件：
   - 用户明确要求包含所有当前改动时，才用 `git add -A`。
   - 否则只 stage 与任务相关的目标文件。
4. 检查 staged 内容：

   ```bash
   git diff --cached
   ```

   确认没有真实 token、secret、私钥或凭据。

Commit message 要求：

- 仓库使用 Conventional Commit 时，保留前缀，例如 `feat(deploy): ...`。
- 默认使用中文提交标题和正文，例如：

  ```text
  feat(deploy): 新增容器化部署
  ```

- 只有用户明确要求或仓库规范要求时，才使用其他语言。
- 如果在当前 Issue/MR 交付中 amend 一个非中文 commit，最终推送前默认改成中文；但不要重写已经共享或合并的提交。

注意：

- 不要在 commit message 中写 `close #id`，除非用户明确要求。
- 如果 MR 要关闭 Issue，把 `close #id` 放在 MR 描述末尾，而不是 commit message。

### 6. 推送规则

`issue-{id}` 分支只推送到 `origin`：

```bash
git push origin issue-{id}
```

如果本地 commit 是 amend 后再次推送：

```bash
git push --force-with-lease origin issue-{id}
```

规则：

- 只能使用 `--force-with-lease`，不要使用普通 force push。
- 绝对不要执行：

  ```bash
  git push upstream issue-{id}
  ```

- `upstream` 只作为 Issue 来源和目标分支来源；`origin`/fork 才拥有 feature/issue 源分支。
- 如果无法通过 API 确认远端分支，可用以下命令确认：

  ```bash
  git ls-remote origin issue-{id}
  ```

### 7. 创建或更新 MR

优先使用 GitLab MCP/API，不优先使用 CLI。

创建/更新前：

1. 在上游项目中查询 opened MR，过滤条件包括：
   - `source_branch`
   - `target_branch`
   - `state: opened`
2. 如果已存在 MR，更新它，不要重复创建。
3. 如果不存在，创建 MR。

创建 MR 时注意：

- 同项目分支：`project_id` 使用 upstream 项目路径或 ID。
- fork 分支：
  - `project_id` 使用 `origin` 对应的 fork 项目路径或 ID。
  - `target_project_id` 使用 upstream 项目 ID。
  - 不要把 upstream 项目作为 `project_id`，同时只传 fork 的分支名；这会创建错误的 upstream-to-upstream MR，并导致 source SHA 缺失。
- `source_branch` 使用 `origin`/fork 上的 `issue-{id}`。
- 不要在 `upstream` 创建 source branch。
- `target_branch` 使用 upstream 默认分支，通常是 `master` 或 `main`。
- `title` 使用简洁变更摘要。
- `description` 包含变更、验证和 closure 行。

MR 描述格式：

```markdown
## 变更
- ...

## 验证
- ...

close #{id}
```

最后一个非空行必须严格是 closure 行，例如：

```text
close #3
```

创建 fork MR 后，必须读取完整 MR API 对象并确认：

- `source_project_id` 等于 `origin` fork 项目 ID。
- `target_project_id` 等于 upstream 项目 ID。
- `sha` 和 `diff_refs.head_sha` 都等于已推送的 origin 分支 HEAD，且非空。
- upstream 项目中不存在 `issue-{id}` 源分支。

如果任一条件不满足，关闭错误 MR，并用 fork 作为 `project_id`、upstream 作为 `target_project_id` 重新创建。

如果 MCP/API 不可用但 `glab` 可用：

- 先检查 `glab` 认证状态。
- 只有认证可用后才使用 `glab`。
- 如果 API 认证失败但 git push 可用，可临时用 GitLab push options 作为兜底；但之后仍要尽可能通过 MCP/API 确认 MR 状态。

### 8. 完成前最终确认

向用户报告完成前，必须确认并汇报：

- 当前仓库状态：

  ```bash
  git status --short --branch
  ```

- commit hash。
- 已推送的远端分支。
- MR IID 和 URL，必须来自 GitLab MCP/API 返回。
- MR 描述最后一个非空行是否为 `close #{id}`。
- 已确认没有故意把真实 token/secret 加入被跟踪文件。

如果某项无法确认，直接说明缺少哪项确认以及原因。

## 快速示例流程

新建 Issue 并完成 MR 的常见流程：

1. 检查工作区和当前分支。
2. 必要时切换到默认分支。
3. 确认 `upstream` 存在。
4. 执行 `git fetch --all`，并将本地默认分支 rebase 到 upstream 默认分支。
5. 在 upstream GitLab 项目创建 Issue，并记录 IID。
6. 从同步后的默认分支创建并切换到 `issue-{id}`。
7. 实现、测试、提交。
8. 将 `issue-{id}` 只推送到 `origin`。
9. 从 `origin`/fork 的 source branch 创建或更新指向 upstream 默认分支的 MR。
10. 确认 MR 描述最后一行是 `close #{id}`。
11. 返回 Issue URL、MR URL、commit hash、分支、验证结果和密钥安全确认。
