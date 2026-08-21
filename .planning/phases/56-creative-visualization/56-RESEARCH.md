# Phase 56: 创作环节可视化 (Creative Visualization) - Research

**Researched:** 2026-08-22
**Domain:** React Flow 画布前端（packages/infinite-canvas）+ kap socket/桥少量后端（src/）＋khs 契约只读对照
**Confidence:** HIGH（纯代码库研究——所有关键结论直接读源码验证，含 khs 侧 gates.yaml / p10c / p07 / p04 只读取证；零新依赖）

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** ScoreRadar 留详情面板 + 新增节点 hover mini-radar popover；雷达不复制造轮（既有纯 SVG 组件直接复用）
- **D-02:** verdict 角标 = 眼/耳图标 + pass(绿)/fail(红)色环，落四角角标系统左下 verdict 位（与 stale 琥珀三角共存规则 planner 定）；hover tooltip 维度分明细
- **D-03:** 刷新链 = socket `node:state` scored 事件驱动（51 已修 canonical 回写），角标从 store 派生自动刷
- **D-04:** verdict 角标 L1 起显示、L0 不渲染（93 镜性能），与 LodProvider 消费模式一致
- **D-05:** 组视图 = 全屏组视图剧场（变体墙 53 同族范式），双击组/角色节点开全屏
- **D-06:** turnaround = 2×2 + 同步缩放 + 中间参考图/角色名/一致性分
- **D-07:** 场景画廊 = 主图 + 缩略行（多视角 top-down/front/side/rear），与 2×2 同容器不同布局
- **D-08:** voice_profile 试听 = 卡上 mini（点即播）+ 组视图/详情完整播放器（波形+时长）
- **D-09:** G16 = 审核剧场变体：左配音条目列表 + 右波形+转写对照+verdict + 底部批量动作；列表主导
- **D-10:** 对照布局 = 时间轴对齐双轨（波形上/转写分句下/共享光标；点句跳播；与 53-D06 同播走带呼应）
- **D-11:** 批量豁免复用 G15 操作桥 waive 通道（同一 bridge action，不同 gate 目标）
- **D-12:** 连续播放 + 键盘（空格播停/→下条），与 53-D20 键盘流一致
- **D-13:** verdict 真值 = socket scored payload + node 持久化；角标/工作台都从 store 派生；单一链路
- **D-14:** 维度口径数据驱动不硬编码（来自 aiScore.dimensions；契约测试保 p03/p14 维度集）
- **D-15:** 维度中文文案 = kap 契约层映射表（未知维度回退英文原名）
- **D-16:** turnaround 一致性分从 khs turnaround-ssim 工件透传展示，平台不计算

### Claude's Discretion（本研究已逐项裁决，planner 采纳）
- hover popover 触发延迟/定位 → **250ms 触发 / 100ms 消失 / 上方优先下方兜底 / pointer-events:none**（UI-SPEC §2）
- verdict 位与 stale 同角共存 → **stale 贴角不动，verdict 环右移 tri+4px 同带横排；无 stale 时同位稳定**（UI-SPEC §1）
- 波形实现 → **轻量自绘 canvas：AudioContext.decodeAudioData 真实峰 + 伪波形兜底；否决 wavesurfer**（零新依赖）
- 转写分句对齐来源 → **p10c transcript 无时间戳（RESEARCH §G16 证据），等时分布近似对齐 + UI 注记**（诚实呈现，不假精确）
- TheaterShell 抽取时机 → **抽最小壳（两个新消费者成立），53 VariantWall 不迁移**（UI-SPEC §3）

### Deferred Ideas (OUT OF SCOPE)
None — 讨论未超出 phase 范围。
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VIZ-01 | p03 5-dim / p14 8-dim 雷达图；qwen-eye/qwen-ear verdict 角标直贴资产节点（消费 socket scored + aiScore 契约），分数更新后实时刷新 | ScoreRadar 现状全查（§雷达）；**scored 事件客户端死信缺口**（§Critical Gap 1，必须修）；verdict 数据源两条链（§Critical Gap 2） |
| VIZ-02 | 角色 turnaround 四视图同屏、场景多视角画廊、voice_profile 试听内嵌 | 剧场范式全查（§剧场）；turnaround/scene/voice 三类数据形状与缺口（§组视图数据） |
| VIZ-03 | G16 配音审核工作台：波形 + 转写对照 + 逐条试听 + 批量豁免 | voice-audit 同步链 + clips 记录形状（§G16）；waive 桥 gate 参数化缺口（§Critical Gap 3）；波形/分句引擎落点（§G16） |
</phase_requirements>

