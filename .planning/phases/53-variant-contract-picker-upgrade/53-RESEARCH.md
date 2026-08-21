# Phase 53: 候选变体契约与选片 (Variant Contract + Picker Upgrade) - Research

**Researched:** 2026-08-21
**Domain:** 双端候选数据契约 (zod envelope) + 全屏审片剧场 (React 19 / zustand / @xyflow 生态) + 事务化选优回写 (express + sqlite/knex) + G15 分诊操作桥
**Confidence:** HIGH (codebase-grounded; khs2 契约源码逐行核读; 无 web 依赖声明)

<user_constraints>
## User Constraints (from CONTEXT.md)

> 20 个决策全部 LOCKED(D-01..D-20),planner 不得 re-litigate。以下为逐字摘录。

### Locked Decisions

- **D-01:** 双波拆分——Wave A = kap 接收端全部工作(zod 契约 + 双端 contract test 框架、VAR-02 变体墙、VAR-04 G15 分诊面板)立即开工;Wave B = khs field-map/canvas_sync 映射(VAR-01 khs 侧)+ VAR-03 端到端闭环,等 khs2 v2.4 Phase 25 验收完成后单独 plan。符合 ROADMAP"kap 侧纯接收端工作可先行"注释
- **D-02:** 契约 kap schema 先行——kap 侧 zod candidate envelope(canvasAssetSchema 扩展)+ 双端 contract test 先落地,khs 映射后补;复刻 v2.0 四道闸模式(历史上零漂移)
- **D-03:** 存量不回填——已在流的 p03 候选(2026-08-18 透传上线)不动,新契约只对增量同步生效
- **D-04:** COORD-01"工作树干净"判定范围 = 仅代码文件(`pipeline/phases/*.py` + `plugins/kais_aigc/`);`episodes/` 运行时产物与 `.pipeline-state.json` 永脏不算 blocker
- **D-05:** 布局 = 全屏审片剧场——全屏接管、暗色剧场、上方 N-up 大屏视频墙、底部候选胶片条;签名元素 = 跨变体同步走带(一条主控时间轴驱动所有 take);沿用 catppuccin token 体系(`v3theme.signal.select`/`theme.bg.panel`)
- **D-06:** 同播语义 = 主控同播 + solo 声——一条主控 transport(播放/暂停/拖动)同时驱动所有 take;音频 solo 模式(同一时刻只听一条的声,点击卡切换)
- **D-07:** 信息密度分层——卡上精要(缩略/视频 + aiScore 徽章 + 时长 + seed;prompt 摘要单行截断),完整 prompt 在选中卡下方详情区展开
- **D-08:** 选定交互 = 检视 + 显式选定——点卡 = 检视(展开详情/设 solo 声),每卡显式「选定」按钮才提交;防误触(换 winner 会级联 stale),与 select-winner 端点幂等语义配合
- **D-09:** 通道 = 扩展 select-winner 端点——在 Phase 49 端点(`src/routes/canvas/v2/select-winner.ts`)上挂 manifest 回写 hook(与 reviewBridge 同位、best-effort 隔离);复用事务化/幂等/广播,选定通道一处收口不漂移
- **D-10:** 降级语义 = canvas 真值 + 重试队列——选定立即落 canvas(体验不阻塞),manifest 回写失败进待同步队列、恢复后重放;与 Phase 49 D-07"canvas 为真值源不回滚"同构
- **D-11:** G13 首尾分选——G13 条件帧拆首帧墙 + 尾帧墙两栏(或两组),各自显式选定 → manifest 分别写 `selected_first_variant` / `selected_last_variant`(与 ROADMAP 字段名对齐;不做成对选定,首尾最优可能不在同一变体)
- **D-12:** 前端接线 = 直连端点 + optimistic——点「选定」→ 本地立即更新(optimistic)+ POST select-winner,失败回滚 + toast;与 approveNode/rejectNode 模式同构;废弃本地 selectWinner + 💾保存双轨
- **D-13:** 落位 = 独立分诊面板——Phase 53 建独立面板(列表+归因+批量处置),接口预留嵌入位;Phase 54 gate 中心建成后作为其内嵌块复用,不返工。分诊工作台(列表)与选片剧场(全屏墙)是两种工作模式,不硬塞同一 UI
- **D-14:** 批量语义 = 勾选 + 动作条 + 二次确认——勾选多条 → 底部「批量豁免」「批量重渲」+ 确认(重渲是 GPU 串行贵操作,不可误触)
- **D-15:** 回写通道 = G15 操作桥——豁免 = waive 语义走 reviewBridge 扩展;重渲 = requeue 指令走同桥新 action;一个桥收口,与 VAR-03 select-winner 同构但独立端点(豁免不是选定,语义不污染)
- **D-16:** 归因数据 = take_log 主 + review 补——take_log 结构化透传为主(VAR-01 契约内)+ G15 review payload 归因维度补充;行上显示错误类别徽章,展开看原始日志截断
- **D-17:** 串行形态 = 墙内下一镜——审完当前组(选定后)墙不关、直接载入下一个待审变体组;也可手动「下一镜」跳过(轻交互,不做队列传唤)
- **D-18:** 串行顺序 = shot 序 + 跳已选——同 phase 内按 shot_id 序,默认跳过已选定组;从 gate 视角进入时只列该 gate 的组
- **D-19:** 资产中心入口 = 画布主 + 跳转——本期变体墙只在画布内开(墙组件单宿主);资产中心候选组加「去画布选片」链接(复用 `focusAssetNodeId` 跳转聚焦);不做双宿主内嵌
- **D-20:** 全套键盘流——数字键 1-9 检视/选 take、Enter 确认选定、→/← 切镜、空格同播;93 镜审片刚需

### Claude's Discretion(本研究已逐项给出具体推荐,见 §Discretion Resolutions)

- aiScore 数据源与口径 / Wave B 启动门槛细节 / 候选缩略图 404 自愈 / candidate envelope 具体字段 shape / 重试队列持久化载体 / 同播时钟同步实现

### Deferred Ideas (OUT OF SCOPE)

None — 讨论未超出 phase 范围。

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description (REQUIREMENTS.md) | Wave A Research Support |
|----|-------------------------------|--------------------------|
| VAR-01 | field-map/canvas_sync 补 candidate/variant/winner/selected 字段映射(kmc 侧同步修改),p01 hook 候选、p03 N-best、p11a0 条件帧、p11a 预览变体、p11b take-log 不再被压平丢失 | **kap 半部(Wave A)**: 新 zod candidate envelope 模块 + 双端 contract test 框架(复刻 verify-phase-51 范式);5 源的今日 wire shape 已逐行核读(见 §Current Wire Formats)。**Wave B:** khs canvas_sync/_manifest 映射 |
| VAR-02 | VariantPicker 升级 — 候选卡带 aiScore/时长/prompt 摘要,支持并排大屏对比与视频同播;缩略图走 resolveMediaUrl 修 404 | 全量 Wave A: 全屏变体墙组件 + aiScore 口径(§DR-1) + master transport(§DR-5) + 缩略图自愈(§DR-3);组推导是隐藏前置(§Critical Gap) |
| VAR-03 | 选优回写 manifest — G13 条件帧/G14 预览的换选直接写回 kmc manifest(chosen_variant_id / selected_first/last_variant 闭环) | **kap 半部(Wave A)**: select-winner 端点扩展 hook 位 + first/last 分选参数 + 重试队列表 + 前端 optimistic。**Wave B:** kmc manifest 实际消费闭环 E2E |
| VAR-04 | 失败镜头批量操作(G15)— failed-shots 列表带失败原因标注,支持批量豁免与批量重渲 | Wave A: G15 分诊面板(契约 fixture 驱动)+ G15 操作桥(waite/requeue 双 action)。真实数据到流前以 contract fixture 验证 |
</phase_requirements>

## Summary

