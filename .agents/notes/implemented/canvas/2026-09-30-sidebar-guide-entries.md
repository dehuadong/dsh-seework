---
title: 首页经右栏开始页进入素材库与画布
status: implemented
created: 2026-09-30
updated: 2026-09-30
approval: 用户提出「在侧栏开始页也做个按钮后打开」，并指定按工程工作流推进（讨论见 GitHub Issue dehuadong/dsh-seework#1）
verification: npx playwright test 最终整跑 6 passed（15.9s，含首页无浮动入口、卡片进右栏不落浮层、两张卡片各自开 tab）；pnpm typecheck 通过；pnpm test 36 个文件 508 通过 1 跳过；删除浮动降级后首页 `[data-dsh-seework-dock]` 与两个 launcher 锚点计数均为 0；e2e/host.mjs 在 src/ 比 lib/ 新时自动重建并复制进临时 profile
---

# Agent Note：首页经右栏开始页进入素材库与画布

## 问题

插件的「素材库 / 画布」入口只在会话里成立：它们注册进会话作用域的 `conversation.session.header.utilities`。无会话的首页没有标题栏，于是插件把入口降级成右下角浮动按钮，而它打开的两种东西都不是右栏里的页面——素材库是自己的左侧抽屉，画布是自己的全屏浮层（`position: fixed; inset: 0; z-index: 63`）。用户实测报出两个后果：浮层把小尺寸窗口整个盖住，而它**同时盖住了那个浮动按钮本身**（dock 是 60），退出只剩浮层头部的小「关闭」，且浮层不认 Esc。

用户两次指出右栏「开始」页里就有现成的卡片（工作区文件 / 新建终端 / 浏览器），要求在那里也加一张。查证结果为真：那是宿主专门开放的接缝，插件此前没有登记。

## 决定

1. **入口登记到右栏 guide 页，而不是再造一处浮动入口。** 宿主契约是 `sidebar.right.tab.guide.entry`（keyed / session）＋ `SidebarRightTabRegistry.register` 的 `guide` 元数据；开始页（`tab.guide.title = '开始'`）遍历所有登记了 guide 的类型渲染卡片，没有自定义渲染器时用宿主的默认卡片，点击即 `tab.actions.openTab(kind, { replaceTab: true })`。改动落在 [`src/client/sidebar-tabs.ts`](../../../../src/client/sidebar-tabs.ts) 的 `TAB_TARGETS`：每个 tab 目标补一个 `guide`（入口 id、`order` 40/50、标题、一行描述），注册时一并交给宿主。
2. **只登记元数据，不自带卡片组件。** 宿主的默认卡片就带图标、标题、描述与快捷键位，加自定义组件只是多一处要维护的渲染器；等真需要卡片内交互（例如直接列出最近几张图）再注册 `.guide.entry` 不迟。
3. **不预置 `openTabIn` 这类内部路径。** `ctx.sidebarRight.openTab` 经过 `require()`，在没有「屏上会话」时抛错（`SidebarRightController.require`）。这次实测证明首页并不落进那条分支：开始页卡片点击后右栏正常出现我们的 tab，因此无需踩不在 `ISidebarRight` 上的内部 API。
4. **不动 `docs/architecture.md` 与 `docs/gui-verification.md`。** 两份文档已被声明为历史材料、新开发不再记录。其中「浏览器半边」一节仍把浮动抽屉、全屏浮层与共用 dock 写成现状，与删除后的代码不符，但按归属规则要改就得先解冻，本次不碰；事实以本记录、Issue #1 与两个 spec 的断言为准。
5. **只出右栏这一种形态，浮动兜底整套删除。** 用户要求取消降级。删掉的是：`surfaces.ts` / `surfaces.module.css`（三个面共用的浮动 dock）与它的测试、`library-panel.tsx`（左侧抽屉挂载点）、`canvas-panel.tsx`（全屏浮层挂载点）以及两个 launcher 锚点。仍被使用的激活事件（`announceActivation` / `onActivation` / `ACTIVE_EVENT`）从 `settings-panel.tsx` 抽到新的 [`activation.ts`](../../../../src/client/activation.ts)；设置页的浮动降级**保留**——它兜的是「宿主没有设置槽位」，与右栏无关，改为自带左下角容器（原先借用刚被删掉的 dock）。`header-launchers` 里那套「按钮在不在屏幕上」的 presence 机制一并删除：浮动按钮已经不存在，没有东西需要它让位；`press` 只对右栏的开关说话，右栏不可用时按钮**什么都不做**，不再退回浮层。
6. **两层降级一起取消。** [`src/client/sidebar-tabs.ts`](../../../../src/client/sidebar-tabs.ts) 之外，`registerSidebarTabsWhenReady` 仍保留最多 10 秒的等待与重试——那是「右栏比本插件晚挂载」的正常时序，不是降级；等不到时结果是没有入口，而非退回浮动按钮。

## 备选方案

