---
title: 用 Playwright 跑真实 GUI 的端到端
status: implemented
created: 2026-09-30
updated: 2026-09-30
approval: 用户调用 playwright-e2e 技能，并选定范围「先搭骨架 + 一条『插件在真实 GUI 里活着』的冒烟」
verification: npx playwright test 连跑三次全绿（3 passed，15.2s / 15.4s / 15.5s，无 retries）；修掉路由注册竞态后，两次整跑（3 passed，15.2s / 15.3s）加一次 --repeat-each=8（24 passed，30.8s）全绿；pnpm typecheck 通过（现已含 e2e 与 playwright.config.ts）；pnpm test 37 个文件 515 通过 1 跳过；临时实例启动图内含 id 为 dsh-seework 的客户端半边（node scripts/probe-host-bundle.mjs）；「src/ 比 lib/ 新则重建」分支实测触发，且不重建时跑完 lib/ 保持干净
---

# Agent Note：用 Playwright 跑真实 GUI 的端到端

## 问题

插件的浏览器半边只在真实 GUI 里才存在，而它最要命的失败是**没有报错**的：客户端 bundle 加载失败、或加载了但什么都没渲染，用户看到的是「按钮一直不出现」，宿主日志里干干净净。jsdom 单元测试覆盖组件逻辑，覆盖不到这一层。[`docs/gui-verification.md`](../../../../docs/gui-verification.md)（历史核对文档，仅供参考）把该核什么写得很细，但只写「怎么核」——每轮核对都是人手开实例、写临时 CDP 脚本、看截图，既不可回归，也不便宜。

仓库里没有任何浏览器可达的自动化入口：`pnpm test` 是 vitest + jsdom，`scripts/smoke.mjs` 打的是桩网关（不经过 GUI），`pnpm probe` 只查 bundle 本身送没送达。

## 决定

引入 `@playwright/test`，宿主由 Playwright 自己起（`playwright.config.ts` 的 `webServer` → [`e2e/host.mjs`](../../../../e2e/host.mjs)），spec 落在 `e2e/`。

1. **用 `@playwright/test`，不用 `playwright` 库 + vitest**。DSH 本体走的是后一条（`apps/web/tests/*.e2e.ts` 用 vitest 收、自己 `chromium.launch()`），但那条路要自己管服务生命周期、自己换会话 cookie。这里要的是「一条命令起宿主、跑完、留产物」，`webServer` + trace + 失败截图现成。
2. **目录用 `e2e/` 而不是 `tests/`**：`.gitignore` 忽略 `tests/`，spec 放进去会不入库。
3. **宿主是临时实例 + 临时 `DSH_HOME`**（`.tmp-e2e/home`，gitignored）。profile 不手写：先跑 `dsh --profile web --dump-config` 让 DSH 按内置模板自己初始化，再往 `dsh.profile.bundles` 里加本插件。手抄 web 模板的 bundle 列表会随 DSH 升级悄悄失效。
4. **每次运行把构建产物复制进 profile，不用目录链接**。这条是查证后改的：宿主半边运行时 import 的 `@deepseek-ai/dsh-settings`、`@deepseek-ai/dsh-tools` 在本仓库是 **devDependency 而非 peer**，而宿主的模块拦截只在「导入方把该包声明为 peer」时优先用安装自带的副本——链接会把工作区里 0.1.5-rc.1 的副本带进去，而宿主跑的是 0.2.0-rc.2，测出来的是一套用户拿不到的组合。复制不带 `node_modules`，与 `file:` 安装一致。复制是每次重建的，因此不会重演 [`scripts/sync-to-profile.mjs`](../../../../scripts/sync-to-profile.mjs) 记的「旧副本静默生效」。
5. **token 只能从宿主 stdout 上拿**：它是每进程随机生成、没有任何文件/环境变量/接口能取。`host.mjs` 解析 `dsh web: http://127.0.0.1:<port>/?token=…` 并写 `.tmp-e2e/runtime.json`（宿主 stdout 是唯一能跨到 worker 进程的通道，Playwright 的 `webServer.ws`/`wait` 都不必要）。浏览器必须走 `127.0.0.1`：会话 cookie 绑 authority，`localhost` 会 401。
6. **就绪判据用 `webServer.url` 指根路径**。信任墙对未认证请求回 401，而 Playwright 的 `isURLAvailable` 判的是 `status >= 200 && status < 404`，401 算就绪。
7. **首启弹窗在 fixture 里按壳自己的按钮关掉**（「预览版说明」→ 继续；「添加一个 API Key 开始使用」→ 稍后配置），且在预算内等它出现。它们的遮罩盖住整个窗口，人不点掉，后面每一次点击都会被吞；而那个 API Key 弹窗是在自己的异步查询之后才渲染的，壳一挂载就去查会查了个空。
8. **`e2e/` 与 `playwright.config.ts` 纳入 `pnpm typecheck`**（`tsconfig.json` 的 include）。Playwright 自己只转译不查类型，不纳入的话这一层的类型错误永远没人管。
9. **触碰插件状态的那条断言用重试式断言（`expect.poll`），不用 `sleep`**。插件把路由注册放在延后的 `settings` 注入里（[`src/index.ts`](../../../../src/index.ts) 里「Route registration belongs INSIDE the settings injection」那段），所以「宿主已经开始服务页面」不等于「插件路由已经就绪」：spec 在页面刚渲染就发请求，会偶发撞上还没注册的窗口，实测红过一次。GUI 自己不会撞上这个窗口（它的 bundle 在 boot 收敛之后才加载），所以这是 spec 的时序问题，不是产品缺陷；即便如此也不加固定等待。

