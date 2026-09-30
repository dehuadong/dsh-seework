---
title: 素材目录：默认移到文档目录，换目录时把文件搬过去
status: implemented
created: 2026-09-30
updated: 2026-09-30
approval: 用户在实测反馈里直接定了两条：「1、换目录时把旧目录的内容搬过去——这个可以接受；2、建议默认的目录不要放在~.dsh/目录下；参考DSH的默认工作区是放在用户的文档目录下，创建文件夹dsh-seework」（工作项 dehuadong/dsh-seework#4）
verification: npx playwright test 整跑 14 passed（22.5s，含新增 e2e/data-root-move.spec.ts）；pnpm typecheck 通过；pnpm test 39 个文件 535 通过 1 跳过（新增 src/documents-dir.test.ts 4 条与 src/library.test.ts 的搬移 5 条）；第一版挂在设置变更事件上的实现在 e2e 里完全不搬（探针实测），据此改的触发点
---

# Agent Note：素材目录：默认移到文档目录，换目录时把文件搬过去

## 问题

素材目录（数据根）过去的行为是：默认放在 `<DSH_HOME|~/.dsh>/dsh-seework`，换目录只换读写位置、旧文件留在原处。用户实测两条：

1. **换目录要把旧内容搬过去**（现在留在原处，旧板子上的图从此定位不到——上一轮只能如实报错）。
2. **默认目录不要藏在 `~/.dsh` 下**，参考 DSH 自己的默认工作区放在用户**文档目录**，创建文件夹 `dsh-seework`。

第 2 条必然连带第 1 条：默认一换，老用户的数据就在旧默认目录里，不搬的话升级后素材库看着是空的。

## 决定

1. **默认根 = `<系统文档目录>/dsh-seework`。** 系统文档目录按 DSH 自己的配方取：macOS `osascript`（`path to documents folder`）、Windows `GetFolderPath(MyDocuments, DoNotVerify)`、Linux `xdg-user-dir DOCUMENTS`（等于 home 视为"未启用"）。取不到（没这个工具、没 shell、超时 5s）退回 `<home>/Documents`。**不能硬编码 `Documents`**：实测这台机器的文档目录是 `D:\Backup\我的文档`（被搬到了 D 盘），中文 macOS 上叫「文稿」——硬编码会造出第二个错的文件夹。
   - **Windows 会问第二次（注册表）**：`GetFolderPath` 是 .NET 调用，企业策略（WDAC/AppLocker）把 PowerShell 放进 ConstrainedLanguage 模式时会**直接拒绝**（实测原文：`Method invocation is supported only on core types in this language mode.`），而 shell 把同一事实记在 `User Shell Folders\Personal`（`REG_EXPAND_SZ`，可能写成 `%USERPROFILE%\Documents`），`reg.exe` 没有语言模式限制。这一问是"在受限机器上仍然落到对文件夹"的关键，否则会静默退回 `~/Documents`——在文档目录被搬走的机器上正好是错的。
2. **搬移是数据根切换的一部分，而且是"先搬后切"**：搬完才切换，搬移期间读写仍走旧根。库被劈成两半时两边都看不全，这是唯一没有中间态的顺序。搬不动就留在旧根，并把原因留着给设置卡片报。
3. **只搬插件自己的条目**（`index.json`、`images/`、`canvas/`），**绝不覆盖**：目标已有同名文件就留在原处并计数。索引按条目 id 合并（源里有、目标里没有的条目并进去）——否则搬过去的图在盘上却看不见。**源目录本身不删**：留个空壳比递归删除安全（递归删除可能和用户刚放进去的文件抢）。
4. **搬移计数是图片张数**。索引是记账，不进用户看到的那个数字。
5. **默认根从"旧默认"起步，等系统答案到了再切过去。** 这样"默认目录变了"和"老用户的数据在旧默认里"是同一件事（一次搬移），也避免先搬到猜测、再搬到答案的两次搬移。
6. **触发点是"读设置"，不是设置变更事件。** 这代宿主的设置是**活引用**（写入原地生效），没有变更事件可用——第一版把搬移挂在 `onChange` 上，e2e 里宿主完全不搬（探针实测 `dataRootMove` 从不出现）；查 DSH 源码后确认 0.2 宿主没有 `installSection`，那个钩子根本不会被调用。现在 `resolve()`（每次读设置）与设置写入之后都会 follow 一次。
7. **"搬移"与"设置根"是两个入口。** `setLibraryDataRoot`（立刻生效、不搬）是原语，测试用它；`applyDataDirectory` / `followDataDirectory` 才搬。理由很硬：测试用临时目录调设置根，如果那个入口会搬，就会把用户真实素材搬进临时目录，测试结束时 `rm -rf` 掉——数据毁灭级的坑。
8. **部署/测试的覆盖口 `DSH_SEEWORK_DOCUMENTS_DIR`。** 系统答案**无法用环境变量重定向**（Windows 读的是账户的 shell 文件夹，不是 `%USERPROFILE%`），e2e 必须能把默认根关在自己的临时树里，否则第一次启动就会往开发者真实的 `D:\Backup\我的文档` 里搬东西。覆盖值不合法时返回"没有答案"，而不是悄悄退回真实目录。

## 备选方案