## Summary

Phase 56 是纯 kap 侧（packages/infinite-canvas 为主 + src/ 的 socket 消费与 g15Bridge 扩展）前端可视化 phase，零 khs 修改（契约只读对照）。最重要发现：

1. **scored 事件在客户端是死信（D-03 前提部分不成立，必须先修）**：服务端 `src/routes/canvas/review/score.ts:110-114` 广播 `node:state {nodeId, state:'scored', aiScore}`，但客户端 `normalizeSocketNodeState`（`canvasStore.ts:396-413`）的合法集里没有 `'scored'` → 返回 null → `applySocketNodeState` 走 `console.warn` 丢弃分支（`canvasStore.ts:708-713`）；且即便归一，现有实现只写 `state` 不写 `aiScore`；`useCanvasSocket.ts:152` 的 payload 类型也没有 aiScore 槽位。**VIZ-01 的"实时刷新"必须以 56-01 接通此链为前置**（'scored' 独立分支 + aiScore 经 applyGraphTransform 落 canonical，不触碰 state/stale——52-01 语义）。
2. **verdict（眼/耳 pass/fail）没有 per-asset 直接字段，但有一条可派生的单一真值链**：qwen-eye/ear 判定以结构化审计节点落画布——p10c `("voice-audit","语音审计","script",True)`（`canvas_sync.py:3614-3621`）、p11c `("video-qc",...)`、p11a `("preview-qc",...)`；per-clip 记录 `{id, shot_id, path, transcript, verdict(PASS/WARN/FAIL), similarity, reason, dims}`（`p10c_voice_audit.py:588-598`）。派生 selector：审计节点 raw 袋 × shot_id join 资产节点 → `Map<nodeId, {judge,verdict}>`，纯 store 派生、防御式形状匹配（与 D-13 单一链路一致；khs 未来若直写字段可无缝短路）。
3. **剧场家族范式完整可直接续建**：VariantWall 532 行（壳/头栏/N-up/胶片条/键盘/自愈全在）+ `wallTransport`（rAF 主时钟 + 120ms 硬 seek + UI 镜像 ~15fps 节流）+ `useWallKeyboard`（window keydown + enabled 门控 + ref 转发）+ `variantPickerStore`（wall 态协议）。56 的 TheaterShell/组视图/G16 全部有精确同族先例；`healThumb.ts` 三段自愈可复用于组视图图片。
4. **G16 数据链比预期顺**：G16 = `p10c_voice_audit` gate（`gates.yaml:316-334`，`p10c-gate`，中文「配音审听」，`gateCatalog.ts:112/133`）；voice-audit 已同步为画布 script 节点；音频可播（DialoguePanel 内联回放先例 + media.waveform 字段存在于 V3 schema `flowgraph-v3/ts/src/types.ts:79`）。**缺口仅在 waive 桥的 gate 目标硬编码**（`g15Bridge.ts:93` "G15 = p11c-gate"）——加可选 gate 参数（默认 p11c-gate 不变）即得 G16 通道。
5. **组视图三布局的数据形状确认**：turnaround 四视图 = khs p04 `l1_anchors[].crops`（front/three_quarter/side/back 四命名视图，`p04_character_design.py:87-89,109-171`）+ kap asset schema 已有 `views`/`turnaround_path` 可选字段（`canvasAssetSchema.ts:91-93`）；场景多视角 = p07 `{scene_id, views:{front,angle_left,angle_right,...}, path}`（`p07_scene_generation.py:450-463`，**实际 key 集与需求文案的 top-down/front/side/rear 不完全一致 → D-14 数据驱动渲染 + 中文映射回退是正解**）；音色 = voice_profile（音色总谱）+ voice_print（声纹）双形态（`assetManagerData.ts:348,371,462-491`），CharacterWardrobe 已有 `buildTurnaroundGrid` 2×2 四宫格视角映射先例（`CharacterWardrobe.tsx:86-92`）可直接平移。

