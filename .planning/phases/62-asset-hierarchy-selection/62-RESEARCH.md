---
phase: 62-asset-hierarchy-selection
researched: 2026-08-24
status: complete
confidence: HIGH
---

# Phase 62 Research: 资产管理中心资产层级与选定逻辑

研究范围：kap 仓画布侧（`packages/infinite-canvas` + `src/`）三层层级视图、层级化选定、pre/final 冗余配置入口；khs 仓只读快照核验。全部结论以 2026-08-24 实读代码/磁盘为准，引用为 `file:line` + 原文摘录。

**重要总发现（影响 D-05/D-08/D-10 三个决策的实施细节，决策方向本身全部可落地）：**
1. 资产中心选定 → 画布组联动**已存在服务端半通道**（PATCH isPrimaryView=true 自动触发 `applyRegistrySelectionToCanvas`），D-05 的客户端 fire-and-forget 是第二通道，幂等安全但常见路径下会是 no-op。
2. `/mnt/agents/output/pipelines/pipe-*/requirement.json` **本机不可写**（uid 错配 EACCES）——D-08② 的 pipe-* 反查写回在本部署恒走「文件面寻址失败」三态；khs runs 工作区（`/data/workspace/kais-hermes-skills/runs/`）可写但是 **episode 目录寻址、无 projectId 字段**。
3. khs 键面快照已漂移：Phase 26 已 shipped、27-01 已 shipped（runner 默认表已含全部嵌套键），嵌套键实际为 **11 个**（`p09_shotlist.transition` 被 27-02 单键裁决合并），不可配报告/审计节点为 **18 个**（非 29）。

---

## A. 覆盖层表挂载（D-08①）

### DB 引擎与文件

`src/utils/db.ts:19-26` — knex + **better-sqlite3**，单文件 `<cwd>/data/db2.sqlite`：

```ts
const db = knex({
  client: "better-sqlite3",
  connection: { filename: dbPath },
  useNullAsDefault: true,
});
```

运行实例（10588 端口）以 kai 用户跑 `node data/serve/app.js`（`NODE_ENV=production PORT=10588`），DB 落在仓库 `data/db2.sqlite`。

### DDL / 迁移模式：boot 时建表，无独立迁移脚本

`src/lib/initDB.ts:1256-1392` — `relationalCanvasTables: TableSchema[]` 数组，每项 `{ name, builder }`，boot 时 hasTable 守卫 + createTable：

```ts
// initDB.ts:1386-1392
for (const t of relationalCanvasTables) {
  const tableExists = await knex.schema.hasTable(t.name);
  if (!tableExists) {
    console.log("[初始化数据库] 创建关系型画布表:", t.name);
    await knex.schema.createTable(t.name, t.builder);
  }
}
```

boot 链（`src/utils/db.ts:57-62`）：`initDB(db)` → `fixDB(db)` → loadAllFromDB → seed。**既有部署零迁移风险**：新表 append 进 `relationalCanvasTables` 即在下次重启自动建表（幂等）。已上线 10588 实例重启后自动获得新表。

对**已存在表加列**的惯例在 `src/lib/fixDB.ts:12-17`（`addColumn` + hasColumn 守卫）——Phase 62 新表用不到，但 DDL 后续演进走这里。

### 新表 `generation_config_overrides` 应遵循的确切模式

复合主键惯例：scope 维表（无自然 id）用 `table.primary(["project_id", "episodes_id"])`（`initDB.ts:1356` canvas_graph_meta 先例）。建议 DDL：

```ts
{
  name: "generation_config_overrides",
  builder: (table) => {
    table.integer("project_id").notNullable();
    table.integer("episodes_id").notNullable();
    table.string("phase_key", 64).notNullable();   // "p01_hook.topic_kernel" 形态
    table.integer("n_candidates");                  // null = 未覆盖该旋钮
    table.integer("final_candidates");
    table.bigInteger("updated_at").notNullable();
    table.primary(["project_id", "episodes_id", "phase_key"]);
    table.index(["project_id", "episodes_id"], "idx_gco_scope");
  },
}
```

（n_candidates/final_candidates 可空列支持「只覆盖 final 一个旋钮」——khs resolver 两旋钮独立解析语义，`_vision_review.py:54-59`。是否允许半覆盖由 planner 定夺；可空列是零成本保留。）

