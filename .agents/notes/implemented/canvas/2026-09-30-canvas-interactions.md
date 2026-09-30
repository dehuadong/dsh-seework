---
title: 画布图片的三种指针手势：双击放大、按住拖动、右键定位文件
status: implemented
created: 2026-09-30
updated: 2026-09-30
approval: 用户直接提出三条需求「1、双击画布中的素材可以放大，大小可以参考标注功能的大小比例；2、左键点击素材后（显示鼠标手形状）直接拖动移动；3、图片上右键 → 出现菜单[打开文件所在位置]」（工作项 dehuadong/dsh-seework#3）
verification: npx playwright test 整跑 13 passed（23.4s，含新增 e2e/canvas-interactions.spec.ts 四条）；pnpm typecheck 通过；pnpm test 38 个文件 525 通过 1 跳过（新增 src/reveal.test.ts 8 条与 routes.test.ts 的 reveal 路由 3 条）；新 spec 先在旧 bundle 上跑（DSH_E2E_SKIP_BUILD=1）四条全红
---

# Agent Note：画布图片的三种指针手势：双击放大、按住拖动、右键定位文件

## 问题

画布上的图片只能靠**标题栏**拖动；看大图得先进标注编辑器；文件在哪台机器、哪个目录，用户只能去素材库详情里读一段路径文本。三件事都是画布对一张图该有的动作，却都做不到。

需求：双击放大（尺寸参照标注编辑器）、左键按住图片即可拖动（手形光标）、图片上右键出「打开文件所在位置」。

## 决定

1. **放大视图复用标注编辑器那套有界面板**：`position: absolute; inset: 0` 的压暗层 + 居中面板 `width: min(100%, 1000px)`。理由是同一个：画布栏可以被拉成全屏，跟着铺满的面板只会更难看清。Esc、点背景、面板上的「关闭」都能收起。**不做缩放与平移**——那是第二个画布，而标注与裁剪已经有现成入口。
2. **图片卡片的正文就是拖动手柄**：`cardBodyPicture` 给出 `cursor: grab`（按住时 `grabbing`），pointerdown 复用既有的 `beginMove`。文字卡片仍只在标题栏拖动——它的正文是文本框，拖它会破坏选字。
3. **图片上右键出图片自己的菜单**（一项：「打开文件所在位置」），板面空白处仍是「上传图片素材」。两者共用同一个菜单元素与状态（定位、Esc、关闭都只有一套）。这**取代**上一轮「卡片上放行浏览器菜单」的做法：那时卡片没有自己的动作，现在有了。
4. **「打开文件所在位置」由宿主半边自己做。** DSH 自带的路径打开能力用不了：会话 Remote 的 `openWorkspacePath` 先过 `verifyDesktopPath`，要求 `fs.processPathFromHostPath` 能往返——也就是路径必须在**会话工作区内**；插件的图在 `<数据根>/images/` 与 `<数据根>/canvas/assets/`，必然被拒。平台配方照 `@deepseek-ai/dsh-native-command` 的 `revealNativePath` 抄：Windows 交给 Explorer 一个**编码后的文件 URI**（`/select,` 与目标各占一个 argv 元素，`,` 与 `=` 先转义、非 ASCII 的百分号转义还原成可读文字），并把它的**退出码 1** 当作"已委派给正在运行的桌面进程"；macOS 用 `open -R`；Linux 用 `xdg-open` 打开父目录。
5. **只认自己库里的文件。** 请求带的是**文件名 + 来源**（`library` / `canvas`），路径由宿主按各 store 自己的名字规则拼出来（`libraryImagePath` / `canvasAssetPath`，两个名字规则各自收成一处，读取路由与 reveal 共用）。页面递不了任意路径。
6. **桌面调用是接缝。** `SeeWorkRoutesDeps.reveal` 默认是真实现，测试传替身——所以给这条路由写的单测**不会在跑测试的机器上弹出资源管理器窗口**。