---

## §雷达（VIZ-01 D-01/D-14/D-15）

- **ScoreRadar 就位且可缩放复用**：`packages/infinite-canvas/src/components/panel/ScoreRadar.tsx:19-23` props `{aiScore, size=200}`——size 是现成 prop，mini popover 传 128 即用，**零修改**。N 维自适应（≥3 成图，L43-57）、hover tooltip（L166-193）、dataviz 纪律注释（L10-11「文本一律走 text token，颜色只落在标记上」）。
- **消费方现状**：`NodeDetailPanel.tsx:540-570` ScoreSection（≥3 维雷达 / <3 维退 DimBar / 无 score 不渲染）；`ScoreMiniBar.tsx`（L2 近景卡底迷你条，dimensions 任意维）。
- **aiScore 形状**：`types/canvas.ts:38-41` `AIScore { overall: number; dimensions?: Record<string, number> }`；flowgraph-v3 zod 镜像（`flowgraph-v3/ts/src/zod.ts` aiScore 段）。`canvas_nodes.aiScore` 独立列持久化（`types/canvas.ts:310` 注释「经 store 往返不丢」）——56-01 canonical 写入后既有 save 链路天然持久化。
- **维度词汇（映射表素材，D-15）**：
  - p03 5 维：`p03_script_audit.py:9`「4-dimension audit (drama / rhythm / character / …)」+ `reversal_depth`(D6)/`social_resonance`(D7)（L77-98）；总分门聚合 5 维（scoring-gates.md:20-21）。
  - p14 8 维：`p14_quality_audit.py:1022-1028` hook_quality / narrative_design / shot_breakdown / scene_planning / character_consistency / audio_voice / visual_rendering /（第 8 维 master 整体项，同文件 L18 "8-dimension scoring"）。
  - 评分量纲两代并存：53 契约 `candidateScoreSchema.scale: "unit"|"percent"`（`candidateEnvelope.ts:52-60`）——ScoreRadar/toUnit 已做 0-1 钳制（L27-30），p14 若透传 0-100 需在 56-01 消费侧按 scale 归一（candidateEnvelope 已有先例）。
- **映射表落位（P8 纪律）**：包内手写镜像（g15TriageStore.ts:55-74 classifyG15 与 53-01 同特征表手写同款先例），放 `packages/infinite-canvas/src/utils/`；契约测试钉 khs 侧词汇（verify:phase-56）。

## §Critical Gap 1 — scored 死信链（VIZ-01 前置）

| 环节 | 现状 | 证据 |
|---|---|---|
| 服务端发射 | ✅ 已发射 | `src/routes/canvas/review/score.ts:107-117` `broadcastToProject(projectId, "node:state", {nodeId, state:"scored", aiScore: score})` |
| socket 类型 | ❌ 无 aiScore 槽 | `useCanvasSocket.ts:152` payload 类型 `{nodeId; state: NodeState; progress?}` |
| 归一 | ❌ 'scored' 不在合法集 | `canvasStore.ts:396-413` normalizeSocketNodeState 只认 pending/running/success/failed/error/skipped/cached/idle → null → `canvasStore.ts:708-713` warn 丢弃 |
| canonical 写 | ❌ 只写 state 不写 aiScore | `canvasStore.ts:715-737` applyGraphTransform 只改 `state`/stale |
| NodeState 类型 | 无 'scored' 枚举 | `types/canvas.ts:22`（'idle'|'pending'|'running'|'success'|'error'|'skipped'）——**不该加**：scored 非执行态，硬塞会污染 52-01 stale 语义 |

**修法（56-01）**：'scored' 独立分支——socket 层 payload 加 `aiScore?`，store 层新增 `applySocketScored(nodeId, aiScore)`（applyGraphTransform 写 `asset.aiScore`，**不触碰 state 与 stale**：评分到达 ≠ 新事实产出）。归一函数不动（Do-Not-Regress 4）。诊断输出：grep 全仓 `'scored'` 仅服务端 5 处 + FeedbackPanel 局部变量（`FeedbackPanel.tsx:147`），客户端零消费——死信实锤。

## §Critical Gap 2 — verdict 眼/耳数据源（VIZ-01 D-02/D-13）

