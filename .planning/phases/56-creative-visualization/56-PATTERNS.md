# Phase 56: 创作环节可视化 (Creative Visualization) - Pattern Map

**Mapped:** 2026-08-22
**Files analyzed:** 24 (new + modified)
**Analogs found:** 24 / 24（全部有精确或角色级 analog——本 phase 是「同族续建」，无范式空白）

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/infinite-canvas/src/hooks/useCanvasSocket.ts` (MODIFY — node:state payload 加 aiScore/verdict 槽 + onNodeScored 回调) | hook | event-driven (socket) | `useCanvasSocket.ts:152-159`（node:state/node:preview handler 签名与 callbacksRef 转发模式） | exact |
| `packages/infinite-canvas/src/store/canvasStore.ts` (MODIFY — applySocketScored canonical 写) | store | event-driven → canonical transform | `canvasStore.ts:715-737` applySocketNodeState 的 applyGraphTransform 写法 + `applySocketNodePreview` L739-757（只写单字段的同类） | exact |
| `packages/infinite-canvas/src/utils/scoreVocabulary.ts` (NEW — 维度/视角/verdict 中文映射 + 量纲归一) | utility (pure) | transform | `g15TriageStore.ts:55-74` classifyG15（包内手写镜像 root 契约特征表的 P8 纪律）+ `StoryboardTimeline.tsx` METADATA_LABELS 中文枚举表 | exact |
| `packages/infinite-canvas/src/store/qcVerdict.ts` (NEW — 审计节点→资产 verdict 派生 selector) | model (pure derivation) | transform (graph → Map) | `store/variantOps.ts`（纯函数图派生：findVariantGroupForNode/getVariantMemberNodes）+ `assetManagerData.ts` groupCharacterIdentities（同族 join） | exact |
| `packages/infinite-canvas/src/components/theater/TheaterShell.tsx` (NEW — 剧场家族公共壳) | component (chrome) | request-response | `variants/VariantWall.tsx:285-339`（壳/头栏/背板关/btnStyle 全套——壳代码从这里抽出，墙本体不迁移） | exact |
| `packages/infinite-canvas/src/utils/audioPeaks.ts` (NEW — decodeAudioData 真峰 + 伪波形兜底) | utility (pure, 注入 AudioContext/fetch) | file-I/O (媒体解码 → peaks) | `wallTransport.ts`（无 React 纯模块 + 依赖注入 + never-throws）+ `AssetCardNode.tsx:488-503` pseudoWaveform（兜底算法原样平移） | exact |
| `packages/infinite-canvas/src/utils/transcriptAlign.ts` (NEW — 分句 + 等时对齐) | utility (pure) | transform | `StoryboardTimeline.tsx` shotKey/frame 分段纯函数 + `g15TriageStore.ts` classifyG15（纯字符串特征 → 结构化输出） | role-match |
| `packages/infinite-canvas/src/components/canvas/icons.tsx` (MODIFY — eye/ear kinds) | component (icon) | static | `icons.tsx:101-162` AssetTypeIcon（SVG path 内联追加同几何风格 kind） | exact |
| `packages/infinite-canvas/src/components/badges/NodeBadges.tsx` (MODIFY — 左下 verdict 带) | component | transform (store-derived) | `NodeBadges.tsx:71-80` stale 三角段（同角新增成员的并行写法）+ L40-69 execBadge 色环/胶囊样式 | exact |
| `packages/infinite-canvas/src/components/badges/ScorePopover.tsx` (NEW — hover mini 雷达) | component (popover) | transform (store-derived) | `ScoreRadar.tsx`（size prop 直用）+ `canvas/SearchNavigator.tsx`（浮层语法：panel 底/shadow-pop/blur/非交互层） | exact |
| `packages/infinite-canvas/src/components/nodes/AssetCardNode.tsx` (MODIFY — 挂 ScorePopover) | component | event-driven (hover) | `AssetCardNode.tsx:261-263,294-298`（hoverTimer 200ms 延迟模式——视频 hover 内联播同款手法平移） | exact |
| `packages/infinite-canvas/src/components/theater/groupMembership.ts` (NEW — 组员推导纯函数) | model (pure) | transform | `store/variantOps.ts` + `assetManagerData.ts` groupCharacterCostumes（characterId 同族分组语义平移） | exact |
| `packages/infinite-canvas/src/components/theater/theaterStore.ts` (NEW — 组视图开关态) | store | request-response | `variants/variantPickerStore.ts`（open/wall 态 + close 清空——剧场开关态协议同款） | exact |
| `packages/infinite-canvas/src/components/theater/TurnaroundView.tsx` (NEW — 2×2 同步缩放) | component | request-response (viewport ops) | `CharacterWardrobe.tsx:86-92` buildTurnaroundGrid（2×2 四宫格视角映射）+ VariantWall N-up grid L342-346 | exact |
| `packages/infinite-canvas/src/components/theater/SceneGallery.tsx` (NEW — 主图+缩略行) | component | request-response | `VariantWall.tsx:404-449` 胶片条（缩略行/选中描边/横滚）+ NodeDetailPanel 大图区 | exact |
| `packages/infinite-canvas/src/components/theater/VoiceProfileBoard.tsx` (NEW — mini + 完整播放器) | component | event-driven (audio) | `assetManager/DialoguePanel.tsx:146-215` DialogueRow（audio ref + 进度 + 时长 + seek）+ `AssetCardNode.tsx:438-486` WaveformCover（mini ▶ toggle） | exact |
| `packages/infinite-canvas/src/components/theater/GroupViewTheater.tsx` (NEW — 三布局容器) | component | request-response | `variants/VariantWall.tsx`（全剧场组件结构：组解析 useMemo → 布局 → 键盘 → 关闭） | exact |
| `packages/infinite-canvas/src/components/FlowCanvas.tsx` (MODIFY — 双击路由 + 剧场挂载) | component | event-driven | `FlowCanvas.tsx:547-553` onNodeDoubleClick（路由分支插入点）+ L1111 `<VariantWall />` 挂载位 | exact |
| `packages/infinite-canvas/src/components/panel/NodeDetailPanel.tsx` (MODIFY — 组视图入口按钮 + 语音审计入口) | component | request-response | `NodeDetailPanel.tsx` 头栏按钮区（52-03 重生成按钮同位） | exact |
| `src/lib/g15Bridge.ts` (MODIFY — gate 参数化) | lib (bridge) | request-response (REST → kmc) | `g15Bridge.ts:66-100` dispatchG15Op 本体（参数对象扩展 + 缺省不变） | exact |
| `src/routes/canvas/v2/g15-ops.ts` (MODIFY — zod gate optional) | route | request-response | 本文件 zod schema L30（action 枚举旁加 optional 字段） | exact |
| `packages/infinite-canvas/src/services/canvasApi.ts` (MODIFY — g15Ops gate 形参) | service | request-response | `canvasApi.ts:483-495` g15Ops 签名 | exact |
| `packages/infinite-canvas/src/components/g16/voiceAuditStore.ts` (NEW — 数据源 seam + fixture + 行状态机) | store | request-response (graph 派生 + 桥乐观) | `g15/g15TriageStore.ts` 全文（G15Source seam/fixture/selected Set/rowState 乐观回滚——同构复制改数据形状） | exact |
| `packages/infinite-canvas/src/components/g16/useVoiceKeyboard.ts` (NEW — G16 键盘流) | hook | event-driven (keyboard) | `variants/useWallKeyboard.ts:31-77`（enabled 门控 + ref 转发 + cleanup；改键位表） | exact |
| `packages/infinite-canvas/src/components/g16/G16VoiceWorkbench.tsx` (NEW — 听审工作台) | component | event-driven (audio + socket-derived) | `g15/G15TriagePanel.tsx`（列表+动作条+乐观+toast）× `VariantWall.tsx`（剧场壳/走带镜像）杂交 | exact |
| `packages/infinite-canvas/src/components/gate/GateCenterPanel.tsx` (MODIFY — p10c-gate 行动作入口) | component | request-response | GateCenterPanel 既有 gate 行动作位（G15 内嵌同位，`GateCenterBlock.tsx` 头注释 D-13 seam） | exact |
| `scripts/verify-phase-56.ts` (NEW — 契约断言) | test | file-I/O (regex 断言) | `scripts/verify-phase-53.ts` / `verify-phase-55.ts`（root-script 聚合 + section 化契约组 + npm script 注册） | exact |
| `packages/infinite-canvas/test/e2e/tests/phase56-viz.mjs` (NEW — e2e 冒烟) | test | request-response | `test/e2e/tests/phase55-nav.mjs` + `phase52-regen.mjs` | exact |
| 各 `__tests__/*.test.ts`（scoreVocabulary/qcVerdict/socketScored/audioPeaks/transcriptAlign/groupMembership/voiceAudit） | test | transform | `store/__tests__/selectWinner.test.ts`（fixture graph 工厂 + vi.mock）+ `variants/__tests__/wallTransport.test.ts`（假元素注入驱动） | exact |

## Pattern Assignments

### 1. canvasStore.applySocketScored（56-01 核心）

**Analog:** `canvasStore.ts:739-757` `applySocketNodePreview` —— 同为「socket 单字段 canonical 写」：graph 空守卫 → 节点存在守卫 → `get().applyGraphTransform((g) => …map 写 asset 字段)`。scored 版差异：写 `aiScore`（kind==='asset' 守卫同 preview 的 L746）、**不触碰 state/stale**（52-01 语义红线，见 56-RESEARCH Pitfall 1）。接口签名加进 `CanvasState`（L137 applySocketNodeState 同排）。

### 2. qcVerdict.ts 派生 selector（56-01）

**Analog:** `store/variantOps.ts`（纯函数 + graph 入参 + 返回自足结构）。入口 `deriveQcVerdicts(graph, rawDataByNodeId): Map<string, QcVerdict>`；审计节点识别用 `pipeline/model.ts:589-591` 的 idIncludes/phaseIndex 词汇（'voice-audit'/'video-qc'/'preview-qc'）+ raw 袋防御式形状探测（`isRecord`/`str`/`num` 守卫照抄 `candidateEnvelope.ts:174-179`）；join 键 shot_id 从资产 raw 袋取（`pickKeyFields` 同源字段）。

### 3. scoreVocabulary.ts 中文映射（56-01）

**Analog:** `g15TriageStore.ts:55-74`——root 契约的包内手写镜像（P8 不跨包 import）。三张表：`DIM_LABELS`（p03/p14 维度，RESEARCH §雷达列出的清单）、`VIEW_LABELS`（front/背面/angle_left/…）、`VERDICT_LABELS`（PASS/WARN/FAIL → 通过/留意/不过）；`normalizeScore(v, scale)` 量纲归一照 `candidateEnvelope.ts:52-60` scale 语义。未知 key 回退原样返回（fail-soft，khs 改维度不炸）。

### 4. TheaterShell.tsx（56-02）

**Analog:** `VariantWall.tsx:285-339` 原样抽壳：`position:fixed inset:0 zIndex:40` + `theme.chrome.lightboxOverlay` + `backdropFilter blur(2px)` + 背板 onClick 关（`e.target === e.currentTarget` 判定 L289）+ 头栏（bg.panel/border/标题位/右侧控件位）+ `btnStyle`/`closeBtnStyle`（L519-531 抄出）。Props：`{title, subtitle?, onClose, children, headerExtra?}`。Esc 由消费者键盘 hook 承担（G16/组视图各自 hook 统一处理，壳不重复挂——避免双 listener）。

### 5. audioPeaks.ts 波形引擎（56-02）

**Analog:** `wallTransport.ts` 纯模块纪律——零 React import、依赖注入（`AudioContext` 构造器注入，vitest node 环境传 fake）、never-throws。`computePeaks(arrayBuffer, buckets, ctx?) → number[]`（decodeAudioData → channel 合并 → 分桶 RMS/max）；`pseudoPeaks(seed, buckets)` = `AssetCardNode.tsx:488-503` pseudoWaveform **原样平移**（FNV 哈希）；`resolvePeaks(url, seed, buckets)` 编排：fetch → compute 成功缓存（Map, WeakRef 不必——工作台生命周期内 Map 够）→ 失败 pseudo。React 层 `useAudioPeaks(url)` hook 薄封装（懒解码 + state）。

### 6. transcriptAlign.ts（56-02）

**Analog:** 仓内分句纯函数无直接先例 → 取 `StoryboardTimeline.tsx` 纯段函数纪律（入参字符串/返回结构化 + 单测文件伴生）。`splitSentences(text)`（。！？!?\n 切分 + 保留标点 + 空→['(无转写)']）；`evenAlign(sentences, durationSec) → Array<{start,end,text}>`（按字符数加权等时分布——比等句分布更贴近真实语速）；`sentenceAt(align, t)` 二分查找。

### 7. NodeBadges verdict 带（56-03）

**Analog:** `NodeBadges.tsx:71-96`——stale 段与 review 段之间的并行第四段：`let verdictBadges: React.ReactNode[] = []`，从 props 注入的 `verdicts`（AssetCardNode 已有 asset/lod，需经 NodeBadgesProps 扩 `qcVerdicts?`——slots.ts NodeBadgesProps 扩展点 L14-24）。位置规则（UI-SPEC §1）：`left: off + tri + 4px` 起、同带横排 gap 4px；环样式三态（PASS 实线/FAIL 实线+光环/WARN dashed）内联 SVG circle + strokeDasharray。

### 8. ScorePopover（56-03）

**Analog:** 浮层语法 = `SearchNavigator`（panel 底 + `--cv-shadow-pop` + blur(4px) + `pointer-events:none` 变体）；内容 = `<ScoreRadar aiScore={aiScore} size={128} />` 直用 + 维度行（`ScoreMiniBar.tsx` 的条目渲染词汇：getScoreColor 色点 + mono 数值）。触发：AssetCardNode 卡根 div `onMouseEnter/onMouseLeave` + `hoverTimer`（L261-263,294-298 视频 hover 200ms 同款手法改 250ms/100ms）。挂载点：卡内条件渲染（popover absolute 定位到卡上方——卡片本身 position:relative 已满足）。

### 9. groupMembership.ts + theaterStore.ts（56-04）

**Analog:** `variantOps.ts`（membership 推导）+ `assetManagerData.ts` groupCharacterIdentities/groupCharacterCostumes（characterId 同族）；theaterStore 照 `variantPickerStore.ts` L13-28（`group: {kind:'turnaround'|'scene'|'voice', anchorId} | null` + open/close）。

### 10. TurnaroundView 同步缩放（56-04）

**Analog:** 格局 = `CharacterWardrobe.tsx:546` turnaroundGrid map + `buildTurnaroundGrid` L86-92（byAngle/空格占位）；同步缩放无先例 → 状态机自建：`scale` 单一 state（1–4 clamp），每格 `transform: scale(s)`（hover 格 `transformOrigin` 跟光标、其余 center），wheel handler `e.deltaY` 步进 ±0.1、`preventDefault`；按钮/复位过渡 120ms、wheel 即时（UI-SPEC Motion）。参考锁定值不走新常量：clamp 写模块内字面（同 wallTransport `DRIFT_HARD_SECS = 0.12` 先例——模块级锁定常量非「新 token」）。

### 11. SceneGallery / VoiceProfileBoard（56-04）

**Analog:** SceneGallery 缩略行 = `VariantWall.tsx:404-449` 胶片条（横滚/160px→64px 卡/选中描边 `v3theme.signal.select`/emoji 占位）；主图 = NodeDetailPanel 大图 contain。VoiceProfileBoard mini = `WaveformCover` toggle（L452-462 new Audio + onended 复位）；完整播放器 = `DialoguePanel.tsx DialogueRow`（audio ref + progress 0-1 + onSeek 比例点击 L167-177 + fmt MM:SS L179-184）+ audioPeaks 波形替换伪柱。

### 12. FlowCanvas 双击路由（56-04）

**Analog:** `FlowCanvas.tsx:547-553`——`onNodeDoubleClick` 内加一个防御式分支：`theaterTargetOf(node)`（groupMembership 导出的纯判定：raw assetType/metaSub/变体组归属）命中 → `useTheaterStore.getState().open({...})` + return；未命中走原 setSelectedNode/setDetailNode 链零改动。挂载 `<GroupViewTheater />` 于 L1111 `<VariantWall />` 同级 overlay 区。

### 13. g15Bridge gate 参数化（56-05）

**Analog:** 本文件签名扩展模式——`dispatchG15Op({projectId, episodesId, action, shotIds, gate = 'p11c-gate'})`；route zod L30 action 枚举旁加 `gate: z.string().regex(/^p\d+[a-z0-9]*-gate$/).optional()`（deriveGateId 词汇正则，`gateCatalog.ts:53-58` 同源——**白名单式**，不接受任意字符串）；writeback payload 透传 gate（旧行缺省回放正确，56-RESEARCH Gap 3）。canvasApi `g15Ops(..., gate?)` 透传。

### 14. voiceAuditStore.ts（56-05）

**Analog:** `g15TriageStore.ts` 全文同构——`VoiceAuditSource` seam（`loadClips(): Promise<VoiceClip[]>`）、fixture 对齐 p10c 真实形状（`p10c_voice_audit.py:588-598` clips 记录：id/shot_id/path/transcript/verdict/similarity/reason/dims）、真实源 = graph 内 voice-audit 节点 raw 袋派生（`useCanvasStore` graph + rawDataByNodeId → 防御式解析）。行状态机（selected Set/rowState waived/乐观回滚）照抄 L143-180。差异：无 requeue（G16 只有豁免——gates.yaml approve 语义），加 `currentIndex`（连播游标）。

### 15. G16VoiceWorkbench.tsx（56-05）

**Analog:** 布局杂交——`G15TriagePanel.tsx`（左列表行/sticky 动作条/批量乐观/toast/「已豁免」标 L213-216）× `VariantWall.tsx`（TheaterShell 消费/走带 UI 镜像 rAF ~15fps L152-168/playhead range）。双轨区：`<canvas>` 波形（audioPeaks + devicePixelRatio 适配）上轨 + transcriptAlign 句行下轨 + 共享 cursor（absolute 1.5px 线贯穿两轨容器，`--cv-select`）。键盘 hook = useWallKeyboard 改键位表（空格/→/←/Esc；Enter/数字键不注册）。

### 16. verify-phase-56.ts + e2e（56-06）

**Analog:** `scripts/verify-phase-53.ts`/`verify-phase-55.ts`（section 化契约组 + process.exit 码 + package.json script 注册 `verify:phase-56`）；e2e = `phase55-nav.mjs`（断言 × N 重复 + headless 探针）。56 特有断言组：S-socket-scored（死信修复链）、S-vocabulary（khs 维度词表镜像零漂移——读 khs python 正则断言，55-01 verify 同手法）、S-badge（角标渲染词汇）、S-g16（桥 gate 白名单 + clips 解析）、S-token（无新 hex——grep 新组件文件 `#[0-9A-Fa-f]{6}` 零命中，53/55 未做、本期 UI-SPEC 红线 12 的机械化）。

## No Analog Found

- **同步缩放状态机**（TurnaroundView）与 **decodeAudioData 峰值计算**（audioPeaks）为本期新算法面——无仓内先例，但均为模块内自足纯逻辑 + 锁定常量 + 注入式单测（wallTransport 纪律），风险受控；已在 Pattern 5/10 给出锁定值与手法。
