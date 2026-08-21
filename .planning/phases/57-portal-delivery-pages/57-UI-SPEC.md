---
phase: 57
slug: portal-delivery-pages
status: approved
shadcn_initialized: false
preset: none
created: 2026-08-22
reviewed_at: 2026-08-22
---

# Phase 57 — UI Design Contract（门户与交付 Portal & Delivery Pages）

> Visual and interaction contract. Generated per 57-CONTEXT.md binding decisions（D-01..D-16），house style = 55-UI-SPEC + 54-UI-SPEC（同为 cattpuccin 体系，token-only 纪律）。
> 本期主 UI：门户首页（项目入口）、交付页 `/deliver/:ep`（成片 + 交付清单 + G8 终审）；次级面：Toonflow 嵌入页、共享 navbar（四岛共脸）、画布 topbar 内嵌段。
> **设计宪法（CONTEXT specifics 锁定）**：门户壳是本期签名 UI；信息架构以「项目 → 画布 / 交付」动线为主轴；navbar 克制、低调、可注入；交付页面向**收片人**不是操作员——master.mp4 大播放器为主角，清单/终审为辅；copy 用交付 vernacular（「成片」「交付清单」「终审」）。

---

## Design System

| Property | Value |
|----------|-------|
| Tool | **none**（shadcn gate：`components.json` 不存在；55/54 两期已裁决——复用自有 token 体系，不引入平行组件体系） |
| Preset | not applicable |
| Component library | none — inline styles + `--cv-*` CSS vars / `v3theme.*`/`theme.*`（TS 侧）是仓库惯例 |
| Icon library | `UiIcon`（`packages/infinite-canvas/src/components/canvas/icons.tsx` 既有 kind 体系；portal 经 monorepo 相对路径 alias 复用，新 kind 按同一几何风格内联追加，不引外部图标库） |
| Font | `--cv-font-ui` = Inter + Noto Sans SC + PingFang SC；`--cv-font-mono` = JetBrains Mono（ep 号 / P0X / gate id / 时长 / 文件尺寸 / 计数专用） |
| Token 真相源 | `packages/infinite-canvas/src/theme/tokens.css`（CSS 侧）+ `src/theme/catppuccin.ts`（TS 侧）。**本期禁止新建任何色值/字号/间距常量——一切引用现有 token**；唯一允许衍生 = 既有 token 的 alpha 变体（`*Weak` 先例） |
| Phase 词汇真相源 | `packages/infinite-canvas/src/constants/phaseRegistry.ts`（55-D04 单一注册表，22 条）——管线带/深链 zone/一切 phase 文案只从它读，禁止内联中文 phase 表 |
| Gate 词汇真相源 | `src/lib/gateCatalog.ts`（54-D02 快照，16 门）——终审卡/gate 点只从它读 |

---

## Spacing Scale

与 55/54 完全同标（4 的倍数）：

| Token | Value | Usage（本期面） |
|-------|-------|-------|
| xs | 4px | navbar 项内 icon-文字间隙、行内徽章间隙 |
| sm | 8px | 行内元素 gap、按钮内距纵向、集行垂直 padding |
| md | 16px | 卡片/面板 padding（`--cv-panel-pad`）、交付页区块内距 |
| lg | 24px | 分区间隔（`--cv-panel-section-gap`）、页面纵向节奏 |
| xl | 32px | 门户内容列左右留白（窄屏塌缩到 md） |
| 2xl | 48px | 交付页 hero 上下留白（影院呼吸感，唯一大档使用） |

Exceptions（均为既有值，新代码不得再发明）：28px 新交互行最小高度（55 规则——集行/清单行/gate 行键盘鼠标可命中下限）；40px navbar 全宽档高度；26px navbar compact 档高度（对齐顶栏 ViewMode 控件族）；36px 交付页终审动作条按钮高（54 同款 32px + 边距，按钮本体高维持 32px）。

内容列宽：门户/交付页内容列 `max-width: 1080px` 居中（交付页 hero 视频同宽）；窄屏（<720px）单列堆叠、终审卡下移。

---

## Typography

严格复用 `--cv-fs-t1..t4`，权重只有 400 + 600 两档：