- **等 DSH 开放右栏根作用域内容位**：前提判断是错的——右栏并非无内容，而是开始页已为第三方留了座位（`sidebar.right.tab.guide.entry`）。按错误前提推进会白等一次上游改动。
- **首页自己画一条工具条**：多一处入口、多一套要维护的定位与显隐，且仍然解决不了「没有会话就没有标题栏」这个根因；用户此前也只是要求入口别再钉在右下角。
- **把首页入口接到 `ctx.layout.openRightbar` + `openTabIn(sessionId, kind)`**：能绕过 `require()`，但 `openTabIn` 不在对外接口上，踩内部实现要额外承担失效风险；实测证明公开路径在首页可用，因此不引入。
- **注册自定义开始页卡片（`.guide.entry`）**：能拿到 `sessionId` 与 `tab.actions`，未来若要「卡片内直接选图/选板」才是必需；现在只是把宿主默认卡片重画一遍，收益为零。
- **开始页卡片只保留一张（画布）**：素材库在首页本来就有抽屉可用。驳回：用户要的是两个面都能从侧栏进，且素材库抽屉与画布 tab 现在能并排存在于右栏。
- **一开始保留浮动按钮、只把开始页当作第二条路**：这是本记录写第一版时的实际做法，被用户否掉（「已经右侧栏开始卡片，可以点击画布了，为什么还是存在右下角浮动按钮」）。首页一屏两个入口指向同样两个面，多出来的那个就是噪音。
- **直接删掉浮动入口**：本插件将来也可能跑到只有右栏服务不可用的宿主上，那里删了就真的没有入口了。曾按这个理由改成条件隐藏，随后用户要求把降级整套取消，于是连条件隐藏一起删除——宿主不给右栏时插件没有入口，也不再摆出另一种形态。
- **只删入口、留下抽屉与浮层的代码**：它们会成为没有任何调用点的死代码（浮层还占着「开/关/Esc」整套交互没人用）。需要时按新需求重做，比维护一份没人跑的实现更省。

## 后果

- 首页与无会话屏幕上，右栏开始页出现两张 SeeWork 卡片；点任一张都会把该面当作页面开在右栏，与勾选会话标题栏入口的行为一致。用户不必再先找右下角的浮动按钮。
- 开始页卡片总数从 3 张增加到 5 张，超过宿主 `MAX_DESCRIBED_ENTRIES = 4` 后**所有卡片的描述行都会被隐藏**（宿主的既定规则，插件无法选择保留）。这是加两张卡片必须付的代价，验收时按「标题仍在」判定。
- **浮动按钮只在右栏不可用时保留**：右栏服务在位且两个 tab 类型登记成功（`onAvailable()`）时，首页不再出现右下角按钮，dock 元素也一并移除；`registerSidebarTabsWhenReady` 最多等 10 秒仍未等到侧栏服务时，插件退回浮动入口，那种宿主上首页仍然进得去。
- **只有右栏一种形态**：素材库与画布都只是右栏里的页面。浮动 dock、左侧抽屉、全屏浮层都不存在，`requestSurface` 也随之删除；宿主不提供右栏时插件没有入口，这是用户明确选择的取舍。设置页的浮动入口仍保留，它兜的是宿主没有设置槽位。
- `lib/` 是这次变更的交付形态，已随构建更新；E2E 跑的就是它。

## 验证

- `npx playwright test`：新增 [`e2e/guide-entries.spec.ts`](../../../../e2e/guide-entries.spec.ts) 三条 + 原有的 [`e2e/plugin-alive.spec.ts`](../../../../e2e/plugin-alive.spec.ts) 三条，最终一次整跑 `6 passed`（15.9s，无 retries）。新增三条分别断言：首页打开右栏后开始页出现 `seework-library` 与 `seework-canvas` 两张卡片；点「画布」卡片后右栏出现 `[data-dsh-seework-canvas-tab]` 且**不**出现插件的全屏浮层；两张卡片各自开得出自己的 tab（每次经 tab 条的「新标签页」回到开始页）。`plugin-alive` 第一条改成新契约：首页 `[data-dsh-seework-dock]` 计数为 0、两个浮动按钮 `toBeHidden()`，入口改由右栏开始页卡片断言。
- 浮动按钮这条曾经红过一次，红的是断言而不是行为：第一次跑时按钮已 `display: none`，但**空的 dock 容器还在**（`getComputedStyle(dock).display === 'flex'`、没有可见子元素），所以「dock 计数为 0」不成立。据此补上「dock 没有可见按钮就移除」，并把断言写成「dock 为 0 + 按钮隐藏」两面都钉住。
- 接缝查证：宿主开始页是 `ui-sidebar-right` 的 guide tab（`locales.ts` 的 `tab.guide.title`），卡片由 `tabs/guide/GuideBody.tsx` 渲染，登记面在 `tab-registry.ts` 的 `SidebarRightTabDefinition.guide`；实测的 ARIA 快照显示目录级断言成立。
- `pnpm typecheck`：通过。
- `pnpm test`：36 个文件 508 通过、1 跳过（删掉 `surfaces.test.ts` 与两处依赖旧降级接口的用例；`header-launchers.test.tsx` 增加一条「没有 controls 时点击什么都不做」）。`src/client/sidebar-tabs.test.ts` 里钉住两张卡片、顺序 40/50、标题与描述为函数的断言不变。
- 构建：`e2e/host.mjs` 检测到 `src/` 比 `lib/` 新并自动 `node --run build`，随后把产物复制进临时 profile；两次整跑都没有出现客户端半边加载失败。
