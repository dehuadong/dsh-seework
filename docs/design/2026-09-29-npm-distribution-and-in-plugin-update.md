# npm 分发与插件内更新

- 状态：草稿
- 日期：2026-09-29
- 发布目标：公开 npm（包名 dsh-seework）· License：MIT（2026-09-29 确认）
- 实现状态：已实现、已发布（`dsh-seework@0.1.4` 在 npm 上，MIT），desktop profile 为 registry 安装（`^0.1.0`）。

把插件发布到 npm registry，并让插件自己能发现新版本、一键更新。本文件是这个交付的技术方案与取舍；发布目标（公开 / 私有）与 license 见「未决事项」。

## 目标

1. 插件能从 npm registry 安装，之后能更新。
2. 插件自己能识别 registry 上有更新的版本，并在设置卡片里给出提示。
3. 设置卡片提供一个更新按钮，点了就装最新版；同时保留在「设置 → 插件」里重新安装这条路。

## 已核实的事实

以下是实测或读宿主代码确认的，不是推断。

| 事实 | 证据 |
| --- | --- |
| DSH 平台没有 update 动作 | `plugin_manager` 只有 `installBundle` / `removeBundle` / `setBundleEnabled` / `setPluginEnabled` / `listBundles` / `inspect`；GUI 三个插件页全文无「更新 / 升级 / 最新」字样 |
| `dsh-seework` 包名在 npm 上可用 | `GET registry.npmjs.org/dsh-seework` → 404 |
| DSH 插件走 npm 分发是既定方式 | `dsh-plugin-whale-pet`（官方文档里的示例名）在 registry 上存在，`dist-tags: {beta: 0.2.8-beta.1, latest: 0.2.8}` |
| registry 方式重装能当更新用 | 管理器比较 profile 依赖的前后差异：`^0.1.0` → `^0.2.0` 有差异即可定位目标；spec 不变时退而按 `spec.startsWith('包名@')` 匹配 |
| 路径 / git / tarball spec 重装会被拒 | 实测报 `ambiguous-install`（pnpm 那边只说 `Already up to date`） |
| 插件能拿到宿主的管理服务 | Inspect：`pluginManager` 是 optional 服务，`ctx.get("pluginManager")`；`installBundle(spec, options)` 签名可用 |
| desktop profile 是实时应用 | 两次安装都返回 `application: "applied"`，插件随即 `describe` 200 |
| 当前 npm 凭证无效 | `pnpm whoami` → 401；`~/.npmrc` 里那条 `_authToken` 已失效 |
| pnpm 默认拒绝安装发布不满 24 小时的版本 | 实测报 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`，原文给出 cutoff 与发布时间，两者相差正好 1440 分钟；`pnpm config get minimumReleaseAge` 返回 `undefined`，即未见显式配置 |
| pnpm 把已接受的版本记进 profile 的 `minimumReleaseAgeExclude` | 每次安装后 pnpm 自己往 `pnpm-workspace.yaml` 追加 `包名@版本`，并打印 `Added 1 entry to minimumReleaseAgeExclude`；这个文件正是放行后再次安装同一版本而不报错的依据 |
| `pluginManager.inspect` 不能用来查最新版 | 它对**已安装**的包直接拒绝（`already-installed`），且从不返回版本号；早期版本据此实现，卡片因此长期显示 `dsh-seework is already installed` 而不是新版本 |

## 方案

### 1. 发布准备（package.json）

- 去掉 `"private": true`（否则 `pnpm publish` 直接拒绝）。
- 补 `"repository"`，让 npm 页面能指回源码。
- 加 `"prepublishOnly": "pnpm build"`：发布的是构建产物，不能靠人记得先 build。
- `"files"` 只留运行时真正需要的：`lib`（两个 bundle）、`assets`（技能正文，运行时从 `../assets/` 读）、`cordis.patch.yml`（profile 行插入）、`LICENSE`、`README.md`。`src` 与 `docs/` 不进包——它们在仓库里，但不是插件运行所需，内部设计文档更不该随公开包发出去。
- `"peerDependencies"` 保持 `@deepseek-ai/cosmokit` 与 `@deepseek-ai/schemastery`：它们由宿主提供，发布后 pnpm 只会在安装时给一条警告，不会去装。
- 首次发布 `version: 0.1.0`。

### 2. 版本检查

宿主查询 `pluginManager.registries()` 拿到 registry 地址，插件直接 `GET <registry>/<包名>/latest`，取其中的 `version`。

- registry 取 `resolved`，其次 `registry`，都没有才落到 `registry.npmjs.org`——顺序与 pnpm 自己解析的一致，私有源和镜像因此自动生效。
- 当前版本从插件自己的 `package.json` 读（`lib/index.js` 上一层的那个），不写死在代码里。
- `latest` 端点是「最新发布版是什么」这一个问题的答案，也是 `npm view <名> version` 读的那个，不必拉整个 packument。
- **semver 比较自己实现**：插件不能为这个加依赖——任何 `@deepseek-ai/*` 之外的新依赖都会进 profile 的 `node_modules`，而 profile 里多一个包就有盖住宿主内置副本的风险（见 [Agent Note](../../.agents/notes/implemented/canvas/2026-09-29-dsh-0-2-settings-model.md)）。比较规则覆盖 `major.minor.patch` 与 prerelease（prerelease 低于同号正式版）。
- 检查失败**不抛给卡片**：registry 不可达、响应不是 JSON、文档里没有 `version`，都变成 `status.error` 的一句说明，卡片照常显示当前版本。把「查不到」渲染成「已是最新」是这里最容易犯的错。
- **时机**：启动后约 4 秒查一次（见「界面」的浮条），设置卡片打开时再查一次，另有手动「检查更新」。不做后台轮询。

原先用 `pluginManager.inspect`，现在不用了。理由是它答的不是这个问题：它回答「这个 spec 在安装**之前**指向什么」，对已经装上的包直接以 `already-installed` 拒绝，也从不返回版本号——所以卡片永远拿不到「最新版是多少」。私有源、代理、认证这一层由 `registries()` 交出地址来继承，不必自己实现。

### 3. 更新动作

客户端 `POST /api/dsh-seework/update/apply`。宿主半边按三步走：先解析目标版本，再为它开一次供应链门槛，最后才发起安装。

**第一步：解析到确切版本。** 用与「版本检查」同一条路径拿到 `latest`。装的时候用 `包名@<确切版本>` 而不是 `包名@latest`：`@latest` 的解析会经过下面那道门槛，pnpm 可能把它解析到一个**更老**的版本上去，于是「更新成功」但版本没变。

**第二步：把目标版本写进 profile 的 `minimumReleaseAgeExclude`。** pnpm 默认拒绝安装发布不满 24 小时的版本，而一次更新必然指向刚发布的版本——不开口子，更新在发布当天永远装不上（这正是「点了没反应」的成因）。做法是往 profile 的 `pnpm-workspace.yaml` 追加一行 `dsh-seework@<版本>`：

- 位置和写法与 pnpm 自己写的完全一致（它每接受一个版本就追加一条），所以这里不是新机制，是复用同一个口子。
- **范围最小**：一个包、一个版本，且是用户此刻主动点的那一个。不给整个 profile 关掉策略，也不会放行下一个版本——下个版本要再点一次。
- 幂等：已有该条目就不写文件；比对的是完整 bullet，避免 `dsh-seework@0.1` 被当成 `dsh-seework@0.1.0`。
- 写不成（没有 workspace 文件、不可写）不阻断流程：照旧用 `@latest` 发起安装，让 pnpm 报出它自己的拒绝。

**第三步：发起安装。** `installBundle('<包名>@<版本>')`。spec 带 `@` 而不是裸包名：管理器的兜底匹配是 `spec.startsWith('包名@')`，裸包名在依赖声明恰好没变时会撞上 `ambiguous-install`。

**时序是这个方案唯一的真问题**：`installBundle` 应用阶段会重新组合 profile，插件的 fiber 随之销毁、路由被 teardown。如果 handler 同步 `await` 它再写响应，响应就可能发不出去。

因此：

1. handler **先**写响应 `{ ok: true, started: true, to }`；
2. 再用 `setTimeout(…, 0)` 异步发起 `installBundle`，不等它的结果。

客户端收到 `started` 就进入「更新中」状态，然后轮询 `POST /api/dsh-seework/update/status`：请求失败或版本变了，都说明重载正在进行；轮询到新版本即报告成功。这条路径不依赖「重载后旧代码还能不能把响应写完」，因此不需要为此做实验。

### 4. 界面

**启动浮条。** 设置卡片是用户要主动走进去的页面，只靠它，更新在用户不打开设置时就等于不存在。所以插件在 `shell.overlay`（root 级、加新 id 即并列的浮层）上放一条小提示：

- 启动后约 4 秒查一次；有新版才出现，没有就什么都不渲染——不会先闪一条可能不成立的提示。
- 内容是新版本号与当前版本，动作只有「更新」和「关闭」。
- **只报告**：不点按钮就不会安装任何东西，也不做后台轮询。第一版曾打算做「自动更新」，被否（见「备选方案」）。
- 浮层本身是点击穿透的，条目要自己 `pointer-events: auto` 才能被点到。
- 位置在右下角、插件的悬浮按钮 dock **上方**：左下角是 shell 自己的（侧栏控件），右下角 `right:16 bottom:16` 已经被本插件的 dock 占了，压在它上面会挡路。

**设置卡片的「版本」块：**

- 当前版本，以及 registry 上的最新版本（查不到就只显示当前版本，并说明原因）；
- 「检查更新」按钮；
- 有新版时出现「更新到 x.y.z」；点击后变「正在更新…」，完成后提示**重启 DeepSeek Harness**。

**装完必须重启客户端**，没有刷新页面的入口。宿主侧是 `application: applied`，插件立刻重载；但渲染进程里跑的还是它启动时那份客户端 bundle（URL 带 `rev=`，只有页面重新加载才会重新拉）。桌面客户端的菜单里**没有**「重新加载页面」——`main.js` 的 `setApplicationMenu` 模板把那两项写在 `...development ? [...] : []` 里，正式构建拿到的是空数组，`Ctrl+R` 也没有绑定。所以提示必须写「重启 DeepSeek Harness」。

### 5. 开发安装与 registry 安装要分开

插件要能看出自己是怎么装的——读 profile 的 `package.json`，看自己的 spec 是 `file:` 还是版本范围：

| 装法 | 卡片显示 |
| --- | --- |
| `file:` | 「开发安装」+ 不显示更新按钮，说明用 `pnpm build && pnpm sync` |
| 版本范围 | 正常显示检查 / 更新 |

这不是锦上添花：registry 安装后，`pnpm sync` 手动覆盖的 `node_modules` 文件会在下一次 pnpm 操作时被还原，两条流程混用会得到「改了没生效」或「生效了又被还原」这种难解释的现象。开发用 `file:`、发布用 registry，各自的路走各自的。

从 `file:` 切到 registry 是平滑的：依赖声明从 `file:E:/...` 变成 `^0.2.0`，管理器看到差异即可定位目标，不需要先卸载。

## 备选方案

- **用 `pluginManager.inspect` 查最新版**：一度是主路径，已否决。它答的不是这个问题——见「版本检查」末段。
- **自己 fetch `registry.npmjs.org/<name>/latest`**：现在的主路径，但把 registry 地址换成宿主 `registries()` 给的，而不是写死公开源。写死会漏掉私有源与镜像。
- **把 profile 的 `minimumReleaseAge` 设为 0**：一行就能让所有安装都不再受 24 小时门槛限制，也让更新立刻可用。否决——它保护的是这个 profile 里的**每一个**包，为了一个插件的更新把整层保护关掉不划算。只豁免用户当前点的那个版本能达到同样效果，代价小得多。
- **等新版本「够老」再更新**：零改动、零风险，但发布当天到第二天的窗口里更新按钮等于坏的。作为兜底保留在文档里，不作为方案。
- **只提示、不做按钮**：最安全（插件不碰 profile 写入），但用户还是要自己去插件页重装，体验与目标不符。用户明确要按钮。
- **让插件在启动时自动更新**：不可接受。插件无权在用户没同意时改动 profile 的依赖。启动时**检查**并提示是允许的，且已实现——它不写任何东西。
- **用 Remote 通道让客户端直接调 `pluginManager.installBundle`**：能省掉一条插件路由，但等于把「装任意包」的能力交给页面，且绕开了插件自己已有的 loopback-only 路由约束。否决。
- **依赖宿主提供更新 UI**：平台没有这个能力，且不打算为单个插件加。

## 迁移影响

- 首次发布后，当前这份 `file:` 安装可以用卡片上的按钮一键切到 registry（依赖声明有差异，无需先卸载）。
- **已经装上的旧版本不会自己获得豁免能力**：签发豁免的代码在那个版本里还不存在，所以从没有该能力的版本升到第一个带它的版本，得先把目标版本手工写进 `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude`（或等 24 小时）。它之后自食其力。desktop profile 已在 2026-09-29 手工写入 `dsh-seework@0.1.4` 完成这一步。
- 切到 registry 之后，本机开发流程要改：改代码走 `file:` 安装（比如另建一个 profile），或者继续用 registry 但每次发新版本。这一条要写进 README，否则「改了代码不生效」迟早会发生。
- README 的「更新」一节要补上按钮这条路，并保留「registry 重装 / 其余方式先卸载再装」的说明。

## 验证

**静态与单测**：`pnpm typecheck`、`pnpm test`（516 通过 / 1 跳过）、`pnpm build`、`node scripts/smoke.mjs` 全绿。版本比较、检查的各条降级路径（registry 不可达、响应非 JSON、文档无版本号、本地安装短路、宿主无管理服务）、`exemptVersion` 的写入与幂等、浮条的四条分支（检查中不渲染、有新版才渲染、失败不渲染、只在点击时安装）都有用例。

**路由行为**（在一个全新实例上实测）：`POST /update/status` → 200；`POST /update/apply` 对本地安装 → 409 `local_install`；`GET /update/status` → 插件自己的 405。三者合起来证明路由已挂载、安装方式识别正确、旧路由未受影响。

**更新链路端到端**（2026-09-29，这是本节的重点）：造一个假装是 registry 安装的临时 profile（声明 `^0.1.2`、装着 0.1.2、`pnpm-workspace.yaml` 里**没有**豁免块），在宿主**运行中**依次实测：

| 步骤 | 实测结果 |
| --- | --- |
| `POST /update/status` | `{current:"0.1.2", kind:"registry", updateAvailable:true, latest:"0.1.3"}` |
| `POST /update/apply` | `{started:true, to:"0.1.3"}` |
| profile 的 `pnpm-workspace.yaml` | 追加了 `minimumReleaseAgeExclude: - dsh-seework@0.1.3` |
| 约 35 秒后 `node_modules/dsh-seework` 的版本 | **0.1.3**，依赖声明变 `^0.1.3` |
| 复查 `/update/status` | `{current:"0.1.3", updateAvailable:false}` |

结论：24 小时门槛确实是此前「点更新没反应」的成因，豁免那一个版本之后更新在发布当天即可装上。

**门槛确实会挡人**（反证）：同一个临时 profile 在豁免**之前**，pnpm 的原文是 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`，给出 `0.1.3 was published at … within the minimumReleaseAge cutoff (…, 24h earlier)`。

**豁免确实放行**：把 desktop profile 当前的 `pnpm-workspace.yaml` 复制到一个一次性目录，在里面 `pnpm add dsh-seework@0.1.4` → 成功，装上 0.1.4。

**发布与 CDN 滞后**：`pnpm publish` 成功；元数据、`dist-tags`、时间戳先就位，tarball 与 `/latest` 落后几分钟（0.1.0 约 4 分钟，0.1.3 约 2 分钟，0.1.4 约 2 分钟）。滞后期间 `install_bundle` 会以 `ERR_PNPM_FETCH_404` 失败——**这是 CDN 同步滞后，不是发布失败**，重试即可。

**两个容易误判的现象**：

- `set_plugin_enabled` 触发的重载**不会**重新加载插件模块（Node 的 ESM 模块缓存），改了宿主半边代码后必须重启 DSH 才看得到，`pnpm sync` 本身不够。
- 日志里出现的 `EPERM … rename '.pnpm-lock.yaml.<随机>.tmp' -> 'pnpm-lock.yaml'` 是**并发跑 pnpm** 造成的（例如一边让插件安装、一边在同一个 profile 目录手动执行 pnpm），不是更新路径的缺陷：同一个 profile、宿主同样在运行，只让插件跑一次安装时日志干净、安装成功。

## 未决事项

1. **版本号策略**：0.1.0 起公开发布、0.1.x 逐版修，已按这条走到 0.1.4。什么时候进 0.2.0 未定。
2. **发布凭证的形式**：现在靠一个带 bypass 2FA 的 granular token 发布，而 npm 已公告 2027 年 1 月起移除该能力（页面原文：*Bypass-2fa token with direct-publish access are being deprecated*）。届时要么改走 `npm stage publish` + 人工 promote，要么回到每次带 OTP 发布。
3. **每个新版本都要用户再点一次**：豁免是按版本签发的，所以 0.1.5 发布当天仍需用户点一次更新。让插件对新版本自动续期等于把上面那条策略整个架空，不打算做。