| Role | Size | Weight | Line Height | Token |
|------|------|--------|-------------|-------|
| 页面/区块标题（「项目」「成片」「交付清单」「终审」） | 14px | 600 | 1.2 | `--cv-fs-t1` |
| 正文/行标签/按钮文字/navbar 项 | 12px | 400 | 1.6 | `--cv-fs-t2` |
| 集行 id/清单行文件名/状态标签/navbar compact 项 | 11px | 400（状态标签 600） | 1.4 | `--cv-fs-t3` |
| mono 标注（P0X / gate id / ep 号 / 时长 / 字节数 / 计数） | 10px | 400 | 1.4 | `--cv-fs-t4` + `--cv-font-mono` |

- ID 类文本一律 mono + tabular-nums；数字/尺寸格式沿用仓内既有（时长 `MM:SS`、字节数人类可读 KB/MB）。
- 文案全部中文（审片/交付行话），专有名词（Toonflow / master.mp4 / KAP）保留原文；不向用户暴露 review-platform / POLICY_EVAL / content_ref 等内部词汇（54 规则延续）。

---

## Color

延续 v2「冷中性壳 + 暖模态通道」。门户/交付表面**只出现阶段维度**（phaseGroup 4 色）+ 54 gate 四态色；**严禁场景维度色**（55 两维度纪律：场景色带只在画布导航表面）。

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#0A0B0E`（`--cv-bg-canvas`）+ `#111317`（`--cv-bg-panel`） | 页面底、navbar、播放器壳 |
| Secondary (30%) | `#16181D` card / `#1E2128` overlay / `#272B33` elevated | 集行 hover、清单行、终审卡、hover 提升 |
| Accent (10%) | `#EDEEF1` 冷白（`--cv-select`） | 见 reserved-for 清单 |
| Destructive | `#DD6A82` 玫（`--cv-rejected`） | 仅驳回按钮填充 + 驳回态点/标签（54 同款约束） |

Accent（冷白）reserved for（穷举，仅此 5 处）：
1. navbar 当前项文字 + 2px 下划线；
2. 交付页视频播放器中央播放键（48px 圆形描边，内容主角的唯一亮色 affordance）与已播进度段；
3. 终审「放行」主按钮（54 已定：primary = `theme.button.primary` 冷白填充 + `text.onAccent`）；
4. 键盘焦点环（tokens.css 既有 `:focus-visible`，不得删除）；
5. 门户集行被键盘导航选中时（同 55 导航器激活行语法：左侧 2px 实线 + `rgba(237,238,241,0.10)` 底）。

**管线带颜色编码（签名元素，见下节）**：段填充 = `v3theme.phaseGroup`（research 金 `#E0B665` / story 青 `#56B89A` / production 玫 `#DD6A82` / post 橙 `#E08547`）的 weak alpha 底（`rgba(*,*,*,0.12)` 同 `*Weak` 公式）+ 同色 1px 顶边线全饱和；空段 = 透明 + `--cv-line-panel` 发丝线描边。交付页 gate 点 = 54 四态色（pending 金 / approve 青 / reject 玫 / waive 冷灰 `#7A8290`），10px 圆点。门户行 micro 版**不带 gate 态**（安静）。

终审卡四态 = 54 锁定映射原样复用（等你决策=金 / 放行=青 / 驳回=玫 / 豁免=冷灰），一处不另起。

---

## Signature Element：管线带（Pipeline Ribbon）

本期唯一记忆点——把 22-phase 注册表变成一条**数据为真**的水平制程带，让「这部片子走到了哪」在一眼里可读，并把 PORTAL-02 深链做成可见 affordance。