## 备选方案

- **用 DSH 的 `openWorkspacePath`（`action: 'reveal'`）**：省掉整个宿主实现，但 `verifyDesktopPath` 只接受会话工作区内可往返的路径，而插件的图在自己的数据根下。驳回，有源码证据（`api/session-controller/src/index.ts`）。
- **引 `@deepseek-ai/dsh-native-command` 直接调 `revealNativePath`**：能省掉平台细节（含 WSL 的 `wslpath` 转换），但要新增一个宿主依赖，而本仓库的 DSH devDependencies 停在 `0.1.5-rc.1`、运行时却是 `0.2.0-rc.2`，无法确认那个版本有 `revealNativePath`。改为照配方自己实现（40 行，纯 argv 部分可单测）。
- **放大视图做成可缩放可平移的画布**：等于在画布里再造一个画布；要细看并改动有标注与裁剪。驳回。
- **文字卡片也能从正文拖动**：正文是文本框，拖动会破坏选字与编辑。驳回（需求说的也是「素材」，即图片）。
- **图片右键给一整套动作（加入到对话框 / 标注 / 裁剪 / 移除）**：超出本次范围，且卡片已有的浮出指令条与 ✕ 覆盖了这些动作。本次只放需求要的那一项。
- **e2e 直接打真路由验证 reveal**：那会在跑测试的机器上弹出资源管理器窗口（E2E 规则明确要求临时实例与用户环境隔离）。改为 spec 用 `page.route` 截住路由、断言页面发出的请求体，宿主侧由单测覆盖。

## 后果

- 图片可以整块拖动（正文即手柄），双击是「看清楚」，右键按目标分两套：图片上是图片的动作，板面空白处是上板。
- 板面菜单与图片菜单共用同一元素，因此**互斥**：同一次右键只有一个菜单。
- 需要本机有文件管理器。WSL 与没有显示服务的 Linux 上会失败并**如实报出原因**（画布上的提示条），不会假装成功。已知限制：没有做 WSL 的 `wslpath` 转换（DSH 那边做了），那种部署下这条动作会失败。
- 放大视图只读：不提供保存、标注、裁剪入口——那些在浮出指令条上。

## 验证

- `npx playwright test` 整跑 **13 passed**（23.4s）：新增 [`e2e/canvas-interactions.spec.ts`](../../../../e2e/canvas-interactions.spec.ts) 四条 —— 双击后放大视图出现、图**比卡片更大**、面板宽度 ≤ 1000px、Esc 收起；在图片正文上真按下-移动-抬起 70/45px 后卡片跟着走、且正文的计算光标是 `grab`；图片上右键的菜单含「打开文件所在位置」而**不含**「上传图片素材」；点该项后页面发出 `{ file, source: 'canvas' }`（路由被 spec 截住应答，不弹窗口）。
- 红证：新 spec 先在**旧 bundle** 上跑（`DSH_E2E_SKIP_BUILD=1`），四条全红。
- `pnpm test`：38 个文件 525 通过、1 跳过。新增 `src/reveal.test.ts` 8 条（三平台 argv、Explorer 的转义与可读文字、委派退出码 1 只在 Windows 算成功、命令失败、无文件管理器的平台）；`src/routes.test.ts` 新增 3 条（同一文件名在两个 store 各自拼到自己的目录、非法名/未知来源/缺来源一律 400、桌面拒绝时回 `reveal_failed` 而不是假装成功）。
- `pnpm typecheck`：通过。
- **测试设施同时修了一处会漂移的设计**：画布 spec 原来靠「最后一张卡片」在累积了 19 张重叠卡片的板上定位，运行次数一多就漂（失败现场是「另一张卡片的正文拦截了指针事件」），两个 spec 并行时还共用同一块板互相干扰。现在每条用例先**新建一块板**（`openFreshBoard`），板上一张图，且各用例的板互不相干。
