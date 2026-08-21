---
phase: 51-canonical-write-path-coordination-guard
plan: 04
subsystem: canvas
tags: [dead-code, cleanup, legacy-types, flowgraph-v3, dependency, infinite-canvas]

requires:
  - phase: 51-01
    provides: flowDataMapper 消费点（FlowCanvas/CanvasContextMenu canvasToFlowGraph 调用）全部清除
  - phase: 51-03
    provides: CanvasContextMenu legacy 类型消费清零（四个 legacy 类型名 0 命中），类型本体删除扫清引用
provides:
  - 12 个死代码文件整体删除（4 旧节点渲染器 + AssetNode + VariantGroupDetail + BranchPanel + StructuredFieldPanel + 3 旧徽章 + flowDataMapper，-3,317 行）
  - types/canvas.ts 四个 legacy 类型本体删除（ScriptNodeData/StoryboardNodeData/VideoNodeData/AudioNodeData，-72 行）
  - packages/infinite-canvas dependencies 声明 @kais/flowgraph-v3 (file:../flowgraph-v3)，幽灵依赖正名；vite alias/tsconfig paths 保留
  - canvasToFlowGraph 全仓 0 命中（排除构建产物）
affects: [51-05, verify-phase-51, phase-55 NAV-06 BranchPanel 重建]

tech-stack:
  added: []
  patterns:
    - "本地包声明：packages 间依赖用 file: 相对路径声明进各自 package.json，并在包目录内 npm install 更新包级 lockfile（本仓非 npm workspaces）"
    - "死代码删除前置：逐文件 basename grep 全量复核 + 红线活组件存在性断言进 acceptance"

key-files:
  created: []
  modified:
    - packages/infinite-canvas/src/components/FlowCanvas.tsx（死 import AssetNodeComponent 移除）
    - packages/infinite-canvas/src/types/canvas.ts（4 legacy 类型删除 + 过期注释改述）
    - packages/infinite-canvas/src/v3/adapter.ts / v3/serialize.ts（flowDataMapper 注释改述）
    - packages/infinite-canvas/package.json + package-lock.json（@kais/flowgraph-v3 声明）
  deleted:
    - packages/infinite-canvas/src/components/nodes/{ScriptNode,VideoNode,AudioNode,StoryboardNode,AssetNode}.tsx
    - packages/infinite-canvas/src/components/{VariantGroupDetail,BranchPanel,StructuredFieldPanel,ScoreBadge,VariantBadge,FeedbackBadge}.tsx
    - packages/infinite-canvas/src/utils/flowDataMapper.ts

key-decisions:
  - "install 落点为 packages/infinite-canvas/ 包级 lockfile：本仓根 package.json 无 workspaces 字段，根 npm install 不处理包子依赖；plan 所写 package-lock.json 实际生效文件为 packages/infinite-canvas/package-lock.json"
  - "npm install 统一加 --legacy-peer-deps：根依赖 @rmp135/sql-ts@2.2.0 与 sqlite3@6 存在先于本 plan 的 peer 冲突，与本次变更无关"
  - "过期注释改述而非保留：acceptance 要求 flowDataMapper/VariantGroupDetail/BranchPanel/StructuredFieldPanel 0 命中，5 处注释（adapter/serialize/types）同步改述，零行为变化"

patterns-established:
  - "删除-断言闭环：每文件删除前 basename grep 复核 → 删除后 find 0 命中 + 红线文件 ls 存在 + tsc/vitest 门"

requirements-completed: [WRITE-04]

duration: 7 min
completed: 2026-08-21
---

# Phase 51 Plan 04: 死代码清除 + 依赖正名 Summary

**12 个死代码文件（-3,317 行）整体删除并逐文件 grep 复核零活引用，types/canvas.ts 四个 legacy 节点数据类型本体删除，@kais/flowgraph-v3 以 file: 声明进 infinite-canvas dependencies 消除幽灵依赖；红线活组件 NodeBadges/ScoreMiniBar 完好，双根 tsc + 双包 vitest(202+118) + vite build 全绿，canvasToFlowGraph 全仓 0 命中。**

## Performance

