# flowgraph-v3

《AI短剧创作无限画布 · 设计宪法 v1.0》落地 **步骤 1（V3 schema + 迁移脚本）+ 步骤 3（契约 harness）** 的交付包。
语义唯一权威是设计宪法；代码唯一权威源（SSOT）是 `schema/flowgraph-v3.schema.json`（JSON Schema draft 2020-12，`additionalProperties: false` 全程，受控例外仅 `GenerationParams` 与 `AIScore.dimensions` 两处，均有 `$comment` 标注）。

## 布局

```
schema/flowgraph-v3.schema.json   # SSOT
ts/                               # TypeScript 层（前端/后端共用）
  src/types.ts                    # 类型（镜像宪法 §7–§13）
  src/zod.ts                      # Zod 校验（含 stage↔meta 交叉校验）
  src/migrate.ts + v2types.ts     # §14 V2→V3 迁移（含引用完整性尾检）
  src/stale.ts                    # P13 脏传播纯函数
  src/variants.ts                 # P12 变体选定联动纯函数
  src/integrity.ts                # 引用完整性检查（7 类 issue）
  src/importFromDir.ts            # §16 shot-timeline → FlowGraphV3（import-from-dir 映射升级）
  src/layout.ts                   # 宪法步骤 4 布局引擎：拓扑分层 × 泳道 × 第 0 列 × role 分流（P7/P8/P9/P11/P12/P19）
py/                               # 契约 harness（P21/P22/P25）
  flowgraph_v3/models.py          # Pydantic v2（与 schema 逐字段对齐）
  flowgraph_v3/harness.py         # producer / consumer / e2e / lint 四模式 CLI
  flowgraph_v3/selftest.py        # P25 自验证（注入漂移，断言 fail-loud）
fixtures/                         # V2 导出样本、V3 全要素样本、未知字段样本
  shot-timeline-sample/           # §16 真实样本（shots/prompts/audio_analysis/transcript，93 镜头 + 4 stems）
  v3-decompose-import.sample.json # 上述样本经 importShotTimelineAsset 的确定性映射输出
```

## 快速开始

> 注意：`/mnt/agents/output` 文件系统不支持 symlink，`npm install` 会失败。
> 请在本地普通文件系统（如 `$HOME` 的 checkout / worktree）里安装与测试。

```bash
# TS 层
cd ts && npm install && npx vitest run && ./node_modules/.bin/tsc --noEmit

# 契约 harness
cd py && pip install -e .[dev] && python -m pytest -q && python -m flowgraph_v3.selftest

# harness 四模式
python -m flowgraph_v3.harness producer <file.json>   # 生产端严格校验，失败退出码 1
python -m flowgraph_v3.harness consumer <file.json>   # 消费端 graceful-degrade，恒退出 0 + warnings
python -m flowgraph_v3.harness e2e <file.json>        # round-trip 保真
python -m flowgraph_v3.harness lint <file.json>       # 引用完整性 lint
```

## 当前版本：schema 3.1（semver-lite）

- 3.0：FlowGraphV3 初版（事件实体、槽位边、变体组、TimelineStructure）。
- 3.1（minor）：`VariantGroupV3.selectMode` 新增枚举值 `'locked'`（宪法 §11 解构集整组锁定展示的表达）；AssetNodeV3 增加 `stage ↔ meta.stage` 一致性约束（allOf if/then）。无改名/删字段/加 required。

## 假设清单（宪法未定义处的最小合理决策，代码内均有注释标注）

