# dsh-seework 开发文档
 
> 使用中文简体回复用户的问题，包括GitHub Issues文档产物。
> 表达简明扼要，用通俗标准语言，给结论用大白话，不要抛技术选择题，严禁黑话与虚浮套话;
> 新造词必须和用户解释或按照约定的术语与定义;有产品空洞先自己核实代码/文档再上报。
> 输出直接呈现核心事实与动作，不打无意义流水账。
> 具体业务任务，多实测少猜测，基于验证而非空想推进任务。
 
插件的正式家是桌面客户端的 desktop profile

本文件是 **dsh-seework 插件工程**（deepseek-harness 插件）的代理入口；本目录既是工程根也是本项目的**仓库管理根**，文档归属与标准见 [`docs/AGENTS.md`](docs/AGENTS.md)，跟踪器、triage 标签与领域文档约定见 [`docs/agents/`](docs/agents/)。本文件只记插件细则。

在开发deepseek-harness 插件时遇到问题可参阅deepseek-harness官方源码工程包 `E:\workspace\DSH\deepseek-harness\packages`

## 文档位置

| 工件 | 位置 |
| --- | --- |
| 工程说明与使用指南 | [`README.md`](README.md) |
| 架构与实现**地图**——每处行为的现状与简短的「为什么」 | [`docs/architecture.md`](docs/architecture.md) |
| 详细设计与取舍——**一个主题一份**（同一主题的后续变更进同一份，标修订与状态；无关主题另开） | [`docs/design/`](docs/design/) |
| 架构决定——**不可逆、值得留档**的取舍（含被否决的备选） | [`docs/adr/`](docs/adr/) | 
| Agent 变更与决策记录 | [`.agents/notes/`](.agents/notes/README.md)（本工程） |
| 对外接口契约（本插件消费） | **外部属主**：SeeAI Hub 仓库（`dehuadong/seeaihub`）的 `docs/api/`，不在本目录 |

说明：`architecture.md`、`gui-verification.md`为历史开发文档，仅供参考历史做法，后期新开发不再记录，如需要另外建档,也不作为新的决策依据。 

## 工程工作流

> 文档和仓库治理工作可以绕过该工程工作流，除非它改变了重要的产品、技术、架构或其他工程契约。

### Discuss

理解问题，结合现有代码、文档、历史决策、已接受的 ADR/RFC 和项目约束形成解决方案，并消除足够的歧义，以判断下一阶段。
讨论不是被动访谈。优先自行分析已有项目上下文，而不是把可判断的问题交给用户。
讨论过程中：

- 明确实际问题、约束和相关既有决策
- 提出有实质差异的可行方案，并在依据充分时给出推荐
- 说明关键权衡、风险和影响
- 发现假设与现有事实或决策冲突时，明确指出
- 仅在缺少必要信息，或涉及未决的产品、业务、范围、兼容性、成本、风险及其他价值判断时，请求用户裁决

不要要求用户重复已有信息，也不要求在 Discuss 中确定所有实现细节。

在以下情况下继续停留在 Discuss：

- 工作仍处于探索阶段
- 仍在比较重要的备选方案
- 用户当前只是寻求理解，而不是准备推进
- 目标或选定范围尚不足以形成实施合同

不要仅因为正在讨论产品、技术或架构决策，就创建规划产物。
模型可以判断讨论已经足够成熟，并说明已解决事项、剩余未决事项和建议的下一阶段，但不能仅凭自身判断离开 Discuss。
何时从 Discuss 进入 Planning 或 Implementation Gate，由用户决定。若用户此前的请求已经明确授权推进，则复用该授权。
当用户已授权推进时：
- 若仍有重要合同决策需要补全或正式固化，则进入 Planning
- 否则按照 `docs/agents/engineering.md` 中的 Implementation Gate 继续

授权进入 Planning 不等于授权实施。

### 执行授权

当当前工作已具备实施条件但尚未获得执行授权时，需要用户明确输入“执行实现”。

“确认”“可以”“同意”等仅表示审批，不构成执行授权。

执行授权仅适用于**当前已确认范围的实施工作**，并覆盖该工作内部连续发生的：

- 实施
- Implementation Review
- 范围内修正
- Verify

这些阶段之间不需要重复请求执行授权。

以下情况不继承原有执行授权：

- 开始新的工作项
- 扩大或改变已授权范围
- 返回 Planning 后形成了实质变化的合同或方案
- 出现需要用户重新裁决的重大决策

执行授权不会因为处于同一会话而自动延续到其他工作。

