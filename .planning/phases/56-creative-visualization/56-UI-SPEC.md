---
phase: 56
slug: creative-visualization
status: approved
shadcn_initialized: false
preset: none
created: 2026-08-22
reviewed_at: 2026-08-22
---

# Phase 56 — UI Design Contract（创作环节可视化）

> Visual and interaction contract. Generated inline per gsd-ui-researcher flow, verified per gsd-ui-checker 6 dimensions.
> 本期主 UI：VIZ-01 verdict 角标 + hover mini-雷达、VIZ-02 全屏组视图剧场（turnaround 2×2 / 场景画廊 / 音色试听）、VIZ-03 G16 配音听审工作台。
> 本期所有新表面与 53 变体墙同属**剧场家族**——同一暗色剧场容器语法、catppuccin token、一处签名元素。

---

## Design System

| Property | Value |
|----------|-------|
| Tool | **none**（shadcn gate 维持 55 期裁决：`components.json` 不存在；用户指令「复用既有 catppuccin 体系，不发明平行色板」继续锁死 → 不初始化） |
| Preset | not applicable |
| Component library | none — inline styles + `theme`/`v3theme`（catppuccin.ts）+ `--cv-*` CSS vars 是仓库惯例（VariantWall / G15TriagePanel / GateCenterBlock 全部此模式） |
| Icon library | 仓内 `components/canvas/icons.tsx`。本期新增 `eye` / `ear` 两个 kind（stroke=currentColor、size 12、同一几何风格内联追加），不引外部图标库；emoji 仅沿用剧场家族既有用法（🎬🎵🖼 占位、头栏装饰），不新增 emoji 语义位 |
| Font | `--cv-font-ui`（Inter + Noto Sans SC）/ `--cv-font-mono`（shot_id、seed、similarity、分数、视角 key） |
| Token 真相源 | `packages/infinite-canvas/src/theme/catppuccin.ts`（`v3theme`/`theme`）+ `theme/tokens.css`。**本期禁止新建任何色值/字号/间距常量——一切引用现有 token** |
| 新依赖 | **零**。波形 = 轻量自绘 canvas（`AudioContext.decodeAudioData` 取峰 + 伪波形兜底），明确否决 wavesurfer 等库（bundle 约束 + CONTEXT Discretion 裁定） |

---

## Spacing Scale

沿用 55 期声明值（全部 4 的倍数）＋**剧场家族既有节奏**：

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | 角标同角共排间隙（stale 三角 ↔ verdict 环）、icon-文字间隙 |
| sm | 8px | 列表行内距、缩略行卡距、popover 与锚点距离 |
| md | 16px | 面板/剧场头栏左右内距（`--cv-panel-pad` 既有） |
| lg | 24px | 分区间隔、工作台分区 |
| xl / 2xl | 32/48px | 剧场主区外距、空态卡内距 |

**剧场家族 chrome 例外（grandfathered，新剧场表面沿用不求新）**：VariantWall 既有节奏 10px（头栏上下）/ 12px（N-up gap、主区内距）——56 的 TheaterShell/组视图/G16 工作台 chrome 沿用同值保持家族一致；非剧场新表面（角标/popover）不得使用。其余例外（2px hairline / 28px 交互行高）沿用 55 期声明。

93 镜约束：G16 左侧条目列表 `min(380px, 30vw)` 内滚动、行高 28px 起步；hover popover 全局单例；组视图缩略行横向滚动。**禁止 93 行平铺无滚动列表。**

---

## Typography

严格复用 `--cv-fs-t1..t4`，权重只有 400 + 600 两档：

| Role | Size | Weight | Line Height | Token | 用途 |
|------|------|--------|-------------|-------|------|
| Heading | 14px | 600 | 1.2 | `--cv-fs-t1` | 剧场头栏标题、工作台分区标题 |
| Body | 12px | 400 | 1.6 | `--cv-fs-t2` | 转写句、prompt、说明文案 |
| Label | 11px | 400 | 1.4 | `--cv-fs-t3` | 列表行、缩略卡标签、维度行 |
| Micro | 10px | 400 | 1.4 | `--cv-fs-t4` | 计数、similarity、键位提示、kbd |

- 一切 ID/数值（shot_id、seed、similarity、一致性分、视角 key）一律 `--cv-font-mono` + tabular-nums。
- 文案全中文（审片行话），维度/视角名走 56-01 中文映射表，未知回退英文原名（D-14/D-15）。

---

## Color

