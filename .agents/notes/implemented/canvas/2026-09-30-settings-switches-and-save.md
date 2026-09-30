---
title: 设置卡片：退役「启用插件」、把「保存」留给它真正保存的那一节
status: implemented
created: 2026-09-30
updated: 2026-09-30
approval: 用户实测设置卡片提出两条：「1、启用插件和允许Agent生图的勾选应该合并；理由是DSH本来已经有插件的安装、启用、卸载功能了。然后启用插件就是意味允许Agent生图；2、保存的按钮到底对那些变更有效，我看好像都是自动保存的」（工作项 dehuadong/dsh-seework#5）
verification: npx playwright test 整跑 15 passed（22.7s，含新增的一条「本地与行为只剩两个开关且这一节没有保存按钮」）；pnpm typecheck 通过；pnpm test 39 个文件 536 通过 1 跳过
---

# Agent Note：设置卡片：退役「启用插件」、把「保存」留给它真正保存的那一节

## 问题

用户在设置卡片上实测两条：

1. **「启用插件」与「允许 Agent 生图」两个勾选应该合并。** 理由：DSH 自己就有插件的安装/启用/卸载（`plugin_manager` 的 `setPluginEnabled`），插件自带的「启用插件」是重复的；而且"启用插件"本来就意味着"允许 Agent 生图"。
2. **「保存」按钮到底对哪些变更有效？** 看着都是自动保存的。

## 查证结果（动手前先核实的）

- `enabled` 当时管**四处**：系统提示词公告（`enabled && announceToAgent`）、随包技能是否注册进宿主目录、Agent 工具调用时拒绝（`plugin-disabled`）、生成路由拒绝（`plugin-disabled`）。它和 DSH 的 `setPluginEnabled` 是同一件事的两种做法。
- `allowAgentGeneration` 只管**一处**：Agent 调用 `generate_image` 时是否放行（用户自己在面板生图不受它影响）。所以"启用插件"对 Agent 而言确实就是它。
- 卡片底部那枚「保存」调的是 `saveConnection()`：**只保存连接那一节的暂存值**（API 地址 / 模型目录地址 / 用户 API Key），其余字段与开关都是改完即写。也就是说那枚按钮既放错了地方，又在没有连接改动时只会说「没有需要保存的改动」——用户的困惑是准确的。

## 决定

1. **退役 `enabled`。** 从设置 schema、`Config` / `EffectiveConfig` / `effectiveConfig`、卡片、以及四处判断里退场；插件的开/关交给 DSH 自己的插件管理（停用即整个插件不加载）。已存文档里的 `enabled` 按本工程既有的**退役键**处理：不读取、不迁移、不报错，也不假装它还生效——并且**真把它从文档里清掉**（每次启动检查一次，还在就 `unset`）。归属与被否决的备选见 [ADR-0002](../../../../docs/adr/0002-plugin-enable-disable-belongs-to-the-host.md)。
2. **`allowAgentGeneration` 成为唯一的行为开关**，名字就说它做的事。
3. **随包技能不再跟任何设置走**：它随插件加载而注册，`announceToAgent` 只管提示词预算（ADR-0001 的既定分工），`syncSkill` 因此整体消失，注册改成注入回调里的一次 `ctx.effect`。
4. **「本地与行为」不再有「保存」按钮**，并在这一节写明"改完立即生效"；暂存后保存的只有连接一节，「保存连接」留在连接一节里。

## 备选方案

- **留着 `enabled` 但隐藏**：藏起来的开关比看得见的更糟（用户会以为插件关不掉，实际是某个看不见的字段在挡）。驳回。
- **把 `enabled` 改名成 `allowAgentGeneration` 的语义（删掉 `allowAgentGeneration`）**：老文档里的 `enabled: false` 会变成"Agent 不能生图"，名与实不符，而且这个字段名在 DSH 的插件配置语境里另有含义。驳回。
- **两个开关都留、只改文案**：用户明确要求合并，而且 DSH 已经提供了同一件事的开关。驳回。
- **让那枚「保存」保存全部字段（含连接）**：会破坏连接一节的暂存语义——API Key 是 `role('secret')`，读不回来，误覆盖不可撤销，暂存正是为它设计的。驳回。
- **把开关也改成"暂存 + 统一保存"**：多一个"忘了保存"的失败模式，而且和素材目录（改完立即生效、还可能搬文件）不一致。驳回。

## 后果

- **行为变化，如实记下**：老文档里存着 `enabled: false` 的用户，升级后插件是启用的（那个键被忽略）。要停用请用 DSH 的插件管理——那也是唯一能真正卸载/不加载的地方。
- 生成路由不再回 `plugin-disabled`；Agent 工具不再回那个错误码（`agent-generation-disabled` 仍在）。
- 卡片少了「启用插件」和底部那枚「保存」，多了两句说明。
- 三条单测用例随之消失（"停用时不注册技能"、"技能跟随 `enabled` 运行时切换"、"停用时不出公告"）：它们保护的开关不存在了；技能注册、公告跟随 `announceToAgent` 仍由相邻用例覆盖。

## 验证

- `npx playwright test` 整跑 **15 passed**（22.7s）：新增 [`e2e/plugin-alive.spec.ts`](../../../../e2e/plugin-alive.spec.ts) 一条 —— 设置页的「本地与行为」里**没有**「启用插件」、有「允许 Agent 生图」与「把插件与模型告知 Agent」，且整页**没有**叫「保存」的按钮、「保存连接」在（按 `getByLabel` / `getByRole` 断言，不是文本匹配）。
- `pnpm test`：39 个文件 **537 通过**、1 跳过。`SettingsCard.test.tsx` 改成断言"两个开关、没有启用插件"、"行为一节没有保存按钮"、以及开关写入的是 `allowAgentGeneration`；`routes.test.ts` 的 schema 默认值断言改成 `allowAgentGeneration`；`index.test.ts` 新增一条：文档里还带着 `enabled` 时插件写出 `{op:'unset', path:['enabled']}`，干净文档什么都不写。
- `pnpm typecheck`：通过。
- 决定本身留档在 [`docs/adr/0002-plugin-enable-disable-belongs-to-the-host.md`](../../../../docs/adr/0002-plugin-enable-disable-belongs-to-the-host.md)（编 0002：0001 在 `docs/agents/domain.md` 里已预留给「Agent 可见面的承载分工」，`index.ts` 的技能注释也引它）。
- 顺带核对了用户的前提：DSH 的 `plugin_manager` 确有 `setPluginEnabled`（见 `.agents/notes/implemented/dev-infra/2026-09-29-npm-distribution-and-in-plugin-update.md` 里对它的记录），所以"启用插件"确实是与宿主重复的第二个开关。
