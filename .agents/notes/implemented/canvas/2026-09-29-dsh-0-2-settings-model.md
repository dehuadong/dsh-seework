---
title: 适配 DSH 0.2 的 Config 表单模型
status: implemented
created: 2026-09-29
updated: 2026-09-29
approval: 用户要求把本插件适配并安装进 desktop profile
verification: pnpm typecheck 通过；pnpm test 472 通过（1 跳过）；pnpm build 产出 lib/index.js 与 lib/client.js；装进 desktop profile 后实测 cordis_inspect host Config（entry dsh-seework，status schema）、client Slots（settings.section 占用者含 dsh-seework）、host Tool（generate_image 在列）、POST /api/dsh-seework/settings/describe 与 settings/mutate（set→revision 1，unset→revision 2），以及写入前后 profile 的 cordis.patch.yml 哈希一致
---

# Agent Note：适配 DSH 0.2 的 Config 表单模型

## 问题

桌面客户端内置的 DSH 是 0.2.0-rc.1，本插件此前针对 0.1.5-rc.1 开发。0.2 换掉了设置模型：`SettingsProvider` 不再有 `installSection` / `register`，表单改为**从 profile 条目的 Config schema 投影**，并且只收 `.volatile()` 标记下的字段；表单以 **profile 条目 id** 标识插件（`describe()` 返回 `ns: entry.options.id`）。

后果是设置卡片整块失效：`installSettingsSection` 调的 `installSection` 不存在（抛 `TypeError`，被 cordis 吞掉，插件仍显示为激活），而设置桥按 `descriptor.ns === 'dsh-seework'` 过滤，条目 id 却是 patch 里写的 `seework`，于是 `namespaces` 恒为空，卡片显示「设置接口不可达」。用户填不进 API Key，生图主链路实际不可用。

另有两处次要不一致：上游 `schemastery` 没有 `.volatile()`（标记只在宿主 vendor 的 `@deepseek-ai/schemastery` 里）；`settings.plugin.item` 槽在 0.2 更名为 `settings.plugins.tab`。

还有一处只有装进真实 profile 才暴露的问题：插件的 `dependencies` 里带着 `@deepseek-ai/dsh-client-ui-sidebar-right@0.1.5-rc.1`（以及 `@deepseek-ai/schemastery`、`@deepseek-ai/cosmokit`）。pnpm 把它们装进 profile 的 `node_modules/@deepseek-ai/`，而宿主的模块解析优先命中 profile 而不是 `app.asar` 里的内置副本，内置的 `dsh-client-ui-sidebar-terminal` 于是拿到 0.1.5 的 sidebar-right、激活失败，桌面客户端以「应用无法启动或已意外停止 / web boot: 1 entry did not activate」拒绝启动。

这条曾经被误判：看到 `sidebar-terminal` 失败后做了「禁用本插件仍失败」的对照就归因于临时实例环境，但**禁用插件不会卸载它拖进来的依赖**，那个对照没有排除任何东西。真正的信号是 profile 的 `node_modules/@deepseek-ai/` 存在与否。

## 决定

保留插件自带的 SeeWork 设置页（它承载「检测可用模型并勾选」这类 schema 投影做不到的交互），把后端链路接到 0.2 的模型上：

1. **Config 顶层 `.volatile()`**（[`src/settings.ts`](../../../../src/settings.ts)），schema 由 `@deepseek-ai/schemastery` 构造。顶层标记让整张表进入表单，且 `isVolatilePath` 对任意路径返回 true，写操作不被逐字段拒绝。
2. **profile 条目 id 改为 `dsh-seework`**（[`cordis.patch.yml`](../../../../cordis.patch.yml)），与 `SEEWORK_SETTINGS_NAMESPACE` 对齐，设置桥的过滤与写入因此无需改代码。
3. **`installSettingsSection` 支持两代宿主**：有 `installSection` 走注册（0.1.x），没有则直接读宿主交来的活引用。0.2 把 volatile 值解析成一个就地更新的引用，每次读即最新值，因此不需要变更通知。
4. **`configure({ auto: false }, ctx.fiber)`**（[`src/index.ts`](../../../../src/index.ts)）：插件自带页面，host 不应再为同一条目生成自动表单。
5. **`@deepseek-ai/*` 一律不进 `dependencies`**（[`package.json`](../../../../package.json)）：运行时由宿主提供的 `@deepseek-ai/schemastery` 与 `@deepseek-ai/cosmokit` 声明为 `peerDependencies`（`autoInstallPeers: false`，不会被装），只在类型与构建期用到的 `@deepseek-ai/dsh-client-ui-sidebar-right` 移入 `devDependencies`。`dsh plugin add` 只装 prod 依赖，profile 的 `node_modules` 因此只剩插件本体。