Phase 53 Wave A 是"接收端先行"的三件套:① kap 侧 candidate envelope zod 契约 + 双端 contract test 框架(为 Wave B 的 khs field-map 预留精确接口);② 全屏审片剧场(D-05..D-08/D-17..D-20 的变体墙);③ select-winner 端点的 manifest 回写扩展 + 重试队列,以及 G15 分诊面板与操作桥。

研究核读了 khs2 候选同步的全部现役代码路径(`canvas_sync.py` `_extract_candidates` L5394 / `_load_candidate_variants` L5460 / `_load_iframe_flf_artifacts` L5618 / `canvas_graph.py` `add_candidate_node` L896),确认了 5 个候选源的**今日 wire shape**——这是 envelope 设计的直接输入。两个最重要的发现:(1) **score 字段今天在 call site 被丢弃**(`canvas_sync.py` L1347-1360 只透传 `thumbnailUrl/filePath/description/data`,`_extract_candidates` 提取的 `score` 与 `_load_candidate_variants` entry 的 `score` 均未进 `add_candidate_node` 参数)——这正是 VAR-01"压平丢失"的实锤之一,也定义了 envelope 必须同时容忍"今日无 score 的扁平形状"和"Wave B 结构化形状"。(2) **kmc 候选节点不在 canvas variantGroups 里**(khs sync 从不写 `variantGroups`,canvas_graph.py 只 normalize 空数组;canvasAssetLinkage 头注释确认"sync-assets 建的节点 variant_group_id 为 NULL")——而 select-winner 端点、`selectVariant` 守卫、`variant:selected` 广播全部以 canvas variant group 为操作单元。**因此 Wave A 存在一个 CONTEXT 未明说的前置任务:kap 侧候选组推导/物化(candidate families → canvas variantGroups)**,否则墙的「选定」无组可写。复用 Phase 48 的 groupKey 词表(`shot:{shot_id}:first|last` / `name:{dir}/{base}`)可让资产中心与画布两侧 grouping 语义同源。

另一个修正:53-CONTEXT 说 select-winner"前端未接"——**已过时**。`canvasStore.selectWinner`(v3 路径)已实现 optimistic + POST + 失败回滚(Phase 49 D-04 落地,`selectWinner.test.ts` 在测)。VAR-03 前端的真实缺口是: VariantPicker 的"点击即选定即关闭"交互要改成 D-08 检视+显式选定,G13 首尾分选(D-11)需要新的参数面,本地 selectWinner 旧 RF 路径(D-12 废弃对象)在 graph 为空时仍存在。

**Primary recommendation:** 按「契约先行 → 组推导 → 墙 → 端点扩展+队列 → G15 桥」的依赖序排 Wave A 任务;envelope 用统一信封 + source 判别字段(§DR-2);组推导物化为 canvas variantGroups 且 groupKey 词表与 Phase 48 对齐;重试队列用新 sqlite 表(§DR-4);同播用 rAF 主时钟 + 漂移阈值硬校正(§DR-5)。

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Candidate envelope zod 契约 | kap API/后端 (src/lib) | khs 映射层 (Wave B) | D-02 kap schema 先行;khs 只做映射不定义形状 |
| 候选组推导 (families→variantGroups) | kap API/后端 (load/sync 接收路径) | 前端 (墙的 view-model 兜底) | select-winner/守卫/广播都以 group 为单元;持久化物化才能跨刷新 |
| 变体墙 UI (N-up 同播/胶片条/键盘流) | Browser (packages/infinite-canvas) | — | 纯 C 层组件,zustand 自有 store(先例 variantPickerStore) |
| aiScore 展示口径 | Browser (墙/卡渲染) | kap 契约 (AIScore 形状) | 值来自同步数据,归一化在展示层定(§DR-1) |
| 缩略图 404 自愈 | Browser (onError 检测) | kap API (ensureThumbnail 端点) | 检测在前端、生成在后端既有端点(§DR-3) |
| 选定事务 + o_assets 联动 | kap API (select-winner 端点) | sqlite 事务 (canvasRelationalStore) | Phase 49 已收口,扩展不另开通道 (D-09) |
| manifest 回写 (chosen/first/last) | kap API (hook + 重试队列) | kmc 消费 (Wave B) | best-effort 隔离 + 队列重放 (D-10) |
| G15 豁免/重渲桥 | kap API (reviewBridge 扩展) | review-platform / kmc | waive 走 approve 语义扩展,requeue 是新 action (D-15) |
| G15 归因数据 | khs 透传 (Wave B) | kap 契约 + 面板渲染 (Wave A fixture) | take_log 主 + gate payload 补 (D-16) |
| 资产中心「去画布选片」 | Browser (AssetLibrary) | canvasStore focusAssetNodeId | D-19 既有机制复用 (L824-830 先例) |

## Current Wire Formats (5 源今日实况 — envelope 设计输入)

> 全部 [VERIFIED: codebase, khs2 repo 逐行核读 2026-08-21]。Wave B 改的就是这些产出端;Wave A envelope 必须同时吃下今日形状。

### 源 1: p01 hook 候选 (`_load_candidate_variants`, canvas_sync.py L5460-5596)
- 候选文件映射表 `_CANDIDATE_FILES = {"p01": "hook-candidates.json"}` (L5456-5458) — **只有 p01**;p03 K=3 落选盘加载是 docstring 意图(L5468 提及 P03 script K=3)但映射表未加键 → p03 落选候选今天实际不上画布(53-CONTEXT"p03 K=3 落选盘加载已有"是指机制就绪,Wave B 补映射)。
- 磁盘 SSOT 形状: `{value: {variants: [{variant_id, candidate: {...}, provenance}], chosen_variant_id}}`。
- 产出的 candidate dict: `{id: "variant-{vid}", label, selected (vid==chosen_variant_id), description (白名单字段拼接), score? (hook_strength|score), data: {标量穿透 ≤500 字符 + frame_breakdown_3sec 拍平预览}}`。
- 节点: `c-p01-variant-{vid}`,type `"variant"`。

### 源 2: p03 N-best (`_extract_candidates`, canvas_sync.py L5394-5451)
- 读 `result.outputs` 的 `variants|candidates|options|choices` 键;`selected_{key.rstrip('s')}` 或 `selection` 定 winner。
- dict 项透传 `thumbnailUrl/filePath/description/score` 四键到 candidate dict——但 call site (L1347-1360) 只消费 `thumbnailUrl/filePath/description/data`,**`score` 丢弃**。
- p03 audit 评分本体: 4 维 scores (drama/rhythm/character/logic, 0.0-1.0) + D6 `reversal_depth` / D7 `social_resonance_depth` 顶层键 + `total_score` (p03_script_audit.py L1005/L1064);总分门 0.78,D6/D7 分带 veto (L96-105)。

### 源 3: p11a0 条件帧 (`_load_iframe_flf_artifacts`, canvas_sync.py L5618-5730)
- SSOT = `{workdir}/assets/P11/iframe-manifest.json`(gen_iframes.py 写,p11a0 选优回写)。
- 节点 `a-flf-{shot_id}-{first|last}-v{N}` (variant 从文件名 `_v(\d+)` 提取, `_flf_variant_of` L725-736;无后缀 = v1)。`data = {label, assetType:"keyframe", frame_type, variant("v1".."vN"), groupKey("{shot_id}_{first|last}"), shot_id, filePath(/oss/), generation_prompt, isPrimaryView, curationState(active|eliminated), state, tags(["★ 选定"|"○ 待选"|"✕ 淘汰"]), description}`。
- 选优真值: p11a0 把 **`selected_first_variant` / `selected_last_variant`** (1-based index) 写回 iframe-manifest.json entry (p11a0_iframe_qc.py L1377-1381) + `iframe_qc` qc 摘要 `{judged, selected_variant, selected_score, needs_regenerate, best_fail, finalists, fail_reasons}` (L1382-1398)。**这是 D-11 字段名的权威对齐点。**
- iframe-qc slot per-slot 形状 (L1343-1360): `{shot_id, frame_type, judged, variants: [{variant(int), verdict(pass|fail), score(int 0-100), reasons}], selected_variant, selected_score, finalists, needs_regenerate, best_fail}`。