Store 读写函数挂 `src/lib/canvasRelationalStore.ts`（同域惯例），UPSERT 走 `db.raw INSERT ... ON CONFLICT ... DO UPDATE`（`upsertNode` 先例 96-146 行）或 knex `onConflict().merge()`。

### 路由惯例（v2 系）

`src/routes/canvas/v2/*.ts` 每文件一个 express Router：`zod safeParse` 门 → `success()/error()` 信封（`src/lib/responseFormat.ts`）→ `src/router.ts` 挂载表注册（如 `router.ts:203` `app.use("/api/canvas/v2/variant-groups", route167)`）。

**信封陷阱**：`error()` helper 的 body `code` 恒为 400（`responseFormat.ts:16-22`），HTTP 状态码另由 `res.status()` 给出（404/409/500…）。mock 与客户端判定必须看 HTTP status，不能看 body.code。

最接近的 per-scope 配置读端点先例：`src/routes/canvas/v2/gate-state.ts`（GET + `z.coerce.number().int()` query + service 层）。写端点先例：select-winner.ts 的 body zod + 状态码分级。

---

## B. requirement.json 寻址面（D-08②）

### 磁盘现状实测

`/mnt/agents/output/pipelines/` 下 15 个 `pipe-*` 目录，其中 **11 个含 requirement.json**（另 4 个无）。抽样 `pipe-1779893307001-ls83lp/requirement.json`（最新 mtime 2026-05-27 22:48）：

- **无 `generation_config` 键、无任何 `n_candidates`/`final_candidates`**——`grep -l "generation_config|n_candidates|final_candidates" */requirement.json` 命中 0 个。CONTEXT「现存均为 v2.5 前旧形态」**核验成立**。
- 有 `project_id: "1779861265924"` 与 `projectId: "1779861265924"`（字符串，两键并存）、`episodesId: null`、`mode: "canvas"`——projectId 反查寻址可行。

**khs runs 工作区**（可配置 base 候选）：`/data/workspace/kais-hermes-skills/runs/<ep-name>/requirement.json`（ep-cat-heist、ep-xiaojianghu-v2 等 5 个）。实测：

- `runs/ep-xiaojianghu-v2/requirement.json` keys = `[aspect_ratio, comedy_subtype, creative_brief, duration_sec, episode_count, form_factor, genre, language, mood, must_have_elements, platform, target_audience, title, tone, visual_style]` —— **无 projectId/project_id、无 generation_config**。寻址靠**目录名（episode 名）**，与 pipe-* 的 projectId 反查是两套寻址面。
- `runs/<ep>/.pipeline-assets/requirement.json` 是**另一个东西**（slot 台账：`{episode_id, payload, schema_version, slot, source, written_at}`）——**不要**把 generation_config 写到这里。

### 写权限（关键风险，实测）

```
drwxr-xr-x  dnsmasq systemd-journal  /mnt/agents/output/pipelines/pipe-*/
-rw-r--r--  dnsmasq systemd-journal  requirement.json
```

容器 uid 错配 → kap 进程用户 `kai (uid 1000)` 对 pipe-* 子目录 **touch 实测 EACCES（权限不够）**。`/mnt/agents/output` 顶层本身 777，但 requirement.json 都在不可写子目录里。结论：**本部署上 D-08② 对 pipe-* 的原子写回（tmp+rename 同目录）恒失败**——三态徽标设计恰好吸收该失败（显示「文件面寻址失败——覆盖层已保存」），但 planner 必须知道「已同步 requirement.json」态在本机**实际只能经 khs runs base 达成**。khs runs 目录 kai 可写（实测 touch 成功）。

### 可配置 base 的既有 env 机制

- `OUTPUT_DIR`（默认 `/mnt/agents/output`）——`src/app.ts:75`，/oss 静态后备源。
- `KAIS_OUTPUT_DIR`——**默认值三处不一致**：`src/app.ts:113-115` = `/data/workspace/kais-hermes-skills/runs`；`src/routes/canvas/v2/file.ts:12-13` 与 `review-gate.ts:9-10` = `/data/workspace/kais-movie-agent`（260702 已退役仓）。`.env` 只设了 `OUTPUT_DIR`，`KAIS_OUTPUT_DIR` 未设。
- 建议：Phase 62 引入**专用 env**（如 `KHS_RUNS_DIR`，默认 `/data/workspace/kais-hermes-skills/runs`），不要复用语义已分裂的 KAIS_OUTPUT_DIR。