- **Duration:** 7 min
- **Started:** 2026-08-21T07:47:46Z
- **Completed:** 2026-08-21T07:54:38Z
- **Tasks:** 3
- **Files modified:** 18 changed（12 删除 / 6 修改），+18 / -3,410 行

## Accomplishments

- **死代码清除（Task 1）**：删除前对 12 个文件逐一 basename grep 全量复核——唯一的真实活引用是 FlowCanvas.tsx L18 的 `import AssetNodeComponent`（已确认 nodeTypes L71-91 全路由 AssetCardNode，该 import 无消费者），其余命中均为注释或同名局部符号（AssetNodeV3 / StoryboardTimeline 内局部 ScoreBadge 函数）；12 文件 git rm 后 find 0 命中、红线 `badges/NodeBadges.tsx`/`badges/ScoreMiniBar.tsx` 存在、pkg `tsc -b` exit 0、vitest 202/202 绿
- **legacy 类型清零（Task 2）**：types/canvas.ts 删除 ScriptNodeData/StoryboardNodeData/VideoNodeData/AudioNodeData 四个接口（消费方前置 grep 确认仅剩类型本体——51-03 已清 CanvasContextMenu、Task 1 已删 flowDataMapper）；四类型名在 packages/infinite-canvas/src + src/ 合计 0 命中；AssetNodeData/VariantGroupNodeData 等活类型保留，tsc/vitest 无连带破坏
- **依赖正名（Task 3）**：packages/infinite-canvas/package.json dependencies 增加 `"@kais/flowgraph-v3": "file:../flowgraph-v3"`（外层包名，非内层 flowgraph-v3）；vite.config.ts alias 与 tsconfig paths 原样保留（diff 确认零触碰）；包目录内 npm install 更新包级 lockfile（node_modules/@kais/flowgraph-v3 → symlink）；根 `tsc --noEmit` + pkg `tsc -b` + pkg vitest 202 + flowgraph-v3/ts vitest 118 + `npm run build`（tsc -b && vite build）五项全绿

## Task Commits

1. **Task 1: 删除 12 个死代码文件 + FlowCanvas 死 import/过期注释清理** — `372625cb` (refactor)
2. **Task 2: types/canvas.ts 四个 legacy 类型本体删除** — `b57d715c` (refactor)
3. **Task 3: @kais/flowgraph-v3 file: 依赖声明 + 全量构建验证** — `bede7e74` (chore)

## Files Created/Modified

- 删除 12 文件（见 frontmatter deleted）：nodes/{ScriptNode,VideoNode,AudioNode,StoryboardNode,AssetNode}.tsx、{VariantGroupDetail,BranchPanel,StructuredFieldPanel,ScoreBadge,VariantBadge,FeedbackBadge}.tsx、utils/flowDataMapper.ts —— 合计 -3,317 行
- `packages/infinite-canvas/src/components/FlowCanvas.tsx` — 移除死 import `AssetNodeComponent`（-1 行），其余逻辑零触碰
- `packages/infinite-canvas/src/types/canvas.ts` — 删除 4 个 legacy 接口（-72 行）+ 3 处过期注释改述（awaiting_audit / VariantGroupDetail 状态机 / progress 桥接说明）
- `packages/infinite-canvas/src/v3/adapter.ts`、`v3/serialize.ts` — 各 1 处 flowDataMapper 注释改述（零行为变化）
- `packages/infinite-canvas/package.json` + `package-lock.json` — @kais/flowgraph-v3 file: 声明与 lockfile 同步

## Decisions Made

