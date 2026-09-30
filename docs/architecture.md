# dsh-seework 架构

## 两半结构

DSH 插件由宿主半边和浏览器半边组成，同一个 npm 包两个入口：

| 半边 | 入口 | 运行位置 | 职责 |
| --- | --- | --- | --- |
| 宿主 | `lib/index.js`（`exports["."]`） | DSH 宿主进程（Node） | 设置区、`/api/dsh-seework/*` 路由、生成任务（每模型 1 并发、不排队）、素材库落盘、Agent 工具、系统提示词公告 |
| 浏览器 | `lib/client.js`（`exports["./client"]`） | dsh web GUI | 设置卡片（槽位或浮动面板）、素材库、画布、右上角入口、**会话内的图片卡片** |

宿主半边在 `cordis.patch.yml` 里以裸包名插入 profile 装配表；`package.json` 的 `dsh.client` 声明让浏览器半边从 `/plugins/dsh-seework/client.js` 加载。

## 宿主半边

```
src/index.ts            apply()：装配设置区、路由、Agent 工具、公告
src/settings.ts         设置文档：schemastery schema、生效值归一化、模型解析
src/capability.ts       能力表：模型形状（schema 片段 / 读回 / 合并 / 退役键 / 与目录新读法比对与采纳）+ 请求解析（默认值、裁剪、上限）（#669）
src/protocol.ts         两半共享的线协议（常量、请求/响应、素材记录）
src/engine.ts           请求映射 + 调 SeeAI Hub + 响应归一化
src/catalog.ts          模型目录发现（catalog 优先，/models 兜底）
src/catalog-refresh.ts  自动检测：启动 / 开卡片 / 低频后台三个触发共用一条路径与节流
src/generation-runtime.ts  生成任务（每模型 1 并发、忙即拒、取消、等待、落库）
src/library.ts          本地素材库（文件 + index.json）
src/routes.ts           /api/dsh-seework/* 路由族（含工具结果图片的附件回读路由）
src/agent-tools.ts      generate_image（同步调用，结果里没有任务号；带可选的 reference_images 即改图）
```
 

## 浏览器半边

```
src/client/index.ts            装配：设置入口两个座位（导航页 + 插件 tab）、素材库、画布、右上角入口、右侧栏 tab、轮询
src/client/header-launchers.tsx 会话标题栏右上角的「素材库 / 画布」入口 + 各面自报开关状态
src/client/sidebar-tabs.ts     右侧栏两个 tab 类型（素材库 / 画布）的注册、打开、关闭与查询
src/client/generation-watch.ts 轮询「素材库最新一条」以发现宿主里刚完成的生图，然后刷新共享素材库 store（**不碰画布**）
src/client/NodeFloatingBar.tsx 选中画布节点后吸附在它旁边的浮动指令条
src/client/floating-bar.ts   浮动条定位纯函数（上/下翻转 + 水平钳位）
src/client/AnnotationEditor.tsx 标注编辑器（画笔/矩形/文字混用，烧录成一张合成图）
src/client/annotations.ts     标注对象模型与几何（原图像素，纯函数）
src/client/CropOverlay.tsx    节点原地裁剪（框 + 手柄 + 比例工具栏）
src/client/crop-rect.ts       裁剪框几何与三层换算（纯函数）
src/client/burn-image.ts      离屏 canvas 烧录（标注合成图 / 裁剪子图）
src/canvas-assets.ts          画布自有图片的落盘与读取（宿主）
src/client/composer-draft.ts 「加入到对话框」：把图片当草稿附件塞回会话输入框
src/client/LibraryTab.tsx      素材库 tab 本体（复用 LibraryPanel + 详情浮层）
src/client/CanvasTab.tsx       画布 tab 本体（复用 CanvasBoard，板列表折叠成一条）
src/client/settings-scope.ts   设置桥 scope（读/写/版本栅栏/密钥是否已保存）
src/client/snapshot-store.ts   极小的可观察快照（不依赖 dsh-client-store）
src/client/SettingsCard.tsx    设置卡片本体：连接、模型目录、生成默认值、行为开关
src/client/library-store.ts    素材库状态与纯视图helper（筛选、按天分组、模型计数）
src/client/LibraryPanel.tsx    素材库抽屉（搜索、筛选、按天分组、卡片）
src/client/library-detail.tsx  素材详情浮层（大图翻页、复制提示词、参数、删除）
src/client/library-panel.tsx   素材库挂载点（启动按钮进共享 dock + 抽屉 + 详情，共用一份 store）
src/client/canvas-store.ts     画布客户端状态（打开/编辑/自动保存/冲突重试）
src/client/CanvasBoard.tsx     画布本体（工具栏、无限画布、卡片、素材库选图、板列表）
src/client/canvas-panel.tsx    画布挂载点（启动按钮 + 全屏浮层）
src/client/tool-card.tsx       会话里的图片卡片：按工具名注册 tool.call.toolview，引用取自结果 meta
src/client/surfaces.ts         共享启动按钮 dock（三个面共用一个底栏）
src/client/controls.tsx        本地表单控件（按 --dsw-* 设计令牌取色）
src/client/settings-panel.tsx  浮动设置入口 + 遮罩面板（无槽位时的兜底）
src/client/api.ts              路由客户端
```

 