规格：
1. **结构**：22 段按 `PHASE_REGISTRY` sortKey 升序横排（flex 等宽）；`sub: true` 的子阶段段渲染为 60% 高度、底对齐（P03.5/P09b/P09c/P10c/P11a0/P11c 一望可辨主从）。段间 2px 间隙（hairline 例外）。
2. **micro 版**（门户集行内，flex-1 占满行宽）：高 8px；有节点段 = phaseGroup weak 填充 + 1px 顶边线；空段 = 发丝线描边；无 tooltip 之外的任何装饰。点击整条 → `/canvas?project&ep`（不带 zone）。
3. **full 版**（交付页 hero 下方，宽 = 内容列）：高 24px；在 micro 版基础上每段 hover 120ms 提亮（`brightness(1.15)`）+ tooltip（`P0X 名称` mono 10px + 节点计数）；**gate 段**（gateCatalog 有 `review_gate` 的 phase）段下方挂 10px 四态圆点；点击段 → `/canvas?project=X&ep=Y&zone=<khsPrefix>` 深链（D-05）。P13 段与右侧终审卡相邻——结构真相：终审是管线的最后一道门。
4. **数据**：micro = `POST /api/canvas/projects` 扩展字段（episodes[].phases 直方图，canvas_nodes 按 phase_index 聚合）；full = 交付页 load-v2 后按 phaseIndex 计数 + gate-state 四态。注册表外 phaseIndex 不出段（55「未映射」词汇不进门户表面——门户只呈现注册表内制程；计数>0 但无段的情形由契约测试防）。
5. **降级**：聚合接口失败 → 管线带整条隐藏（不渲染空壳），行内只余文字计数；不占位不报错弹窗。

---

## Copywriting Contract（交付 vernacular，全中文；词表与 54 锁定词表同源）

| Element | Copy |
|---------|------|
| Navbar 品牌 | KAP（mono 600，冷白） |
| Navbar 项 | 门户 / 画布 / 剧核 / 3D导演台 / Toonflow |
| 门户页标题 | 项目 |
| 项目行 meta | {N} 集 · {M} 资产（t3 tertiary，计数 mono） |
| 集行动作 | 画布 / 交付（ghost 按钮，动词直指；非「打开」「查看」） |
| 门户空态 heading | 暂无项目 |
| 门户空态 body | 项目在画布或 Toonflow 里创建后，会出现在这里 |
| 门户接口失败 | 项目列表加载失败 —— 稍后重试，或直接进入画布。[重试] |
| 交付页区块标题 | 成片 / 交付清单 / 终审 |
| 终审卡标题 | 成片终审（mono 标注 `p13-gate`；显示名「成片交付」出自 54 门名表） |
| G8 四态标签 | 等你决策 / 放行 / 驳回 / 豁免（54 词表原样；需求 prose「通过/打回」映射为 放行/驳回，不另造词汇——D-10 通道复用决定词汇复用） |
| 终审主 CTA | 放行（单点击即执行，无二次确认——54-U-05） |
| 终审次 CTA | 驳回（danger 玫） |
| 驳回确认（54 C-4 原文） | 驳回后管线将回滚到 {阶段名} 重跑（重试预算 3 次）。确认驳回？ |
| 驳回理由 placeholder | 驳回理由（必填）：告诉管线哪里不过——将随决策存档。 |
| 409 已决 toast | 该门已在别处处理（如 telegram），状态已刷新。 |
| 操作中瞬时态 | 处理中…（行级，禁止全屏 loading） |
| gate 状态源降级 | 状态源不可达 —— 无法连接审核状态源，正在显示 {N 分 N 秒前} 的快照，不会误判为已放行。[重试] |
| 红线子门脚注 | p13 红线子门为本地自动扫描，不进入人工决策。（54 原文） |
| 交付清单行 | 文件名 mono + 尺寸 + 类型徽章（成片 / 交付包 / 质检报告）+ 打开 |
| 交付清单空态 heading | 交付清单为空 |
| 交付清单空态 body | P13 交付阶段产出后，这里会列出成片与交付包 |
| 无成片空态 heading | 本集尚未产出成片 |
| 无成片空态 body | P13 交付阶段完成后，这里会播放 master.mp4 并给出交付清单。[去画布看 P13] |
| 深链落点不存在 toast | 该资产尚未放置在画布上（既有 focusAssetNodeId toast，不改） |
| Toonflow 嵌入页注 | 旧版工作台（共存期）——新工作请从门户与画布进入 |
| Toonflow 嵌入失败 | Toonflow 加载失败。[直开旧版]（链接到 /） |
| 管线带 tooltip | {P0X} {名称} · {N} 节点（mono P0X；full 版 gate 段追加 门名 · 四态词） |

