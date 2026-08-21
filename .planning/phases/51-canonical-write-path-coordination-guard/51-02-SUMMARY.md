---
phase: 51-canonical-write-path-coordination-guard
plan: 02
subsystem: canvas
tags: [flowgraph-v3, canvasStore, canonical-writeback, socket, MetaRenderer, e2e, playwright]

requires:
  - phase: 51-01
    provides: serializeGraphToV2 已接入保存链（STORYBOARD-07 走新序列化器）+ adapter error→failed 归一表
provides:
  - canvasStore 三个 canonical 回写 action：updateAssetMeta / applySocketNodeState / applySocketNodePreview（均经 applyGraphTransform 写 store.graph）
  - canonicalWriteback.test.ts 11 用例：三 action 写入 + transform-survival + 清空语义 + progress-ephemeral + 早退守卫
  - FlowCanvas socket 回调与 MetaRenderer MetadataEditor 全部改走 canonical 回写（派生缓存只读重建）
  - phase35 e2e 迁移到 canonical 回写 + save-v2 契约（getMeta + V2 wire 形状 + graph:saved reload 真往返）
  - mock backend v1 /api/canvas/save 端点删除；e2e 全套 40/40 绿（含 4 个预存红套件修复）
affects: [51-03, 51-04, 51-05, verify-phase-51]

tech-stack:
  added: []
  patterns:
    - "canonical 回写三 action：写入方一律经 applyGraphTransform 写 store.graph，派生 RF 缓存只由 graphToViewModel 重建"
    - "meta 字段级 patch 白名单 META_PATCHABLE_KEYS 对齐 zod strict 判别联合（stage 不可 patch，非法 key console.warn 忽略不 throw）"
    - "progress-ephemeral 裁定：V3 strict 无 progress 槽位，瞬态量走派生缓存 ephemeral 通道且必须在 canonical transform 之后写（否则被 setGraph 重建冲掉）"
    - "e2e 观测点迁移：flat data[field] → data.meta（getMeta）；事件节点折叠后 op 配方经边 data.eventId/params 观测（testMode hook 增 getEdges）"

key-files:
  created:
    - packages/infinite-canvas/src/store/__tests__/canonicalWriteback.test.ts
  modified:
    - packages/infinite-canvas/src/store/canvasStore.ts
    - packages/infinite-canvas/src/components/FlowCanvas.tsx
    - packages/infinite-canvas/src/components/panel/MetaRenderer.tsx
    - packages/infinite-canvas/test/e2e/tests/phase35-storyboard-metadata.mjs
    - packages/infinite-canvas/test/e2e/mock-backend/server.mjs
    - packages/infinite-canvas/test/e2e/helpers.mjs        # 偏差：预存红修复
    - packages/infinite-canvas/test/e2e/tests/phase36-orchestrator.mjs  # 偏差
    - packages/infinite-canvas/test/e2e/tests/phase38-storyboard-preview.mjs  # 偏差
    - packages/infinite-canvas/test/e2e/tests/phase40-status-normalization.mjs  # v1 save 迁移（plan 明示"命中则一并迁移"）
    - packages/infinite-canvas/test/e2e/tests/phase41-pipeline-sync.mjs  # 注释契约诚实
    - packages/infinite-canvas/test/e2e/REPORT.md          # 文档契约诚实
    - packages/infinite-canvas/src/main.tsx                # 偏差：testMode hook + getEdges

key-decisions:
  - "三 action 最终命名沿用 research 建议：updateAssetMeta / applySocketNodeState / applySocketNodePreview"
  - "socket state 归一表与 adapter normalizeNodeState 同一张（error/skipped→failed、cached→success、idle→pending），未知值 console.warn 忽略"
  - "progress ephemeral 写必须排在 canonical transform 之后（setGraph 重建派生缓存会冲掉先写的 ephemeral 值）——单测锁死"
  - "STORYBOARD-07 reload 真往返复用 save-v2 广播 graph:saved 的既有自动 reload（phase41 SYNC 已证链路），不另起 page.reload"

requirements-completed: [WRITE-03]

duration: 33 min
completed: 2026-08-21
---

# Phase 51 Plan 02: canonical 回写 actions + 接线 + e2e 契约迁移 Summary

**store 新增 updateAssetMeta/applySocketNodeState/applySocketNodePreview 三个 canonical 回写 action（meta 白名单 patch、state 归一、media.thumbnail，progress 保持派生缓存 ephemeral），FlowCanvas socket 回调与 MetadataEditor 全部改线，transform-survival 单测 + STORYBOARD-07 save→graph:saved→reload 真往返双重锁死「applyGraphTransform 后编辑被冲掉」类 bug；mock backend v1 save 删除，e2e 全套 40/40 绿。**

## Performance

