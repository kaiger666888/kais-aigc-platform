---
phase: 58-full-recipe-persistence
plan: 01
subsystem: canvas-data-channel
tags: [flowgraph-v3, serialize, migrate, recipe-roundtrip, delete-propagation, zod, vitest]

# Dependency graph
requires:
  - phase: 51-write-path-foundation
    provides: serializeGraphToV2 V3→V2 唯一保存序列化器 + verify-phase-51 聚合门
  - phase: 52-regen-loop
    provides: 事件配方反向覆盖三键窄通道（52-02）+ updateEventParams 空值删除语义
provides:
  - RECIPE_ROUNDTRIP_KEYS 九键映射契约（含 modelVersion↔engine 唯一非恒等映射）
  - RECIPE_EDITABLE_FIELDS 五键可编辑白名单 + RECIPE_KNOWN_KEYS 九键已知集（58-02/03 面板与 popover 换源用）
  - migrate recipeParams 全集提取 + hasRecipe 任意键判定（丢弃点②解除）
  - serialize 九键写回 + delete 传播（丢弃点①解除，「空=未设置」清空语义成立）
  - verify-phase-51 S1 断言注解（允许恰一条 RECIPE_ROUNDTRIP_KEYS 运行时导入）
affects: [58-02-canvasAssetSchema-UI, 58-03-e2e, 58-04-verify-phase-58, 59-stale-cascade]

# Tech tracking
tech-stack:
  added: []  # 零外部新依赖（全仓内改造）
  patterns:
    - "映射表驱动键名 round-trip：RECIPE_ROUNDTRIP_KEYS 单点契约，migrate/serialize/verify 三处消费，禁裸字符串数组"
    - "delete 传播：params 缺键 → 同步 delete wire data 同键，与 updateEventParams 空值删除对称"
    - "零 import 纯常量模块（recipe.ts）：root verify 脚本相对路径直连 import 的前提"

key-files:
  created:
    - packages/flowgraph-v3/ts/src/recipe.ts
  modified:
    - packages/flowgraph-v3/ts/src/migrate.ts
    - packages/flowgraph-v3/ts/src/index.ts
    - packages/flowgraph-v3/ts/tests/migrate.test.ts
    - packages/infinite-canvas/src/v3/serialize.ts
    - packages/infinite-canvas/src/v3/__tests__/serialize.test.ts
    - scripts/verify-phase-51.ts

key-decisions:
  - "路线 A 裁决落地：serialize.ts 唯一一条运行时常量导入 RECIPE_ROUNDTRIP_KEYS，verify-phase-51 断言外科注记允许恰这一条"
  - "negative 进往返集但不进可编辑集（往返≠可编辑，planner 裁决 2）"
  - "delete 传播语义：canonical 缺键 = 清空 → wire 同步删（顺手覆盖 prompt 清空 '' 同款潜在复活 bug）"

patterns-established:
  - "Pattern: 配方键集单点常量（recipe.ts）——后续 UI/schema/verify 全部引用此处，防三方漂移"
  - "Pattern: 陈旧 verify 断言随现实外科更新并注记（Phase 48 先例，本 plan S1/S4/S5 三处延续）"

requirements-completed: [RECIPE-01, RECIPE-03]

# Metrics
duration: 7 min
completed: 2026-08-23
---

# Phase 58 Plan 01: 全配方持久化数据通道 Summary

**九键配方 round-trip 数据通道：recipe.ts 映射契约（modelVersion↔engine 唯一非恒等映射）+ migrate 全集提取 + serialize 九键写回与 delete 传播——serialize/migrate 对称落地，§14 双丢弃点解除，graph:saved 同屏回读不再回退高级字段**

## Performance

- **Duration:** 7 min
- **Started:** 2026-08-23T12:52:11Z
- **Completed:** 2026-08-23T12:59:04Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- `recipe.ts` 零 import 纯常量契约模块：`RECIPE_ROUNDTRIP_KEYS` 九对映射（negative 在往返集）、`RECIPE_EDITABLE_FIELDS` 恰五键、`RECIPE_KNOWN_KEYS` p 侧派生；barrel 导出
- migrate 窄通道解除：`recipeParams` 映射表驱动九键全集提取（lora 深结构整袋透传），`hasRecipe` 任意映射键在场判定（Pitfall 8：仅 steps 节点不再落 orphan import 种子）
- serialize 窄通道解除：九键写回（52-02 script prompt 例外保留）+ **delete 传播**（params 缺键 → 同步 delete wire data 同键，防 rawData 陈旧值复活，清空语义成立）
- verify-phase-51 S1 断言外科注解（恰好一条 RECIPE_ROUNDTRIP_KEYS 运行时导入豁免），聚合门 45/45 全绿

## Task Commits

1. **Task 1: recipe.ts 九键映射契约 + migrate 全集提取** - `53849426` (feat)
2. **Task 2: serialize 反向覆盖拓宽 + delete 传播 + verify-phase-51 断言注解更新** - `fef430c8` (feat)

**Plan metadata:** 见本文件提交（docs）

## Files Created/Modified

