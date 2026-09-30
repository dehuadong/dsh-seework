# dsh-seework 开发文档
 
> 使用中文简体回复用户的问题，包括GitHub Issues文档产物。
> 表达简明扼要，用通俗标准语言，给结论用大白话，不要抛技术选择题，严禁黑话与虚浮套话;
> 新造词必须和用户解释或按照约定的术语与定义;有产品空洞先自己核实代码/文档再上报。
> 输出直接呈现核心事实与动作，不打无意义流水账。
> 具体业务任务，多实测少猜测，基于验证而非空想推进任务。
 
本文件是 **dsh-seework 插件工程**（DSH 插件）的代理入口；本目录既是工程根也是本项目的**仓库管理根**，文档归属与标准见 [`docs/AGENTS.md`](docs/AGENTS.md)，跟踪器、triage 标签与领域文档约定见 [`docs/agents/`](docs/agents/)。本文件只记插件细则。

## 文档位置

| 工件 | 位置 |
| --- | --- |
| 工程说明与使用指南 | [`README.md`](README.md) |
| 架构与实现**地图**——每处行为的现状与简短的「为什么」 | [`docs/architecture.md`](docs/architecture.md) |
| 详细设计与取舍——**一个主题一份**（同一主题的后续变更进同一份，标修订与状态；无关主题另开） | [`docs/design/`](docs/design/) |
| 架构决定——**不可逆、值得留档**的取舍（含被否决的备选） | [`docs/adr/`](docs/adr/) | 
| Agent 变更与决策记录 | [`.agents/notes/`](.agents/notes/README.md)（本工程） |
| 对外接口契约（本插件消费） | **外部属主**：SeeAI Hub 仓库（`dehuadong/seeaihub`）的 `docs/api/`，不在本目录 |

## 工程工作流

> 文档和仓库治理工作可以绕过该工程工作流，除非它改变了重要的产品、技术、架构或其他工程契约。

### Discuss

使用 Discuss 理解请求、探索备选方案，并消除足够的歧义，以判断下一阶段。
在以下情况下继续停留在 Discuss：

* 工作仍处于探索阶段
* 仍在比较重要的备选方案
* 用户当前只是寻求理解，而不是准备推进实施
* 目标或选定范围尚不足以形成实施合同

常规细节优先根据上下文和仓库证据自行解决。
只询问会实质影响工作的缺失信息；这里不要求所有实现细节都已经确定。
不要仅因为正在讨论产品、技术或架构决策，就创建规划产物。
模型可以判断讨论已经足够成熟，可以进入后续阶段，但不能仅凭这一判断自行离开 Discuss。
何时从讨论进入规划或实施，由用户决定。若用户此前的请求已经明确授权推进，则复用该授权。
当用户已授权推进时：

* 若仍有重要合同决策需要补全或正式固化，则进入 Planning
* 否则按照 `docs/agents/engineering.md` 中的 Implementation Gate 继续

授权进入 Planning 不等于授权实施。

### 执行授权

当前范围已经具备实施条件但尚未获得执行授权时，需要用户输入“执行实现”。
“确认”“可以”“同意”等仅表示审批，不构成执行授权。
执行授权在已确定的工作范围内持续有效，覆盖实施、审查、范围内修正和验证；阶段切换不要求重复授权。
新增范围或尚未解决的重大决策仍需要用户授权。
端到端请求在满足相应工作流门禁后，持续推进至验证完成。
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

## GUI 核对

插件跑在**桌面客户端的 `desktop` profile** 里；逐面要核的东西（选择器、断言、哪些零成本、哪些要备份还原）以及桌面客户端与临时实例的分工，在 [`docs/gui-verification.md`](docs/gui-verification.md)。

**起临时实例或收工前先读它的「临时实例」一节**：那里的回收按**端口**定位进程，不许按进程名批量杀——`Get-Process chrome | Stop-Process` 会关掉用户正在用的浏览器，真实发生过。