- **挂在设置变更事件（`onChange`）上**：0.2 宿主不触发，实测无效。驳回（见决定 6）。
- **同步搬移**（`renameSync` 等）：跨盘搬几个 GB 会冻住整个宿主。驳回。
- **先切换、后台搬移**：会出现"库看着是空的、再慢慢长回来"的中间态。驳回。
- **复制而不是搬**（旧文件留着）：用户要的是"搬过去"，而且留两份以后必然对不上；只保留"源目录空壳不删"。驳回。
- **覆盖同名文件**：会毁文件。驳回。
- **硬编码 `~/Documents`**：这台机器的文档目录在 D 盘，中文 macOS 是「文稿」。驳回。
- **只问 `GetFolderPath`（和 DSH 一样，不问注册表）**：DSH 只问这一句，但它在受限机器上会被拒（实测），失败后只能静默退回 `~/Documents`。多问一句注册表很便宜，而且 `reg.exe` 不受语言模式限制。驳回"只问一次"。
- **查找失败时改用 `<DSH_HOME>/dsh-seework`**（老默认）：那正是用户要求搬离的地方，而且会让"文档目录"这个意图在失败时消失。驳回（仍退回 `~/Documents`）。
- **把解析出的默认目录写进设置**：卡片会把它当成"自定义目录"（多出「恢复默认」），而它本来就是默认。驳回。
- **只改默认、不搬旧默认目录的数据**：升级后素材库看着是空的。驳回。

## 后果

- **换目录会动用户的文件**（这是用户要的）。搬移失败时留在旧根、卡片如实报原因，不会劈成两半。
- **升级后第一次读设置**：设置里没有 `dataDir` 时，旧默认目录 `<DSH_HOME>/dsh-seework` 的内容会被搬进 `<文档>/dsh-seework`；设置了 `dataDir` 时，旧默认目录的内容会被搬进那个目录（旧板子和图因此回来）。
- 这台机器的实际情况（供用户核对）：`dataDir` = `D:\Backup\我的文档\see`（当时是空的），旧默认目录 `C:\Users\MyPC\.dsh\dsh-seework` 里有 3 个画布素材和 1 块板 → 升级后第一次读设置会把它们搬进 `D:\Backup\我的文档\see`。
- 路由族多一条不变式：**读设置即让 store 跟上**（`resolve()` 会 follow），设置写入之后也 follow 一次。
- 搬移串行：两次改动不会互相踩。
- 已知限制：同名不覆盖意味着"目标已有同名文件"时源文件留在旧目录（会被计数并报出）；`index.json` 按 id 合并，目标已有的条目为准。

## 验证

- `npx playwright test` 整跑 **14 passed**（22.5s）：新增 [`e2e/data-root-move.spec.ts`](../../../../e2e/data-root-move.spec.ts) —— 在设置里换素材目录 → 宿主报出搬移（`dataRootMove` 的 `to` 与 `pending:false`）→ 图片文件在新目录、**不在**旧目录 → 同一张图仍能从新根读回 200（带 cache-bust 绕过浏览器那份 immutable 缓存）。
- 原来 `e2e/canvas-interactions.spec.ts` 里那条「换过素材目录后：定位如实报错」**删掉了**：搬移之后那个场景不再成立。"文件真的不在当前目录"的如实报错路径改由 `routes.test.ts` 的单测覆盖。
- `pnpm test`：39 个文件 **538 通过**、1 跳过。新增 `src/documents-dir.test.ts` 7 条（三平台命令、Windows 第二问走注册表、`%USERPROFILE%` 展开、XDG 的"未启用"答案、空答案/裸根/展开不出来的变量/无配方平台、部署覆盖口及其非法值）；`src/library.test.ts` 新增 5 条（搬移带索引且旧目录清空、绝不覆盖、跨盘 EXDEV 走"复制→校验→删源"、切换后才生效并回报、失败时留在旧根）。
- `pnpm typecheck`：通过。
- **查找链路的两处实测**（在这台机器上跑的，不是推断）：① 文档目录被搬到 D 盘时 `GetFolderPath` 正确返回 `D:\Backup\我的文档`（124ms）；② 强制 ConstrainedLanguage 后同一个调用报 `Method invocation is supported only on core types in this language mode.`，而 `reg.exe query ... /v Personal` 返回同样的 `D:\Backup\我的文档`。
- **没有实测的部分（如实记下）**：真实 macOS 与 Linux 上的 `osascript` / `xdg-user-dir` 只按 DSH 的配方实现并由单测钉住命令与解析，没有真机验证；Windows 上 `powershell.exe` 与 `reg.exe` 都被策略挡掉时会退回 `<home>/Documents`。
- **e2e 隔离**：`e2e/host.mjs` 把 `DSH_SEEWORK_DOCUMENTS_DIR` 指到临时树（见决定 8），并实测确认临时实例的默认根是 `<临时 home>/documents/dsh-seework`。
- 实测证据：第一版（挂在 `onChange` 上）在 e2e 里宿主从不搬移；探针显示设置写入后 `dataRootMove` 不出现、`library/list` 的 `dataRoot` 仍是默认目录。据此查源码定位到 `installSection` 在 0.2 上不存在，改为"读设置即 follow"。