### 源 4: p11a 预览变体 (rapid-preview-clips JSONL, p11a_preview_clips.py)
- JSONL 行: `{shot_id, variant_id, structure_delta, clip_path, generation_time_ms, engine}` (模块 docstring L32-36);`VARIANTS_PER_SHOT` 默认 1(2026-08-15 起,曾是 3)。
- G14 (p11a-gate) payload 的 chosen 形状 (L1270-1281): `{variant_id, clip_path, qwen_eye}` 按 shot。
- preview-qc slot: per-variant qwen-eye verdict 聚合,advisory。

### 源 5: p11b take-log (asset_bus slot, p11b_final_render.py)
- `asset_bus_write("take-log", {"takes": [...]})` (L2683-2684)。
- entry schema (L1103-1115): `{take_n, shot_id, changed_variable, seed, verdict, evidence, timestamp}` + `shot_index` (L2589);**verdict enum: `keep | fix_in_post | edit | re_roll | rewrite`**(五分诊)。
- **今天完全不上画布**(canvas_sync 无 take-log 消费者)— Wave B 透传,kap envelope 先行定义。

### 附: G15 失败镜头数据 (p11c_video_qc.py)
- OUTPUT_SLOTS = `["video-qc", "failed-shots"]` (L80);GATE_ID = "p11c-gate" (Gate 15, L84)。
- `failed-shots` slot: `{failures: [{shot_id, error, timestamp, run_id}]}` (L52-55, writer L560-573)。
- `video-qc` slot: `{per_shot: {shot_id: {verdict, dims, reasons, obs}}}`;判定维度 = `framing_ok / camera_ok / composition_ok / axis_ok / content_match / confidence / verdict / reasons` (judge prompt L147)。
- Gate payload: `finalists[] / best_fails[] / fail_detail[]` 均带 reasons (L597-624)。
- runner error_info 词表 (canvas_sync.py L2530-2540 消费): `delegate_timeout | delegate_parse_failure | schema_validation`。
- p10c 音频保真(音频 A/B/C 档体系): `.pipeline-assets/p10c-fidelity.jsonl` 行 = `{id, wav_mtime, verdict, similarity, transcript, 阈值, emotion_hard_fail}` (p10c_voice_audit.py L235-250)。

## Critical Gap (CONTEXT 未明说的 Wave A 前置)

**kmc 候选节点不在 canvas variantGroups 里。** [VERIFIED: codebase]
- khs `canvas_graph.py` 只把 `variantGroups` normalize 成空数组 (L275/L300/L401-402/L722-723),从不写入。
- kap `canvasAssetLinkage.ts` 头注释:"sync-assets 建的节点 variant_group_id 为 NULL,只有用户在 UI 分组并保存后才有组"。
- 而 select-winner 端点查 `canvas_variant_groups` 表 (`selectWinnerInGroup` L469)、前端 `selectVariant` 守卫走 `graph.variantGroups`、`variant:selected` 广播带 groupId。
- 现行 VariantPicker 的牌堆数据 `VariantStackData` (adapter.ts L606-619) **只在组内有 `curation:'deprecated'` 成员时物化** (stackByWinner L679-697) — kmc 候选组不满足此条件,墙不能依赖现有 stack 通道。

**推荐方案:** Wave A 加一个 kap 侧「候选组推导」步骤——在图加载/同步接收路径上(或一个显式的 ensure 调用),按候选信封的 groupKey 物化 `variantGroups`(selectMode:'single')并经 canonical 写路径持久化。groupKey 词表**复用 Phase 48 `candidateGrouping.ts` 的格式**(`shot:{shot_id}:first` / `shot:{shot_id}:last` / `name:{parentDir}/{base}`,L16-20)— 资产中心(o_assets 分组)与画布(canvas variantGroups)两侧 grouping 语义同源,回写桥接时不会出现两套词表。G13 首帧/尾帧天然是两个组(D-11 与 Phase 48 的"first/last 两分组"决策同构)。

## Standard Stack

### Core(全部既有,零新增安装)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | ^4.3.5 (root) / ^3.25.76 (infinite-canvas) | envelope + 端点入参校验 | canvasAssetSchema/save-v2/execute 既有范式 [VERIFIED: codebase package.json] |
| react / react-dom | ^19.1.0 (pkg) | 墙/面板 UI | 既有 [VERIFIED: codebase] |
| zustand | ^5.0.14 (pkg) | 墙开关态/键盘态 store | variantPickerStore 先例 [VERIFIED: codebase] |
| @xyflow/react | ^12.6.0 (pkg) | 宿主画布(墙为其 overlay) | 既有 [VERIFIED: codebase] |
| express + knex/sqlite | 既有 (root) | 端点扩展 + 重试队列表 | select-winner/initDB 既有范式 [VERIFIED: codebase] |
| vitest | ^2.1.9 (pkg) | store/纯函数单测 | store/__tests__ 既有 [VERIFIED: codebase] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| sharp / ffmpeg (系统) | 6.1.1 | 缩略图自愈后端 | 既有 ensureThumbnail 通道,不新增 |
| tsx | 既有 devDep | verify-phase-53 脚本运行器 | npm script 注册范式 |

### Alternatives Considered
| Instead of | Could Use | Trade off |
|------------|-----------|----------|
| 自研 rAF 主时钟同步 | hls.js / video 组合同步库 | 引入新依赖且我们是无流本地 mp4 同播;DOM currentTime 足够,不装 |
| 新表存重试队列 | o_agentWorkData kv JSON | kv 是整串 JSON 重写,无状态机/索引/重放语义 — 见 §DR-4 |
| canvasAssetSchema 内扩 envelope | 独立 candidateEnvelope.ts 模块 | assetDataSchemas 是 per-node-type 基线,envelope 是 per-source 判别联合 — 混入会让两类校验语义纠缠(§DR-2) |

**Installation:** 无 — Wave A 零新增依赖。

## Package Legitimacy Audit

本 phase **不安装任何外部包**(全部推荐均为仓库既有依赖,已核 root/infinite-canvas package.json)。slopcheck 不适用(无新增注册表交互)。

| Package | Registry | Status |
|---------|----------|--------|
| (无新增) | — | Approved — 既有依赖复用 |

## Architecture Patterns

### System Architecture Diagram (Wave A 数据流)

