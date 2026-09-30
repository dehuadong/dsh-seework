---
title: 首页经右栏开始页进入素材库与画布
status: implemented
created: 2026-09-30
updated: 2026-09-30
approval: 用户提出「在侧栏开始页也做个按钮后打开」，并指定按工程工作流推进（讨论见 GitHub Issue dehuadong/dsh-seework#1）
verification: npx playwright test 两次全绿（6 passed，17.5s / 16.0s，含新增 3 条与原有 3 条）；pnpm typecheck 通过；pnpm test 37 个文件 515 通过 1 跳过；e2e/host.mjs 在 src/ 比 lib/ 新时自动重建并复制进临时 profile
---

# Agent Note：首页经右栏开始页进入素材库与画布

## 问题

插件的「素材库 / 画布」入口只在会话里成立：它们注册进会话作用域的 `conversation.session.header.utilities`。无会话的首页没有标题栏，于是插件把入口降级成右下角浮动按钮，而它打开的两种东西都不是右栏里的页面——素材库是自己的左侧抽屉，画布是自己的全屏浮层（`position: fixed; inset: 0; z-index: 63`）。用户实测报出两个后果：浮层把小尺寸窗口整个盖住，而它**同时盖住了那个浮动按钮本身**（dock 是 60），退出只剩浮层头部的小「关闭」，且浮层不认 Esc。

用户两次指出右栏「开始」页里就有现成的卡片（工作区文件 / 新建终端 / 浏览器），要求在那里也加一张。查证结果为真：那是宿主专门开放的接缝，插件此前没有登记。

## 决定

1. **入口登记到右栏 guide 页，而不是再造一处浮动入口。** 宿主契约是 `sidebar.right.tab.guide.entry`（keyed / session）＋ `SidebarRightTabRegistry.register` 的 `guide` 元数据；开始页（`tab.guide.title = '开始'`）遍历所有登记了 guide 的类型渲染卡片，没有自定义渲染器时用宿主的默认卡片，点击即 `tab.actions.openTab(kind, { replaceTab: true })`。改动落在 [`src/client/sidebar-tabs.ts`](../../../../src/client/sidebar-tabs.ts) 的 `TAB_TARGETS`：每个 tab 目标补一个 `guide`（入口 id、`order` 40/50、标题、一行描述），注册时一并交给宿主。
2. **只登记元数据，不自带卡片组件。** 宿主的默认卡片就带图标、标题、描述与快捷键位，加自定义组件只是多一处要维护的渲染器；等真需要卡片内交互（例如直接列出最近几张图）再注册 `.guide.entry` 不迟。
3. **不预置 `openTabIn` 这类内部路径。** `ctx.sidebarRight.openTab` 经过 `require()`，在没有「屏上会话」时抛错（`SidebarRightController.require`）。这次实测证明首页并不落进那条分支：开始页卡片点击后右栏正常出现我们的 tab，因此无需踩不在 `ISidebarRight` 上的内部 API。
4. **不动 `docs/architecture.md` 与 `docs/gui-verification.md`。** 两份文档已被声明为历史材料、新开发不再记录。右栏槽位的作用域、开始页接缝与既有浮动降级契约仍写在 `docs/architecture.md` 里且与现状不符，但按归属规则要改就得先解冻，本次不碰；事实以本记录、Issue #1 与 `e2e/guide-entries.spec.ts` 的断言为准。
5. **范围不含画布浮层的退出修复。** 用户报的「全屏退不出去」包含两条：浮层不认 Esc、关掉它的按钮被自己盖住的入口。后者在开始页有入口之后已不再是唯一出路；前者是独立缺陷，另开工作项处理。

## 备选方案

- **等 DSH 开放右栏根作用域内容位**：前提判断是错的——右栏并非无内容，而是开始页已为第三方留了座位（`sidebar.right.tab.guide.entry`）。按错误前提推进会白等一次上游改动。
- **首页自己画一条工具条**：多一处入口、多一套要维护的定位与显隐，且仍然解决不了「没有会话就没有标题栏」这个根因；用户此前也只是要求入口别再钉在右下角。
- **把首页入口接到 `ctx.layout.openRightbar` + `openTabIn(sessionId, kind)`**：能绕过 `require()`，但 `openTabIn` 不在对外接口上，踩内部实现要额外承担失效风险；实测证明公开路径在首页可用，因此不引入。
- **注册自定义开始页卡片（`.guide.entry`）**：能拿到 `sessionId` 与 `tab.actions`，未来若要「卡片内直接选图/选板」才是必需；现在只是把宿主默认卡片重画一遍，收益为零。
- **开始页卡片只保留一张（画布）**：素材库在首页本来就有抽屉可用。驳回：用户要的是两个面都能从侧栏进，且素材库抽屉与画布 tab 现在能并排存在于右栏。

## 后果

- 首页与无会话屏幕上，右栏开始页出现两张 SeeWork 卡片；点任一张都会把该面当作页面开在右栏，与勾选会话标题栏入口的行为一致。用户不必再先找右下角的浮动按钮。
- 开始页卡片总数从 3 张增加到 5 张，超过宿主 `MAX_DESCRIBED_ENTRIES = 4` 后**所有卡片的描述行都会被隐藏**（宿主的既定规则，插件无法选择保留）。这是加两张卡片必须付的代价，验收时按「标题仍在」判定。
- 浮动按钮保留为右栏不可用时的兜底（`registerSidebarTabsWhenReady` 仍可能在 10 秒内等不到侧栏服务而永久降级）；它与开始页卡片并存，不是替代关系。
- 画布全屏浮层仍是不支持 Esc 的降级说明面，等独立工作项处理；在那之前，开始页入口给首页留了一条不必经过浮层的路。
- `lib/` 是这次变更的交付形态，已随构建更新；E2E 跑的就是它。

## 验证

- `npx playwright test`：新增 [`e2e/guide-entries.spec.ts`](../../../../e2e/guide-entries.spec.ts) 三条 + 原有三条，两次全绿（`6 passed`，17.5s / 16.0s，无 retries）。新增三条分别断言：首页打开右栏后开始页出现 `seework-library` 与 `seework-canvas` 两张卡片；点「画布」卡片后右栏出现 `[data-dsh-seework-canvas-tab]` 且**不**出现插件的全屏浮层；两张卡片各自开得出自己的 tab（每次经 tab 条的「新标签页」回到开始页）。
- 接缝查证：宿主开始页是 `ui-sidebar-right` 的 guide tab（`locales.ts` 的 `tab.guide.title`），卡片由 `tabs/guide/GuideBody.tsx` 渲染，登记面在 `tab-registry.ts` 的 `SidebarRightTabDefinition.guide`；实测的 ARIA 快照显示目录级断言成立。
- `pnpm typecheck`：通过。
- `pnpm test`：37 个文件 515 通过、1 跳过（`src/client/sidebar-tabs.test.ts` 增加 4 条断言，钉住两张卡片的存在、顺序 40/50、标题与描述为函数）。
- 构建：`e2e/host.mjs` 检测到 `src/` 比 `lib/` 新并自动 `node --run build`，随后把产物复制进临时 profile；两次整跑都没有出现客户端半边加载失败。
