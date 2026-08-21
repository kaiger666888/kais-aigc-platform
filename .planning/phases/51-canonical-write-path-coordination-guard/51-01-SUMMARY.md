---
phase: 51-canonical-write-path-coordination-guard
plan: 01
subsystem: api
tags: [flowgraph-v3, flowgraph-v2, serializer, canvas, save-v2, zod, vitest]

requires:
  - phase: 50-historical-backfill-contract-guards
    provides: save-v2 端点（zod 校验 + 结构化参数强制 + graph:saved 广播）与 canvasRelationalStore
provides:
  - packages/infinite-canvas/src/v3/serialize.ts — canonical V3 → FlowGraphV2 正向序列化器 serializeGraphToV2（纯函数，import type only）
  - serialize.test.ts 9 用例 round-trip/合规断言（adapt∘serialize id 集、storyboard 字段、audio audioType、FlowGraphV2Schema.safeParse）
  - adapter normalizeNodeState error→failed 归一（失败节点保存-重载状态守恒）
  - 保存全链路切换：canvasApi.saveCanvasGraph → POST /canvas/v2/save-v2；handleSave/handleOrchestrate/handleBatchExecute 三处走 serializeGraphToV2
  - v1 /canvas/save 路由删除（src/routes/canvas/save.ts + router.ts route12）
affects: [51-02, 51-03, 51-04, 51-05, verify-phase-51]

tech-stack:
  added: []
  patterns:
    - "canonical-first 写路径：保存一律 serializeGraphToV2(store.graph, rawDataByNodeId, viewport) → save-v2，不再从 RF 派生缓存重建"
    - "data 袋重建公式：{ ...rawDataByNodeId?.get(id), ...flattenMeta(meta), filePath, thumbnailUrl }（地雷 #1 防线）"

key-files:
  created:
    - packages/infinite-canvas/src/v3/serialize.ts
    - packages/infinite-canvas/src/v3/__tests__/serialize.test.ts
  modified:
    - packages/infinite-canvas/src/v3/adapter.ts
    - packages/infinite-canvas/src/v3/__tests__/adapter.test.ts
    - packages/infinite-canvas/src/services/canvasApi.ts
    - packages/infinite-canvas/src/components/FlowCanvas.tsx
    - packages/infinite-canvas/src/components/CanvasContextMenu.tsx
    - src/router.ts
  deleted:
    - src/routes/canvas/save.ts

key-decisions:
  - "serializeGraphToV2 返回 FlowGraphV2WireShape,warnings 经可选出参 warningsOut 收集（调用点不关心告警,测试可断言）"
  - "mix stage → type 'audio' audioType 缺省 + warning（research 裁定的有损映射）"
  - "rawData.type 还原原始类型前过服务端 NodeTypeSchema 白名单——历史 scene_image 无 zod 槽位,原样写回会整图 400,故回退 'asset'"
  - "selectMode 'locked' → 'single' + warning（服务端 zod 无 locked 槽位,防整图 400）"
  - "branch shim status:'active'/forkReason:'' 有损,与 adapter 现状同级,本 phase 不治本"

patterns-established:
  - "serializeGraphToV2: 保存唯一序列化入口,event 折叠语义与 graphToViewModel 对齐"
  - "rawDataByNodeId 合并为强制公式,audio 必填三字段有单测锁死"

requirements-completed: [WRITE-01]

duration: 23 min
completed: 2026-08-21
---

# Phase 51 Plan 01: 正向序列化器 + 保存通道切换 Summary

**新写 canonical V3 → FlowGraphV2 正向序列化器（serializeGraphToV2，含 rawDataByNodeId 合并防 audio 必填参数 400 连锁），画布保存三处调用点一次性切到既有 save-v2 端点并删除 v1 save 路由，随刀修复 adapter error→failed 缺失导致的失败节点重载复活 bug。**

## Performance

- **Duration:** 23 min
- **Started:** 2026-08-21T06:39:32Z
- **Completed:** 2026-08-21T07:02:30Z
- **Tasks:** 3
- **Files modified:** 9（2 新建 / 6 修改 / 1 删除）

## Accomplishments

