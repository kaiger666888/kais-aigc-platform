# Phase 51 Research — 写路径地基统一 (Canonical Write Path + Coordination Guard)

**Researched:** 2026-08-21
**Inputs:** 51-CONTEXT.md (locked decisions) · REQUIREMENTS.md · STATE.md · ROADMAP.md · 代码实证(全部关键文件已直读)

---

## Summary

Phase 51 的技术图景比表面更"水到渠成":**几乎所有 canonical 基建都已存在**——`save-v2` 端点(zod 校验 + 结构化参数强制 + graph:saved 广播)、`store.approveNode/rejectNode` 的 canonical optimistic 模式、`applyGraphTransform` 纯函数变换接缝、`rawDataByNodeId` 原始数据袋穿透、e2e mock backend 的 `/api/canvas/v2/save-v2`。本 phase 的核心新造物只有**一个**:canonical V3 → FlowGraphV2 正向序列化器(`migrateV2toV3`/`buildMeta` 的逆变换)。其余工作是**改接线**(3 处保存调用点、右键审核/删除、MetaRenderer、2 个 socket 处理器)+ **删除**(~3,200 行死代码 + v1 save 路由)+ **成文**(COORD-01)。

最大的三个地雷:① save-v2 对 audio 节点有**必填参数 400 强制**(shot_id/engine/duration_sec),序列化器若不合并 `rawDataByNodeId` 会把这些字段抹掉,第一次保存后所有后续保存全部 400;② V3 `failed` ↔ V2 `error` 状态枚举不对称,且 adapter `normalizeNodeState` **缺少 `error`→`failed` 映射**(当前 error 落 default → success + warning,失败节点重载后复活为 success)——这是必须随本 phase 修的伴随 bug;③ V3 `selectMode:'locked'`(shot_decompose 解构集)在服务端 zod 枚举里没有槽位,原样序列化会让**整个保存 400**。

---

## Task 1 — FlowCanvas.tsx 重复问题(已裁决)

**结论:只有一份。** `src/components/FlowCanvas.tsx` **不存在**(scout 报告笔误);唯一的活文件是 `packages/infinite-canvas/src/components/FlowCanvas.tsx`。grep 命中的 `src/routes/canvas/static/assets/*.js.map` 是历史构建产物(sourcemap 内嵌源码文本),不是活代码。