- qwen-ear verdict 产出方：khs `p10c_voice_audit.py`（fidelity/emotion/speaker 三档维度，L177；PASS/WARN/FAIL 三值，L356-361）；qwen-eye：p11c video-qc / p11a preview-qc / p03 视觉评分。
- **落画布通道**（已存在，无需 khs 改动）：`canvas_sync.py:3614-3621` p10c voice-audit → 单 script 节点「语音审计」（结构化透传 True）；p11c `("video-qc","视频质检","script",True)`（L3649 附近）；p11a preview-qc（L3638-3645）。前端已有节点 id 词汇先例：`pipeline/model.ts:589-591` `match: {phaseIndex:14, idIncludes:'video-qc'}`。
- **派生链（planner 采纳）**：`qcVerdict.ts` 纯 selector——扫 graph script 节点（raw 袋防御式识别 voice-audit/video-qc/preview-qc 形状）→ per-clip/per-shot verdict 列表 → 按 shot_id join 资产节点 → `Map<assetNodeId, {judge:'eye'|'ear', verdict:'pass'|'warn'|'fail'}>`（同节点眼+耳可共存）。兜底短路：资产 raw 袋若已有 `qc_verdict`/`verdict` 直读字段则优先（khs 未来直写的演进位）。
- 持久化语义（D-13「落 node 持久化」）：aiScore 走 scored 修复链（Gap 1）；verdict 为派生值不落库（单一真值 = 审计节点，避免双写漂移）——与 53「canvas 为真值源」同构。

## §Critical Gap 3 — G15 桥 gate 目标硬编码（VIZ-03 D-11）

- 桥现状：`src/lib/g15Bridge.ts:66` `dispatchG15Op({projectId, episodesId, action, shotIds})`；L93 注释「G15 = p11c-gate」——gate 目标写死。
- 路由现状：`src/routes/canvas/v2/g15-ops.ts:23` body `{projectId, episodesId, action:"waive"|"requeue", shotIds}`，zod `action` 枚举 L30；桥失败入 `canvas_writeback_queue` 重放（L43-51, L80-81）。
- **修法（56-05）**：三层各加可选 `gate` 参数（zod `.optional()` 缺省 `"p11c-gate"`）——route schema → dispatchG15Op → reviewBridge approve-with-comment 目标；G16 传 `"p10c-gate"`。重放队列 payload 兼容（旧行无 gate 字段 = 缺省，天然回放正确）。**G15 既有调用零改动**（缺省值 = 现行为）。
- G16 gate 事实核对：`gates.yaml:316-334` `p10c_voice_audit`（blocking，editor，asset_bus_slots_to_lock: voice-audit）；`gateCatalog.ts:112` 快照 + L133 `"p10c-gate": "配音审听"`；`gateStateService.ts`/`gateStore.ts`（54 期）已建 gate 状态模型——G16 行动作位是 GateCenterPanel 既有扩展点（`GateCenterPanel.tsx` 头注释「可被 G15 工作台内嵌」同位）。

## §剧场（VIZ-02 D-05 + TheaterShell 裁定）

- **VariantWall 全范式**（`variants/VariantWall.tsx`）：壳 L285-294（fixed inset-0 zIndex:40 + `theme.chrome.lightboxOverlay` + blur(2px) + 背板点击关）；头栏 L296-339（bg.panel + border + btnStyle/closeBtnStyle L519-531）；N-up L342-401；胶片条 L404-449；检视详情行 L451-494。挂载 `FlowCanvas.tsx:1111`。
- **wallTransport**（`wallTransport.ts`）：rAF 主时钟唯一真值（L86-97 不回读 currentTime）、120ms 硬 seek（L36）、solo 静音（L103-107）、stall 全场停（L77-84）、UI 镜像 rAF ~15fps 节流（VariantWall L152-168）——G16 共享光标/连续播放直接取同手法（单 audio 元素比多 video 简单，不引 transport 本体）。
- **useWallKeyboard**（`useWallKeyboard.ts:31-77`）：window keydown + enabled 门控 + handlers ref 转发只挂一次 + cleanup——G16 新 hook 同范式改键位表（空格/→/←/Esc，数字键不占用）。
- **healThumb**（`healThumb.ts`）：onError → 一次性 POST /api/canvas/v2/thumbnail（仅 /oss/ 白名单）→ 换 URL → emoji 占位；组视图图片兜底复用，**不改本体**。
- **变体组数据通道**：`store/variantOps.ts`（findVariantForNode/getVariantMemberNodes/nextReviewGroup）；`variantPickerStore.ts` wall 态协议。
- **双击现状（CONTEXT 待核实项，已核实）**：`FlowCanvas.tsx:547-553` 双击 = setSelectedNode + setDetailNode（开详情面板）；`zoomOnDoubleClick={false}` 已设（L549 注释）。**D-05 落地裁定**：双击 character/scene/voice_profile 类资产改开组视图剧场，其余节点双击语义不变；剧场内「节点详情」按钮保闭环（UI-SPEC §4）。
- **TheaterShell 裁定依据**：56 有两个新全屏剧场消费者（组视图 + G16）→ 抽最小壳（overlay/头栏/三通道关闭/btn 词汇）；VariantWall 不迁移（Do-Not-Regress 6）。