- **Duration:** 33 min
- **Started:** 2026-08-21T07:01:00Z
- **Completed:** 2026-08-21T07:34:36Z
- **Tasks:** 3
- **Files modified:** 13（1 新建 / 12 修改）

## Accomplishments

- 三 canonical action 落地（canvasStore.ts）：`updateAssetMeta` 按 META_PATCHABLE_KEYS 白名单做字段级 patch（空值=删字段，stage 不可改，非法 key console.warn 不 throw）；`applySocketNodeState` 归一后落 canonical state；`applySocketNodePreview` 写 `asset.media.thumbnail`；graph===null/节点不存在静默早退
- canonicalWriteback.test.ts 11 用例全绿：三 action 写入断言、**transform-survival**（编辑→无关 applyGraphTransform→值仍在且派生同步）、清空语义（undefined/'' 删字段）、error→failed、**progress-ephemeral**（canonical JSON.stringify 不含 progress、派生缓存可见）、非法 key/早退不 throw
- 接线：FlowCanvas socket 回调区（L202-216）改调 store action，setNodes 直改逻辑删除，diff 不触及 handleSave/handleOrchestrate 区（与 51-01 划界遵守）；MetaRenderer setField 改调 `updateAssetMeta`，读侧 flat 覆盖层删除直读 `meta[field]`，MetadataEditor 不再接收 data prop
- e2e 迁移：phase35 getField helper 删除改 getMeta；STORYBOARD-07 断言 V2 wire 形状（`meta.version==='2'`、节点带 branchId、flat `data.framing/cameraMovement`）+ graph:saved 自动 reload 后 getMeta 真往返；mock backend 删 `/api/canvas/save`，全套 `grep "canvas/save" | grep -v save-v2` 0 命中
- **最终门全绿**：根 `tsc --noEmit` exit 0；pkg `tsc -b` exit 0；pkg vitest 195/195（含 selectWinner 无回归）；`npm run test:e2e` 40/40

## Task Commits

1. **Task 1: store 三 canonical 回写 action + vitest（含 transform-survival）** — `8d682953` (feat)
2. **Task 2: FlowCanvas socket 回调 + MetaRenderer 改 canonical 回写** — `28ad2fda` (feat)
3. **Task 3: phase35 e2e 契约迁移 + mock v1 save 删除（含预存红修复）** — `f40b7486` (test)

## Decisions Made

- **progress ephemeral 写入时序**：首版实现把 progress 的 setNodes 写在 canonical transform 之前，被 setGraph 的派生重建冲掉（单测 d 红）。修为 action 内 `applyProgressEphemeral()` 助手在所有分支最后调用——这正是本 phase 要消灭的 bug 类别的镜像，注释写明原因。
- **STORYBOARD-07 reload 方式**：plan 建议"加 reload 后 getMeta 断言"。mock save-v2 本就广播 graph:saved（5ms），前端 onGraphSaved 全量 reload（phase41 SYNC-01 已证），故真往返断言直接 expect.poll getMeta，不引入 page.reload 额外不确定性。
- **PREVIEW-01 观测点**：V3 事件节点折叠后 `evt_*` 不在 store.nodes；op 配方经折叠边 `data.eventId/params` 携带（P19 边中点 op 芯片设计），testMode hook 增 `getEdges` 一行做观测缝。

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] e2e 全套 40 用例预存红（2026-08-02 viewMode 默认值变更遗留）**
- **Found during:** Task 3 首次 `npm run test:e2e`
- **Issue:** 40/40 全部在 loadCanvas 等 `.react-flow__node` 超时——commit 81d2cccc（Aug 2）把 viewMode 默认值改为 'assets' 后，画布视图需手动点导航「画布」，e2e 从未适配，全套红至今（与本次改动无关，dist 探针实证 store 已有 6 节点只是视图未切）
- **Fix:** helpers.mjs 新增 `switchToCanvasView(page)`（getByRole button name '画布' exact）并在 loadCanvas 内调用；phase36/phase40 自带 goto 的两处补调用
- **Files modified:** test/e2e/helpers.mjs、tests/phase36-orchestrator.mjs、tests/phase40-status-normalization.mjs
- **Committed in:** `f40b7486`

**2. [Rule 2 - Missing Critical] 详情面板单/双击行为变更遗留（phase35×5 + phase40×1 红）**
- **Found during:** Task 3 第二次 e2e 跑（32 passed / 8 failed）
- **Issue:** FlowCanvas 现行为单击=选中、双击才 setDetailNode 开右面板（zoomOnDoubleClick=false 配套）；phase35 五个用例与 phase40 NORMALIZE-01 仍用 `.click()` 等 detail-panel
- **Fix:** 观测意图是开面板 → `.dblclick()`（6 处）
- **Files modified:** tests/phase35-storyboard-metadata.mjs、tests/phase40-status-normalization.mjs
- **Committed in:** `f40b7486`