### 既有 HTTP 文件面

- `/oss/*` 是**纯读**静态（`app.ts:72-87`，express.static + pipelineOutputDir 后备）——phase 59 的翻译模式只解决读路径。
- `POST /api/v2/canvas/file/write`（`file.ts:101-151`）存在但 **ALLOWED_ROOTS 不含 /mnt/agents/output**（`file.ts:18-23`），且是全量覆盖 + .bak 快照（非 tmp+rename 原子写）。
- `review-gate.ts:97-110` 是最接近的「受控服务端写文件」先例：`KAIS_OUTPUT_DIR/.review-state/<nodeId>.json` + 路径包含检查 + writeFileSync。

**结论：requirement.json 写回不能复用 file.ts（白名单不含目标根 + 非原子写），需要新端点**，沿 review-gate 的守卫模式（env base + 固定相对路径 requirement.json + resolve 后包含检查 + `fs.writeFileSync(tmp)` → `fs.renameSync(tmp, target)` 原子替换 + mtime 乐观锁按 Claude's Discretion 落地）。读侧同理由新路由服务端直读（不经 /oss）。

---

## C. select-winner 复用面（D-05）

### 端点契约

**`POST /api/canvas/v2/variant-groups/:groupId/select-winner`**（挂载 `src/router.ts:203`；实现 `src/routes/canvas/v2/select-winner.ts:72-221`）

body（zod，`select-winner.ts:44-52`）：

```ts
{ projectId: number, episodesId: number, winnerNodeId: string /*1-128*/,
  frameSlot?: 'first'|'last', source?: candidateSource }
```

需要的是 **winnerNodeId（画布节点 id）**，不是 asset id。响应 `{ groupId, winnerNodeId, applied: true|false }`。

**客户端已有封装可直接复用**：`canvasApi.ts:482-494` `selectVariantWinner(projectId, episodesId, groupId, winnerNodeId, cancelToken?, frameSlot?)`——非 2xx 抛 ApiError。

### D-07 反向同步幂等性：确认成立

`select-winner.ts:111-117` —— idempotent 分支（重选同 winner）**在任何 o_assets 写之前 return**：

```ts
if (result.status === "idempotent") {
  // D-03: re-selecting the current winner carries no new information —
  // no o_assets swap, no broadcast, no bridge.
  return res.status(200).send(success({ groupId, winnerNodeId, applied: false }));
}
```

updated 分支的 `syncAssetPrimaryForWinner`（`canvasRelationalStore.ts:571-635`）promote winner + demote 同 projectId 家族/成员——与资产中心已写的 isPrimaryView 值一致，重放安全。

### 失败形状（fire-and-forget 调用方需知）

- `400` 参数校验失败（zod issues）
- `404` `{message:"变体组不存在"}` — scope 内无 `canvas_variant_groups` 行
- `409` 三种：winnerNodeId 不在组内 / select_mode ≠ single / 组含 `curation:'locked'` 成员（WR-09）
- `200 applied:false`（幂等 no-op，非失败）
- `500` 选定操作失败

**「图未加载」不是失败模式**——端点直读 DB 表（`selectWinnerInGroup` 查 `canvas_variant_groups`/`canvas_nodes` 行，`canvasRelationalStore.ts:446-557`），与客户端 graph 加载状态无关。组不存在 = DB 无行 = 404。

### 重叠通道（CONTEXT 未提及的既有事实）

`PATCH /api/v1/assets-registry/:id` 置 `isPrimaryView===true` 时**服务端已自动联动画布**（`src/routes/v1/assets-registry/index.ts:225-229`）：

```ts
if (updates.isPrimaryView === true) {
  void applyRegistrySelectionToCanvas(u.db, id).catch(...)
}
```

`applyRegistrySelectionToCanvas`（`src/lib/canvasAssetLinkage.ts:126-168`）：`findCanvasNodesForAsset`（`a-oasset-{id}` 精确 id 或 `json_extract(data,'$.oAssetId')`，**全部 episodes**）→ 节点有 `variant_group_id` 列则直接调 `selectWinnerInGroup`（不经 HTTP）。