## §组视图数据（VIZ-02 D-06/D-07/D-08/D-16）

- **turnaround 四视图**：khs p04「4 views (front / three_quarter / side / back) via turnaround sheet method (single image → crop)」（`p04_character_design.py:87-89`）；`_validate_4d_anchor_views` L109-171（crops 里的 4 命名视图校验）；`turnaround_sheet`/`turnaround_path` 字段 L294。kap 接收侧 `canvasAssetSchema.ts:91-93` 已有 `views: array<string>` + `turnaround_path` 可选。前端 2×2 先例：`CharacterWardrobe.tsx:86-92` buildTurnaroundGrid（byAngle Map + face_cu 优先 + 空格占位）——直接平移成画布剧场版。
- **一致性分（D-16）**：ssim 工件在 p04（`grep ssim` 命中 `p04_character_design.py`）；透传展示位 = raw 袋 ssim/consistency 字段（防御式读，无则不渲染该 chip——**不计算**）。
- **场景多视角**：p07 输出 `{scene_id, views:{front, angle_left, angle_right,...}, path}`（`p07_scene_generation.py:450-463`，views dict 有啥列啥）；kap asset schema `scene_id` 可选字段在列（`canvasAssetSchema.ts:90`）。需求文案的 top-down/front/side/rear 与实际 key 集不完全一致 → **数据驱动 + 中文映射回退**（UI-SPEC 视角词表）。
- **voice_profile 试听**：双形态 `voice_profile`（音色总谱）/`voice_print`（声纹）（`assetManagerData.ts:348,371,462-491`；中文名/emoji 词表 L1383/L1430）。音频播放在仓内三先例：① `DialoguePanel.tsx:146-215` DialogueRow 内联回放（audio ref + 进度 + 时长 + seek 比例点击）——完整播放器直接同构；② `AssetCardNode.tsx:438-486` WaveformCover（pseudoWaveform id 哈希 24 柱 + ▶ toggle + new Audio()）——mini 播放键同款；③ `NodeDetailPanel.tsx:291-296` 详情 `<audio controls>` + media.waveform 图。**真实波形**：V3 media schema 有 `waveform: string|null`（`flowgraph-v3/ts/src/types.ts:79`）但多数节点空 → 自绘引擎（decodeAudioData 真峰 + 伪波形兜底）是唯一零依赖路径（REQUIREMENTS Future「真实音频波形」deferred 项的轻量落地，不越界做服务端峰值预生成）。
- **组员推导落点**：变体组走 graph.variantGroups；character/scene 走 raw `characterId`/`scene_id`/label-base 同族 + global 域；voice 走 voice_profile + 同 characterId voice_print。先例：`assetManagerData.ts` groupCharacterIdentities/groupCharacterCostumes（CharacterWardrobe.tsx:32-33 消费）——语义平移为纯函数 + 单测。

## §G16（VIZ-03 D-09/D-10/D-12）