延续「冷中性壳 + 暖模态通道」。剧场家族底 = `theme.chrome.lightboxOverlay`（rgba(0,0,0,0.85)）+ blur(2px)，头栏/动作条 = `theme.bg.panel` + `theme.border.default`（VariantWall 同款）。

**verdict 语义色（D-02，全部复用 signal token，零新色值）：**

| 结果 | Token | Value | 环样式（形＋色双编码） |
|------|-------|-------|------------------------|
| PASS | `v3theme.signal.approved` | #56B89A | 1.5px 实线环 |
| FAIL | `v3theme.signal.rejected` | #DD6A82 | 1.5px 实线环 + 外扩 2px 同色 40% 静态光环 |
| WARN | `v3theme.signal.running` | #E0B665 | 1.5px 虚线环（dashed） |

- 眼/耳 glyph 本体 `theme.text.primary`，底 `var(--cv-bg-overlay)`——**judge 身份绝不走颜色**（颜色通道只编码结果，dataviz 单通道纪律；身份由 glyph 形状承载，色盲可达）。
- 波形：已播柱 `v3theme.modality.audio` 全不透明、未播柱同色 opacity 0.35、共享光标 1.5px `--cv-select` 冷白。
- 同步缩放聚焦格描边 `v3theme.signal.select`；一致性分数字按 `getScoreColor`（既有阈值，不新算）。
- Accent（#EDEEF1 冷白）reserved for（穷举）：① G16 当前播放条目行（左 2px 实线 + 弱底）；② 双轨共享光标；③ 同步缩放 hover 聚焦格描边；④ 连播 toggle 激活态；⑤ 剧场头栏主按钮（「批量豁免」按 G15 惯例保持默认 btn 样式——冷白不落在批量动作上，防误触）。`focus-visible` outline 规则不动。

---

## Signature Element

**剧场家族签名（53 已立）：共享主时间轴。** 56 三个新表面各持一处、且仅一处记忆点：

1. **VIZ-01**：hover mini-雷达 popover——既有 ScoreRadar 缩小直出（128px），分数即图、不占常驻面积（D-01「93 镜不占常驻面积」的直接表达）。角标/Popover 其余视觉安静。
2. **VIZ-02**：turnaround **同步缩放**——四视图一条缩放比例，wheel 任一格全格缩放（一致性审看的核心手势）；场景画廊/音色试听无第二记忆点。
3. **VIZ-03**：**时间轴对齐双轨**——波形在上、转写分句在下、一条共享光标贯穿两轨（CONTEXT specifics 点名的 56 签名元素候选，采纳）。

反模板红线：审片工作台不是 dashboard——无图表墙、无渐变、无多余装饰；每个表面除签名元素外全部退到冷中性。

---

## Copywriting Contract（审片行话，全中文）

| Element | Copy |
|---------|------|
| G16 工作台标题 | 配音听审 · {episode 或项目名}（头栏；「听审」为 CONTEXT 钦定行话） |
| G16 条目行 | {shot_id}（mono）· {说话人} · {相似度 similarity×100 整数} · verdict 徽章（通过/留意/不过） |
| G16 主 CTA | **批量豁免**（底部动作条，与 G15 同词同语义） |
| G16 次 CTA | 重听（当前条目重播）/ 连播（toggle，激活态「连播中」）/ 上一条 ← · 下一条 → |
| G16 豁免成功 toast | 已豁免 {N} 条配音（沿用 G15 文法） |
| G16 豁免失败 toast（含回滚） | 豁免失败已回滚: {原因}（沿用 G15 文法） |
| G16 空态 heading | 本集暂无听审数据 |
| G16 空态 body | 运行 P10c 语音审计后，这里会按镜头列出全部配音条目与转录对照 |
| G16 分句近似对齐注 | 转写无时间戳，分句按等时近似对齐（10px tertiary，双轨区角标） |
| verdict 角标 tooltip | 眼审 通过 / 眼审 不过 / 眼审 留意 / 耳审 通过 / 耳审 不过 / 耳审 留意（+「维度分明细」入口语：点击节点看雷达） |
| hover popover 头 | AI 评分 · {overall×100}（mono 大字 + `/ 100`） |
| 组视图剧场头 | {角色名/场景名} · 组视图 · {N} 视图 / {角色名} · 音色试听 · {N} 条声纹 |
| 组视图入口 tooltip | 打开组视图剧场 |
| 同步缩放控件 | 同步缩放 ＋ / － / 复位（1.0×–4.0×，当前倍率 mono 显示） |
| 一致性分标签 | 一致性 {分×100}（mono；tooltip：turnaround-ssim 透传，平台不计算） |
| 场景视角名 | 正面 / 背面 / 左侧 / 右侧 / 俯视 / 3/4 侧（映射表覆盖，未知 key 回退英文原名，mono） |
| 音色试听 mini | 卡上 ▶（点即播，再点停；无文字标签，不进面板） |
| 音色试听完整播放器 | 声纹 {characterId} · {MM:SS} · ▶/⏸ + 可拖光标 |
| 剧场关闭 | ✕ + Esc + 点击背板（三通道，沿用墙习惯） |
| 剧场内详情入口 | 节点详情（开右面板，保住双击被改道后的详情可达性） |