另导出 `ConfigShape`（不带 volatile 的同形 schema）给测试与工具；对它的 `as z<Config>` 断言是必要的，因为该 fork 的 `object()` 把每个字段的 mode 留在输出类型里未归约。

## 备选方案

- **放弃自带卡片，全部交给 0.2 的自动表单**：字段标 volatile 后 shell 会生成表单，用户能填地址与 Key，但 `models`（检测后勾选的模型列表）没有交互位置，只能手写 YAML。体验明显降级，故否决。
- **两个入口并存**（自动表单 + 自带卡片）：同一插件两处配置，且与卡片自身「一个设置页只出现一次」的既有取舍冲突。故用 `configure({auto:false})` 关掉自动表单。
- **只改设置桥的 ns 过滤、不动 schema**：`describe()` 会返回空表单，`mutate()` 直接以 "has no volatile fields" 拒绝，改不动。故必须加 volatile。
- **保留 `dependencies` 里的 `@deepseek-ai/*`、只把版本号提到 0.2.0**：能消掉这一次的覆盖，但只要 profile 里存在任何 `@deepseek-ai/*`，宿主内置副本就有被盖住的风险（版本恰好一致才侥幸无事），而这份依赖在运行时根本用不上（客户端半边对它是 type-only import）。故整类移出 prod 依赖。

## 后果

- profile 条目 id 从 `seework` 变为 `dsh-seework`。此前没有任何 profile 装过本插件，无覆盖项需要迁移；用户若在自己的 patch 里按 `id: seework` 覆盖，需改这个 id。
- 0.1.x 兼容保留但未回归：那条路径仍走 `installSection`，`.volatile()` 在旧宿主上无副作用。当前工程只对 0.2.0-rc.1 做过实测。
- **profile 的 `node_modules` 必须只有插件本体**。装任何 `@deepseek-ai/*` 到 profile 都会盖住宿主 `app.asar` 里的内置副本，症状是**内置插件激活失败、客户端拒绝启动**，而不是本插件报错——排查时极易误判成"与插件无关"。插件运行时用到的 `@deepseek-ai/schemastery` 与 `@deepseek-ai/cosmokit` 由宿主的模块解析提供，已实测：profile 里没有这两个包时设置桥照常工作。
- 反过来说，本插件对宿主的这两个包是**硬依赖**：宿主将来若不提供，插件会在 `apply` 时因找不到模块而失败。这也是把它们声明成 `peerDependencies` 而不是干脆不写的原因。
- `settings.plugin.item` 兜底路径在 0.2 下不再命中（槽已更名），但主路径 `settings.section` 存在，兜底不参与。

## 验证

- `pnpm typecheck`、`pnpm test`（472 通过 / 1 跳过）、`pnpm build` 全绿。
- 用宿主 `app.asar` 内的 dsh CLI 起临时 0.2.0-rc.1 实例（独立 `DSH_HOME` 与端口）：客户端半边进入启动图、bundle 200、未内联 react、外部依赖只有 react 系列；设置导航出现 SeeWork。
- 装进 desktop profile（`plugin_manager install_bundle`，`application: applied`）后在同一台机上实测：
  - `cordis_inspect host Config`：条目 `dsh-seework`，`status: schema`；
  - `cordis_inspect client Slots`：`settings.section` 占用者含 `{id: "dsh-seework", order: 40, active: true}`；
  - `cordis_inspect host Tool`：`generate_image` 在列；
  - `POST /api/dsh-seework/settings/describe`：200，`ns: dsh-seework`、`writable: true`、字段齐全、`secrets: apiKey`；
  - `POST /api/dsh-seework/settings/mutate`：`set announceToAgent=false` 后读回 false、revision 1；`unset` 后读回 true、revision 2；
  - 两次写入前后 `~/.dsh/profiles/desktop/cordis.patch.yml` 的 SHA256 一致（写入默认值未留痕）。
- 依赖布局修正后重装（`remove_bundle` → `install_bundle`）：pnpm 报 `Packages: +1`，profile 的 `node_modules` 只剩 `dsh-seework`（无 `@deepseek-ai/`，残留的 `@standard-schema/` 一并清掉），`.modules.yaml` 的 `hoistedLocations` 只有 `dsh-seework`；`cordis_inspect host Config` 里 `ui-sidebar-terminal` 与 `dsh-seework` 同为 `fiberPhase: active`；设置桥返回 200、`apiUrl` 取到默认值，画布路由同样 200。
- 未验证：真实 `dsh-desktop-host` 下的客户端渲染（桌面 UI 走 `dsh-app://` 自定义协议，外部浏览器访问 19387 需 token，无法用无头浏览器只读核对）；需要会话的右侧栏 tab 与工具图片卡片；真实生图。