**画布 UI 供给链:** `packages/infinite-canvas`(vite 构建,`@kais/flowgraph-v3` 经 vite alias + tsconfig paths 直指 `../flowgraph-v3/ts/src/index.ts` 的 TS 源码)→ `dist/` → `scripts/deploy-canvas.sh` 拷贝到 `data/web/infinite-canvas` → 后端 :10588 `/infinite-canvas/` 静态服务。**所有前端改动只碰 `packages/infinite-canvas`**;部署需重跑 `deploy-canvas.sh`(部署协调见地雷 #9)。

## Task 2 — 正向序列化器设计(canonical V3 → FlowGraphV2)

### 服务端契约(已直读 `src/routes/canvas/v2/save-v2.ts` + `src/types/flowgraph-v2-schema.ts`)

- 挂载:`src/router.ts` route24 → `POST /api/canvas/v2/save-v2`,body `{projectId, episodesId, graph}`。
- `FlowGraphV2Schema`:meta(version 字面值 `'2'`)/ nodes(`FlowNodeV2Schema`:id/type/branchId/phaseIndex/phaseName/position/size/data/state + 可选 reviewStatus/aiScore/isWinner/variantGroupId…)/ links / branches(`status/createdAt/updatedAt` **必填**)/ variantGroups(`selectMode` 枚举**仅** `single|multi`)。
- 状态枚举:V2 = `idle|pending|running|success|error|skipped`;V3 = `pending|running|success|failed`。**序列化器必须 `failed→error`**。
- **结构化参数强制**(`src/lib/canvasAssetSchema.ts`):实际只有 `audio` 类型有 schema,必填 `shot_id` + `engine` + `duration_sec`(filePath 在 audio schema 里被重声明为 optional);`zone/phase/suggestion/reference` 与 `3d/variant/upscale/face_restore` 直接放行;其余类型无 schema → 放行。**地雷:audio 节点 data 必须保住这三个字段。**
- 通过后:`processGraphThumbnails`(幂等缩略图)→ `saveFullGraph` relational UPSERT(全量替换语义)→ 广播 `graph:saved`。

### 逆变换映射表(由 `packages/flowgraph-v3/ts/src/migrate.ts` §14 + `buildMeta` + `adapter.ts` 逐行推导)

| V3 canonical | V2 wire | 依据 |
|---|---|---|
| stage `script` | type `'script'`;data 补 `hookType/hookIntensity/premise`;`content→data.prompt`(§14: prompt→content 的逆) | migrate.ts L294 / buildMeta script 分支 |
| stage `storyboard` | type `'storyboard'`;**flat** data 补 `shotId/shotType/durationS/cameraMovement/framing/composition/pacing` | buildMeta storyboard 分支**读 flat 字段**(d.cameraMovement),不读 data.meta |
| stage `keyframe` / `global` | type `'asset'`;global 补 `data.assetType` | §14;rawData 里有原始 type 时优先用(rawData.type,可还原 `scene_image`) |
| stage `video` / `composite` | type `'video'`;composite 必须把 `meta.edlRef` 摊平进 data(`inferVideoStage` 靠 data.edlRef 判 composite) | migrate.ts L185-194 |
| stage `voice`/`foley`/`bgm` | type `'audio'` + **`data.audioType`**(migrate 按 audioType 拆 stage 的唯一线索)+ `shotId/emotion/speaker` | migrate.ts L325-341 |
| stage `mix` | 无 §14 显式来源(罕见),建议 type `'audio'` + audioType 缺省 → 重载落 voice,**有损**,记 warning | 边缘 case,plan 时裁定 |
| `media.original/thumbnail` | `data.filePath` / `data.thumbnailUrl` | P15 注释:original=V2 filePath, thumbnail=V2 thumbnailUrl |
| state `failed` | `'error'`;`pending`→`'pending'` | 枚举差集 |
| `reviewStatus/aiScore/curation=='selected'` | 顶层 `reviewStatus/aiScore/isWinner` | adapter normalizeNode 读顶层 |
| event 节点 + `role:'output'` 边 | **不落盘**(折叠逻辑同 `graphToViewModel`:event 经 output 边映射到产出资产,端点替换、自环丢弃) | adapter.ts L705-714;canvasToFlowGraph 现行剔除 evt_* 的语义必须保持 |
| link `role` | `dataType`(自由字符串,migrate 负责 role 推断);`isExplore/isInactive` 透传 | adapter normalizeLink L207-224 |
| branches `{id,name,parentBranchId,createdAt}` | `{id,label:name,parentId,status:'active',forkReason:'',createdAt,updatedAt}` | 服务端 zod 必填 status/createdAt/updatedAt;**有损 shim**(status 不回真),与 adapter 现状同级 |
| variantGroups `selectMode:'locked'` | **必须映射为 `'single'`(+warning)**——否则 zod 400 整图 | 地雷 #3 |
| `variantGroupId` | 节点顶层 `variantGroupId` | schema 有槽位 |

**data 袋重建公式(关键):** `data = { ...rawDataByNodeId.get(id), ...flattenMeta(asset.meta), filePath, thumbnailUrl }`。
- `rawDataByNodeId`(store 已有,adaptV2Graph 产出)是 audio 必填字段(engine/duration_sec/shot_id)与一切白名单外字段的唯一存活地——**不合并它 = 第一次保存就把生产图的结构化参数抹掉,之后保存被 save-v2 400 拒绝**(地雷 #1)。
- `flattenMeta` 必须**摊平**(非嵌套 data.meta),因为 reload 时 `buildMeta` 只读 flat 字段。
- `rawDataByNodeId === null`(fixture / V3 直通模式)时退化为纯 flattenMeta,序列化器不得 throw。

**放置与形态(建议):** `packages/infinite-canvas/src/v3/serialize.ts`,纯函数
`serializeGraphToV2(graph: FlowGraphV3, rawDataByNodeId: Map|null, viewport?): FlowGraphV2Shape`——与 adapter.ts 同目录成对,可被 packages/infinite-canvas vitest 直接单测(round-trip 不变量:`adaptV2Graph(serialize(g))` 保 node id 集 / storyboard meta 字段 / audio audioType)。**注意:`import type` 引用 `@kais/flowgraph-v3`**(类型在 tsx 下擦除),这样根目录 `scripts/verify-phase-51.ts`(tsx)也能 import 它做断言。

**调用点切换(3 处 + API 层):**
- `canvasApi.saveCanvasGraph`:`'/canvas/save'` → `'/canvas/v2/save-v2'`,参数类型 FlowGraph → V2 形状。
- `FlowCanvas.handleSave`(L515-527):改从 `store.graph` 序列化(不再从 RF nodes/edges);catch 里 `console.error` → `showToast(err.message, 'error')`(CONTEXT 锁定)。`graph === null`(加载完成前的瞬态)时 toast 提示并早退——flowDataMapper 删除后非 graph 兜底路径不复存在。
- `FlowCanvas.handleOrchestrate`(L557)与 `CanvasContextMenu.handleBatchExecute`(L136):同一序列化入口。
- 删除 v1 路由 `src/routes/canvas/save.ts` + `src/router.ts` route12 import/mount(CONTEXT 锁定一次性切换);**先 grep 确认无服务端内部调用方**。

**伴随修复(必须同 phase 做):** `adapter.ts normalizeNodeState` 补 `case 'error': return 'failed'`——否则保存过的失败节点重载后全部变 success 还刷 warning toast。

## Task 3 — canonical 回写(store actions + socket + MetaRenderer)

**canonical 结构(直读 `flowgraph-v3/ts/src/types.ts` + `zod.ts`):** store.graph 是唯一真值源;资产节点持 `state` / `media.thumbnail` / `meta`(判别联合);**zod 全树 `.strict()`**(唯一例外 GenerationParams catchall)——新 action 写入必须产出合法联合成员(stage 不可丢),且**无 progress 槽位**。

**现状合并机制:** `applyGraphTransform(fn)` → `setGraph(fn(graph))` → `getViewModel` memo 重建派生 RF 缓存。派生缓存**永不**反向覆盖 canonical(机制上无此通道);今天的 bug 是写入方(socket/MetaEditor)只写派生缓存,下一次 transform 重建时编辑被冲掉。修复 = 让所有写入方改走 canonical,`applyGraphTransform` 后编辑自然存活(成功标准 3 的机制层保证)。

**新增 store actions(命名为 Claude discretion,建议):**
- `updateAssetMeta(nodeId, patch)` — MetaRenderer 专用:applyGraphTransform 内对 `asset.meta` 做字段级 patch(cameraMovement/framing/composition/pacing 均在 storyboard 联合分支,合法);空值 = 删字段(对应"未设置"清空语义)。
- `applySocketNodeState(nodeId, state, progress?)` — **state 落 canonical**(`error→failed` 归一,与 adapter 同一张归一表);**progress 保持派生缓存 ephemeral**(V3 无槽位,strict zod 不容许塞进 meta;且 progress 本质是瞬态运行时量,持久化无意义)——这是对 CONTEXT "state/progress/thumbnailUrl 落 canonical" 的实证修正,plan 应写明此裁定。
- `applySocketNodePreview(nodeId, thumbnailUrl)` — 写 `asset.media.thumbnail`。

**接线点:** `FlowCanvas.tsx` L208-225 的两个 socket 回调(`onNodeStateChange`/`onNodePreviewUpdate`)由 `setNodes` 直改改为调 store action;`MetaRenderer.tsx` L138-175 `MetadataEditor.setField` 由 `setNodes(flat data[field])` 改为 `updateAssetMeta`——读侧 `data[field] ?? meta[field]` 的 flat 覆盖层同步删除,直接读 `meta[field]`(即 asset.meta,经 graphToViewModel 注入 data.meta)。

## Task 4 — 删除确认 + save-v2 持久化 + verify 集成断言

**store 侧(建议 `deleteNode(nodeId)`):**
1. CanvasContextMenu 内联确认 UI(复用该文件既有驳回原因 textarea 的轻量模式,不用原生 confirm——CONTEXT 锁定);
2. `applyGraphTransform`:移除节点 + 所有 source/target 触及它的 links + variantGroups 成员清理(若节点是 winner,清 winnerNodeId;组清空则删组);
3. 走统一 `saveCanvasGraph`(save-v2 全量替换)持久化——**不新增 delete 端点**(CONTEXT 锁定);失败按 approveNode 范式回滚 prevGraph + error toast。

**verify-phase-51 集成断言(遵循 verify-phase-49/50 范式):**
- 关键约束:`canvasRelationalStore.saveFullGraph/loadFullGraph` **绑定 `@/utils/db` 单例**(无 db 注入参数,与 `selectWinnerInGroup(db,…)` 不同),且 db 路径 = `process.cwd()/data/db2.sqlite`。
- 因此采用 **verify-phase-49 的隔离 chdir 范式**:`mkdtemp` + 拷贝 package.json + `process.chdir(tmpdir)` **先于** `await import("../src/utils")` barrel + `await import("../src/lib/canvasRelationalStore")`——store 即在临时文件库上启动,生产库永不触碰。
- 断言组(真实模块驱动,零重实现):构造 FlowGraphV2(含节点 X + 边)→ 真 `saveFullGraph` → 真 `saveFullGraph`(去掉 X 及其边,即模拟删除后保存)→ 真 `loadFullGraph` → 断言 X 不存在、其边不存在、其余节点字节不变。另加一组幂等(同图二次 save → load 无 diff)。
- STATE.md 既有教训:app-db knex pool 与长驻 :memory: section 同进程时 insert 不落(49-01)——本方案用**临时文件库单进程**规避,若 plan 加 endpoint dispatch section 则须走 spawned 子进程(49 的先例)。
- npm script 注册 `verify:phase-51`(package.json scripts,对齐 verify:phase-50 行)。

## Task 5 — phase35 e2e fixture 迁移清单

文件:`packages/infinite-canvas/test/e2e/tests/phase35-storyboard-metadata.mjs`(142 行,唯一直接触碰该契约的 e2e)。逐条:

| 行 | 现状断言 | 迁移后 |
|---|---|---|
| L27-33 `getField` helper | 读 flat `data[field]` | **删除**(或改读 data.meta) |
| L85 | 下拉改 framing → `getField('framing')==='wide'` | → `getMeta()` 读 `data.meta.framing==='wide'`(store 即时回写 canonical,经 graphToViewModel 注入 data.meta) |
| L96-98 | cameraMovement set/clear flat | → getMeta 断言:zoom_in → 清空后 `undefined` |
| L109 | 同上 framing | → getMeta |
| L124-126(STORYBOARD-07 保存往返) | saved node `data.framing==='wide'`(flat)+ `data.meta?.cameraMovement==='zoom_in'` | flat `data.framing==='wide'` **应当继续成立**(序列化器摊平设计),改/补断言:saved payload 是 V2 形状(`meta.version==='2'`、节点带 `branchId`),`data.cameraMovement==='zoom_in'`(flat,reload 可读)。**最强化建议:加 reload 后 getMeta 断言**——真往返,比断言 wire 形状更接近成功标准 3 |
| L63-99 下拉渲染/枚举 | 不涉及写入路径 | 不动 |

mock backend(`test/e2e/mock-backend/server.mjs`)**已有** `/api/canvas/v2/save-v2`(L183-193,含 graph:saved 广播,与真后端对齐);迁移收尾时应**删除 mock 的 `/api/canvas/save`** 保持契约诚实,并 grep 全套 e2e 确认无其他用例打 v1 save。STORYBOARD-07 保存路径将自动走新序列化器 + save-v2,成为 WRITE-01 的 e2e 覆盖。

## Task 6 — COORD-01 落地点

**仓库内先例:** 跨切契约的成文地是 `.planning/specs/`(SKILL-CONTRACT.md 先例);ROADMAP.md 架构决策 #4 已含规则要点。gsd-plan-phase skill 是**用户级共享 skill**(跨项目),不应把项目专属规则硬编码进去——plan 模板条款应由 phase 输入(CONTEXT/ROADMAP/specs)携带。

**建议双落地(与 CONTEXT 决策一致):**
1. **规范文档**:新建 `.planning/specs/COORD-01-khs2-parallel-coordination.md`,内容 = ①变更面限定(field-map / canvas_sync / manifest schema 三层,不碰 khs2 v2.4 在改 phases 内部算法);②排序约束(涉 p04/p09 输出字段映射的 phase 排在 khs2 v2.4 Phase 25 验收之后,Phase 53 已挂此前置);③**plan 开工 checklist 复制块**(含 `kais-hermes-skills 工作树干净`:`git -C /data/workspace/kais-hermes-skills status --porcelain` 为空 / 与上游同步),供后续每个涉 kmc 侧的 PLAN.md 原文引用。
2. **模板接缝**:ROADMAP 架构决策 #4 补一句指向该 spec;Phase 51 自身的 PLAN.md 首用该 checklist 作为示范实例。verify-phase-51 用 grep gate 锁死"文档存在 + 含工作树检查条款 + ROADMAP 引用存在"(见 Validation Architecture)。

## Task 7 — 见文末 Validation Architecture

---

## 建议 Plan 分解(Wave 结构)

| Plan | 范围 | 需求 | Wave |
|---|---|---|---|
| **51-01 序列化器 + 保存切换** | `v3/serialize.ts` 新写 + vitest round-trip 单测;`canvasApi.saveCanvasGraph` 改端点;FlowCanvas handleSave/handleOrchestrate 接线 + showToast;adapter `error→failed` 伴随修复;删 v1 save 路由(先 grep 消费方) | WRITE-01 | **W1** |
| **51-02 canonical 回写 actions** | store 新增 `updateAssetMeta/applySocketNodeState/applySocketNodePreview`(+ store vitest);FlowCanvas socket 回调改线;MetaRenderer 改 canonical 回写;phase35 e2e 迁移 | WRITE-03 | **W1**(与 01 并行;唯一文件交集是 FlowCanvas.tsx 的不同代码区,提交时注意) |
| **51-03 右键菜单 canonical 化** | handleApprove/handleReject 改调 store.approveNode/rejectNode;handleDelete → 确认 UI + store.deleteNode + save-v2 持久化;顺带清理本文件的 legacy 类型使用(add-node 处理器删除、SCAIL2 块改 plain object) | WRITE-02 | **W2**(依赖 01 的 save-v2 通道;独占 CanvasContextMenu) |
| **51-04 死代码清除 + 依赖正名** | 删 12 个文件(~3,200 行)+ legacy 类型(types/canvas.ts)+ FlowCanvas 死 import;`@kais/flowgraph-v3: file:../flowgraph-v3` 进 dependencies(保留 vite alias/tsconfig paths);tsc 双根 + 双 vitest 验证 | WRITE-04 | **W2**(与 03 并行——约定 03 独占 CanvasContextMenu/类型清理,04 不动该文件) |
| **51-05 契约门 + COORD-01** | `scripts/verify-phase-51.ts`(集成删除-不复活 + 全部 grep/source-shape gate)+ npm script 注册;`.planning/specs/COORD-01-*.md` 成文 + ROADMAP 引用 | 全部 + COORD-01 | **W3**(收尾,聚合门) |

时序理由:01 提供 save-v2 写通道是 03 删除持久化的前提;02 与 01 语义独立(MetaEditor/socket 不走 save);04 删除 flowDataMapper 必须在 01/03 的调用点清理之后,故放 W2 且与 03 按文件划界。

## Risks / Landmines

1. **audio 必填参数 400 连锁**:序列化器不合并 `rawDataByNodeId` → 首存抹掉 engine/duration_sec/shot_id → 之后所有保存被 save-v2 400。序列化器单测必须含 audio 节点 round-trip。
2. **状态枚举不对称**:V3 failed ↔ V2 error;adapter `normalizeNodeState` 缺 `error` 分支(现落 default→success+warn)——不补则失败节点"复活"。伴随修复列入 51-01。
3. **`selectMode:'locked'` 无 V2 槽位**:原样序列化 → 服务端 zod 400 整图。映射 `'single'` + warning(plan 时裁定并写进序列化器注释)。
4. **progress 无 canonical 槽位**(zod strict):保持派生缓存 ephemeral;不要塞进 meta。CONTEXT 表述需按此实证修正,PLAN 应明写。
5. **旧部署产物仍调 v1 save**:`data/web/infinite-canvas`(线上 SPA)与 `src/routes/canvas/static` 旧 bundle 在 v1 路由删除后保存即 404——phase 收尾需重跑 `scripts/deploy-canvas.sh` 并在 VERIFICATION 标注人工确认;grep gate 须排除 `src/routes/canvas/static/**`、`data/web/**` 构建产物。
6. **fixture / V3 直通模式 `rawDataByNodeId === null`**:序列化器必须容忍(退化 flattenMeta);fixture 模式下 handleSave 建议 toast 早退(无项目上下文)。
7. **branch shim 有损**(status/label 不回真):与 adapter 现状同级,序列化器 synthesized `status:'active'` 即可;勿在 51 试图治本(超范围)。
8. **link `refType`/sourceHandle 在 V3 链路本就不存活**(graphToViewModel 不带)——现状既有损耗,51 不引入新损耗即可,文档注明。
9. **删 v1 路由前 grep 消费方**:`src/` 内其他 route/script、kmc 侧(契约只授权 kmc 用 save-v2,mock 注释已表明 pipeline 走 save-v2,但需实证)。
10. **`tsc -b` 于 packages/infinite-canvas**:`npm run build` = `tsc -b && vite build`;加 file: 依赖后须重跑 `npm install`(package-lock 更新),vite alias/tsconfig paths **保留**(真正承担解析)。
11. **BranchPanel 删除 vs Phase 55 NAV-06 复活/重写**:ROADMAP 决策 #6 已定"先删后建",删除不必保留副本,git 历史即档案。
12. **store.approveNode/rejectNode 的 graph-null 旧路径**:右键菜单改线后无消费者,但 ReviewActionButtons 仍在用 store action——保留 store 内旧路径无害,51 不强行清理(最小改动)。

---

## Validation Architecture

| 需求 | 自动化检查 | 类型 | 位置 |
|---|---|---|---|
| **WRITE-01** 保存走 save-v2 | ① `canvasToFlowGraph` grep 0 命中(范围 `packages/infinite-canvas/src` + `src`,排除 static/data web 产物);② 序列化器 vitest round-trip(adapt∘serialize 保 id 集/storyboard 字段/audio audioType/V2 schema safeParse 通过);③ handleSave/handleOrchestrate/handleBatchExecute 三处 source-shape 断言(不再 import flowDataMapper,改调 serialize+save-v2);④ v1 `src/routes/canvas/save.ts` 文件不存在 + router 无 route12 | grep-gate + vitest + verify-51 section | verify-phase-51 S1 + packages/infinite-canvas vitest |
| WRITE-01 保存失败 toast | handleSave catch 分支含 `showToast(` source 断言;store vitest:mock api reject → toast error 入列 | source-shape + vitest | verify-phase-51 S1 / store __tests__ |
| **WRITE-02** 右键审核/删除 canonical | ① CanvasContextMenu source-shape:不再直接 import `approveNode/rejectNode` API(改 store action);② handleDelete 含确认 UI 状态 + 调 `deleteNode` | source-shape | verify-phase-51 S2 |
| WRITE-02 删除不复活 | 真 `saveFullGraph→saveFullGraph(减节点)→loadFullGraph` 集成断言(隔离 chdir 临时库,49 范式) | **集成** | verify-phase-51 S2 |
| **WRITE-03** MetaEditor/socket 回写 canonical | ① store vitest:三 action 各写 canonical + **transform-survival**(编辑 → applyGraphTransform(applyLayout) → 值仍在);② MetaRenderer source-shape:setField 不再写 flat `data[field]` | vitest + source-shape | store __tests__ + verify-51 S3 |
| WRITE-03 e2e 契约迁移 | phase35 e2e 迁移后断言全绿(getMeta + V2 wire 形状 + 建议的 reload 往返) | playwright e2e | packages/infinite-canvas test:e2e |
| **WRITE-04** 死代码 | 12 文件不存在 grep gate;`ScriptNodeData/StoryboardNodeData/VideoNodeData/AudioNodeData` grep 0 命中 | grep-gate | verify-phase-51 S4 |
| WRITE-04 幽灵依赖 | `packages/infinite-canvas/package.json` dependencies 含 `@kais/flowgraph-v3` | json 断言 | verify-phase-51 S4 |
| WRITE-04 编译/测试绿 | 根 `tsc` 干净 + `packages/infinite-canvas` `tsc -b` 干净 + 双 vitest 全绿 | 命令门 | phase VERIFICATION 执行项 |
| **COORD-01** 成文 + 模板 | `.planning/specs/COORD-01-khs2-parallel-coordination.md` 存在 + 含"工作树干净"checklist 条款 + ROADMAP.md 引用该 spec | grep-gate | verify-phase-51 S5 |
