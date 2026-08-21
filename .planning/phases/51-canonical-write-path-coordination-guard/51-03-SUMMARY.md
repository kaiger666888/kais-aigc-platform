---
phase: 51-canonical-write-path-coordination-guard
plan: 03
subsystem: canvas
tags: [canvasStore, context-menu, deleteNode, save-v2, canonical, rollback, vitest]

requires:
  - phase: 51-01
    provides: serializeGraphToV2 + saveCanvasGraph → /canvas/v2/save-v2 统一保存通道
  - phase: 51-02
    provides: store canonical action 范式（applyGraphTransform 写回 + transform-survival）
provides:
  - 右键审核 canonical 化：handleApprove/handleReject 改调 store.approveNode/rejectNode（optimistic + prevGraph 回滚 + toast 内置），菜单层零自管回滚
  - store.deleteNode(nodeId)：canonical 图变换（节点 + 触及 links + variantGroups winner/空组清理）→ save-v2 统一持久化 → 失败回滚 prevGraph + error toast
  - 画布内轻量删除确认 UI（复用驳回确认模式，非浏览器原生弹窗）
  - deleteNode.test.ts 7 用例：图变换 / winner·空组清理 / V2 payload 形状 / 失败回滚 / 三条早退守卫
  - CanvasContextMenu legacy 类型消费清零（add-node 旧类型处理器删除、SCAIL2 块改 plain object），为 51-04 类型本体删除扫清引用
affects: [51-04, 51-05, verify-phase-51]

tech-stack:
  added: []
  patterns:
    - "右键写入三通道统一走 store action：approve/reject/delete 全部 canonical optimistic + 回滚，菜单层只触发不实现"
    - "deleteNode 不新增端点：图变换后 serializeGraphToV2 → saveCanvasGraph（save-v2 全量替换语义即删除语义）"

key-files:
  created:
    - packages/infinite-canvas/src/store/__tests__/deleteNode.test.ts
  modified:
    - packages/infinite-canvas/src/components/CanvasContextMenu.tsx
    - packages/infinite-canvas/src/store/canvasStore.ts

key-decisions:
  - "deleteNode 最终命名沿用 plan 建议 deleteNode(nodeId: string): Promise<void>，置于 store 审核操作区（approveNode/rejectNode 之后）"
  - "确认态命名 showDeletePrompt/setShowDeletePrompt：acceptance grep 'confirm(' 需 0 命中，避开子串碰撞（含注释中的 confirm() 字面量一并改述）"
  - "缺项目上下文（projectId/episodesId null）早退 + warning toast，不做'假成功'乐观删（与 selectWinner D-04 裁定对齐）"
  - "handleAddAsset（AssetNodeData）保留：不在四个 legacy 类型（Script/Storyboard/Video/Audio）删除范围，asset 是 AssetCardNode 活类型"

patterns-established:
  - "store 删除三道清理：links source/target 触及过滤 + winnerNodeId 清空（delete 可选属性）+ 空组整组删除——单测锁死 T-51-03-03"

requirements-completed: [WRITE-02]

duration: 12 min
completed: 2026-08-21
---

# Phase 51 Plan 03: 右键菜单 canonical 化（审核/删除）+ legacy 类型消费清理 Summary

**右键菜单最后一个绕行 canonical 的写入点收编：handleApprove/handleReject 改调既有 store.approveNode/rejectNode（optimistic + 回滚内置）；新增 store.deleteNode——确认 UI → canonical 图变换（节点/links/variantGroups 三道清理）→ save-v2 统一持久化（不新增 delete 端点）→ 失败 prevGraph 回滚 + error toast，7 组 vitest 锁死；同文件 legacy 类型消费清零，51-04 可安全删除类型本体。**

## Performance

- **Duration:** 12 min
- **Started:** 2026-08-21T07:38:00Z
- **Completed:** 2026-08-21T07:50:00Z
- **Tasks:** 3
- **Files modified:** 3（1 新建 / 2 修改）

## Accomplishments

- **审核改线（Task 1）**：CanvasContextMenu 的 canvasApi import 移除 approveNode/rejectNode 符号；handleApprove/handleReject 改为 `void storeApproveNode(nodeId)` / `void storeRejectNode(nodeId, reason)`（store hook 解构），菜单层删除全部自管乐观更新/回滚/toast 逻辑（净 -27/+10 行），与 ReviewActionButtons 消费方式对齐；驳回原因 textarea 交互保留
- **删除落地（Task 2）**：store 新增 `deleteNode`——graph 为空/节点不存在静默早退，缺项目上下文 warning 早退；快照 prevGraph → applyGraphTransform 内过滤节点 + 触及 links + variantGroups（winner 清 winnerNodeId、空组删组）→ `saveCanvasGraph(pid, eid, serializeGraphToV2(cur, rawDataByNodeId))` 持久化 → catch 回滚 prevGraph + `删除失败已回滚` error toast（完全复刻 approveNode 范式）
- **确认 UI（Task 2）**：菜单项「删除节点」点击只展开内联确认区（确认删除/取消双按钮，复用驳回确认的轻量样式），确认后才 `void storeDeleteNode(nodeId)`；零浏览器原生弹窗（`grep -c 'confirm('` = 0）
- **deleteNode.test.ts 7/7 绿**：a 图变换（节点+links 过滤、不触及边保留）；b winner 清理 + 空组删除 + 兄弟组不受牵连；c payload V2 wire 形状（`meta.version==='2'`、branchId、节点集/边无被删 id）；d mock reject → prevGraph 引用级回滚（节点/边/组全恢复）+ error toast；三条早退守卫（graph null / 节点不存在 / 缺项目上下文不调 API）
- **legacy 清理（Task 3）**：四个 legacy 类型名在 CanvasContextMenu 0 命中；add-node 处理器 handleAddStoryboard/handleAddVideo 及对应菜单项「添加分镜节点」「添加视频节点」整体移除（无死按钮残留）；SCAIL2 块 newData 改 plain object（运行时行为不变）；handleAddAsset/「添加资产节点」保留（AssetNodeData 非 legacy 四类）