```
                    ┌────────────────────────── kap 后端 (src/) ──────────────────────────┐
                    │                                                                     │
 khs canvas_sync ──►│ save-v2 / nodes 路由                                                  │
 (今日扁平形状)      │   ├─ validateNodeData (canvasAssetSchema)                            │
                    │   └─ [新] candidateEnvelope.parse(tolerant) ──► node.data            │
                    │        (今日形状 → 归一化信封;Wave B 结构化形状 → 同一信封)            │
                    │                       │                                               │
                    │ [新] 候选组推导: envelope groupKey ──► canvas_variant_groups 物化      │
                    │                       │                                               │
 墙「选定」────────►│ POST /canvas/v2/variant-groups/:groupId/select-winner                 │
 (optimistic)       │   ├─ selectWinnerInGroup (事务, 幂等, locked/multi 守卫)               │
                    │   ├─ o_assets isPrimaryView 联动 (D-07, best-effort)                 │
                    │   ├─ [新] manifest 回写 hook ◄─ D-11: frame_slot=first|last          │
                    │   │     ├─ 成功 → done                                               │
                    │   │     └─ 失败 → [新] canvas_writeback_queue 入队 ──► 定时重放 ──► hook │
                    │   ├─ reviewBridge (49-02 既有, choose:v{N})                          │
                    │   └─ broadcast variant:selected ──► 多端回显守卫 (useStale/socket)    │
                    │                                                                     │
 G15 面板「豁免/重渲»│ POST [新] /canvas/v2/g15-ops (waive | requeue)                        │
                    │   └─ g15Bridge (reviewBridge 同构: deps 注入/吞错/幂等)                │
                    └─────────────────────────────────────────────────────────────────────┘
                                        │
                    ┌───────────────────┴── 浏览器 (packages/infinite-canvas) ─────────────┐
                    │ 变体墙(全屏): rAF 主时钟 ──► N 个 <video> currentTime 校正             │
                    │   ├─ solo 声: 非 solo 全 muted                                        │
                    │   ├─ 卡: 缩略(resolveMediaUrl)+aiScore 徽章+时长+seed+prompt 摘要     │
                    │   ├─ 404 自愈: onError → POST /canvas/v2/thumbnail → 换 URL → 占位兜底  │
                    │   └─ 键盘流 1-9/Enter/←→/空格 (D-20)                                  │
                    │ G15 分诊面板: 勾选+动作条+二次确认 (D-14)                              │
                    │ 资产中心: 「去画布选片」→ setFocusAssetNodeId + setViewMode('canvas')    │
                    └─────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure(新增文件)
```
src/lib/candidateEnvelope.ts          # zod 信封 + 5 源判别 + 今日形状归一化 (D-02)
src/lib/candidateGroupDeriver.ts      # 信封 groupKey → canvas variantGroups 物化(纯函数,db 参数)
src/lib/manifestWriteback.ts          # D-09 hook: chosen/selected_first/last 回写(deps 注入)
src/lib/writebackQueue.ts             # D-10 重试队列(表 + drain/replay)
src/lib/g15Bridge.ts                  # D-15 waive/requeue 桥(reviewBridge 同构)
src/routes/canvas/v2/g15-ops.ts       # G15 操作端点(独立于 select-winner, D-15)
scripts/verify-phase-53.ts            # 契约 gate(npm script verify:phase-53)
packages/infinite-canvas/src/components/variants/VariantWall.tsx      # 全屏剧场(替换 Picker 主体)
packages/infinite-canvas/src/components/variants/wallTransport.ts    # rAF 主时钟 + 漂移校正(纯逻辑可单测)
packages/infinite-canvas/src/components/variants/useWallKeyboard.ts   # D-20 键盘流
packages/infinite-canvas/src/components/g15/G15TriagePanel.tsx        # D-13 分诊面板
```

### Pattern 1: 双端契约平行声明 + 容忍式信封 (D-02/D-03)
**What:** kap 侧 zod envelope 先行;解析函数接受两代形状(今日扁平 label/description/score/selected/tags + Wave B 结构化),归一化为统一信封;contract test 用 fixture 锁 round-trip。
**When to use:** 任何"接收端先行、源端后补"的契约扩展。
**Example:**
```typescript
// Source: 本研究推荐形状(设计依据 = §Current Wire Formats 逐行核读)
// src/lib/candidateEnvelope.ts
export const candidateSourceSchema = z.enum([
  "p01_hook", "p03_nbest", "p11a0_flf", "p11a_preview", "p11b_take",
]);
export const candidateScoreSchema = z.object({
  overall: z.number(),                       // 归一化 0-1 (§DR-1)
  dimensions: z.record(z.string(), z.number()).optional(),
  scale: z.enum(["unit", "percent"]).default("unit"),  // 源刻度声明
});
export const candidateEnvelopeSchema = z.object({
  source: candidateSourceSchema,
  groupKey: z.string().min(1),               // Phase 48 词表: shot:{sid}:first|last / name:{dir}/{base}
  variantId: z.string(),                     // "v1".."vN"
  shotId: z.string().optional(),
  frameSlot: z.enum(["first", "last"]).optional(),   // D-11 G13 分选
  selected: z.boolean().default(false),
  score: candidateScoreSchema.optional(),    // 今日形状缺省 → undefined (score 今天在 call site 丢弃)
  durationSec: z.number().min(0).optional(),
  prompt: z.string().optional(),             // generation_prompt / video_prompt
  seed: z.number().int().optional(),
  filePath: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  extras: z.record(z.string(), z.unknown()).default({}),  // hook_type/visual_concept/structure_delta…
});
// tolerant parse: 结构化形状直接 safeParse;今日扁平形状(a-flf-*/c-* 节点 data)经
// normalizeLegacyCandidateData() 映射(frame_type→frameSlot, variant→variantId,
// groupKey 直通, isPrimaryView/tags→selected, generation_prompt→prompt)
```

### Pattern 2: best-effort 桥 + 双 backstop + deps 注入 (D-09/D-15)
**What:** manifest 回写 hook 与 g15Bridge 复刻 `reviewBridge.ts` 的全部纪律: `void` 不 await、内部吞错、`.catch()` 二 backstop、baseUrl/fetchImpl/logger/timeoutMs 全注入(脚本与测试可驱动)、幂等语义。
**When to use:** 任何"主操作已提交、附属通道不可拖垮响应"的挂点。
**Example:** [VERIFIED: codebase, src/lib/reviewBridge.ts L114-258 + select-winner.ts L151-158 — 挂点同位]

### Pattern 3: canvas 真值 + 队列重放 (D-10)
**What:** 选定事务先落 canvas;manifest 回写失败仅入队,不回滚不阻塞;恢复后 drain 重放。
**When to use:** 跨系统最终一致且用户侧真值已定居。
**Example:** [VERIFIED: codebase, select-winner.ts L90-144 的"canvas truth committed → 隔离段只 warn"先例;队列为新增,见 §DR-4]

### Pattern 4: verify-phase-NN 聚合门 (v2.0 四道闸复刻)
**What:** 单一 verify 脚本 section 化(S1 契约 round-trip / S2 组推导 / S3 端点+队列 / S4 墙组件源形状 / S5 G15 桥),mkdtemp+chdir 隔离 DB、真实模块零重实现、forced-failure 自检、npm script 注册。
**When to use:** phase 收口门。
**Example:** [VERIFIED: codebase, scripts/verify-phase-51.ts 头注释 + verify-manifest-contract.ts (跨仓 pytest spawn — Wave B 恢复四道闸时的另一半)]

### Anti-Patterns to Avoid
- **墙内直改派生缓存**: 墙的选定必须走 store canonical action + 端点(Phase 51 地基),不得像旧 VariantPicker 注释里"💾 保存后持久化"那样留双轨(D-12 明令废弃)。
- **envelope 塞进 assetDataSchemas**: variant 类型在 `optionalTypes`(canvasAssetSchema.ts L125)本就不校验;把 per-source 判别联合混进 per-type 基线表会让 689 历史行的宽容校验语义被误伤(Pitfall 3 教训,44-RESEARCH)。
- **墙依赖 VariantStackData**: 该通道只在 deprecated 折叠时物化(adapter L679-697),kmc 候选组不满足 — 必须走组推导。
- **khs 侧代码修改**: Wave A 任何任务不得动 `/data/workspace/kais-hermes-skills` 工作树(仅只读)。

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| 事务化选定 + 幂等 + locked/multi 守卫 | 新选定通道 | `selectWinnerInGroup` (canvasRelationalStore L446) | 48-02/49-01 已收口;扩展 hook 位即可 (D-09) |
| 选定前端 optimistic + 回滚 | 新的本地状态机 | `canvasStore.selectWinner` 既有 v3 路径(已接端点,有测试) | D-12 同构要求;改交互不改机制 |
| 缩略图生成 | 墙内前端截帧 | `ensureThumbnail` + POST /canvas/v2/thumbnail (idempotent) | sharp/ffmpeg 管线 + 缓存已就绪 |
| 媒体 URL 解析 | 自拼路径 | `resolveMediaUrl` (mediaUrl.ts L89) + `resolveRelativeAssetPath` | 8 处消费先例,/local-file 白名单兜底 |
| review 平台交互 | 新 HTTP 客户端 | reviewBridge 的 deps 注入骨架 | 协议已核(409=已 resolve 等),直接扩展 |
| 契约测试 DB | 临时 schema | mkdtemp + chdir + 真实 store 函数 | verify-phase-51 范式,零逻辑拷贝 |

**Key insight:** 本 phase 的价值在"接线与契约",不在"机制发明"——所有重机制(事务/幂等/桥/缩略图/归一化)都已有收口点,新代码应该是薄的。

## Common Pitfalls

### Pitfall 1: envelope 过严拒收今日形状
**What goes wrong:** Wave B 未到,save-v2/nodes 校验对 kmc 存量扁平字段 400。
**Why:** 把 Wave B 目标形状当必填。
**How to avoid:** envelope 所有新增字段 optional/default;legacy 归一化函数容忍缺 `score`(今天 call site 就丢);contract test 同时喂两代 fixture。
**Warning signs:** 增量同步后画布节点数下降 / save-v2 400 日志。

### Pitfall 2: 组推导与 Phase 48 词表漂移
**What goes wrong:** 画布 groupKey 自造格式,回写桥接时 o_assets 分组与 canvas 组对不上。
**How to avoid:** 只用 `shot:{shot_id}:first|last` / `name:{parentDir}/{base}` 两格式(candidateGrouping.ts L16-20);把"两侧词表一致"写进 verify-phase-53 断言。

### Pitfall 3: 同播音画不同步/全场喇叭
**What goes wrong:** N 个 video 各自播放,漂移累积;或全部有声混音。
**Why:** 浏览器 video 时钟各自独立;audio 未强制 mute。
**How to avoid:** §DR-5——solo 之外全 `muted=true`;漂移超阈值硬 seek。
**Warning signs:** 长时间播放后 take 间画面错位 >0.5s。

### Pitfall 4: 重试队列与 select-winner 事务耦合
**What goes wrong:** 入队失败导致选定响应 5xx,违反 D-10"体验不阻塞"。
**How to avoid:** hook 整体在事务外、`void` 调用、队列写入自身 try/catch 降级为日志(队列不可用时最坏 = 丢一次回写,canvas 真值仍在)。

### Pitfall 5: 幂等分支不触发桥(既有语义保持)
**What goes wrong:** 重复点「选定」(同 winner)时误触发回写/桥/广播。
**Why:** select-winner L82-88 幂等分支**刻意**不走到 o_assets/桥/广播。
**How to avoid:** manifest hook 挂在 `status==="updated"` 段(与 reviewBridge 同位),队列重放走 hook 自身幂等(manifest 值相等则 no-op)。

### Pitfall 6: G13 双组与 D-11 首尾分选
**What goes wrong:** 把首尾做成一个组的成对选定,或一个端点参数同时写两个 slot。
**How to avoid:** first/last 是两个 variantGroups(两个 groupKey),各自显式选定,各自带 `frameSlot` 进回写。

### Pitfall 7: e2e 跑 dist 不跑源码
**What goes wrong:** 墙改完跑 e2e 全绿但测的是旧构建。
**How to avoid:** 任何 e2e 前 `npm run build`(packages/infinite-canvas),verify 脚本头注释重申(51-02 先例)。

### Pitfall 8: zod 双版本混淆
**What goes wrong:** 在 infinite-canvas 包内 import root 的 zod 4 类型或在服务端用包内 zod 3 enum 互通报错。
**Why:** root zod ^4.3.5 / pkg zod ^3.25.76 并存。
**How to avoid:** envelope(服务端)用 root zod;包内如需类型,手写 TS interface 或从生成文件导出,不跨包 import zod schema 实例。

## Code Examples

### 选定端点扩展(D-09/D-11 挂点)
```typescript
// Source: [VERIFIED: codebase, src/routes/canvas/v2/select-winner.ts L146-170 扩展位]
// zod 扩展(向后兼容——新增字段全 optional):
const selectWinnerSchema = z.object({
  projectId: z.number(),
  episodesId: z.number(),
  winnerNodeId: z.string().min(1).max(128),
  frameSlot: z.enum(["first", "last"]).optional(),   // D-11: G13 首尾分选
  source: candidateSourceSchema.optional(),          // 归因到 5 源之一
});
// status==="updated" 段,reviewBridge 同位、之后:
void enqueueManifestWriteback({ projectId, episodesId, groupId,
  winnerNodeId, variantIndex, frameSlot, source }).catch(() => {});