数字/ID 一律 mono；时长 `MM:SS`；文件尺寸 KB/MB 人类可读。

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none | not applicable（Tool: none） |
| third-party | none | not applicable——**本期零新增依赖**（portal 新包仅 devDependencies 复用根仓既有 vite/esbuild 版本；navbar 为 vanilla custom element，无框架依赖） |

若 planner 想引入任何新包（router 库 / UI 库 / iframe 通信库），须回补 RESEARCH 的 Package Legitimacy Audit——默认答案是「不引入」。路由 = pathname switch 手写（3 条路由，无 react-router）。

---

## Component Inventory & Interaction Contract

### P-1 KapNavbar（共享 navbar，vanilla custom element）
- **单源三宿主**：源码一份 vanilla TS（custom element `<kap-navbar>`，light DOM 不用 shadow——`--cv-*` token 自然级联）；三宿主：①portal React 直接 import；②画布 topbar 内嵌（infinite-canvas import 同源）；③静态站注入（esbuild 产物 `data/assets/kap-nav.js` + `kap-nav.css` = tokens.css 构建期 concat + nav 样式，单 token 源不复制值）。
- **全宽档**（门户/交付/嵌入页）：高 40px，底 `--cv-bg-panel`，下缘 1px `--cv-line-panel`；左 = 品牌 KAP（链接 /portal）+ 5 项（`--cv-fs-t2`，gap 16px）；当前项 = 冷白文字 + 2px 下划线（`data-active` 属性驱动，宿主传入或按 `location.pathname` 前缀自判：`/story-map`、`/director-desk`、`/portal|/deliver` → 门户，`/infinite-canvas|/canvas` → 画布，`/toonflow` → Toonflow）；其余项 `--cv-text-secondary`，hover 120ms 转 primary。
- **compact 档**（画布 topbar 内嵌，`compact` 属性）：高 26px 内联，项字号 t3，替换 FlowCanvas topbar 左簇的 logo+「无限画布」标题块（画布身份由「画布」当前项承载）；**不得新增第二层横条、不得改 48px topbar 高度与 `calc(100vh - 48px)` 布局**（Do-Not-Regress 1）。
- **注入形态**（静态站）：serve 时在 index.html `<body>` 后插入 `<kap-navbar data-active="...">` + `<script defer src="/assets/kap-nav.js">` + `<link rel="stylesheet" href="/assets/kap-nav.css">`；story-map 自有站内 navbar 保留在下方（全局导航层 vs 站内导航层，不吞不改）。
- 键盘可达：项为 `<a href>`，焦点环走 tokens.css 既有规则。

### P-2 门户首页 PortalHome（`/portal`）
- 数据：`POST /api/canvas/projects`（既有，src/routes/canvas/projects.ts:23-89；本期**增量扩展** episodes[].phases 直方图——canvas_nodes GROUP BY phase_index，字段已存在，additive 不破坏 ProjectSelector 消费）。
- 结构：内容列 1080px；页头「项目」t1 + 计数 mono；项目分节 = 项目名 t1 + meta 行 + 集行列表（行高 ≥28px，行间发丝线）。
- 集行：ep 号（mono t3）+ 节点数（t4 tertiary）+ **管线带 micro**（flex-1，P-5）+ [画布] [交付] ghost 按钮（28px 高）。画布按钮 → `/canvas?project={projectId}&ep={episodesId}`（D-05 格式，portal 是深链的唯一发码方之一）；交付按钮 → `/deliver/{episodesId}`。无 P13 产物的集交付按钮不置灰——交付页自带空态（比禁用诚实）。
- 状态：加载骨架（3 行 quiet 脉冲）→ 数据/空态/失败（copy 见上表）。