时长格式 `4.5s` / `MM:SS` 沿用仓内既有；「检视」「选定」「下一镜」等 53 词汇在剧场家族内继续可用，不新造同义词。

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none | not applicable（未初始化） |
| third-party | none | 本期零新增依赖。**wavesurfer.js / peaks.js 明确否决**（Discretion 倾向轻量自绘 + bundle 约束）；若 planner 想引入任何包须回补 RESEARCH Package Legitimacy Audit——默认答案是「不引入」 |

---

## Component Inventory & Interaction Contract

### 1. verdict 角标（VIZ-01，NodeBadges 扩展）
- **落位（D-02 + planner 终裁）**：左下 verdict 带——stale 三角保持贴角（`left: off, bottom: off`，`V3_NODE_SIZES.badge = { dot:10, tri:14, offset:-6 }` 既有），verdict 环形角标排其右侧 `left: off + tri + 4px`（无 stale 时仍用同一偏移位，位置稳定不跳）；眼在前、耳在后，同带 gap 4px（xs）。
- **规格**：直径 10px 环（badge.dot），内嵌 eye/ear glyph（SVG，8px，text.primary），底 `--cv-bg-overlay`；环样式见 Color 表。
- **LOD（D-04）**：`lod === 0` 不渲染（NodeBadges 既有早返天然满足）；L1/L2 均渲染。
- **刷新（D-03）**：从 store 派生（56-01 scored 通道 + qcVerdict selector），socket scored 到达即重渲，无轮询。
- tooltip（native title，既有角标同款）：见 Copywriting 表。

### 2. hover mini-雷达 popover（VIZ-01，新 ScorePopover）
- **触发**：悬停资产卡任意区域 ≥250ms 且 `aiScore.dimensions ≥3`；离卡 100ms 消失（防抖）；全局单例（hover 天然单例）；LOD≥1 才触发（L0 无卡可悬停）。
- **形态**：锚卡片上方居中、距卡 8px（上方越界翻下方）；`--cv-bg-panel` 底 + `--cv-border-subtle` + `--cv-shadow-pop` + blur(4px)（SearchNavigator 浮层同语法）；`pointer-events: none`（不夺卡 hover、不与画布拖拽打架）。
- **内容**：ScoreRadar 原组件 `size={128}`（**零修改复用**）＋右侧维度行（中文维度名 label 11px + mono 数值 + `getScoreColor` 色点；≤8 行，超出截断 + 「…」）＋头部 overall 大字（Copywriting 表）。
- **性能**：93 镜 × 悬停单例 = 同时至多 1 个雷达在渲染；popover 不进 DOM 直到触发。

### 3. TheaterShell（新，剧场家族公共壳）
- 抽取时机裁定（CONTEXT Discretion）：56 有两个新剧场消费者（组视图 + G16），抽**最小壳**——`position:fixed inset-0 zIndex:40` + `chrome.lightboxOverlay` + blur(2px) + 头栏（bg.panel + border + 标题/控件位）+ ✕/Esc/背板三通道关闭 + btnStyle/closeBtnStyle 词汇。**53 VariantWall 不迁移**（零回归风险；注释标注未来收编点）。
- 子内容区 `flex:1 minHeight:0`，布局归各消费者。