含义（planner 必须纳入 D-05 实施语义）：
1. handleSelect 的 `updateAsset(id, {isPrimaryView:true})` **今天就会**触发该联动——D-05 的客户端 select-winner POST 在常见路径（节点带 variant_group_id 列）到达时已是幂等 no-op（200 applied:false）。
2. 客户端 POST 的**真实增量**：① 节点 `variant_group_id` 列为 NULL 但 `canvas_variant_groups.variantNodeIds` 含该节点（两套成员源错配时，见 D 节）——此时服务端 linkage 跳过而 HTTP 端点能选定；② 仅当客户端 POST 是那个真正翻转状态的通道时才触发 review bridge + manifest writeback + WS 广播（linkage 路径直调 selectWinnerInGroup，**刻意**跳过这三件套防环）。
3. 双通道并发安全：都写同一 (group, winner) 值，后到者幂等。D-05 按 CONTEXT 落地客户端 fire-and-forget 是安全的；但要意识到 o_assets→canvas 的兜底同步已存在，客户端调用主要价值在覆盖成员源错配 + 让 bridge/manifest 在该通道上有机会触发。

### episodesId 来源

资产中心资产无 episodes 维度（o_assets 只有 projectId），但 select-winner 需要 episodesId——客户端从 `useCanvasStore` 的 `episodesId`（`canvasStore.ts:75`）取当前集。

---

## D. getGroupKey 反查提取（D-02）

### handleGoCanvasSelect 原文（AssetLibrary.tsx:834-845，CONTEXT 引 831，漂移 +3）

```ts
const handleGoCanvasSelect = useCallback((group: CandidateGroup) => {
  const store = useCanvasStore.getState()
  store.navPushCallback?.()
  const primary = group.items.find((d) => d.isPrimaryView) ?? group.items[0]
  const nodeId = `asset-${primary.id}`
  const vg = store.graph?.variantGroups.find(
    (v) => v.variantNodeIds.includes(nodeId) || v.winnerNodeId === nodeId,
  )
  store.setFocusAssetNodeId(nodeId)
  if (vg) useVariantPickerStore.getState().openWallByGroup(vg.id)
  store.setViewMode('canvas')
}, [])
```

### graph.variantGroups 形状

`packages/flowgraph-v3/ts/src/types.ts:236-245`：

```ts
export interface VariantGroupV3 {
  id: string;
  branchId: string;
  phaseIndex: number;
  sourceEventId: string;
  variantNodeIds: string[];   // 冗余缓存
  winnerNodeId?: string;
  selectMode: 'single' | 'multi' | 'locked';
}
```

**组上没有 `variantGroupSize` 字段**——徽标显示的 size 应取 `vg.variantNodeIds.length`，或节点级 `data.variantGroupSize`（adapter 派生，见下）。adapter.ts:815-817（CONTEXT 引 795-845，核验准确）把组归属挂到节点 data：

```ts
...(n.variantGroupId != null ? { variantGroupId: n.variantGroupId } : {}),
...(stack ? { variantStack: stack } : {}),
...(m ? { variantGroupIds: m.groupIds, variantGroupSize: m.firstGroupSize } : {}),
```

### 提取提案

新文件 `packages/infinite-canvas/src/components/assetManager/groupCanvasLinkage.ts`（纯函数，无 React 依赖，可单测 + e2e 契约锁）：

```ts
export const ASSET_NODE_ID_PREFIX = 'asset-'
export const OASSET_NODE_ID_PREFIX = 'a-oasset-'

/** 资产 id → 画布上可能存在的节点 id 候选（两种建点约定都查）。 */
export function canvasNodeIdsForAsset(assetId: number): string[]

/** 组主资产 → 画布变体组精确反查（handleGoCanvasSelect 逻辑提取 + a-oasset- 扩展）。 */
export function findVariantGroupForAsset(
  graph: FlowGraphV3 | null, assetId: number,
): { groupId: string; size: number; winnerNodeId?: string } | null
```

**关键扩展（CONTEXT 隐含但未明说）**：画布上同一 o_assets id 存在**两种节点 id 约定**——
- 客户端拖入：`asset-${payload.id}`（`FlowCanvas.tsx:461`，data 袋带 `assetId`/`assetUuid`）
- 服务端 sync-assets 自动建点：`a-oasset-${asset.id}`（`sync-assets.ts:69`，data 袋带 `oAssetId`）

现 handleGoCanvasSelect/handleLocateOnCanvas 只查 `asset-` 前缀，会**漏 a-oasset- 节点**。提取的 util 应两前缀都查（`variantNodeIds.includes()` 对两个候选 id 各试一次）。