### P-3 交付页 DeliveryPage（`/deliver/:ep`）
- `:ep` = 数字 episodesId（kap 全链词汇；kmc 侧 ep-slug 由 gateStateService 桥接，不进 URL）。projectId 由 `/api/canvas/projects` 反查（episode → project 归属），再并行 `POST /api/canvas/v2/load-v2` + `GET /api/canvas/v2/gate-state`（全部既有端点，零新建后端）。
- **版式（收片人动线：先看成片，再核清单，最后终审）**：
  ```
  ┌ KapNavbar ────────────────────────────────────────────┐
  │ {ep 号 mono} · {项目名}                    [去画布]    │
  │ ┌──────────── 成片 hero 16:9 ─────────────┐ ┌ 终审 ┐  │
  │ │            master.mp4 大播放器           │ │ 卡   │  │
  │ │        （中央 48px 冷白播放键）          │ │      │  │
  │ └─────────────────────────────────────────┘ │      │  │
  │ [管线带 full · 22 段 + gate 四态点]          │      │  │
  │ 交付清单                                     └──────┘  │
  │  ▸ master.mp4   182.4 MB  成片      [打开]            │
  │  ▸ delivery-package…       交付包    [打开]            │
  └───────────────────────────────────────────────────────┘
  ```
  宽屏 hero 左（约 2/3）+ 终审卡右（约 1/3，sticky）；窄屏堆叠、终审卡置底。
- **成片 hero**：`<video controls preload="metadata">`，src = `resolveMediaUrl(node.data.filePath)`（与 53 变体墙同链，utils/mediaUrl.ts:89-103；`/oss` 与 `/local-file` 均原生 Range——app.ts:71/83/166，D-12 满足）；壳 = `--cv-bg-panel` + 发丝边，页面底即冷近黑影院底，无额外装饰。master 判定：p13（phaseIndex 16）节点中 canvasType=video 且名称/路径含 `master`（或唯一 video 节点兜底）。
- **交付清单**：p13 全部节点列表（成片/交付包/质检报告三型徽章，文案上表）；行 = 文件名 mono + 尺寸 + 类型徽章 + [打开]（resolveMediaUrl 新窗口）；不直扫文件系统、不手工配置（D-11——数据 = canvas_sync → save-v2 契约透传的 p13 节点）。
- **终审卡（G8）**：54 词汇/色/交互全套复用——四态行（10px 点 + 11px/600 标签 + `p13-gate` mono 标注）、驳回理由展示（最新 note 截断）、动作条 [放行] 冷白 / [驳回] 玫、驳回 = 理由必填(1-500) + 二次确认对话框（54 C-4 模式，组件内 state，禁原生 confirm）、409 幂等 toast、降级横幅（`chrome.errorBar` 底）。红线 3 子门 = 脚注灰字（自动扫描，无卡无点）。操作通道 = `POST /api/canvas/v2/gate-ops`（reviewId 取自 gate-state p13-gate 条目；display 非 pending 时动作条隐藏只留状态）。
- **去画布看 P13**（空态与 hero 角标）：`/canvas?project&ep&zone=p13`。

### P-4 Toonflow 嵌入页（`/toonflow`）
- KapNavbar（当前项 Toonflow）+ 注释行（copy 上表）+ 同源 `<iframe src="/">` 占满余高（`/` = data/web/index.html 26MB bundle 原位不动——D-01 共存：根路径与全局 SPA fallback 行为零改动，Toonflow 经 iframe 进门户）。加载失败 → fallback 注释行 + [直开旧版] 链 `/`。

### P-5 PipelineRibbon（签名元素组件）
- 见 Signature Element 节。React 版（portal/交付页）+ 数据钩子；phase 词汇 import PHASE_REGISTRY（monorepo 相对路径 alias，import-from-dir.ts:81 跨包先例）；micro/full 两档同组件 props 切换。

### P-6 画布深链消费（无新 UI 面，交互契约）
- `/canvas` = express 302 → `/infinite-canvas/?projectId={project}&episodesId={ep}&focus={focus}&zone={zone}`（参数翻译 + 透传；D-05 URL 契约稳定，画布本体挂载点不动）。
- 画布侧 `getInitialParams()`（FlowCanvas.tsx:105-114）扩展读 `focus`/`zone`：图加载后 focus → `setFocusAssetNodeId(nodeId)` 直发；zone（khsPrefix）→ PHASE_REGISTRY 查 phaseIndex → 该 phase 首个资产节点 → 同一 `setFocusAssetNodeId`——**只复用既有 effect 语义（FlowCanvas.tsx:762-786 fitView/1.5s 清空/未放置 toast），不写第二套 viewport 机制**；落点不存在走既有 toast 文案。