端到端请求在获得当前工作项的执行授权并通过相应门禁后，持续推进至验证完成。

限定阶段的请求，在该阶段及其要求的审查完成后结束。


## 文档与约定

### Issue tracker

提案与工作项存放在 GitHub Issues（`dehuadong/dsh-seework`）。本目录就是该仓库的 clone，`origin` 指向 `git@github.com:dehuadong/dsh-seework.git`，正常 `git push` 即可；`gh` 子命令因为仓库归属不在当前目录的远端推断范围内，仍要显式 `-R dehuadong/dsh-seework`。见 [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md)。

### Triage labels

使用五个标准 triage 标签。见 [`docs/agents/triage-labels.md`](docs/agents/triage-labels.md)。

### 文档归属

本工程文档入口是 [`docs/AGENTS.md`](docs/AGENTS.md)——文档类型与属主、状态头、写作与审阅标准、文件边界都在那里，本文件不复述：

- 领域文档（`CONTEXT.md` 与 `docs/adr/`）的读取规则、ADR 冲突处理：[`docs/agents/domain.md`](docs/agents/domain.md)。
- Agent Note 的记录范围、生命周期与格式：[`.agents/notes/README.md`](.agents/notes/README.md)；只读导航与机械检查用 `node scripts/decisions/list.mjs`、`node scripts/decisions/check.mjs`。

 
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
| `npx playwright test` | 在**真实 GUI** 里跑 `e2e/**/*.spec.ts`：临时实例、临时 `DSH_HOME`，由 `e2e/host.mjs` 起停；只覆盖 jsdom 观测不到的那层（客户端半边有没有加载、设置页有没有落进导航、入口在不在屏幕上）。零成本，不消耗生图额度 |

## E2E 测试规则

1. UI 行为的验证一律跑 `npx playwright test`；只跑一个文件就 `npx playwright test e2e/xxx.spec.ts`。宿主由 Playwright 自己起（`e2e/host.mjs`），不用先开终端。
2. 每个新功能或 bugfix 都要带一个能复现它的 spec（`e2e/**/*.spec.ts`），和业务代码一起提交。**不要放进 `tests/`——那个目录被 `.gitignore` 忽略**。
3. 脚本失败时按这个顺序走：先让脚本稳定复现问题（红）→ 读产物（`npx playwright show-trace`、失败截图、`test-results/*/error-context.md` 里的 ARIA 快照）→ 改业务代码 → 重跑同一条命令，直到绿。
4. 选择器用 `getByRole` / `getByLabel`；插件的 DOM 锚点在 `e2e/support.ts` 的 `SELECTORS` 里，缺稳定锚点就在组件上补 `data-dsh-seework-*`，不用脆弱的 CSS 层级。
5. 不写 UI 单元测试（按钮渲染、className、快照）；UI 行为由 spec 覆盖。业务逻辑、纯函数、接口契约仍由 `pnpm test` 覆盖。
6. spec 只断言用户看得见的东西；故障产物（截图、trace、ARIA 快照）用来读失败原因，不用来当断言对象。
7. **spec 不许消耗生成额度**：不写真发起的生图。要验生图链路用 `pnpm verify-live`，它会明确报出扣费。
8. E2E 跑的是 `lib/` 这份构建产物，不是源码：`src/` 比 `lib/` 新时 `e2e/host.mjs` 会自动重建（`DSH_E2E_SKIP_BUILD=1` 可关）。这个构建不是逐字节可复现的，所以别把「跑完 E2E 后 `lib/` 的 mtime / 内容变了」当成缺陷。
9. 临时实例与用户真实 `~/.dsh`、桌面客户端 `desktop` profile、真实素材库与画布完全隔离；临时目录在 `.tmp-e2e/`。实例随 Playwright 结束而退出，需要手工回收时**按端口**定位（`Get-NetTCPConnection -LocalPort 3311`），不许按进程名批量杀。
10. 需要人眼判断的视觉细节（好不好看、间距对不对）列成清单交给人验；脚本不假装能替人判断。

## GUI 核对

插件跑在**桌面客户端的 `desktop` profile** 里；逐面要核的东西（选择器、断言、哪些零成本、哪些要备份还原）以及桌面客户端与临时实例的分工，在 [`docs/gui-verification.md`](docs/gui-verification.md)。

**起临时实例或收工前先读它的「临时实例」一节**：那里的回收按**端口**定位进程，不许按进程名批量杀——`Get-Process chrome | Stop-Process` 会关掉用户正在用的浏览器，真实发生过。