- `serializeGraphToV2` 纯函数落地（migrateV2toV3/buildMeta 逆变换），9 组 vitest 断言全绿：round-trip 保资产 id 集 / storyboard meta 七字段 / audio audioType / composite edlRef；输出过服务端 `FlowGraphV2Schema.safeParse`；`rawDataByNodeId === null` 退化不 throw
- 地雷 #1/#2/#3 三道防线全部自动化锁死：audio `shot_id/engine/duration_sec` 经 rawData 合并存活（单测 b）、adapter `error→failed`（单测断言 state==='failed' 且无未知状态 warning）、`selectMode 'locked'→'single'` + warning（单测 e）
- 保存全链路切换：`saveCanvasGraph` → `/canvas/v2/save-v2`；`handleSave`（graph===null toast 早退 + catch `showToast(err.message,'error')`）/`handleOrchestrate`/`handleBatchExecute` 三处统一走 `serializeGraphToV2`；v1 路由 `src/routes/canvas/save.ts` 与 router.ts route12 删除

## Task Commits

1. **Task 1: 正向序列化器 v3/serialize.ts + vitest round-trip 单测** — `4d132486` (feat)
2. **Task 2: adapter normalizeNodeState 补 error→failed + 单测** — `4cae23aa` (fix)
3. **Task 3: 保存通道切换（canvasApi + 3 调用点 + showToast + v1 路由删除）** — `350abb09` (feat)

## Files Created/Modified

- `packages/infinite-canvas/src/v3/serialize.ts` — serializeGraphToV2 纯函数 + FlowGraphV2WireShape wire 类型（镜像服务端 zod 契约）
- `packages/infinite-canvas/src/v3/__tests__/serialize.test.ts` — 9 用例 round-trip/合规断言（直接 import 根 `src/types/flowgraph-v2-schema.ts` 做 safeParse）
- `packages/infinite-canvas/src/v3/adapter.ts` — normalizeNodeState 补 `case 'error': return 'failed'`
- `packages/infinite-canvas/src/v3/__tests__/adapter.test.ts` — error→failed 新用例 + success/running/pending 回归
- `packages/infinite-canvas/src/services/canvasApi.ts` — saveCanvasGraph 端点与 graph 参数类型（FlowGraphV2WireShape）
- `packages/infinite-canvas/src/components/FlowCanvas.tsx` — handleSave/handleOrchestrate 改线（仅 save 区，socket 区未碰）
- `packages/infinite-canvas/src/components/CanvasContextMenu.tsx` — 仅 import 行 + handleBatchExecute 调用行（2 hunks，净 +2 行）
- `src/router.ts` — route12 import/mount 两行删除（@routes-hash 按仓库先例留 stale，无自动 hasher）
- `src/routes/canvas/save.ts` — 删除

## Decisions Made

- **warnings 出参形态**：`serializeGraphToV2(graph, rawDataByNodeId, viewport?, warningsOut?)` 返回 wire 形状本体，有损映射告警（mix/locked/边丢弃）经可选第 4 参收集——调用点签名与 interfaces 建议一致，测试可断言 warning。
- **rawData.type 白名单 guard**：research 建议"rawData.type 优先还原 scene_image"，但服务端 `NodeTypeSchema` 枚举无 scene_image 槽位，原样写回会让整图 400。实现为"rawData.type ∈ 服务端枚举才还原,否则回退 stage 映射类型"——保留 research 意图（合法原始类型如 asset 还原）同时堵 400。
- **filePath/thumbnailUrl 仅非空覆盖**：不拿 null 抹 rawData 原值;空媒体不伪造字段（服务端结构化参数必填由管线数据保证,序列化器不兜底）。

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] serialize.ts 注释中的 canvasToFlowGraph 字面量改述为 flowDataMapper**
- **Found during:** Task 3（acceptance grep）
- **Issue:** 我在 serialize.ts 头注释里引用了 `canvasToFlowGraph` 标识符,使 plan 级 grep 门多一个非活代码命中；51-05 verify gate（0 命中）会被此卡住
- **Fix:** 注释改述为"现行 flowDataMapper 剔除 evt_* 的语义",不再含该标识符
- **Files modified:** packages/infinite-canvas/src/v3/serialize.ts
- **Verification:** `grep -rn "canvasToFlowGraph" packages/infinite-canvas/src src/routes` 仅剩 flowDataMapper.ts 定义（51-04 删除范围）与 types/canvas.ts 注释（51-04 legacy 类型清理范围）
- **Committed in:** `350abb09`（Task 3 提交的一部分）

**2. [Criterion 澄清] "canvasToFlowGraph 0 命中" 与 "不动 flowDataMapper.ts 本体" 并存矛盾**
- **Found during:** Task 3 acceptance
- **Issue:** acceptance 要求 grep 0 命中,但同任务又明令 flowDataMapper.ts 本体留待 51-04 删除——定义行与 types/canvas.ts 注释必然残留 2 处命中
- **Fix:** 按 criterion 注释的真实意图执行（"三处调用点 + import 全部清除"）——已确认活代码中 import/调用 0 残留;定义与注释残留属 51-04 既定范围,如实记录
- **Files modified:** 无（仅核实）
- **Verification:** 残留 2 命中 = `utils/flowDataMapper.ts:287`（定义）+ `types/canvas.ts:391`（注释）