---

## State Matrix

| Surface | States |
|---------|--------|
| PortalHome | 加载骨架 / 有项目（集行+管线带 micro）/ 空态 / 接口失败（重试） |
| PipelineRibbon micro | 全空（全发丝线）/ 部分 / 满；整条隐藏（聚合失败） |
| PipelineRibbon full | 同 micro + hover tooltip + gate 四态点 + 点击深链 |
| DeliveryPage | 无成片空态 / 有成片 / 清单空 / hero 加载中（黑壳+中央播放键禁用态） |
| 终审卡 | 等你决策（点呼吸 + 动作条）/ 放行（青点，动作条退场）/ 驳回（玫点 + 理由）/ 豁免（冷灰点）/ 处理中…（行级）/ 409 刷新 / 降级横幅 |
| KapNavbar | 全宽档 / compact 档 / 注入档（静态站，当前项由 data-active 指定） |
| Toonflow 嵌入页 | 加载中 / 就绪 / 失败 fallback |
| 画布深链 | 命中（focus 效果既有）/ 落点不存在（既有 toast）/ zone 无节点（静默不跳，仅加载） |

动效全部走既有 token：面板/页面区块进场 `--cv-d-panel` 240ms `--cv-e-out`（交付页 hero→管线带→清单以 `--cv-d-ancestor-step` 40ms 递进，一次编排）；hover 120ms `--cv-d-select`；终审 pending 点呼吸 = 54 同拍 2.4s（`--cv-e-inout`，opacity 0.5↔1.0）；退场 `--cv-d-unhighlight` 220ms；`prefers-reduced-motion` 全部静止（tokens.css 既有块）。**零新节拍**。

---

## Do-Not-Regress（执行器红线）

1. **画布 topbar 结构**：48px 高度、`calc(100vh - 48px)` 布局、GateTodoChip/视图切换/项目选择器行为零改动——navbar compact 只替换左簇 logo+标题块，不加第二层条。
2. **focusAssetNodeId effect 语义**（FlowCanvas.tsx:762-786）：fitView/highlight/1.5s 清空/未放置 toast 只复用不改；`?projectId/?episodesId` 既有参数与 `/infinite-canvas/` 直链完全兼容。
3. **54 gate 通道语义**：gate-ops 409 幂等 toast、fail-closed 降级、reject 理由 1-500 必填、四态折叠——交付页终审复用，不得另起通道或词汇。
4. **55-D04 单一注册表**：一切 phase 词汇（管线带/深链 zone/文案）只 import `phaseRegistry.ts`，禁止内联 22 条表；gate 词汇只 import `gateCatalog.ts`。
5. **token-only**：零新 hue/hex/字号/间距/动效节拍；alpha 衍生仅限既有 `*Weak` 先例公式。
6. **Toonflow 共存零破坏**：`/`、全局 SPA fallback（app.ts:238-252）、agent-sync 消费的 `/api/project/*` 全部不动；门户路由（/portal、/deliver、/toonflow、/canvas 重定向）注册在全局 fallback 之前。
7. **LOD/FITVIEW_MIN_ZOOM 不动**；zone 深链只经既有 viewport 机制（fitView/setCenter/focusAssetNodeId）。
8. **两维度色彩纪律**：门户/交付表面只出现 phaseGroup + gate 四态；场景维度色（VT_SCENE_COLORS）不得出现在本期任何表面。
9. **express 静态注入不得改写磁盘文件**：story-map/director-desk 的注入是响应期后处理（幂等、内存缓存），`data/web/` 磁盘内容不被服务进程修改。

---

## Design Decisions Log（auto 自主裁定；planner 不得重开已锁项，但可依新事实提请）