1. **ReviewStatus / AIScore / FlowBranchV2 / StructureNodeV3**：宪法注明"复用 V2"但未给定义 → 最小定义（ReviewStatus 三态；AIScore = overall + dimensions 开放 map；FlowBranchV2 = id/name；StructureNodeV3 = kind+structureType）。**接入旧库前需对齐真实 V2 定义。**
2. **V2 导出结构**（`v2types.ts`）：整体反推自宪法 §14 映射表左列，待与旧库真实导出对齐。
3. **AssetStageMeta 补 `{stage:'mix'}` 空载荷分支**：宪法 Stage 枚举含 mix 但 §8 联合未列分支，否则 mix 资产无合法 meta。
4. **phaseIndex/phaseName 编号**：按泳道序（global=0 … composite=9），属展示层约定。
5. **video → video/composite 判定**：按 isMasterTimeline/edlRef/phaseName 线索推断（`inferVideoStage`），无法判定的进 `report.warnings`。
6. **locked 语义**：locked 资产不标脏、不传播脏（§13 传播终点）；selectVariant 对 locked 组抛错。
7. **selectMode:'locked'**：宪法 §11 说解构集"selectMode 语义变为整组锁定展示"但枚举未含该值 → 作为 minor 扩展补齐（3.1）。
8. **非 winner 变体配方**：存于事件 `params.variantRecipes`（§9 开放扩展点），保证可复现。
9. **winner 切换后的下游脏标记**：纯函数不级联，由编排层调用 `markStaleDownstream`（注释已写明）。
10. **有向环**：视为非法输入，`markStaleDownstream` 防御性终止，不保证业务语义。
11. **stems→三轨映射假设（待与 producer 确认）**：shot-timeline 的 demucs 4 轨 → 宪法三轨：`vocals→voice`、`other→foley`、`drums/bass→bgm`（两个 bgm 资产）。`TimelineShot.bgm` 是单槽位，无法承载 drums+bass 两条 bgm stem：确定性取舍为指向 stems 顺序中首个 bgm 资产（`asset_stem_drums`），取舍本身进 `ImportReport.warnings`（代码注释【stems→三轨映射假设，待与 producer 确认】）。
12. **shotType:'unknown' 诚实缺省**：shot-timeline 样本无景别字段，93 个 storyboard 资产的 `meta.shotType` 一律 `'unknown'`，不臆造。
13. **zone 未实现**：schema（3.1）无 zone 字段，§16.3「拉片参考区」语义由独立 branch（`br_reference`，`FlowBranchV2 name:'拉片参考'`）+ `curation:'locked'` 承载；zone 圈定留给步骤 4 布局引擎。
14. **schema gap 记录（候选 minor：`TimelineShot.observedAudioType`）：audio_analysis 的 per-shot `dominant_type`（dialogue/bgm/sfx/mixed）与 episode 级 `type_distribution` 在 schema 3.1 无槽位，按决策**禁止偷渡进 params/meta**，只进 `ImportReport`（`perShotAudioType` / `typeDistribution`）。若要在图内持久化，建议 minor 扩展 `TimelineShot.observedAudioType`，待宪法补原则后落地。
15. **事件泳道 = 首产出泳道（P19 落地）**：事件无 stage，y 取该事件首个 `role:'output'` 边目标资产的泳道（按 links 顺序，确定性）；无 output 边时退回首个因果入边来源泳道，再无则第 0 泳道。x = max(输入层)+0.5 列；无因果输入的种子事件取 min(输出层)−0.5 列；既无分层输入又无分层输出（如只产出 global 资产的 import 事件）钉在第 0 列左侧 −0.5 列入种口。
16. **第 0 列内 global 资产沿 y 堆叠（P9 落地）**：多个 scope:'global' 资产在 global 泳道带内按 id 序沿 y 方向堆叠（步进 = 节点高 + gap），x 一律 0，不与其他泳道抢道；同（泳道, 半列）的多个事件芯片按 id 序加 1/4 列宽子槽位避免芯片互叠。

## 后续步骤（宪法落地顺序 2/4/5/6）接口预留

| 步骤 | 本包已备好的接口 |
|---|---|
| 2. import-from-dir 映射升级（§16） | **已交付**（本分支）：`ts/src/importFromDir.ts` 的 `importShotTimelineAsset` 把 ShotTimelineAsset 四文件映射为「1 composite 成片 + 1 shot_decompose 事件 + 93 分镜 + 4 音轨 + 97 output 边 + 92 sequence 边 + 1 个 selectMode:'locked' 解构集」；真实样本与确定性输出见 `fixtures/shot-timeline-sample/` 与 `fixtures/v3-decompose-import.sample.json` |
| 4. 布局引擎 | **已交付**（feat/layout）：`ts/src/layout.ts` 的 `layoutFlowGraph` / `applyLayout`——因果边最长路分层为 x 列（P7）、Stage 十泳道为 y（P8）、global 资产钉第 0 列（P9）、sequence 只做同泳道横向排序（P11）、deprecated 变体贴 winner 坐标标 stacked（P12）、事件芯片落边上（P19）；`position` 即布局缓存（P17 语义），applyLayout 写回不 mutate 入参 |
| 5. 视图整合 | Zod 校验 + media 三件套字段（original/proxy/thumbnail/waveform） |
| 6. 基准库与自洽环 | TimelineStructure 正逆向同构，compose/decompose 两 source 形态均有 fixture |

## 验证状态（main @ 交付时）

- TS：vitest **63/63** 通过，`tsc --noEmit` 干净
- PY：pytest **20/20** 通过，`selftest` 3/3 漂移抓住（P25）
- 双路独立审查（reviewer + verifier 对抗性探测）发现的 8 项缺陷已全部修复并回归

## 验证状态（feat/import-from-dir @ §16 交付）

- TS：vitest **81/81** 通过（importFromDir 新增 18 条），`tsc --noEmit` 干净
- PY：pytest **23/23** 通过（decompose fixture 的 producer/e2e/lint 新增 3 条），`selftest` 3/3 漂移抓住
- `fixtures/v3-decompose-import.sample.json` 四模式 CLI 手工确认：producer / consumer / e2e / lint 退出码全 0（e2e faithful=true，lint 0 issue）

## 验证状态（feat/layout @ 宪法步骤 4 交付）

- TS：vitest **101/101** 通过（layout 新增 19 条），`tsc --noEmit` 干净
- 真实解构样本实测：拓扑 3 层（≤4）；93 分镜 x ∈ [640, 30080] 步进 320 且与 shot index 完全同序；泳道节点数 storyboard 94（93 资产 + 1 事件芯片）/ voice 1 / foley 1 / bgm 2 / composite 1