第一个 spec（[`e2e/plugin-alive.spec.ts`](../../../../e2e/plugin-alive.spec.ts)）三条：首页上 dock 与两个浮动入口在位、且没有 `Failed to load plugins`；宿主半边路由应答；设置里出现 SeeWork 且卡片渲染出真实数据。全部零成本，不消耗生图额度。

## 备选方案

- **继续用 CDP 脚本核对**：能核，但每轮重写、不可回归、结果只活在当次会话里。这次要的正是把它变成一条几秒可重跑的命令。
- **`playwright` 库 + vitest**（DSH 本体的做法）：复用本仓库既有的 vitest 配置，但要自己起服务、自己做 token 交换、还要过一遍 vitest 的模块加载；`webServer` 与 trace 都得自己补。
- **拿用户真实的 `~/.dsh` 或 `desktop` profile 当靶子**：`desktop` 由 Electron 独占（`dsh plugin --profile desktop` 被拒），而且会动用户真实的素材库与画布。
- **`dsh plugin --profile <name> add file:…` 装进临时 profile**：是官方路径，但要跑 pnpm、要网络，装的是副本，改了 `lib/` 还得再同步一次。
- **在 profile 的 `node_modules` 里放目录链接（junction）**：省一次复制，但会把工作区的 `node_modules` 一起带进去（见决定 4）。已按此实现过一版并跑通，查证出 devDependency 覆盖的隐患后改回复制。
- **把开发者的 `.credentials.yaml` 拷进临时 home，从根上避免 API Key 弹窗**：套件会因此依赖本机凭据，干净机器/CI 上不成立；改为按壳自己的入口关掉弹窗。
- **每次运行都无条件 `pnpm build`**：最直观，但这个构建不是逐字节可复现的（客户端 bundle 里 CSS module 的键顺序每次都不同），无条件重建等于每次跑完都弄脏 `lib/client.js`。改成「`src/` 比 `lib/` 新才重建」。

## 后果

- 固定端口 3311，`DSH_E2E_PORT` 可覆盖；占用时 Playwright 直接报端口被占（`reuseExistingServer: false`），不会静默连上别人的实例。
- 临时实例与用户真实 `~/.dsh`、`desktop` profile、真实素材库/画布完全隔离；实例随 Playwright 结束退出，手工回收按端口定位。
- 桌面客户端路径是 `host.mjs` 里的默认值，换机器或换安装位置用 `DSH_E2E_APP` 覆盖。
- 跑的是 `lib/` 这份构建产物而不是源码：`src/` 比 `lib/` 新时自动重建（`DSH_E2E_SKIP_BUILD=1` 可关）。
- spec 里不许写真发起的生图，这条写进了 [`AGENTS.md`](../../../../AGENTS.md) 的 E2E 规则。
- 本仓库仍**没有 CI**，所以 E2E 不会自动跑；接 CI 需要另开范围。
- 顺带发现（未修，超出本次范围）：`scripts/probe-host-bundle.mjs` 在当前 DSH 上会崩——启动图里的 bundle 地址是相对地址 `plugins/??dsh-seework/client.js&rev=…`（没有前导 `/`），脚本按 `base + url` 拼成了 `http://127.0.0.1:3311plugins/…`，`fetch` 抛 `Invalid URL`。启动图那一行本身正常。

## 验证

- `npx playwright test`：连跑三次都是 `3 passed`（15.2s / 15.4s / 15.5s），无 retries。
- 失败态见过两次，都不是「选择器还没定」：首启弹窗未处理时第 3 条红（报错是遮罩拦截点击，不是断言失败）；修好后出现过**一次未复现的偶发**——第 2 条路由断言红，随后 5 次整跑 + 一次 `--repeat-each=5` 都不再复现，产物已被下一次运行清掉。据此按查到的注册时序加了重试式断言（见决定 9），之后两次整跑（15.2s / 15.3s）加 `--repeat-each=8`（24 passed，30.8s）全绿。
- `pnpm typecheck`：通过（包含 `e2e/`、`playwright.config.ts`）。
- `pnpm test`：37 个文件 515 通过、1 跳过（vitest 只收 `src/**/*.test.ts(x)`，与 e2e 互不干扰）。
- 临时实例的启动图里含 `"id":"dsh-seework"` 的客户端半边：`node scripts/probe-host-bundle.mjs`（该脚本随后在拼地址那步崩，见「后果」）。
- 「过期才重建」分支：把 `lib/client.js` 的 mtime 改成前一天后起宿主，输出 `构建插件（node --run build）：src/ 比 lib/ 新`；不重建的那次跑完 `git status -- lib/` 为空。