两个调用点：① handleGoCanvasSelect 改调 util（现行为零变化 + 补 a-oasset 覆盖）；② D-05 选定后映射判定与 D-02 组卡徽标（groupId + variantNodeIds.length）。

---

## E. 计数一致性（D-04）

### 三态判定式（AssetLibrary.tsx:499-507，CONTEXT 引 500-505，微漂移）

```ts
// 按 tab 拆分三态：选定 / 待选 / 淘汰。
const tabFiltered = useMemo(() => {
  return filtered.filter((d) => {
    if (tab === 'selected') return !!d.isPrimaryView && d.state !== 'eliminated'
    if (tab === 'eliminated') return d.state === 'eliminated'
    return !d.isPrimaryView && d.state !== 'eliminated' // candidate
  })
}, [filtered, tab])
```

数据源 = `useRealAssets` 的 `AssetDetail[]`（POST /v1/assets-registry/search，o_assets 行）。

### DAG 公式（model.ts:937-961，核验准确）

```ts
const candidates = Math.max(0, total - selected - eliminated)   // :937
const needsDecision = candidates > 0 && (selected > 0 || explicitCandidates > 0)  // :944
return { def, state, total, completed, selected, candidates, ... }  // :961
```

selected/eliminated 来自 `curationBucket(node, raw)`（`model.ts:193-204`）：读**画布节点** `v3.curation ?? raw.curation ?? data.curation` / `curationState` / `data.isPrimaryView`。

### 结论：**不是同一数据源——必须明说**

| | 层级视图（AssetLibrary） | DAG（model.ts） |
|---|---|---|
| 判定字段 | `isPrimaryView`（o_assets 列）+ `state`（o_assets 列） | `curation`/`curationState`/`data.isPrimaryView`（canvas_nodes data） |
| 数据面 | o_assets 行（assets-registry API） | 画布 RF 节点（graph） |

两源靠同步通道对齐（select-winner D-07 写 o_assets；sync-assets 建点写 `data.state: selected|candidate` 但**不写 curation**；registry linkage 写 canvas 表）。因此 D-04 的 e2e 一致性断言是**跨源契约测试**：fixture 必须**同时**喂对齐的两份 mock（assets-registry/search 响应 + 画布 graph 的 curation 字段），断言两个 UI 计数相等——而不是同源派生校验。CONTEXT D-04「数据源相同」表述不准确，但其处方（不改 DAG 派生代码、e2e 锁一致性）仍然正确。

附加细节：DAG 每卡片只统计命中 `nodeMatchesDag` 的节点（`model.ts:846-877`，默认 `artifactsOnly` 仅 `a-*` 前缀）——**拖入的 `asset-*` 节点不计入 DAG**。且 neutral（无 curation 信号）也计入 candidates。kap DAG 词汇表实为 **39 个** DAG_NODES（实测计数），非 42——42 是 khs 侧口径。

---

## F. khs 键面快照核验（D-10/D-12，跨仓只读）

### clamp 语义：逐字核验成立

`/data/workspace/kais-hermes-skills/skills/kais-movie-pipeline/pipeline/phases/_vision_review.py:87-91`：

```python
pre = _pick("n_candidates") or max(1, default_pre)
final = _pick("final_candidates")
if final is None:
    final = pre if default_final is None else default_final
final = max(1, min(final, pre))
return pre, final
```

即 `pre ≥ 1`；`final = clamp(1, final, pre)`——与 CONTEXT D-10 钳制语义逐字一致。确定性派生类的硬上限另有 `resolve_capped_redundancy`（同文件 106 行起，超帽 warn + 回落 + `_redundancy_cap` 留痕）。

### 漂移 1：khs 执行状态已过时

CONTEXT（specifics）称「两 phase 均停在 Ready for planning 未 shipped」。**实测（2026-08-24 当日 khs 已推进）**：
- khs `STATE.md:28`：「Status: **Executing Phase 26**」；Phase 26 已 shipped（`26-01..03-PLAN/SUMMARY` 齐全 + commit `e6d475a`）
- Phase 27 的 **27-01 已 shipped**：git log `cdd12dd "feat(27-01): single-product redundancy foundation — default-table 11 paired keys + resolve_capped_redundancy helper"`——runner 默认表**已含全部嵌套键**（`runner.py:2341-2392`，注释「2026-08-24 单产物篇 (Phase 27)」）
- 27-02（p06/p09 fan-out）、27-03（p11 engine fan-out）有 PLAN 无 SUMMARY，未 commit