```

### 缩略图 404 自愈(§DR-3)
```typescript
// Source: [VERIFIED: codebase, 通道既有 — POST /api/canvas/v2/thumbnail body {sourcePath}]
// 墙内 <img onError> 一次性自愈:
const onThumbError = async (c: WallCandidate) => {
  if (c.healTried || !c.filePath) return setFallback(c);       // 一次性
  c.healTried = true;
  const r = await fetch('/api/canvas/v2/thumbnail', { method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ sourcePath: ossPathOf(c.filePath }) }); // resolveMediaUrl 逆路径
  const j = await r.json();
  if (j?.data?.thumbnailUrl?.includes('/_thumbs/')) updateThumb(c, j.data.thumbnailUrl);
  else setFallback(c);                                          // 模态 emoji 占位(VariantPicker L111 先例)
};
```

### 同播主时钟(§DR-5)
```typescript
// wallTransport.ts — 纯逻辑,可 vitest 单测(fake VideoProxy)
export function createMasterTransport(videos: HTMLVideoElementLike[]) {
  let masterTime = 0, playing = false;
  const SOLO = -1; let soloIdx = SOLO;
  const DRIFT_HARD = 0.12;                     // 秒:超阈硬 seek
  function tick(now: number, last: number) {
    if (!playing) return;
    masterTime += (now - last) / 1000;
    const span = timelineSpan();               // min(duration) — 最短 take 为墙时长
    for (const [i, v] of videos.entries()) {
      v.muted = i !== soloIdx;                 // D-06: solo 之外全静音
      const target = masterTime % span;
      if (Math.abs(v.currentTime - target) > DRIFT_HARD) v.currentTime = target;
      if (v.paused && playing) void v.play().catch(() => {});
    }
  }
  return { play, pause, seek(t) { masterTime = t; videos.forEach(v => v.currentTime = t); },
           setSolo(i) { soloIdx = i; }, get masterTime() { return masterTime; } };
}
// 驱动: requestAnimationFrame(tick);stall 处理:任一 video 'waiting' 事件 → 全场 pause + masterTime 对齐
```

### 候选组推导(纯函数形状)
```typescript
// candidateGroupDeriver.ts — db 参数惯例(48-02),verify 脚本可注入 :memory: knex
export interface DerivedGroup { id: string; groupKey: string; selectMode: 'single';
  variantNodeIds: string[]; winnerNodeId?: string }