### 4. GroupViewTheater 组视图剧场（VIZ-02）
- **入口（D-05 + planner 终裁）**：双击 **character/scene/voice_profile 类资产节点**（`assetType ∈ {character, scene}` 或 raw metaSub `voice_profile`，含变体组节点）→ 开剧场；**其余节点双击仍开详情面板**（REGEN-04 面板跟随语义不回归）。次入口：详情面板头「组视图」按钮。剧场内「节点详情」按钮开右面板（闭环可达性）。
- **组员推导（数据驱动）**：变体组 → `graph.variantGroups`；角色/场景 → raw 袋 `characterId` / `scene_id` / label-base 同族（global 域）；音色 → voice_profile 节点 + 同 characterId 的 voice_print。纯函数模块 + 单测。
- **turnaround 布局（D-06）**：2×2 网格（格 minmax(280px,1fr)，gap 12px）；每格 = 视图图（resolveMediaUrl）+ 角度标签（中文映射）；中央悬浮 chip（`--cv-bg-panel` 90% 不透明 + border）：参考图 48px + 角色名（t1）+ 服装套系名 + 一致性分（mono，D-16 透传展示）。**同步缩放**：四格共享 scale 1.0×–4.0×；wheel 任一格缩放全格（hover 格跟随光标、其余中心原点）；双击格复位；头栏 ＋/－/复位 + 当前倍率。wheel 即时无过渡（跟手），按钮/复位 120ms 过渡。
- **场景画廊布局（D-07）**：主图区（contain 大图 + 当前视角名 chip）+ 底部缩略行（高 64px 横滚卡：缩略 + 视角名 + 选中描边 select）；点缩略切主图。视角集数据驱动（p07 `views` dict 有啥列啥），不硬编码四视角。
- **音色试听布局（D-08）**：左列声纹卡（mini ▶ 点即播，不进面板；卡 = 角色名 + characterId mono + 时长）＋右侧完整播放器（波形 canvas 72px + 时长 + 播放/暂停 + 可拖光标；波形引擎与 G16 共用）。同一时刻至多一条声纹在播（点新卡停旧卡）。

### 5. G16VoiceWorkbench 配音听审工作台（VIZ-03）
- **形态（D-09）**：TheaterShell 审核变体——三栏：左条目列表（`min(380px,30vw)` 内滚，行 28px+：勾选框 + shot_id mono + 说话人 + similarity mono + verdict 徽章；当前播放行 accent 处理）｜右双轨区（签名元素）｜底部动作条（sticky：已选 N + 全选/清空/重听/连播 toggle/批量豁免）。
- **双轨（D-10）**：上轨波形 canvas（真实峰：`AudioContext.decodeAudioData` 自绘；解码失败/无音频 → 伪波形兜底并注记）＋下轨转写分句（12px，当前句 text.primary + 左 2px accent，其余 secondary；点击句按等时比例 seek）。**一条共享光标贯穿两轨**（rAF 节流 ~15fps，wallTransport UI 镜像同款手法）。对照原文（ground truth）在句下以 tertiary 10px 对照显示差异（相似度低时高亮该句）。
- **播放（D-12）**：连续播放（播完自动下一条、跳过已豁免；可暂停/跳过）+ 键盘：空格 播停 / → 下一条 / ← 上一条 / Esc 关（useWallKeyboard 范式新 hook，键位与 53-D20 家族一致）；数字键不占用（无 N take 语义）。
- **批量豁免（D-11）**：复用 `g15Ops` 桥，gate 目标参数化为 `p10c-gate`（同一 bridge action、不同 gate 目标；G15 默认值不变）。乐观 rowState → 失败回滚 + toast（G15TriagePanel 同构）；豁免轻操作免二次确认（沿用 53-07 planner 裁定）。
- **数据源**：voice-audit script 节点（canvas_sync p10c slot，raw 袋防御式解析 `clips[]`：id/shot_id/path/transcript/verdict/similarity/reason/dims）；音频路径经 resolveMediaUrl。
- **入口**：① GateCenterPanel 的 p10c-gate 行动作「打开听审工作台」（阻塞时主入口）；② 语音审计节点详情面板按钮。

### 6. scoreVocabulary 中文映射（56-01，契约伴生）
- 维度/视角/verdict 三张映射表（p03 五维、p14 八维、p07 视角 key、PASS/WARN/FAIL），包内手写镜像（P8 纪律，g15TriageStore classifyG15 同款），未知回退英文原名；契约测试钉 khs 侧词汇（khs 改维度不炸前端，D-14）。

---

## State Matrix