**3. [Rule 2 - Missing Critical] PREVIEW-01 观测点失效（V3 事件折叠遗留）**
- **Found during:** Task 3 第二次 e2e 跑
- **Issue:** `evt_storyboard-1` 不再是 RF 节点（graphToViewModel 折叠 event），getNodes 观测点不存在
- **Fix:** testMode hook 增 `getEdges`（main.tsx 一行，test-only 缝），断言改读折叠边 `data.eventId==='evt_storyboard-1'` 的 `op==='create'` + `params.prompt==='主角进入场景'`——业务语义（构图 prompt 由生成事件携带）不变，观测点随 V3 折叠设计迁移
- **Files modified:** src/main.tsx、tests/phase38-storyboard-preview.mjs
- **Committed in:** `f40b7486`

**4. [Rule 2 - Missing Critical] dist 构建产物过期（e2e 跑的是 dist 不是源码）**
- **Found during:** Task 3
- **Issue:** mock backend 静态服务 `dist/`（Aug 20 构建，pre-51-01），不重建则 STORYBOARD-07 仍走旧 handleSave→v1 save→404
- **Fix:** `npm run build` 重建 dist（gitignored 产物，不入提交）；后续 e2e 复跑均须先重建（地雷 #5 同构）
- **Files modified:** 无（构建产物）
- **Verification:** 重建后 40/40 绿

**5. [plan 明示] phase40 v1 save 迁移 + 文档/注释契约诚实**
- **Issue:** acceptance 要求 `grep -rn "canvas/save" test/e2e/ | grep -v save-v2` 0 命中；phase40 两处 `page.request.post('/api/canvas/save')`（注入 stale blob 通道）+ phase41 注释 + REPORT.md + mock 头注释/health 端点残留
- **Fix:** phase40 两处改打 `/api/canvas/v2/save-v2`（mock 语义等价：有 nodes 即替换 state）；注释/文档/health 计数同步清理——plan Task 3 明写"命中则一并迁移"
- **Files modified:** tests/phase40-status-normalization.mjs、tests/phase41-pipeline-sync.mjs、REPORT.md、mock-backend/server.mjs
- **Committed in:** `f40b7486`

---

**Total deviations:** 5 auto-fixed（4 预存红/产物修复 + 1 plan 明示迁移）
**Impact on plan:** 全部集中在 test/e2e 与 test-only hook（main.tsx getEdges 一行）；生产代码逻辑改动零越界——FlowCanvas 仅 socket 回调区、MetaRenderer 仅 setField/读侧，与 51-01 的 save 区划界遵守（diff 实证 0 交集）。

## Issues Encountered

- **e2e 套件长期失修**：viewMode 默认值（Aug 2）、双击开面板、V3 事件折叠三次行为变更均未回填 e2e，本 plan 一并修复后全套转绿。后续 phase 若再动画布交互行为，须同步跑 `npm run test:e2e`（注意先 `npm run build` 重建 dist）。
- 提醒 51-05：e2e 绿依赖 dist 重建，verify gate 若含 e2e 须把 `npm run build` 纳入前置。

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- WRITE-03 落地：MetaEditor/socket 写入方全部 canonical 化，51-03（右键删除）可复用同一 applyGraphTransform 接缝
- 51-04 提醒：MetaRenderer 已无 setNodes 依赖；flowDataMapper 删除不受本 plan 影响
- verify-phase-51 S3 source-shape 断言可直接 grep：MetaRenderer 含 `updateAssetMeta(`、FlowCanvas socket 区含 `applySocketNodeState|applySocketNodePreview`、phase35 含 `data.meta` 断言

## Self-Check: PASSED

- [x] key-files 全部存在于磁盘（canonicalWriteback.test.ts 新建已提交）
- [x] `git log --grep="51-02"` = 3 commits（8d682953 / 28ad2fda / f40b7486）
- [x] 全部 acceptance_criteria 重跑通过：
  - Task 1: vitest canonicalWriteback 11/11 绿;grep 三 action ≥3;均经 applyGraphTransform;selectWinner 无回归（store 套件 19/19）
  - Task 2: MetaRenderer 含 `updateAssetMeta(` 且 setField 无 flat 写;FlowCanvas L200-230 含两 action 调用且无 setNodes 直改;diff 不触 handleSave/handleOrchestrate;tsc -b exit 0;npm test 195/195
  - Task 3: `npm run test:e2e` 40/40 exit 0;phase35 无 getField、含 getMeta + `meta.version==='2'` 断言;`grep "canvas/save" | grep -v save-v2` 0 命中;mock 仍含 `/api/canvas/v2/save-v2`
- [x] plan 级 verification 重跑：npm test 195/195;双根 tsc exit 0;e2e 40/40;source-shape 全过;mock 无 v1 save 残留

---
*Phase: 51-canonical-write-path-coordination-guard*
*Completed: 2026-08-21*