export function deriveCandidateGroups(
  nodes: Array<{ id: string; data: Record<string, unknown> }>,
): DerivedGroup[] // 按 groupKey 聚合;winner = isPrimaryView||selected 节点;幂等:已存在同 id 组则跳过
```

## Discretion Resolutions(6 项裁定的具体推荐)

### DR-1: aiScore 数据源与口径
**事实基础 [VERIFIED]:** V3 类型系统已定义 `AIScore { overall: number; dimensions?: Record<string, number> }` (flowgraph-v3/ts/src/types.ts L60-63, §8 产物属性) — 不需要发明新形状。今日到达画布的分数: p03 phase 头节点 description 拼接"评分: X"(canvas_sync L2518-2538, 4+2 维 + total_score);p11a0 per-variant `score` 是 **int 0-100** (qwen-eye);p11 audio 档位是 verdict/similarity 非 0-1 分;take_log 是 verdict 枚举非分数。另一条 `aiScore` 通道(POST /canvas/review/score 的 AIScoreResult + node:state "scored")是**按需图片评分**,与候选分是两回事,不得混显。
**推荐口径:**
- 信封统一 `score: {overall: 0-1, dimensions?, scale}`;`scale` 声明源刻度,展示层归一(percent → /100)。
- **卡上徽章 = overall 数字**(0-1 ×100 显示为整数),色用 `getScoreColor` (catppuccin.ts L244-248: ≥0.8 青 / ≥0.5 金 / 其余玫) — 既有阈值词汇表,不新造。
- **详情区 = dimensions chips**(维度名 + 值,弱底色 `modalityWeak` + 模态色文字),不加权不合成 — 综合分由源端给(p03 total_score / p11a0 selected_score),前端绝不自算加权(p03 D6/D7 分带 veto 逻辑证明"合成分"是源端语义)。
- 无 score 的候选(今日常态):徽章位显示 verdict/状态(p11b take_log verdict 汉化:keep=保留/fix_in_post=后期修/edit=剪辑/re_roll=重抽/rewrite=重写),不显示 0 分。

### DR-2: envelope 具体字段 shape
**推荐: 统一信封 + `source` 判别字段(非 per-phase 独立 schema)。** 理由:5 源公共面占 90%(groupKey/variantId/selected/score/filePath/prompt/seed/duration),差异面(hook_type/structure_delta/frameSlot/verdict)进 `extras` + 可选判别字段;双端 contract test 只需锁一个信封;khs Wave B 映射时每源只填公共面 + extras,不用 5 份 schema 对齐。`frameSlot` 升为一等可选字段(D-11 需要)。放**独立模块** `src/lib/candidateEnvelope.ts`(不进 assetDataSchemas,理由见 Anti-Patterns;`canvasAssetSchema.ts` 仍是 per-type 基线真值)。今日形状经 `normalizeLegacyCandidateData` 进信封(a-flf: frame_type/variant/groupKey/isPrimaryView/generation_prompt 全可映射;c-* variant 节点: tags/reviewStatus→selected,description 拆 prompt)。完整字段见 Pattern 1。

### DR-3: 候选缩略图 404 自愈
**事实基础 [VERIFIED]:** `needsThumbnailing` (thumbnail.ts L163) 只认"/oss/ 且非 _thumbs"为需生成 — 这就是 memory 里"误判致无法自愈"的根:_thumbs URL 缺文件时它返回 false。服务端已有补丁 `isThumbnailMissing` (L176) + `healNodeDataThumbnail` 四态自愈 (L198),但只跑在 save hook 上,墙渲染时不会触发。既有幂等端点 POST /canvas/v2/thumbnail `{sourcePath}` 接 original 路径返回新 _thumbs URL。
**推荐: 前端检测 + 后端既有端点自愈 + 占位兜底**(三段):(1) 墙/卡 `<img onError>` → 一次性 POST /canvas/v2/thumbnail(sourcePath = 节点 filePath 经 resolveMediaUrl 的 /oss 形态);(2) 响应含 `/_thumbs/` → 换 URL 重渲;(3) 失败/无 filePath → 模态占位(既有 VariantPicker L108-111 的 modality emoji 先例)。**不做**批量预检(墙一次最多 9 卡,串行 onError 足够,别打 batch 2000 上限通道)。可选加分:自愈成功后经 canonical `updateAssetMeta` 回写 thumbnailUrl,下免再愈(Phase 51 action 已存在)。

### DR-4: 重试队列持久化载体
**推荐: 新 sqlite 表 `canvas_writeback_queue`,走 initDB.ts 既有 table family 注册。** [VERIFIED: 惯例依据 — initDB L1332-1347 canvas_variant_groups 的 builder 形状 + kv_shotGraph 的 `state pending|processing|done|error` 枚举先例 L1122]
```
canvas_writeback_queue: {
  id (autoincr PK), project_id, episodes_id,
  action: "manifest_writeback" | "g15_waive" | "g15_requeue",
  payload (text JSON: {groupId, winnerNodeId, variantIndex, frameSlot, source, shotIds...}),
  state: "pending"|"done"|"failed",
  attempts (int, 默认 0), max_attempts (默认 8),
  next_attempt_at (bigint ms, 指数退避 base 30s),
  last_error (text, nullable), created_at, updated_at,
  index (project_id, episodes_id, state, next_attempt_at)
}
```
**否决 o_agentWorkData kv**:整串 JSON 重写无并发安全、无状态机/索引/退避语义,且该表正被 reviewMapping 复用会互相踩。**否决纯内存**:重启丢队列违反 D-10"恢复后重放"。drain: 进程启动 + 定时(setInterval 30s)+ 入队失败即时三条路径;重放调同一 hook 函数(hook 自身幂等:manifest 值已相等 → no-op)。

### DR-5: 同播时钟同步实现
**推荐: requestAnimationFrame 主时钟 + 每帧漂移检测 + 阈值硬 seek。** [ASSUMED — 标准 Web 平台工程实践,无库依赖;与代码库现状(AssetCardNode hover-play 单 video)兼容]
- master time 是唯一真值(rAF delta 累加),**不**从任何 video 读回 currentTime(避免反馈环)。
- 每 tick 对每个 video: `muted = i !== soloIdx`(D-06);`|v.currentTime - target| > 120ms → v.currentTime = target`(硬校正;不用 playbackRate 微调 — 93 镜审片场景简单可靠优先,rate 调谐是流媒体对齐用的)。
- 墙时长 = 所有 take 的 `min(duration)`(短 take 循环窗口);时长读 `data.duration_sec`(canvas_sync 从 manifest params 写入,视频节点必填),fallback `media.durationS`(事件折叠)。
- 拖动 seek:统一 `videos.forEach(v => v.currentTime = t)` + masterTime = t。
- stall 治理:任一 video `waiting` 事件 → 全场 `pause()` + masterTime 对齐到该 video.currentTime(网络/解码慢不让全场跑空)。
- 逻辑抽 `wallTransport.ts` 纯模块(video 接口注入),vitest 可用 fake 时钟断言漂移校正 — 满足 Validation Architecture。

### DR-6: G15 归因数据与徽章 taxonomy
**事实基础 [VERIFIED]:** 可用结构化字段 = p11b take_log `{take_n, shot_id, changed_variable, seed, verdict(5 枚举), evidence, timestamp}`;p11c failed-shots `{shot_id, error, timestamp, run_id}` + video-qc per_shot `{verdict, dims{framing,camera,composition,axis,content_match,confidence}, reasons, obs}`;runner error_info 三枚举 `delegate_timeout|delegate_parse_failure|schema_validation`;BgmTriggerError 有独立异常类。
**推荐 badge enum(错误类别, kap 契约内声明 `g5ErrorCategory`):**
```
qc_vision_fail      — p11c verdict=fail(dims 子 chips: 帧构/运镜/构图/轴线/内容一致性)
engine_render_error — failed-shots error 非超时类 / all-degraded
bgm_trigger         — BgmTriggerError 特征串(prompt 违禁词)
delegate_timeout    — runner error_info
delegate_parse      — runner error_info
schema_validation   — runner error_info
needs_regenerate    — p11a0 shortfall(预算尽无 pass)
take_verdict_*      — p11b verdict 五值(keep/fix_in_post/edit/re_roll/rewrite)汉化标签
unknown             — 兜底(展开看原始日志截断)
```
行 = 勾选框 + shot_id + phase 徽章(`v3theme.phaseGroup` 四色)+ 错误类别徽章(`v3theme.signal.*`)+ 原因截断;展开 = take_log 条目(take_n/changed_variable/seed/evidence)+ 原始 error 全文。taxonomy 在 envelope 契约里固化为 zod enum,Wave B 透传时对号入座;Wave A 面板用 fixture 驱动。

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| VariantPicker 460px 模态点击即选 | 全屏审片剧场 + 显式选定 | 本 phase | 检视/选定解耦 (D-08) |
| 本地 selectWinner + 💾 保存双轨 | optimistic + select-winner 端点 | Phase 49 D-04 已接线 | 墙直接复用机制,只换交互 |
| needsThumbnailing 单一判定 | + isThumbnailMissing 四态自愈(save hook) | 已修(memory 事故) | 墙需前端触发段补齐渲染期 |
| variantGroups 仅 UI 手建 | Wave A 候选组推导物化 | 本 phase | select-winner 对 kmc 候选可用 |
| khs 候选透传无 score | envelope 含 score(scale 声明) | Wave B | kap 侧展示先就位 |

**Deprecated/outdated:** 53-CONTEXT 的"select-winner 前端未接"表述已过时(canvasStore v3 路径已接 + 有测试);`render-shot.ts`/`resume.ts` 的 gold-team/OpenClaw 通道是遗留,不得作为 G15 requeue 通道。

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | rAF 主时钟 + 120ms 硬 seek 足够同播(未真机验证多 video 并发解码) | DR-5 / Code Examples | 需降卡数或改 seek 策略;逻辑在纯模块可调 |
| A2 | manifest 回写通道的具体传输(FS 直写 workdir vs HTTP)未定 — Wave B 决 | Pattern 3 / Open Questions | Wave A 只建 hook 位 + 队列,通道抽象为 deps 注入则无返工 |
| A3 | G15 requeue 的 kmc 侧接指令端点在 Wave B 才存在;Wave A 桥以 review-platform approve 注释通道 + fixture 验证 | DR-6 / VAR-04 | 若 kmc 永远不接,G15 重渲退化为指令落队;面板/队列不受损 |
| A4 | p03 落选候选今天实际不上画布(`_CANDIDATE_FILES` 仅 p01) — 据 L5456 静态核读,未跑真数据验证 | Current Wire Formats 源 2 | 若实际有其他路径补 p03,envelope fixture 多一份形状,无损 |
| A5 | `min(duration)` 作为墙时长窗口的体验合理性未用户验证 | DR-5 | 可改 max+黑边或首 take 时长;一行策略改动 |

## Open Questions (RESOLVED)

> 2026-08-21 planner 复核:三问实质均已解决——Q3 采纳于 53-03;Q1/Q2 按 D-01 路由 Wave B(Wave A 落地点已定)。逐条 Resolution 注明去向。

1. **manifest 回写通道(Wave B 决,Wave A 只留抽象)** — RESOLVED:Wave A 落地 = 53-04;FS vs HTTP 裁定路由 Wave B
   - What we know: kap 后端对 khs workdir 有同机 FS 通道先例(/local-file 白名单覆盖 kais-hermes-skills/runs);review-platform approve 的 `choose:v{N}` 注释是唯一既有机器可读选定通道。
   - What's unclear: 直接写 iframe-manifest.json 与 kmc 重跑的竞态归属(COORD-01 范畴)。
   - Recommendation: Wave A 把 `manifestWriteback` 做成 deps 注入接口(传输实现留空 + fixture),Wave B plan 时定。
   - Resolution: 53-04 采纳 Recommendation——`ManifestTransport` deps 注入接口 + `getManifestTransport()` 读 KMC_MANIFEST_TRANSPORT(Wave A 无实现返回 null,warn-once 不入队);FS/HTTP 裁定与竞态归属留 Wave B plan(挂接点 getManifestTransport / replayManifestWriteback,53-04-SUMMARY 记录)。
2. **G14 预览"chosen_variant_id" 的 kmc 消费端语义** — RESOLVED:kmc 消费端核实路由 Wave B;Wave A 参数面已通用化(53-04)
   - What we know: p11a gate payload chosen={variant_id, clip_path, qwen_eye};p01 的 `_creative_hook_selector` 已支持 gate outcome `chosen_variant_id` 覆写(L307-325)。
   - What's unclear: p11a 侧是否有对称的 selector 消费(未核 p11a 全文)。
   - Recommendation: Wave B 核;Wave A 端点参数面按 `source: 'p11a_preview'` + variantIndex 通用化,不锁字段名。
   - Resolution: 按 D-01 路由 Wave B——Wave A 已照 Recommendation 落地(53-04:source enum + variantIndex,无 frameSlot 时 target.field = chosen_variant_id 通用化,不锁 G14 字段名);p11a 对称 selector 消费端核实入 Wave B plan。
3. **候选组物化的触发时机**(load 时派生 vs sync 接收时物化) — RESOLVED:采纳 Recommendation,落地 = 53-03
   - Recommendation: planner 定 — 倾向 load 路径派生 + 确定性 group id(幂等),避免与 khs 重同步(delete-absent)互相清组。
   - Resolution: 53-03 采纳——load-v2 全量加载路径(无 since)派生 + 确定性幂等 id `cand:{groupKey}` + best-effort try/catch 降级(加载响应不受影响);S2 断言锁幂等与用户组保护,与 khs 重同步互不清组。

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| node | 全部 | ✓ | v24.13.0 | — |
| sqlite (knex) | 队列表/契约测试 | ✓ | 既有 data/db2.sqlite 通道 | — |
| ffmpeg | 缩略图自愈 | ✓ | 6.1.1-3ubuntu | — |
| python3 | (Wave B 四道闸 pytest) | ✓ | 3.12.3 | Wave A 不需要 |
| review-platform | G15 桥/G14 闭环真实调用 | ✗(容器名 review-platform:8090,本机不可达,未验) | — | deps 注入 + fixture(桥设计已内建);真实链路 Wave B |
| khs2 repo | 契约只读核读 | ✓(只读) | Phase 25 mid-flight | 禁改(D-01) |

**Missing dependencies with fallback:** review-platform 真实端点 — Wave A 全部验证走注入 fetch + fixture,无阻塞。
**Missing dependencies with no fallback:** 无。

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^2.1.9 (packages/infinite-canvas, `npm run test` 于包内);root 侧契约用 tsx 脚本 |
| Config file | packages/infinite-canvas/vitest.config.*(既有);root 无 vitest — verify 脚本范式补位 |
| Quick run command | `cd packages/infinite-canvas && npx vitest run src/components/variants` |
| Full suite command | `npm run verify:phase-53` (+ 包内 `npm test`);e2e 前须 `npm run build` |

### Phase Requirements → Test Map (Wave A)
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VAR-01 | envelope 解析今日形状 + Wave B 形状,round-trip 字段不丢 | unit/contract | `npx tsx scripts/verify-phase-53.ts`(S1) | ❌ Wave 0 |
| VAR-01 | legacy 归一化(a-flf/c-* → 信封) | unit | `npx vitest run src/lib/__tests__/candidateEnvelope.test.ts`(如放 root 则 tsx) | ❌ Wave 0 |
| VAR-01/03 | 候选组推导幂等 + groupKey 词表与 Phase 48 一致 | integration(:memory: knex) | verify-phase-53 S2 | ❌ Wave 0 |
| VAR-02 | wallTransport 漂移校正/solo mute/timeline span 纯逻辑 | unit(fake video) | `npx vitest run src/components/variants/__tests__/wallTransport.test.ts` | ❌ Wave 0 |
| VAR-02 | 键盘流映射(1-9/Enter/←→/空格) | unit | vitest useWallKeyboard.test.ts | ❌ Wave 0 |
| VAR-02 | 缩略图自愈三段(onError→POST→fallback),fetch mock | unit | vitest wall thumbnail heal test | ❌ Wave 0 |
| VAR-03 | select-winner 扩展:frameSlot 透传、幂等分支不触发 hook、hook 失败不影响 200 | integration | verify-phase-53 S3(真模块 + mkdtemp DB) | ❌ Wave 0 |
| VAR-03/D-10 | 队列入队/退避/重放/幂等 | integration | verify-phase-53 S3 | ❌ Wave 0 |
| VAR-02 前端接线 | 选定 optimistic+回滚(canvasStore 既有 selectWinner 测试扩展断言) | unit | `npx vitest run src/store/__tests__/selectWinner.test.ts` | ✅ 既有可扩 |
| VAR-04 | G15 桥 waive/requeue payload 形状 + 吞错 + 409 语义 | unit(注入 fetch) | vitest g15Bridge.test.ts | ❌ Wave 0 |
| VAR-04 | 面板勾选/动作条/二次确认状态机 | unit | vitest G15TriagePanel.test.tsx | ❌ Wave 0 |
| 全体 | forced-failure 自检(gate 能失败) | contract | verify-phase-53 S5 | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** 包内 `npx vitest run <相关文件>`(<30s)
- **Per wave merge:** `npm run verify:phase-53` + 包内 `npm test`
- **Phase gate:** verify:phase-53 全绿 + forced-failure 自检行为正确后才 `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `scripts/verify-phase-53.ts` — S1..S5 骨架 + npm script 注册(package.json scripts,41 行后)
- [ ] `src/lib/__tests__/` 或 root 测试位约定(root 无 vitest — 契约测试放 verify 脚本,TS 断言用 node:assert,verify-phase-51 同款)
- [ ] 包内 `src/components/variants/__tests__/` 目录(现有 store/__tests__ 先例)
- [ ] fixture 文件: 两代 candidate 样本(今日 a-flf/c-* data 快照 + Wave B 信封样本)+ take-log/failed-shots 样本

