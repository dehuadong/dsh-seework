# dsh-seework GUI 核对

把插件装进**桌面客户端的 `desktop` profile** 后，逐面核对它在真实 GUI 里的行为。本文件只写**怎么核**（选择器、断言、成本、什么时候要备份还原）；每处行为**为什么**是那样实现的、以及它来自哪次用户反馈，见 [`architecture.md`](architecture.md)——那里是那些叙述的唯一位置，本文件不重复。

**核对在哪儿做**：逐面核对用的是**临时 `dsh web` 实例 + 无头 Chrome**（`desktop` profile 由 Electron 独占，见下节）。两边加载的是同一份 bundle，界面行为一致。

命令入口（typecheck / test / build / smoke / sync / probe / verify-live）见 [`../AGENTS.md`](../AGENTS.md)。

## 临时实例：起法与收法（踩过坑）

自己起实例做端到端核对时，**换端口 + 不要自动开浏览器 + 自己的 `DSH_HOME`**；收工按**端口**回收：

```powershell
# 起：独立端口、--no-open、独立的 DSH_HOME（不去碰用户真实 profile）
$env:ELECTRON_RUN_AS_NODE="1"
$env:DSH_HOME="<工作区>\.tmp-live\home"          # 先 dsh plugin --profile see add <本插件> 装进去
& "C:\Users\MyPC\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe" `
  "C:\Users\MyPC\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh\lib\bin.js" `
  see --port 3299 --no-open

# 收：按端口定位唯一占用者，只停它
Get-NetTCPConnection -LocalPort 3299 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

桌面客户端把 dsh 打包在 `resources/app.asar` 里，没有独立的 `dsh.cmd`，所以起实例要显式跑 asar 里那份 `bin.js`（上一条命令）。宿主日志重定向到文件后再读，别指望它在终端里刷。

三条硬性纪律：

1. **不许按进程名批量杀**。`Get-Process chrome | Stop-Process -Force` 会把用户正在用的 Google 浏览器一起关掉——真实发生过，用户的标签页会丢。同理不要批量杀 `node`。
2. **只杀外层启动器不等于收工**。拿到手的那个 PID 未必是监听端口的那个——启动器会拉起子进程，外层死了端口还在 LISTENING。要么按端口找 PID，要么确认子进程也被收回。
3. **无头浏览器要点名自己那个**。给它独立的 `--user-data-dir` 和 `--remote-debugging-port`，收工时按那个调试端口定位 PID；收工后逐个端口用 TCP 直连确认已 closed（不能只看 HTTP 有没有响应），并确认用户自己的端口（GUI 3080、服务端 8080/8081）仍在。

## 桌面客户端与临时实例的分工

插件的正式家是**桌面客户端的 `desktop` profile**。两件事必须分清，否则会白折腾：

- **`desktop` profile 由 Electron 独占**：`dsh plugin --profile desktop …` 被拒（`profile "desktop" is managed exclusively by the Electron application`）。装 / 卸 / 启停只能走 `plugin_manager` 工具或客户端的插件页。
- **CDP 脚本核对不在 `desktop` profile 上做**：无头 Chrome 要连的是一个能用 `--port` 起的实例，所以逐面核对仍走临时 `dsh web` 实例。两边跑同一份 bundle，行为一致；差别只在 profile 的安装方式与「谁有权改 profile」。

桌面客户端上特有的行为：

| 事项 | 实际行为 |
| --- | --- |
| 新 bundle 怎么生效 | **重启 DeepSeek Harness**。宿主侧返回 `application: restart-required`，渲染进程跑的还是启动时那份客户端 bundle |
| 有没有刷新页面的入口 | **没有**。`main.js` 的 `setApplicationMenu` 把 reload 两项写在 `...development ? [...] : []` 里，正式构建拿到空数组，`Ctrl+R` 也没绑定 |
| 插件管理入口 | 客户端「设置 → 插件」页面，或 `plugin_manager` 工具（`install_bundle` / `remove_bundle` / `set_plugin`） |
| 就近确认装上了什么 | `<profile>/node_modules/dsh-seework/package.json` 的 `version`、profile `package.json` 的依赖声明——两者都可能滞后于「刚点过更新」的直觉 |

**核对更新链路**（零成本，但别拿 `desktop` profile 练手）：

1. 在临时实例上把 profile 的依赖声明改成版本范围、装一份**较旧**的版本，`node_modules` 里那份 `package.json` 的 `version` 也改成旧号——这样 `kind` 才会是 `registry` 且真的「有新版可用」。
2. `POST /api/dsh-seework/update/status` → 断言 `{current, latest, updateAvailable:true}`。
3. `POST /api/dsh-seework/update/apply` → 断言 `{started:true, to:"<latest>"}`。
4. 立刻读 `<profile>/pnpm-workspace.yaml` → 断言 `minimumReleaseAgeExclude` 下多了 `dsh-seework@<latest>`。
5. 等几十秒再读 `node_modules/dsh-seework/package.json` 的 `version` → 断言已变成新版本，依赖声明同步。

**刚发布的版本会被供应链门槛挡住**：pnpm 默认拒绝安装发布不满 24 小时的版本（`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`）。插件在 `apply` 时会自动把目标版本写进 `minimumReleaseAgeExclude` 来放行（见 [设计](design/2026-09-29-npm-distribution-and-in-plugin-update.md)）；手工 `pnpm add` 一个刚发的版本则要自己带 `--config.minimumReleaseAge=0` 或先写白名单，否则会以为「装不上」是插件的毛病。

**并发跑 pnpm 会报 `EPERM … rename '.pnpm-lock.yaml.<随机>.tmp'`**：同一个 profile 目录里同时有两个 pnpm（例如一边让插件安装、一边手工执行）就会撞这个，不是更新链路的缺陷。核对时让插件自己跑，别在旁边补一条手工 `pnpm add`。

## 核对前须知

**成本标记**。标「零成本」的路线不需要生成额度：用历史会话里已有的回复图、或已有素材/板文件即可。标「消耗额度」的需要真生一次图，余额不足时如实报出网关原文。

**会改数据的核对**。凡是动 `canvas/` 板文件或画布图片的核对，**先备份 `canvas/`、核完还原并逐个比对哈希**；本文件在相应条目上标了「会改板文件」。

**脚本化事件的四个坑**（下面各面直接用，不再重复）：

- **要真鼠标事件**：CDP `Input.dispatchMouseEvent`（`mousePressed` / `mouseReleased`）。`dispatchEvent(new PointerEvent(...))` **不触发浏览器的默认焦点行为**，正是它让「点框外即确认」那版的缺陷在核对里蒙混过关（当时只看了一次合成 `pointerdown` 就宣布通过）。
- **注入节点后要「同步」派发 click**：React 提交会把夹在两次 `await` 之间的节点摘掉，摘掉的节点上的事件到不了 document。
- **切换工具后要等一拍**：工具是 React state，点完按钮在**同一个任务里**就派发指针事件时，处理器看到的还是旧工具（真人点击天然隔一帧）。`AnnotationEditor.test.tsx` 用 `act()` 包住点击避免同类假阳性。
- **一个手势可能全落在一个任务里**：指针 down/move/up 挤在同一任务时，只读 state 闭包会把对象丢掉；核对脚本要按真人节奏派发。

## 设置

- 设置对话框**左侧导航**里出现 `SeeWork`（在「Agent 预设」之后），点进去是连接 / 模型目录 / 生成默认值那张卡片。
- **同一张卡片不应再出现在「插件 → 插件配置」里**。
- 「插件 → 插件列表」里出现 `SeeWork` 是**正常**的——那是 shell 自己列的已安装插件。
- 「本地与行为」里**没有水印开关**，只剩「启用插件 / 允许 Agent 生图 / 把插件与模型告知 Agent」三个。（第八批起设置文档里**连 `watermark` / `seed` 字段都不存在**——它们是 doubao 的请求参数，缺省即网关默认。）
- **生成默认值只剩三个下拉**：默认模型 / 默认比例（网关统一的 8 个比例，默认 `3:4`）/ 输出格式（模型声明格式的并集，都为空时退回 `png` / `jpeg` / `webp`，默认 `png`）；**没有「每次张数」「默认档位」输入项**（第十批 / #658 删除），也没有"留空由上游决定"的空项。
  - 核对（**零成本**）：打开设置 → `SeeWork` → 断言 `select` 的选项集合（比例恰好是那 8 个且当前值 `3:4`；输出格式含 `png`），并断言页面文本里没有「每次张数」「默认档位」。旧文档若存着列表外的值（例如比例 `16:10`），该值应作为最后一项仍然选中，而不是显示成第一项。
- **素材目录用"打开系统窗口点选"**，不手填、也不只读：
  - `[data-dsh-seework-datadir]` 是宿主 `GET library` 报出的真实 `dataRoot`（拿不到才退到 `~/.dsh/dsh-seework（默认）`）；
  - 旁边是 `[data-dsh-seework-pick-dir]`「选择目录…」，以及（自定义过才有的）`[data-dsh-seework-reset-dir]`「恢复默认」；
  - 卡片**只在 `kind === 'native'` 时显示按钮**，否则用 `message` 说明原因（接缝的规矩：驱动不了的能力就把入口藏起来）。
- 核对（**零成本**，但**会在用户屏幕上闪一下文件夹窗口、约 1.2 秒后自己收掉**）：临时实例 + 无头 Chrome → 探测接口断言 `kind === 'native'`（这一步**不开窗口**）→ 设置 → `SeeWork` → 断言按钮在位 → 在页面里用 `AbortController` 调 `settings/pick-directory`、1.2 秒后 `abort()` → 断言请求以 `AbortError` 结束、`dataDir` 没被写、之后探测仍 `native`。
- **"真的选中一个文件夹"只能由人完成**（原生对话框无法脚本点选）。那一段由 `SettingsCard.test.tsx` 的假 API 覆盖：选中会写 `dataDir` 并提示、取消不写、`browse` / `none` 无按钮、「恢复默认」只在自定义后出现并 `unset('dataDir')`。

- **卡片底部「版本」区**：`[data-dsh-seework-version]` 是当前版本，「检查更新」是常态按钮，查到新版时多出「更新到 x.y.z」；点下去变「更新中…」，完成后那行提示写**重启 DeepSeek Harness**（`[data-dsh-seework-version-state="done"]`）。本地目录安装走另一条路：出现 `[data-dsh-seework-version-kind="local"]` 的说明，且**没有更新按钮**。
  - 核对（**零成本**）：临时实例上断言 `[data-dsh-seework-version]` 有值；`file:` 安装下 `[data-dsh-seework-version-kind="local"]` 存在且页面里没有「更新到」按钮；registry 安装下该元素不存在。
- **有新版时右下角出现提示条**：`[data-dsh-seework-update-notice]`，落在右下角、**插件悬浮按钮 dock 的上方**（dock 自己占着 `right:16 bottom:16`），带「更新」与「关闭」。
  - 核对（**零成本**）：启动后约 4 秒才查一次，**没有新版时整条不渲染**——这是要点，不该先闪一条可能不成立的提示；同一次核对里点「关闭」后它应消失，且全程没有任何安装动作。

## 对话里的图

- **工具调用那一行显示图片卡片**（标题「SeeWork 生图」+ 状态 + 缩略图，点图开原图），而不是一墙 JSON。
  - 核对（**零成本**）：库里已有的历史会话即可——卡片读结果里持久化的附件引用，用无头 Chrome 打开旧会话检查 `img[src*="/api/dsh-seework/attachment/image"]` 的 `naturalWidth > 0`。
- **助手回复的正文里应该直接出现这张图**（Markdown 图片，地址取工具结果里的 `absolute_url`）。正文才是用户不用展开任何折叠就能看到图的地方。
  - 核对（**消耗额度**）：需要一次新的生图，而且**只能由模型写 Markdown 实现**——shell 的 Markdown 渲染器只认绝对 http 地址，用户消息那一侧不渲染 Markdown（两条都实测过）。
- **正文里的图是「缩略图 + 点击放大」**：最长边 320px（`getComputedStyle().maxWidth === '320px'`、`cursor: zoom-in`），普通左键在原位开灯箱看原图，Esc 或点背景关闭，Ctrl / 中键仍走浏览器开新标签页；卡片缩略图有自己的尺寸（`data-dsh-seework-card-image`，不受那条 320px 规则影响）。
  - 核对（**零成本**）：临时实例 + 无头 Chrome 打开任一带回复图的历史会话，量 `getBoundingClientRect()` 与 `maxWidth`，再派发一次 click 看有没有出现 `[data-dsh-seework-image-zoom]`。
- **同一台机器上装着别的生图插件时，界面不该出现「Failed to load plugins」**——两个插件都会为自己的工具名注册视图，撞名的那个键是 `generate_image`，本插件注册在 `priority: -10`。核对：两边都要能加载。

## 画布

- 会话里右上角出现「素材库 / 画布」入口，右侧栏能打开对应的 tab；**首页（没有会话）时右下角浮动按钮在位**——标题栏只存在于会话里，浮动按钮是被隐藏而不是删除。
- **点中卡片应当升到最上层**；已经在上面的卡再点一次不该有任何变化（不该重复落盘）。
  - 核对（**零成本、会改板文件**）：临时实例 + 无头 Chrome 打开画布 → 读 `[data-seework-card]` 的 `style.zIndex` → 挑一张 z 最小、且 `elementFromPoint` 还能命中的卡（**完全被盖住的卡一个像素都点不到**）→ 真鼠标点它 → 断言它的 `zIndex` 大于所有其它卡、且它是 DOM 里最后一个 → 再点一次 z 不变。
- **画布上点中图片要浮出指令条**（`[data-dsh-seework-node-bar]`）：默认吸附节点上方、上方放不下翻到下方、水平钳在舞台内，条大小不随缩放变；三个入口「加入到对话框 / 标注 / 裁剪」。
  - 核对（**零成本**）：临时实例 + 无头 Chrome，打开画布 tab → 给卡片派发一次 `pointerdown` → 看条的位置（`getBoundingClientRect` 与卡片矩形的关系）与 `data-placement`；点「加入到对话框」后看页面里有没有多出一个 `img[src^="blob:"]` 且 `naturalWidth > 0`（草稿预览），**不需要**发消息。
- **画布图片分来源、可清理、删卡连带删文件**：
  - 卡片标题栏渲染成 `[data-dsh-seework-card-origin]` 徽标（`chat` / `panel` / `annotation` / `crop`）；**老卡片（写入时还没有这个字段的）也应当有徽标**；
  - ✕ 的提示按卡片类型给：合成图说「文件也会一起删掉」，素材库图片说「不会删除素材库里的文件」，备注只说「从画布移除」；
  - 移除合成图卡片**按顺序**删文件：先从板上拿掉卡片并 `saveNow()`，再 `POST canvas/asset/remove`（宿主侧只在这一步校验「没有任何板还引用它」，被引用则 409 `asset_in_use`）；
  - 工具栏「清理无用图片」→ `POST canvas/assets/prune`；`POST canvas/assets` 列清单（`files[].referenced` + `orphans` / `orphanBytes`），界面用结果文案回报（`已清理 N 张…释放 X MB`）。三条路由都是 loopback + POST，`asset/remove` 注册在 `asset` 前缀路由**之前**（否则会被当成文件名读走，`index.test.ts` 钉住了这个顺序）；
  - **回报条 4 秒后自己收起**（`NOTICE_MS = 4000`，`showAssetNotice`），新提示替换旧的（不会叠两条）。
  - 真机核对（**零成本、会改板文件/画布图片**）：清单接口报出 1 张被引用 + 3 张孤儿（4.46 MB）；删被引用的那张 → 409 且文件数不变；卡片徽标（对话生成 / 标注合成 / 备注）与三种 ✕ 提示各自正确；点合成图的 ✕ → 页面提示「卡片和它的合成图文件都已删除」且文件真的从磁盘消失、总数 −1；提示条点完 2 秒还在、约 4 秒后消失。
- **「图层」列表**（`[data-dsh-seework-layers-toggle]` 开关、`[data-dsh-seework-layers]` 面板、行 `[data-seework-layer-row=<id>]`、选中行带 `data-seework-layer-active="true"`）：**最上层排第一行**，每行＝序号 + 来源徽标 + 提示词 / 备注；点一行＝选中 + 提到最上层，若那张卡不在视野内还会把它挪到视野中央；**点画布任意处它要立刻收起**，而点面板自己或它的行都不收起。
  - 核对（**零成本、不改数据**）：图层列表 6 行、第一行＝当前最上层、点最后一行那张 → z 19 成为最大且列表重排、该行标记选中；图层面板点自己的标题不关、点空板面立刻关、再点按钮能重开（核对前后板文件哈希应一致）。
- **编辑器是「有界面板」，而且头部不许透光**：`[role="dialog"][aria-label="标注编辑器"]` 是铺满画布栏的压暗层，里面**只有一个**孩子＝面板（`width: min(100%, 1000px)`，居中、圆角、投影、不透明）；面板 / 工具条 / 按钮都是**实色**。
  - 核对（**零成本**）：临时实例 + 无头 Chrome，打开画布栏 → 选中图片 → 「标注」→ 量 `getComputedStyle` 的 `backgroundColor`（面板与工具条都不能是 `rgba(0, 0, 0, 0)`）与面板宽度；再点画布栏头部的「全屏」把它拉宽（实测浮层 641 → 1424），断言面板仍 ≤ 1002、仍在容器里居中、工具条回到一行（高 51px，不是 87px 的两行）。

## 标注与裁剪

- **产出的都是画布自有图片，不进素材库**：`[data-dsh-seework-annotation-toolbar]`（工具条，五个工具＝画笔 / 矩形 / 箭头 / 文字 / 橡皮擦）、`[data-dsh-seework-annotation-save]`（保存）、`[data-dsh-seework-crop]`（裁剪框）、`[data-dsh-seework-crop-toolbar]`（比例下拉 + 取消 / 裁剪）。
  - 真机核对（**零成本、会改板文件**）：选中图片 → 点「标注」→ 选「矩形」并在 SVG 上派发 `pointerdown` / `move` / `up` 画一个框 → 保存 → 画布上多一张卡、`canvas/assets/` 多一个文件、**素材库条目数不变**；再选中原图 → 「裁剪」→ 确认 → 又一张新卡（原图还在）。
- **文字框在「松手」时出现，不在「按下」时**：`onPointerDown` 只记住落点，`onPointerUp` 才开会框；**不能再加 `onBlur` 提交**；焦点挪走（Tab、切窗口）也不算结束，按框外才确认。
- **文字输入框自己管键盘**：输入框开着时按 Esc 只取消这次输入（清空并关掉输入框），**不能**把编辑器一起关掉。
  - 核对（**零成本**）：打开编辑器 → 选「文字」→ 在 SVG 上点一下 → 输入框出现 → 在输入框上派发 `Escape` → 断言输入框消失、工具条仍在、SVG 里没有 `text` 元素；再走一遍回车确认，`text` 元素应出现。
- **点框外即确认，且这一次点击不许再开新框**：确认写在浮层的 `onPointerDownCapture`，捕获阶段会置一个「这次按下已经用掉了」的 ref，冒泡阶段（SVG 里「记住落点」的处理器）先看它并清掉。
  - 核对**必须用真鼠标事件**（见上文「脚本化事件的四个坑」）。

## 素材库与「加到画布」

- 生图完成后**素材库会刷新**（计数、列表、画布的选图面板跟着更新）；**画布不会被自动打开、也不会有图自动上板**——要上板就在画布里用「从素材库选图」。
- **「加到画布」是手动的，而且点完会打开画布**。三处入口：灯箱底部、卡片缩略图下、素材库（列表卡片元信息行末尾的 chip 与详情浮层里的主按钮，后者放当前翻到的那张）。点一下应当：右侧栏画布 tab 打开（灯箱那条会先关灯箱）→ 板上多一张引用该素材库文件的图卡（落在**当前视野中央**，不是左上角）→ 立刻落盘。
  - 核对（**零成本、会改板文件**）：临时实例 + 无头 Chrome 里往某个 `[data-chat-anchor-key]` 节点注入一个 `<img src="/api/dsh-seework/library/image/<file>">` 并**同步**派发一次 click，再点灯箱里的按钮；素材库那两处直接点即可（注意先看详情浮层再看卡片 chip——打开画布会顶掉素材库 tab）。最后读 `~/.dsh/dsh-seework/canvas/*.json` 看有没有新卡。
  - 对话里的**历史**卡片没有按钮——旧结果里没有素材库文件名；素材库里的历史图片不受影响。
- **素材库详情里的「复制提示词」要像个按钮**。断言：`1px solid` 边框、有 background、`padding: 4px 12px`、约 86×30px，且 `pre.contains(button) === false`（**不在**提示词容器里）；提示词本身是带边框、限高可滚动的 `pre`。

 