- **审计记录形状（权威）**：`p10c_voice_audit.py:588-598` `rec = {id, shot_id, path, transcript, verdict, similarity, reason, dims}`；audit 顶层 `{phase, findings[], critical_count, warning_count, total_clips, empty_text_count, pass}`（canvas_sync.py:3614-3619 注释钉死）。dims 可含 emotion/speaker 判定（L468-511）。
- **transcript 无时间戳**（Discretion 项裁决依据）：全文件 grep 无 segment/start/end 时间字段——分句等时近似对齐 + UI 注记（UI-SPEC Copywriting）。
- **音频源**：p10 产 `{shot_id}.wav`（p10c L683 注释）；画布音频节点 filePath + resolveMediaUrl（`mediaUrl.ts:89-101`，/oss/ 与绝对路径双通道）。
- **连续播放**：单 `<audio>` 元素逐条换 src，onended → 下一条（跳过已豁免）；与 53-D17「审完不关、载下一个」精神一致但列表主导（D-09）。
- **键盘**：useWallKeyboard 范式新 hook（§剧场）；键位 空格/→/←/Esc（D-12），与 53-D20 家族一致（数字键/Enter 有选定语义，G16 无选定不占用）。
- **G15TriagePanel 全套可平移**（`g15/G15TriagePanel.tsx`）：行勾选状态机 + sticky 动作条 + 乐观 rowState + 回滚 toast（L72-86）+ 「已豁免」行标（L213-216）+ Esc 关（L60-65）——G16 工作台批量语义同构，差异仅在数据源与右栏双轨。

## Pitfalls

1. **scored 修复不得走 normalizeSocketNodeState**：'scored' 塞进归一表会把它映射成执行态污染 stale 语义（52-01 只授权 running/success 清 stale）——独立分支（Do-Not-Regress 4 已锁）。
2. **p14 量纲**：p14 0-100 百分制 vs aiScore 0-1——消费侧按 scale 归一（candidateScoreSchema 先例），雷达 toUnit 只钳制不缩放，直接喂 78 会画出满环。
3. **审计节点形状漂移**：voice-audit/video-qc 的 raw 袋形状无 zod（canvas_sync 结构化透传而非 envelope）——防御式解析（never-throws，识别不了 = 空列表 + console.warn），fail-soft。
4. **93 镜性能**：verdict selector 在每次 graph 变更重算——memo 化（audit 节点集稀疏，实际 ≤ 3 节点 × ~90 clip）；popover 单例天然安全；G16 列表虚拟化不做（单集 ≤ ~100 条，行高 28px 内滚即可，与 G15 同规模）。
5. **双击改道回归面**：REGEN-04 面板跟随 + navHistory.push 双击链——改道仅限三类资产节点，判定条件用 raw 袋 assetType/metaSub（assetManagerData isAssetTypeIconKind 同款防御），不命中走原路径零改动。
6. **浏览器自动播放策略**：连续播放链 onended→play() 属用户手势链路内（首次点击后），但 pause 后再连播需用户再触发——连播 toggle 首次开启由点击/键盘手势驱动，满足 Chrome autoplay 策略。
7. **AudioContext 解码大文件**：93 × 数秒 wav 逐条 decode——只在条目被选中时懒解码一次 + 缓存 peaks；解码失败静默退伪波形（永不阻塞播放）。
8. **gate 参数重放兼容**：writeback_queue 旧行无 gate 字段——缺省 p11c-gate 与历史行为一致，无需迁移（Gap 3 修法已含）。

## Assumptions Log

| # | Assumption | 风险 | 验证方式 |
|---|---|---|---|
| A-1 | voice-audit 节点 raw 袋含 clips[]（canvas_sync 结构化透传） | 中——若 canvas_sync 截断 payload，clips 可能缺 | 56-04 防御式解析 + fixture 对齐 p10c 真实形状；真机 UAT 核对（VERIFICATION 项） |
| A-2 | turnaround crops/views 已随资产节点同步（views/turnaround_path 字段） | 中——存量角色节点可能只有整图 | 组视图空格占位（buildTurnaroundGrid 同款）+ 整图兜底显示 |
| A-3 | G16 波形自绘满足审片需求 | 低 | HUMAN-UAT 听审走查；伪波形兜底永不空白 |
| A-4 | scored 事件在真实评分流中仍在发射（score.ts 是唯一发射点） | 低——kap 内 ai-scorer 路径活跃 | verify:phase-56 断言客户端链路；真机触发一次评分核对 |

## Open Questions（planner 已裁决项汇总）

None blocking——CONTEXT 五项 Discretion 全部在本研究裁决并入 UI-SPEC（见 <user_constraints> Discretion 段）。