*(e2e: 墙为全屏 overlay,detail-panel phase35 契约不回归即可;墙自身 e2e 可选,组件单测优先 — 93 镜真机验收属 HUMAN-UAT。)*

## Security Domain

`security_enforcement` 未显式关闭(absent = enabled)。本 phase 无新 auth 面(平台已移除 review 通道 token,reviewBridge 头注释 L17-18 确认),但新增两个入参面:

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | 既有会话;无新凭据 |
| V3 Session Management | no | — |
| V4 Access Control | partial | 新端点 g15-ops 与 select-winner 同信任域;groupId/winnerNodeId 走 zod max(128) 长 bound(T-49-01 先例) |
| V5 Input Validation | **yes** | zod:envelope schema、select-winner 扩展字段、g15-ops body(shotIds 数组 bounded ≤200, action enum) |
| V6 Cryptography | no | — |
| V12 File Handling | **yes** | 缩略图自愈 sourcePath 只接受 /oss/ 形态(端点内 needsThumbnailing 前置即白名单);**Wave B**: manifest FS 直写须路径约束在 episode workdir 内(防目录穿越)— 记入 Wave B plan 检查项 |

### Known Threat Patterns for express + sqlite + FS 通道
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL 注入 | Tampering | knex 参数化(既有);队列 payload 走 JSON 列非拼接 |
| 路径穿越(缩略图/回写) | Tampering/Elevation | /oss/ 前缀校验 + /local-file 白名单(既有);Wave B workdir 约束 |
| 越组选定(跨 episode/项目) | Elevation | selectWinnerInGroup 复合主键 scope where(既有 L452-456);桥端 fail-closed 三维匹配(reviewBridge L196-208 先例) |
| 队列重放风暴 | DoS | max_attempts + 指数退避 + drain 串行 |