### 漂移 2：嵌套键 = 11 个，非 12 个

CONTEXT D-10 表把 `p09_shotlist.shot_list` 与 `p09_shotlist.transition` 列为两键（合计 12）。**khs 27-02 单键裁决**（`27-02-PLAN.md:42`「transition_design 随 shot-list 候选整体产生，不拆独立候选域」）+ runner 实表 + 文档矩阵（`docs/redundancy-review-system.md:97-98`）均确认 **transition 无独立键**。runner 实际嵌套键（`runner.py:2341-2392`）：

| # | phase_key | 档 | runner 默认 |
|---|---|---|---|
| 1 | `p01_hook.topic_kernel` | LLM | 嵌套仅 `final_candidates:1`，pre 共享扁平 |
| 2 | `p06_script.spatio_temporal` | LLM | `{n:1, final:1}` |
| 3 | `p09_shotlist.shot_list` | LLM | `{n:1, final:1}`（transition 随整体） |
| 4 | `p11_video.video_render` | 引擎 | `{n:1, final:1}`（GPU 护栏默认 1） |
| 5 | `p07_style.style_vector` | 确定性 | `{n:1, final:1}` pre 硬上限 1 |
| 6 | `p07_style.color_intent` | 确定性 | 同上 |
| 7 | `p12_compose.master_timeline` | 确定性 | 同上 |
| 8 | `p12_compose.audio_mix` | 确定性 | 同上 |
| 9 | `p13_master.master_mp4` | 确定性 | 同上 |
| 10 | `p12_audio.bgm` | **占位未接线** | 键面存在「供 kap 画布读侧显示『未接线』原因，运行时无消费（HIER-03）」 |
| 11 | `p12_audio.foley` | **占位未接线** | 同上 |

+ 3 扁平键 `p01_hook` / `p02_outline` / `p03_script` `{n_candidates, final_candidates}`（`runner.py:2285-2292`；p02/p03 落文档键 final:1，p01 不落数字 final 键——default_final=None 哨兵语义，`_vision_review.py:68-70`，缺省 final=pre）。

### 漂移 3：不可配 = 18 个报告/审计节点，非 29

`docs/redundancy-review-system.md:101-102`：「42 节点口径再更新：不可配 29 → **18**（11 类毕业；报告/审计类 **18 个**仍不可配——质检产物非资产）」。27-CONTEXT.md:93 同口径（「29 个不可配中的其余 18 个」）。**不可配键清单来源**：
- `p10_voice.tts`：pre 钉死 1（first-wins/铺轨污染根因）——27-CONTEXT 灰区 5（L57）+ runner.py:2306-2309 注释
- 18 个报告/审计类：redundancy-review-system.md:101 + 27-CONTEXT.md:93（**无逐键枚举清单**——kap 常量表如需逐键列出，只能从 42 节点矩阵推导，khs 未交付枚举；建议 kap 侧按「18 个报告/审计类」做汇总行 + tts 单列，避免手工枚举 18 个键名引入新的漂移面）

### 对 kap D-10/D-11/D-12 的修正建议

1. 常量表按 **11 嵌套 + 3 扁平** 建，transition 显示为 shot_list 的注记（「转场随分镜表候选整体」）。
2. `p12_audio.bgm`/`foley` 显示为「占位未接线」态（读侧显示默认值 + 未接线原因；写侧允许写覆盖层但需标注「运行时暂不消费」）——runner 注释明说这两键就是给 kap 读侧显示用的。
3. D-12 e2e 契约 fixture 注入合成 requirement.json 时用 11+3 键面；真实键面权威已从「27-CONTEXT 快照」漂移到「runner 默认表实码」——D-12 的漂移暴露机制仍然必要（27-02/03 未 commit，表还可能微调）。
4. khs runs 工作区的 requirement.json 同样无 generation_config（实测）——D-12 的优雅降级不只针对 pipe-* 旧形态。

---

## G. e2e 基线（D-13）

### 既有回归面（精确文件清单）

`packages/infinite-canvas/test/e2e/tests/`：

