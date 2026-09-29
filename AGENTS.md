# dsh-seework 开发文档

本文件是 **dsh-seework 插件工程**（DSH 插件）的代理入口；本目录既是工程根也是本项目的**仓库管理根**，文档归属与标准见 [`docs/AGENTS.md`](docs/AGENTS.md)，跟踪器、triage 标签与领域文档约定见 [`docs/agents/`](docs/agents/)。本文件只记插件细则。

## 文档位置

| 工件 | 位置 |
| --- | --- |
| 工程说明与使用指南 | [`README.md`](README.md) |
| 架构与实现**地图**——每处行为的现状与简短的「为什么」 | [`docs/architecture.md`](docs/architecture.md) |
| 详细设计与取舍——**一个主题一份**（同一主题的后续变更进同一份，标修订与状态；无关主题另开） | [`docs/design/`](docs/design/) |
| 架构决定——**不可逆、值得留档**的取舍（含被否决的备选） | [`docs/adr/`](docs/adr/) |
| GUI 端到端核对——**怎么核、断言、成本** | [`docs/gui-verification.md`](docs/gui-verification.md) |
| Agent 变更与决策记录 | [`.agents/notes/`](.agents/notes/README.md)（本工程） |
| 对外接口契约（本插件消费） | **外部属主**：SeeAI Hub 仓库（`dehuadong/seeaihub`）的 `docs/api/`，不在本目录 |





## 文档与约定

### Issue tracker

提案与工作项存放在 GitHub Issues（`dehuadong/dsh-seework`，该仓库尚未创建、本目录也还不是它的 clone，操作时显式 `gh -R`）。见 [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md)。

### Triage labels

使用五个标准 triage 标签。见 [`docs/agents/triage-labels.md`](docs/agents/triage-labels.md)。

### 文档归属

本工程文档入口是 [`docs/AGENTS.md`](docs/AGENTS.md)——文档类型与属主、状态头、写作与审阅标准、文件边界都在那里，本文件不复述：

- 领域文档（`CONTEXT.md` 与 `docs/adr/`）的读取规则、ADR 冲突处理：[`docs/agents/domain.md`](docs/agents/domain.md)。
- Agent Note 的记录范围、生命周期与格式：[`.agents/notes/README.md`](.agents/notes/README.md)；只读导航与机械检查用 `node scripts/decisions/list.mjs`、`node scripts/decisions/check.mjs`。

## 边界纪律

- 
- 
- **一处行为只写一次「为什么」**：现状与简短理由记在 [`docs/architecture.md`](docs/architecture.md)，长文（取舍、备选、接口、评审结论）记在 [`docs/design/`](docs/design/)，不可逆的决定记在 [`docs/adr/`](docs/adr/)；本文件不复述。行为改了改那一边，别在这里补一遍。
- **`lib/` 是产物，不要手改**：`pnpm build` 会按源码整份覆盖，手工改动**不会报错、直接消失**。真实发生过一次——有人直接在 `lib/index.js` 里把提示文案的「（或右下角「SeeWork 设置」按钮）」改成「（侧边栏）」（提交 `c45382eb`，只动 lib 没动 src），下一次 `pnpm build` 就把它冲掉了，只能反过来在 `src/agent-tools.ts` 里补回来。改动一律落在 `src/`；怀疑已有手改时，扫一遍"只动了 `lib/` 没动 `src/`"的提交：

  ```powershell
  foreach ($c in (git log --format=%h -25)) {
    $files = git show --name-only --format= $c
    $hasLib = ($files | Where-Object { $_ -like "dsh-seework/lib/*" }).Count -gt 0
    $hasSrc = ($files | Where-Object { $_ -like "dsh-seework/src/*" }).Count -gt 0
    if ($hasLib -and -not $hasSrc) { "$c  $((git log -1 --format=%s $c))" }
  }
  ```

## 验证入口

| 命令 | 覆盖 |
| --- | --- |
| `pnpm typecheck` | 全量类型（宿主 + 浏览器两半，含测试） |
| `pnpm test` | 单元与集成测试：请求映射与能力裁剪、目录来源与回退、素材库落盘、画布存储与修订栅栏、视口数学、路由族、设置桥、各面板渲染，以及**插件装配本身**（`src/index.test.ts`：工具注册、路由注册时机、提示词公告） |
| `pnpm build` | 产出 `lib/index.js` 与 `lib/client.js` |
| `node scripts/smoke.mjs` | 对构建产物跑端到端（桩网关，无需 GUI） |
| `pnpm sync` | 把构建产物同步进已安装的 profile——`file:` 装的是副本，不同步的话 GUI 会一直跑旧 bundle 而且不报错 |
| `pnpm probe -- <base-url>` | 在一个真实宿主上核对：启动图里有没有本插件的客户端半边、bundle 能不能下载、是否误内联了 react、是否依赖了宿主模块表里没有的模块（token 走环境变量 `DSH_PROBE_TOKEN`） |
| `pnpm verify-live -- <base-url> <api-key>` | 对着真实部署跑一遍设置桥写入 → 目录发现 → 提交生成 → 素材库读回（会消耗一次生成额度，余额不足时如实报出网关原文） |

## GUI 核对

装进 `dsh web` profile 后逐面要核的东西（选择器、断言、哪些零成本、哪些要备份还原）在 [`docs/gui-verification.md`](docs/gui-verification.md)。

**起临时实例或收工前先读它的「临时实例」一节**：那里的回收按**端口**定位进程，不许按进程名批量杀——`Get-Process chrome | Stop-Process` 会关掉用户正在用的浏览器，真实发生过。