| # | 决策 | 理由 |
|---|------|------|
| U-01 | 门户挂 `/portal`；`/` 仍归 Toonflow（共存期零破坏）；终态接管 `/` 由 PORTAL-01 评估结论批准后另行执行 | D-01 混合路线的原型安全形态；全局 SPA fallback 与 agent-sync 旧链不断；root takeover 是独立可回滚动作 |
| U-02 | navbar = vanilla custom element 单源三宿主（React import ×2 + esbuild 产物注入） | 四岛共脸 + 静态站无 React 的事实约束；light DOM 让 token 级联，构建期 concat tokens.css 保 token 单源 |
| U-03 | 静态站注入 = express serve 时响应后处理（story-map + director-desk 的 index.html），deploy-story-map.sh 部署链不改 | director-desk 无部署脚本、story-map 每次 rm -rf 重部署——serve 时注入单点全覆盖且幂等；D-07 注入机制细节属 Claude's Discretion |
| U-04 | `/canvas` = express 302 参数翻译重定向（project→projectId、ep→episodesId、focus/zone 透传） | D-05 URL 契约对外稳定；画布本体挂载点 `/infinite-canvas/` 不动，重定向 10 行可回滚 |
| U-05 | 终审词汇 = 54 锁定词表（放行/驳回/豁免/等你决策）；需求 prose「通过/打回」映射之 | D-10 复用 54 通道则词汇同源；一套操作词汇跨 53/54/57 三处消费不漂移 |
| U-06 | 「G8」= gateCatalog `p13_delivery`（derivedGateId `p13-gate`，显示名「成片交付」；khs gates.yaml 注释 Gate 8: delivery） | G8 是 57 prose 简称；快照/门名表/操作通道都以 gateCatalog 为准 |
| U-07 | portal = 新 vite 包 `packages/portal`（base `/portal/'` 绝对路径，因 /deliver 在前缀外），构建产物 `data/web/portal/`；经 monorepo alias 复用 tokens/UiIcon/canvasApi/mediaUrl/phaseRegistry | D-02 不另起部署单元；跨包相对路径 import 是仓内既有先例（import-from-dir.ts:81、infinite-canvas vite alias） |
| U-08 | 管线带数据 = canvas/projects.ts 增量扩展（episodes[].phases 直方图；canvas_nodes.phase_index 列已存在） | 零新路由零新表；additive 字段不破坏 ProjectSelector 既有消费 |
| U-09 | 集行动作用 ghost 按钮；冷白 accent 只留 5 处 reserved | 行内主按钮×N 行 = 全页噪音；动线主 CTA 是「进入画布的路径本身」（行点击/管线带点击都是入口），不需要每行一个亮块 |
| U-10 | 交付页零新建后端：load-v2 + gate-state + projects 三个既有端点组页 | D-11 契约透传 = canvas_sync→save-v2 的 p13 节点（canvasAssetSchema 契约面）；结构化 delivery-package envelope 属 53 Wave B，本期不做 |
| U-11 | 管线带命名「管线带」；22 段 sortKey 序、sub 段 60% 高；点击段 = zone 深链 | 「管线」是仓内既有词汇（管线图/管线视图）；段几何编码主从真相；把 PORTAL-02 做成可见 affordance |
| U-12 | 交付清单类型徽章 = 成片/交付包/质检报告（对齐 p13 OUTPUT_SLOTS master-mp4/delivery-package/master-qc + assetManagerData 既有 subtype 词汇） | 与资产中心既有交付分组词汇同源，不发明第四套 |

---

## Checker Sign-Off

- [x] Dimension 1 Copywriting: PASS（交付 vernacular 全中文；54 词表同源映射显式记录；空态/失败态给方向）
- [x] Dimension 2 Visuals: PASS（收片人动线 hero→清单→终审；navbar 克制可注入；签名元素唯一且数据为真）
- [x] Dimension 3 Color: PASS（token-only；accent reserved 5 处穷举；两维度纪律；gate 四态 54 原样）
- [x] Dimension 4 Typography: PASS（t1..t4 原档；400/600 两档；mono 规则）
- [x] Dimension 5 Spacing: PASS（4 倍数标尺 + 既有例外值声明；28px 行高下限延续）
- [x] Dimension 6 Registry Safety: PASS（零新增依赖；router/UI/iframe 库默认不引入）

**Approval:** passed（2026-08-22，goal-backward 自检同轮完成——见 57-08 与各 plan must_haves）