| 文件 | 用例数 | 覆盖 |
|---|---|---|
| `phase52-regen.mjs` | 3 | REGEN-01a 编辑→保存→重生成带 asset-id nodeId；01b reload 往返保真；01c deprecated 败者只读 |
| `phase52-reroll.mjs` | 2 | REGEN-02a 🎲 同配方新 seed；02b seed 回写 canonical + toast |
| `phase52-stale-panel.mjs` | 4 | REGEN-03a/03b stale 徽标 + orchestrate 子集；04a/04b 面板宽度/开合行为 |
| `phase55-nav.mjs` | 5 | `/` 搜索导航、场景分组跳转、新资产落点视口中心、lane 聚焦、无未捕获错误 |
| `phase61-debt.mjs` | 3 | 拖入落点 ≤64px、同资产二次拖入 409、「＋画布」stub 退役 |

（phase52「三件套」= regen + reroll + stale-panel。）

### 运行机制

`packages/infinite-canvas/playwright.config.mjs`：baseURL `:9876`，webServer = `node test/e2e/mock-backend/server.mjs`，workers=1 串行，`npm run test:e2e`（package.json:10）。**默认视图自 2026-08-02 起是资产管理中心**（`helpers.mjs:43-45` 注释；`switchToCanvasView` 显式点击「画布」）——Phase 62 层级视图用例直接在默认视图起测，画布侧断言（select-winner/DAG）才需要切视图。`loadCanvas` 惯例：`?projectId=1&episodesId=1&testMode=1` + `/__mock/reset` + 等 `window.__kaisCanvas`。

### mock-backend 现有资产面与缺口

已有（`mock-backend/server.mjs`）：
- `POST /api/v1/assets-registry/search`（:255-266）——**固定 2 条 fixture**（id 90001/90002，type character，projectId 1，90001 isPrimaryView=true，meta null），无条件返回
- `POST /api/canvas/v2/nodes/`（:218-250）——400 载荷非法 / 409 查重 / 200 append + `node:created` 5ms 回放（61-01 镜像真 nodes.ts）
- `/__mock/state|reset|emit|calls|config`（:513-529）观测面

**Phase 62 需新增的 mock**：
- `PATCH /api/v1/assets-registry/:id`（现状无）——记录调用 + 可变 fixture 状态
- `POST /api/canvas/v2/variant-groups/:groupId/select-winner`（现状无）——镜像真端点 200/404/409 形状 + `/__mock/calls` 记录（D-05 fire-and-forget 断言面）
- 覆盖层 CRUD 路由 mock（随 D-08① 新端点形状）
- requirement.json 读/写回 mock（随 D-08② 新端点形状）
- search fixture 需升级为可 reset 的多组结构（同组多候选/淘汰态/场景组/声纹组/单产物各型），静态 2 条撑不起层级/三态/计数断言

---

## H. 风险清单（CONTEXT 假设 vs 代码实况）

### 行号漂移登记（全部轻微，canonical_refs 仍有效）

| CONTEXT 引用 | 实况 | 漂移 |
|---|---|---|
| AssetLibrary.tsx:831 handleGoCanvasSelect | **834**-845 | +3 |
| AssetLibrary.tsx:500-505 三态判定式 | **499**-507（filter 体 501-506） | ~+1 |
| AssetLibrary.tsx:273 getGroupKey | 273 精确 | 0 |
| AssetLibrary.tsx:543-575 自动初始化（557-560 豁免） | **536**-573（isSceneGroup/isVoiceGroup 556-559） | −7 / −1 |
| assetManagerData.ts:269 REAL_TYPE_GROUPS | 269 精确 | 0 |
| canvasApi.ts:203-222 AssetDetail | 203-222 精确（确认**无 phase 字段**，D-01 前提成立） | 0 |
| canvasApi.ts:314 updateAsset | 314 精确 | 0 |
| useRealAssets.ts:94 patchLocal | 94 精确 | 0 |
| adapter.ts:795-845 variantGroupId | 795-845 内（spread 在 815-817） | 0 |
| model.ts:463-1006（937-961 公式） | 463/937/961 全精确 | 0 |

### 实质风险