---

**Total deviations:** 1 auto-fixed (missing critical) + 1 criterion 澄清
**Impact on plan:** 均为守门兼容性处理,无范围蔓延;未触碰任何 files_modified 之外的文件做逻辑改动。

## Issues Encountered

- **v1 路由删除前 grep 消费方实证（地雷 #9 执行结果）**：活代码调用方仅 3 处前端调用点 + router.ts mount（本 plan 已清）。另有 3 个**非挂载消费者**残留,均不在本 plan files_modified 范围,按 scope 纪律如实记录：
  1. `scripts/canvas/verify-save-gates.ts`（2026-08-16 审计 #8 的历史 verify 脚本）L42 `read("src/routes/canvas/save.ts")` —— 路由删除后该脚本运行即 throw。未注册进 package.json scripts,仅手动运行。**建议 51-05 或后续 quick task 将其 v1 section 标记 obsolete/删除。**
  2. `scripts/verify-phase-39.ts` L71 v1Routes 清单含 `/api/canvas/save` —— 历史 phase 39 verify,重跑会在该断言失败（同时其 ADAPT-03 断言的旧路由表本身已多处过时）。未注册 npm script。
  3. **`scripts/agent-sync.js` L279 是真实运行时调用方**（OpenClaw agent 管线 canvas_graph 同步,POST `/api/canvas/save`）—— v1 路由删除后该 asset-type 路径将 404。修复（迁移到 save-v2,graph 需补 FlowGraphV2 形状）超出本 plan 范围,**需后续 task 跟进**。
- **research 实证修正**：51-RESEARCH 称"仅 audio 类型有 schema 强制"不准确——`canvasAssetSchema.ts` 实际对 audio/video/asset/storyboard/script 五类均有必填强制（video 要 resolution,asset 要 label+assetType+filePath,storyboard 要 label+shot_id+shot_type+duration_sec,script 要 label+description）。这使 rawDataByNodeId 合并比 research 所述更关键（不止 audio 三类字段）；后端加载的图 rawData 袋已含全部必填字段,防线设计不变、单测不受影响。

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- save-v2 写通道就绪 → 51-03（右键删除持久化）可直接复用 `serializeGraphToV2` + `saveCanvasGraph`
- 51-02（canonical 回写 actions）与本 plan 无文件冲突遗留（FlowCanvas socket 区 L208-225 未触碰）
- 51-04 待办确认：flowDataMapper.ts 删除后 canvasToFlowGraph grep 即归零;types/canvas.ts:391 注释随 legacy 类型清理
- 提醒 51-05：①verify-save-gates.ts / verify-phase-39.ts / agent-sync.js 三处 v1 save 残留需裁决;②旧部署产物（data/web/infinite-canvas、src/routes/canvas/static）仍调 v1 save,phase 收尾须重跑 `scripts/deploy-canvas.sh`（地雷 #5）

## Self-Check: PASSED

- [x] key-files 全部存在于磁盘（serialize.ts / serialize.test.ts 新建已提交）
- [x] `git log --grep="51-01"` ≥ 3 commits（4d132486 / 4cae23aa / 350abb09）
- [x] 全部 acceptance_criteria 重跑通过：
  - Task 1: vitest serialize.test.ts 9/9 绿;serializeGraphToV2 ≥1;@kais/flowgraph-v3 命中行 = 单行 `import type`;`rawDataByNodeId!` = 0;含 audio round-trip + safeParse 断言
  - Task 2: `case 'error'` 命中;adapter.test.ts 绿（含 state==='failed' 新用例）;src/v3/__tests__/ 47/47 绿
  - Task 3: canvasToFlowGraph 活代码 0 引用;canvasApi 含 '/canvas/v2/save-v2' 不含 '/canvas/save';handleSave catch 含 showToast + graph===null 早退;CanvasContextMenu diff 仅 2 hunks 净 +2 行;save.ts 不存在;router 'routes/canvas/save"' = 0
- [x] plan 级 verification 重跑：`npm test`（pkg）185/185 绿;根 `tsc --noEmit` exit 0;pkg `tsc -b` exit 0

---
*Phase: 51-canonical-write-path-coordination-guard*
*Completed: 2026-08-21*