| Surface | States |
|---------|--------|
| verdict 角标 | 无 verdict（不渲染）/ 通过 / 不过 / 留意 / 眼+耳共存（横排）/ 与 stale 共存（stale 贴角 + verdict 右移） |
| ScorePopover | 关闭 / 延迟中(250ms) / 打开（≥3 维）/ 不足 3 维（不触发，退回角标 title） |
| GroupViewTheater | 关闭 / 打开-组员解析成功 / 解析失败（空态：「未找到同族资产」）/ 图片 404（onError 隐藏 + 模态 emoji 占位，墙同款）/ 同步缩放 1.0–4.0× |
| 场景画廊 | 单视图（缩略行不渲染）/ 多视图 / 主图切换中（120ms 淡切） |
| 音色试听 | 无声纹（空态）/ 播放中（mini ▶→⏸）/ 完整播放器 seek 中 |
| G16 工作台 | 空（无听审数据）/ 列表 / 播放中（光标走动 + 当前句高亮）/ 连播中（自动推进）/ 已豁免行（approved 弱化 + 「已豁免」标）/ 批量乐观中（rowState 先行）/ 回滚（error toast） |
| 波形 | 解码中（伪波形占位 + 注记）/ 真实峰 / 解码失败（伪波形 + 注记，永不空白） |

---

## Motion Contract

全部走既有 motion token：`--cv-e-out` 缓出、`--cv-d-panel 240ms`（剧场开关、popover 进出）、`--cv-d-select 120ms`（行 hover、主图切换、缩放按钮过渡）、fitView 600ms 不动。wheel 缩放与光标走动**零过渡**（rAF 直写，跟手优先）。`prefers-reduced-motion` 由 tokens.css 既有 media query 兜底。无新 keyframe（stale 脉动等既有动画不复用、不干扰）。

---

## Do-Not-Regress（执行器红线）

1. **LOD 本体不可动**：`useLod.ts` 阈值/迟滞/`FITVIEW_MIN_ZOOM=0.4`/LodProvider 单一订阅；verdict 角标只做 `lod===0` 早返消费侧扩展。tokens.css 的 `--cv-lod-*` 镜像漂移维持「以 useLod.ts 为权威、不顺手修」的 55 期裁决。
2. **NodeBadges 四角产权制**：左上策展/右上执行+score/右下 review 语义与位置不动；verdict 是左下带**新增成员**，不得挪动 stale 三角贴角位。
3. **ScoreRadar 零修改**：popover 以 `size` prop 复用原组件；不改其内部 token/几何/tooltip。
4. **socket 状态归一语义**：`normalizeSocketNodeState` 既有映射（error/skipped→failed、cached→success、idle→pending）与 52-01「running/success 清 stale、error 保留」规则不动；'scored' 走独立分支只写 aiScore、**不**触碰 state 与 stale。
5. **双击语义**：非 character/scene/voice_profile 节点双击开详情面板 + REGEN-04 面板跟随不回归；`zoomOnDoubleClick={false}` 既有设置不动。
6. **VariantWall 不改**：53 墙本体、selectWinner 链、transport、键盘流零改动；TheaterShell 是新文件非墙重构。
7. **G15 桥兼容**：`dispatchG15Op` 既有 G15 调用（默认 p11c-gate）行为不变；gate 参数纯增量，缺省值 = 现行为。
8. **G15TriagePanel / GateCenter**：既有面板视觉与嵌入位不动；G16 入口是 GateCenterPanel 的新增动作位。
9. **媒体 URL 一律 resolveMediaUrl**；缩略 404 兜底用剧场家族 emoji 占位（不引新自愈通道；组视图复用 healThumb 可选，不得改 healThumb 本体）。
10. **单一注册表**：phase/zone 词汇只从 22-phase 注册表读（55-D04）；scoreVocabulary 只管维度/视角/verdict 词，不复制 phase 词表。
11. **键盘焦点可见性**：`tokens.css` 末段 `:focus-visible` outline 保留；新交互元素全走 `<button>`；popover `pointer-events:none` 不抢焦点。
12. **零新依赖**：package.json 不动（含不装 wavesurfer/peaks/lame）。

---

## Checker Sign-Off

- [x] Dimension 1 Copywriting: PASS（审片行话全覆盖：听审/豁免/重听/试听/检视；空态/错误/toast 均给出且含下一步）
- [x] Dimension 2 Visuals: PASS（剧场家族同语言；三表面各一处签名元素；反 dashboard 红线成文）
- [x] Dimension 3 Color: PASS（verdict 三态全复用 signal token + 形色双编码；accent 冷白穷举 reserved-for；judge 身份不走颜色）
- [x] Dimension 4 Typography: PASS（t1–t4 + 400/600 两档 + mono 数值纪律；无新字号）
- [x] Dimension 5 Spacing: PASS（4 倍数刻度 + 剧场 chrome grandfathered 例外成文，不求新例外）
- [x] Dimension 6 Registry Safety: PASS（零新依赖；wavesurfer 显式否决）

**Approval:** approved 2026-08-22