## Sources

### Primary (HIGH confidence — 全部本机代码库直读)
- `/data/workspace/kais-hermes-skills/plugins/kais_aigc/canvas_sync.py` — `_extract_candidates` L5394 / `_CANDIDATE_FILES` L5456 / `_load_candidate_variants` L5460 / `_load_iframe_flf_artifacts` L5618 / `_flf_variant_of` L725 / score 提取 L2518 / call site L1339-1360
- `/data/workspace/kais-hermes-skills/plugins/kais_aigc/canvas_graph.py` — `add_candidate_node` L896-984 / variantGroups 空 normalize L401-402
- `/data/workspace/kais-hermes-skills/skills/kais-movie-pipeline/pipeline/phases/_manifest.py` — MANIFEST_PARAM_SCHEMA L64-74 / PHASE_REQUIRED_FIELDS L126-138
- `/data/workspace/kais-hermes-skills/skills/kais-movie-pipeline/pipeline/phases/p11a0_iframe_qc.py` — per_slot 形状 L1343-1360 / selected_first/last_variant 回写 L1377-1381
- `/data/workspace/kais-hermes-skills/skills/kais-movie-pipeline/pipeline/phases/p11a_preview_clips.py` — JSONL 字段 L32-36 / chosen payload L1270-1281
- `/data/workspace/kais-hermes-skills/skills/kais-movie-pipeline/pipeline/phases/p11b_final_render.py` — take_log schema L1103-1115 / asset_bus_write L2683
- `/data/workspace/kais-hermes-skills/skills/kais-movie-pipeline/pipeline/phases/p11c_video_qc.py` — slots L52-55/L80 / judge dims L147 / gate payload L597-624
- `/data/workspace/kais-hermes-skills/skills/kais-movie-pipeline/pipeline/phases/p03_script_audit.py` — N=3 L54 / dims L1005/L1064 / 分带阈值 L96-105
- `/data/workspace/kais-hermes-skills/skills/kais-movie-pipeline/pipeline/phases/_creative_hook_selector.py` — gate outcome chosen_variant_id 覆写 L307-325
- kap: `src/routes/canvas/v2/select-winner.ts`(全 179 行)、`src/lib/reviewBridge.ts`(全 258 行)、`src/lib/canvasRelationalStore.ts`(L367-700)、`src/lib/candidateGrouping.ts`(L1-120)、`src/lib/canvasAssetSchema.ts`(全 204 行)、`src/types/flowgraph-v2-schema.ts`(全 110 行)、`src/lib/thumbnail.ts`(L110-240)、`src/routes/canvas/v2/thumbnail/{index,batch}.ts`、`src/lib/canvasAssetLinkage.ts`(头注释)、`src/lib/initDB.ts`(L1090-1347)、`scripts/verify-phase-51.ts` / `verify-manifest-contract.ts`、`schema/pipeline-field-map.yaml` + `schema/generated/frontend-zod-extensions.ts`
- kap 前端: `packages/infinite-canvas/src/components/variants/VariantPicker.tsx`(全 137 行)、`variantPickerStore.ts`、`store/variantOps.ts`(L66-164)、`store/canvasStore.ts`(selectWinner 两路径 ~L893-973)、`v3/adapter.ts`(VariantStackData L606 / stackByWinner L679 / seedOfAsset L656)、`utils/mediaUrl.ts`(L89)、`theme/catppuccin.ts`(全 248 行)、`hooks/useStale.ts`(L48)、`hooks/useCanvasSocket.ts`(L195-215)、`components/nodes/AssetCardNode.tsx`(L272/L288/L343)、`components/panel/NodeDetailPanel.tsx`(L36/L135/L278)、`components/assetManager/AssetLibrary.tsx`(L824-830)、`components/StoryboardTimeline.tsx`(三态契约 L137-257)
- `packages/flowgraph-v3/ts/src/types.ts` — AIScore L60-63 / AssetNodeV3.media L74-82 / curation L90

### Secondary (MEDIUM confidence)
- 无 web 检索源 — 本 phase 研究全部代码库直读,无第三方声明需交叉验证。

### Tertiary (LOW confidence)
- 无(rAF 同播技术为 [ASSUMED] 工程实践,已入 Assumptions Log A1)。

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — 零新增依赖,全既有
- Architecture: HIGH — 挂点/事务/桥/广播逐行核读;唯一结构性发现(组推导前置)有 triple 证据(khs 不写组 + linkage 注释 + 端点查表)
- Pitfalls: HIGH — 每条对应已核代码行或 memory 事故档案
- khs wire formats: HIGH(静态核读)/ A4 一处未跑真数据

**Research date:** 2026-08-21
**Valid until:** 2026-09-04(代码库演进快;若 Wave B 期间 khs canvas_sync 又改候选透传,重核 §Current Wire Formats)