- **安装落点为包级 lockfile**：plan 写"根目录 npm install 更新 package-lock"，但本仓根 package.json 无 workspaces 字段，根 install 不处理 packages 子依赖（实测根 install 后 lockfile 无变化）。改在 `packages/infinite-canvas/` 内执行 npm install，实际更新 packages/infinite-canvas/package-lock.json——依赖声明语义等价达成。
- **`--legacy-peer-deps`**：根依赖 @rmp135/sql-ts@2.2.0 的 peerOptional sqlite3@^5.1.7 与根 sqlite3@^6.0.1 冲突（先于本 plan 存在，ERESOLVE），三处 install（根探测/包级/flowgraph-v3）统一加该 flag；根 lockfile 未被修改，根 `tsc --noEmit` 验证无损。
- **flowgraph-v3/ts 补装依赖**：该目录 node_modules 从未安装（vitest not found，先于本 plan），npm install 后 118/118 绿——属环境补齐，非代码变更。

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] 根 npm install ERESOLVE（既有 peer 冲突）**
- **Found during:** Task 3（依赖声明）
- **Issue:** 根目录 npm install 被 @rmp135/sql-ts↔sqlite3@6 的既有 peer 冲突阻断（与本次变更无关）
- **Fix:** 改用 `npm install --legacy-peer-deps`；并发现本仓非 workspaces，改在包目录内安装以更新包级 lockfile
- **Files modified:** packages/infinite-canvas/package-lock.json
- **Verification:** lockfile 含 @kais/flowgraph-v3 条目 + symlink 就位；根/包 tsc、双包 vitest、vite build 全绿；根 package-lock.json 零改动
- **Committed in:** `bede7e74`

**2. [Rule 1 - Bug] 过期注释命中 acceptance grep**
- **Found during:** Task 1（acceptance grep flowDataMapper|VariantGroupDetail 要求 0 命中）
- **Issue:** v3/adapter.ts、v3/serialize.ts、types/canvas.ts 共 5 处注释仍引用已删模块/组件名
- **Fix:** 注释改述为不具名表述（"v1 持久化层""变体组详情 UI"等），零行为变化
- **Files modified:** v3/adapter.ts、v3/serialize.ts、types/canvas.ts
- **Verification:** acceptance grep 0 命中；tsc/vitest 绿
- **Committed in:** `372625cb`

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** 均为达成 acceptance 的必要守门处理；无范围蔓延，无逻辑变更。

## Issues Encountered

- grep 复核发现若干"疑似活引用"实为注释或同名局部符号（AssetNodeV3 类型、StoryboardTimeline 局部 ScoreBadge 函数、focusAssetNodeId store 字段等），逐一人工核对后确认清单与 CONTEXT 一致，无误删风险。
- 观察（非本 plan 范围）：VariantGroupUIState/VariantReviewLoadingState 原仅服务 VariantGroupDetail，宿主删除后已成孤儿导出；plan 明确"保留其余活类型不动"，本次未删，留待后续清理。

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- WRITE-04 落地：死代码与 legacy 类型层清零，@kais/flowgraph-v3 依赖正名；verify-phase-51 可直接断言——12 文件 find 0 命中、四 legacy 类型名 0 命中、package.json dependencies 含 @kais/flowgraph-v3、canvasToFlowGraph 0 命中（排除 static/ 构建产物）
- BranchPanel 已按 ROADMAP 决策 #6"先删后建"移除，Phase 55 NAV-06 将在干净地基上重写（git 历史即档案）
- CanvasContextMenu.tsx 本 plan 零触碰（与 51-03 文件划界，diff 0 行实证）
- 部署提醒（地雷 #5 同构）：前端产物变更需重跑 `scripts/deploy-canvas.sh` 才对线上 SPA 生效，phase 收尾统一处理

## Self-Check: PASSED

- [x] 12 个删除文件 find 0 命中；红线 `ls badges/NodeBadges.tsx badges/ScoreMiniBar.tsx` 均存在
- [x] 四 legacy 类型名在 packages/infinite-canvas/src + src/ 合计 0 命中
- [x] `grep -rn "flowDataMapper\|VariantGroupDetail\|BranchPanel\|StructuredFieldPanel" packages/infinite-canvas/src` = 0
- [x] `git log --grep="51-04"` = 3 commits（372625cb / b57d715c / bede7e74）
- [x] CanvasContextMenu.tsx 本 plan diff 0 行
- [x] `grep -c '"@kais/flowgraph-v3"' packages/infinite-canvas/package.json` = 1 且在 dependencies 块内；vite.config.ts alias 保留
- [x] 最终门重跑：根 `tsc --noEmit` exit 0；pkg `tsc -b` exit 0；pkg vitest 202/202；flowgraph-v3/ts vitest 118/118；`npm run build` exit 0；canvasToFlowGraph 0 命中（排除构建产物）

---
*Phase: 51-canonical-write-path-coordination-guard*
*Completed: 2026-08-21*