- `packages/flowgraph-v3/ts/src/recipe.ts` — 新建：九键映射契约 + 可编辑白名单 + 已知键集（零 import 纯常量）
- `packages/flowgraph-v3/ts/src/index.ts` — barrel 追加 `export * from './recipe.js'`
- `packages/flowgraph-v3/ts/src/migrate.ts` — recipeParams/hasRecipe 映射表驱动重写
- `packages/flowgraph-v3/ts/tests/migrate.test.ts` — 新 describe 'Phase 58: recipeParams 全集提取'（3 用例）
- `packages/infinite-canvas/src/v3/serialize.ts` — 反向覆盖循环重写（九键 + delete 传播）+ 头注释纪律更新 + 唯一运行时常量导入
- `packages/infinite-canvas/src/v3/__tests__/serialize.test.ts` — 新 describe 'Phase 58: 全配方反向覆盖 + delete 传播'（4 用例）
- `scripts/verify-phase-51.ts` — S1 断言注解更新（RECIPE_ROUNDTRIP_KEYS 豁免）+ S4/S5 陈旧断言修复（见 Deviations）

## Verification Results（plan-level）

- 双包 vitest：flowgraph-v3 **133/133**（基线 130 + 3 新增）、infinite-canvas **410/410**（基线 406 + 4 新增）全绿不降
- 三根 tsc：root `tsc --noEmit` / infinite-canvas `tsc -b` / flowgraph-v3 `tsc --noEmit` 全 clean
- `npm run verify:phase-51` **45/45 PASSED**（含 forced-failure 自检 3/3 按预期 FAIL）
- `grep -c "^import" recipe.ts` = 0（零依赖前提成立）；`Object.keys(generationParamsSchema.shape)` 九键与 ROUNDTRIP p 侧一致（单测 (a) 用例先行覆盖，Plan 04 verify 门机器锁死）

## Decisions Made

- 按 plan 路线 A 落地 serialize 运行时导入；verify-phase-51 过滤逻辑改为「恰好一条运行时导入行且绑定恰为 RECIPE_ROUNDTRIP_KEYS，其余仍须 import type」
- recipeParams/serialize 写侧均以 `as Record<string, unknown>` 收窄访问（GenerationParams 具名键联合写入的 TS 限制，与 RESEARCH Pattern 2 示例同款 idiom）

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - verify 门假红] verify-phase-51 S4 dead-list 陈旧：BranchPanel.tsx**
- **Found during:** Task 2（verify:phase-51 验收实跑）
- **Issue:** S4 断言 BranchPanel.tsx 已删除（51-04 事实），但 Phase 55-06（commit 912eda85，NAV-06）已将其重写为活组件（FlowCanvas.tsx 消费）——断言永久假红，属预存失败，非本 plan 引入
- **Fix:** 从 deadFiles 列表移除 BranchPanel.tsx + 行内 Phase 58 注记（Phase 48「旧 verify 断言随现实更新并注记」先例）
- **Files modified:** scripts/verify-phase-51.ts
- **Verification:** verify:phase-51 45/45 全绿
- **Committed in:** fef430c8（Task 2 commit）

**2. [Rule 1 - verify 门假红] verify-phase-51 S5 ROADMAP COORD-01 引用断言陈旧**
- **Found during:** Task 2（同上实跑）
- **Issue:** 断言要求现行 ROADMAP.md 引用 COORD-01 spec，但 v3.1 kickoff ROADMAP 重写后该引用移至 v3.0 归档（milestones/v3.0-ROADMAP.md L33）——预存失败
- **Fix:** 断言接受 ROADMAP.md 或 v3.0 归档任一携带引用 + Phase 58 注记（门强度不降：交叉引用必须存在于持久文档）
- **Files modified:** scripts/verify-phase-51.ts
- **Verification:** verify:phase-51 45/45 全绿
- **Committed in:** fef430c8（Task 2 commit）

---

**Total deviations:** 2 auto-fixed（2 × Rule 1 verify 门假红）
**Impact on plan:** 两条均为预存门假红（55-06 / v3.1 ROADMAP 重写遗留），不修则本 plan acceptance「verify:phase-51 全绿」无法达成且假红掩盖真回归。修复外科化且注记留痕，无 scope creep。

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 数据通道（migrate 提取 = serialize 写回 = 九键全集）已对称落地，58-02（canvasAssetSchema 五分支声明 + 面板高级参数编辑器 + popover KNOWN_KEYS 换源）可直接消费 `RECIPE_EDITABLE_FIELDS`/`RECIPE_KNOWN_KEYS`
- 58-04 verify-phase-58 三方集合相等门已有落点：recipe.ts 零依赖可直接相对 import
- 注意（58-02+）：audio 节点 data.engine 是服务端必填字段，delete 传播在「事件 params 缺 modelVersion 的 audio 节点」上会删 engine → save-v2 400；当前 load 链 migrate 必回填 modelVersion，且 modelVersion 不在可编辑集，实际不可达——58-02 声明字段时保持 engine 必填位现状勿动（PATTERNS 已有同款提醒）

## Self-Check: PASSED

- created/modified 文件 7/7 在盘
- commits 53849426 / fef430c8 均在 git log
- 全部 acceptance criteria 复跑通过（见 Verification Results）

---
*Phase: 58-full-recipe-persistence*
*Completed: 2026-08-23*
