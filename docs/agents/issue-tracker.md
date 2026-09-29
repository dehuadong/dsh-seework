# Issue tracker: GitHub

本工程的提案与工作项以 GitHub Issues 形式存放在 **`dehuadong/dsh-seework`**，所有操作使用 `gh` CLI。独立的 Spec 与设计文档留在各自登记的属主处（见 [`../AGENTS.md`](../AGENTS.md)）。

**当前访问状态**：该仓库**尚未创建**，本目录也还不是它的 clone（本目录没有 git 元数据）。因此在本目录里 `gh` 无法从 remote 推断仓库，必须显式指定：`gh -R dehuadong/dsh-seework <子命令>`。建仓与推送属于用户动作，本配置不代办，也不创建标签或测试 issue。

## 操作约定

- **创建 issue**：`gh -R dehuadong/dsh-seework issue create --title "..." --body "..."`；多行正文用 heredoc。
- **查看 issue**：`gh -R dehuadong/dsh-seework issue view <number> --comments`，可用 `jq` 过滤评论，同时拿到标签。
- **列出 issues**：`gh -R dehuadong/dsh-seework issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，配合 `--label` 与 `--state` 筛选。
- **评论 issue**：`gh -R dehuadong/dsh-seework issue comment <number> --body "..."`
- **加/减标签**：`gh -R dehuadong/dsh-seework issue edit <number> --add-label "..."` / `--remove-label "..."`
- **关闭 issue**：`gh -R dehuadong/dsh-seework issue close <number> --comment "..."`

在仓库 clone 目录内工作时可省略 `-R`；`--help` 里的仓库推断对 `-R` 与 clone 内运行同样适用。

## 提案工作流

提案是一个 GitHub issue，以 URL 或「仓库限定 + 编号」标识。同一工作复用同一个 issue；独立的需求与设计工件留在登记位置并链接过去，不在 issue 里复制正文。

工作状态用 issue **正文顶部的 `Status:` 行**表示（本工程不使用状态标签）：

| Status | 含义 |
| --- | --- |
| `planning` | 范围仍在收敛，或重要合同决策尚未固化 |
| `ready` | 所需评审与批准齐备，选定范围无阻塞，可进入实施 |
| `in-progress` | 已获执行授权，正在实施 |
| `complete` | 已交付并通过最终验证 |
| `rejected` | 决定不做的，保留原因 |

Plan Review 的结论与批准证据写在 issue 的决策小节或关联的评审评论里。`ready` 的准入条件是所需评审与批准齐备、选定范围没有阻塞性决定或依赖；**执行授权**按项目指令另行判断，状态本身不授权 `/planning` 或 `/implement`。失去准入条件时把状态退回 `planning`，记录阻塞并把受影响工作交回讨论。状态是工作状态，与 triage 标签、Agent Note 生命周期互不替代。历史工作（Originally 记录在 SeeAI Hub 仓库 Issues 里的 `#NNN`）保持那边的编号与状态映射，不在本仓库另建平行词表。

## PR 是否作为 triage 来源

**PR 作为需求来源：否。**

## 当 skill 说「发布到 issue tracker」

先从请求与登记归属确定工作项与落点：同一工作已存在 issue 就更新它，只有确实需要新工作项时才新建。确认该范围的发布已被请求或已获授权——setup 或 `ready` 状态本身**不授予**发布权限。未给标识时先检索相关既有 issue，避免重复；归属不明时先解决归属再动笔。

## 当 skill 说「获取对应工单」

执行 `gh -R dehuadong/dsh-seework issue view <number> --comments`。

## Wayfinding 操作

供 `/wayfinder` 使用。**地图**是一张标记 `wayfinder:map` 的 issue，**子工单**是其下的子 issue。

- **地图**：`gh issue create --label wayfinder:map --title "..." --body "Notes / Decisions-so-far / Fog"`。
- **子工单**：用 GitHub 子 issue 关联到地图（`gh api` 的子 issue 端点）；该能力不可用时改为把子工单放进地图正文的任务清单，并在子工单正文顶部写 `Part of #<map>`。标签 `wayfinder:<type>`（`research` / `prototype` / `grilling` / `task`）。领取时指派给执行者。
- **阻塞**：优先用 GitHub 原生 issue 依赖（`gh api --method POST repos/dehuadong/dsh-seework/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`，其中 `<blocker-db-id>` 是阻塞者的**数字数据库 id**，不是 `#编号` 也不是 `node_id`）。读 `issue_dependencies_summary.blocked_by` 作为活门（只含未关闭的阻塞者）。不可用时退回正文顶部的 `Blocked by: #<n>` 行；全部阻塞者关闭即解禁。
- **边界查询**：列出地图的未关闭子工单，去掉有未关闭阻塞者（`blocked_by > 0`，或 `Blocked by:` 行里仍有未关闭 issue）或已有 assignee 的，按地图顺序取第一个。
- **领取**：`gh -R dehuadong/dsh-seework issue edit <n> --add-assignee @me`，本次会话的第一次写操作。
- **解决**：`gh -R dehuadong/dsh-seework issue comment <n> --body "<answer>"`，然后 `issue close <n>`，最后把上下文指针（要点 + 链接）追加到地图的 Decisions-so-far。