## Task Commits

1. **Task 1: handleApprove/handleReject 改调 store.approveNode/rejectNode** — `e64f97cd` (feat)
2. **Task 2: store.deleteNode + 删除确认 UI + save-v2 持久化 + vitest** — `0b281362` (feat)
3. **Task 3: CanvasContextMenu legacy 类型使用清理（add-node 处理器 + SCAIL2 块）** — `bf58987c` (refactor)

## Files Created/Modified

- `packages/infinite-canvas/src/store/canvasStore.ts` — deleteNode action（接口声明 + 实现）+ saveCanvasGraph/serializeGraphToV2 import
- `packages/infinite-canvas/src/store/__tests__/deleteNode.test.ts` — 新建，7 用例（mock 范式沿用 selectWinner.test.ts，serializeGraphToV2 走真实实现）
- `packages/infinite-canvas/src/components/CanvasContextMenu.tsx` — 审核改线 + 删除确认 UI + legacy 类型消费清理（三个 task 共改，按提交原子拆分）

## Decisions Made

- **deleteNode 命名**：沿用 plan 建议 `deleteNode`，未另造名。
- **确认态命名 showDeletePrompt**：acceptance 的 `grep -c 'confirm('` = 0 是逐字门，`setShowDeleteConfirm(` 会因子串误命中；连带两处注释中的 `confirm()` 字面量改述为"浏览器原生确认弹窗"。行为零变化。
- **缺项目上下文不做乐观删**：selectWinner（D-04）同款裁定——无项目上下文时落库不可能，早退 + warning，不留"UI 删了库里没写"假象。
- **handleAddAsset 保留裁定**：plan 文字为"创建 Script/Video/Audio/Storyboard 旧类型节点的入口整体删除"，handleAddAsset 创建的是 AssetCardNode 活类型 asset 节点且 AssetNodeData 不在 51-04 删除清单，故保留；移除菜单项清单 = 「添加分镜节点」「添加视频节点」两项。

## Deviations from Plan

无范围偏差。两处 acceptance 守门兼容性处理（confirm( 子串、注释字面量）已在 Decisions 记录，均为零行为变化的命名/措辞调整。

## Issues Encountered

- 无阻塞问题。serializeGraphToV2 在 rawDataByNodeId===null（测试 fixture）下退化正常，未触发地雷 #6。

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- WRITE-02 落地：右键审核/删除全部走 canonical 路径；删除经 save-v2 持久化，"删除后不复活"的集成断言由 51-05 verify-phase-51 S2（saveFullGraph→saveFullGraph(减节点)→loadFullGraph）闭环
- 51-04 可直接删除 types/canvas.ts 四个 legacy 类型本体：CanvasContextMenu 已 0 命中；verify gate grep 范围含本文件即过
- verify-phase-51 S2 source-shape 断言可直接 grep：CanvasContextMenu 无 canvasApi approveNode/rejectNode import、含 `s.deleteNode` hook 解构 + `showDeletePrompt` 确认态、`confirm(` 0 命中
- 部署提醒（地雷 #5 同构）：右键删除/审核新链路需重跑 `scripts/deploy-canvas.sh` 才对线上 SPA 生效，phase 收尾统一处理

## Self-Check: PASSED

- [x] key-files 全部存在于磁盘（deleteNode.test.ts 新建已提交）
- [x] `git log --grep="51-03"` = 3 commits（e64f97cd / 0b281362 / bf58987c）
- [x] 全部 acceptance_criteria 重跑通过：
  - Task 1：canvasApi import 行无 approveNode/rejectNode；审核调用经 store hook 解构（L40-41）；pkg `tsc -b` exit 0；npm test 绿
  - Task 2：deleteNode.test.ts 7/7 绿；canvasStore `grep -c deleteNode` ≥ 2（接口+实现）；handleDelete 路径含确认态 + deleteNode 调用；`grep -c 'confirm('` = 0；src/routes/canvas 无新 delete 端点
  - Task 3：四 legacy 类型名 0 命中；无残留菜单项指向已删处理器（grep handleAddStoryboard/handleAddVideo = 0）；pkg `tsc -b` exit 0；npm test 绿
- [x] 最终门重跑：根 `tsc --noEmit` exit 0；pkg `tsc -b` exit 0；pkg vitest 202/202（195 既有 + 7 新增，零回归）

---
*Phase: 51-canonical-write-path-coordination-guard*
*Completed: 2026-08-21*