1. **D-08② pipe-* 写回恒 EACCES**（B 节实测）——uid 错配非 kap 可修。覆盖层为主真值源的设计是对的；「已同步 requirement.json」徽标在本机只能经 khs runs base 出现。且 khs runs 是 ep 目录寻址、requirement.json 无 projectId——寻址顺序两段需要**两套匹配规则**（pipe-* 按 projectId 反查 / runs 按 episode 名或显式配置映射）。
2. **双节点 id 约定**（D 节）——`asset-{id}`（拖入）vs `a-oasset-{id}`（sync-assets 自动建点）。反查 util、D-05 映射判定、focus 定位都要兼容两前缀，否则漏一半节点。
3. **D-05 双通道语义**（C 节）——PATCH isPrimaryView=true 已自动触发服务端 linkage；客户端 select-winner 常见路径幂等 no-op。不阻塞落地，但 e2e 断言要按「客户端 POST 发出 + 最终态正确」写，不能断言 applied:true；UI toast「画布侧同步失败」只应挂在客户端 POST 的非 2xx 上（服务端 linkage 失败静默是既有行为）。
4. **D-10 快照三处漂移**（F 节）——11 键非 12、transition 合并、不可配 18 非 29、khs 26+27-01 已 shipped。kap 常量表应以本 RESEARCH F 节表格（= runner.py 实码）为准，27-CONTEXT 快照降级为历史参考。
5. **D-04 跨源计数**（E 节）——两套数据源（o_assets vs canvas_nodes data），e2e fixture 必须双 mock 对齐；勿试图统一派生。
6. **error() 信封 body.code 恒 400**（A 节）——新路由/mock/客户端判定统一看 HTTP status。
7. **DB 迁移零风险**（A 节）——boot 时 hasTable 幂等建表；10588 实例部署重启即得新表，无独立迁移脚本需要跑。
8. **`AssetDetail.meta` 为 JSON 字符串**（useRealAssets/search 直传）——层级视图阶段徽标的 `meta.phaseName/phaseCode` 直读需 JSON.parse + 防御（`parseMetaFields` 先例 AssetLibrary.tsx:243-251）。
9. **kap DAG 词汇表 39 节点非 42**（E 节）——若 HIER-03 配置面想按 DAG 卡片对齐展示，两套口径（39 vs khs 42）有 3 个差值键面，按 phase_key 常量表走即可，勿按 DAG_NODES 枚举。

---

## Implementation Guidance（建议构建顺序）

1. **util 提取先行**（D-02）：`groupCanvasLinkage.ts`（findVariantGroupForAsset + 双前缀 canvasNodeIdsForAsset）+ `getGroupKey`/判定式常量导出。纯函数、可单测、是后面所有 UI 与选定的共享地基。同时锁 `subtype→阶段` 静态映射常量表（D-01 徽标）。
2. **键面常量表 + 覆盖层 store/表**（D-08①/D-10 修正版：11 嵌套 + 3 扁平 + tts/18 报告审计不可配 + bgm/foley 未接线态）：initDB `relationalCanvasTables` append → canvasRelationalStore CRUD 函数 → v2 路由（GET 三源合并 / PUT 覆盖层 + 钳制 400 + requirement.json best-effort 写回三态徽标数据）。
3. **mock-backend 扩面**：PATCH assets-registry、select-winner mock、覆盖层路由 mock、多组可 reset 的 search fixture——与第 4 步并行开发的前置。
4. **UI 层级视图**（HIER-01/D-03/D-04）：AssetLibrary 内新组织模式或 AssetManager 新 Tab（UI-SPEC 定夺；建议先 Tab 内切换降低对既有三 tab 布局的回归面）——三域折叠树 + 计数聚合（复用 501-506 判定式）+ 单件桶 + 阶段徽标 + variantGroup 徽标（util）。
5. **层级化选定**（HIER-02/D-05/D-06/D-07）：批量多选 UI → 每组走 handleSelect 单组通道（winner 规则升级 mtime 最新）→ 组映射存在时 fire-and-forget `selectVariantWinner`（canvasApi 既有封装）→ 场景/声纹「手动选择」标注。
6. **冗余配置 UI**（HIER-03/D-09/D-11/D-12）：读侧三源合并 + 角标 + 不可配禁用行；写侧两段式 + 三态徽标。
7. **e2e 三文件 + 全量回归**（HIER-05/D-13）：phase62-hierarchy / phase62-selection / phase62-redundancy-config + 52 三件套 + 55-nav + 61-debt 回归；D-04 一致性用例做双 mock 对齐断言；D-12 键面契约 fixture 用 11+3 键。

理由：1 是 4/5 的依赖且零 UI 风险；2/3 是 5/6 的前后置契约面；UI（4→5→6）按数据依赖递进；7 贯穿收口（每步可先补对应 mock 用例再写实现，沿 GSD nyquist 节奏）。
