---
phase: 52-prompt-edit-regenerate-loop
plan: 01
subsystem: canvas-store
tags: [zustand, flowgraph-v3, canonical-graph, stale-propagation, vitest]

# Dependency graph
requires:
  - phase: 51-canvas-write-path-foundation
    provides: updateAssetMeta/applySocketNodeState canonical 回写范式、deleteNode 持久化+外科式回滚范式、serializeGraphToV2 + save-v2 通道、markStaleDownstream BFS 索引
provides:
  - canvasStore.updateEventParams（事件配方 canonical 同步写入，空值=删字段，kind 守卫）
  - canvasStore.persistEventParams（乐观写 → save-v2 持久化 → 失败回滚 prevParams + error toast）
  - applySocketNodeState stale 自动清除（running/success 清、failed 留）
  - flowgraph-v3 getDownstreamIds（重跑链下游资产 id 集计算引擎）+ buildCausalIndex 私有提取
affects: [52-02 wire round-trip, 52-03 PromptSection, 52-04 换 seed 回写, 52-05 stale 重跑链]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "事件配方写入与资产 meta 同构：守卫早退 + applyGraphTransform 纯函数映射 + 空值删字段，但不引 key 白名单（GenerationParams catchall）"
    - "同步/持久化双 action 拆分：updateEventParams（纯写）+ persistEventParams（写+存+回滚），写入方统一在 store"
    - "stale 清除与 socket state 回写同路径（条件展开 stale:null），不新增 action"
    - "buildCausalIndex 模块私有提取，markStaleDownstream / getDownstreamIds 共用（GUARD 零逻辑复制）"

key-files:
  created: []
  modified:
    - packages/infinite-canvas/src/store/canvasStore.ts
    - packages/infinite-canvas/src/store/__tests__/canonicalWriteback.test.ts
    - packages/flowgraph-v3/ts/src/stale.ts
    - packages/flowgraph-v3/ts/tests/stale.test.ts
    - packages/flowgraph-v3/ts/tests/layout.test.ts（deviation：补预存缺失类型 import）

key-decisions:
  - "updateEventParams 不引 key 白名单：GenerationParams `[key:string]:unknown` catchall + zod catchall 是全图唯一非 strict 点，白名单会堵死 variantRecipes/sourcePath 等 op 级扩展字段"
  - "双 action 拆分理由：52-04 换 seed 回写只需同步落 canonical（持久化等下一次保存），52-03 保存按钮需持久化+回滚；单一 action 会让换 seed 路径被迫整图保存"
  - "failed 保留 stale（plan 裁定）：重跑没产出新事实，脏标记不该消；CONTEXT 只授权 running/success 清除"
  - "getDownstreamIds 的 locked 终点语义：locked 资产自身计入结果（它仍是下游资产），但不越过它向下延伸——与 §13「locked 自身不标脏」不冲突（stale 标记与下游集合是两个问题）"
  - "不在 socket success 路径全局 triggerStaleCascade（地雷 #11）：会把 Phase 37 批量执行的下游全标脏，行为越界；记入 VERIFICATION 遗留归 52-06"

patterns-established:
  - "事件配方 canonical 写入：updateAssetMeta 范式移植到 EventNodeV3.params（kind!=='event' 守卫替代 stage 白名单）"
  - "带持久化 action：快照 prev → 乐观写 → serializeGraphToV2+saveCanvasGraph → 失败外科式回滚 prev + error toast"

requirements-completed: [REGEN-01, REGEN-03]

# Metrics
duration: 5 min
completed: 2026-08-21
---

# Phase 52 Plan 01: 事件配方与 stale 的 store 地基 Summary

**canvasStore 新增 updateEventParams/persistEventParams 双 canonical action（配方写入+持久化回滚）、applySocketNodeState 自动清除 stale（running/success 清、failed 留）、flowgraph-v3 导出 getDownstreamIds 下游计算引擎，33 条新断言全绿。**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-08-21T11:01:02Z
- **Completed:** 2026-08-21T11:05:45Z
- **Tasks:** 3
- **Files modified:** 5（含 1 个 deviation 修复文件）

## Accomplishments

- REGEN-01 地基：事件配方可经 store canonical action 写入（同步版 updateEventParams）并带持久化+回滚（persistEventParams，deleteNode 店级范式），写入方统一在 store，NodeDetailPanel Props 契约不变
- REGEN-03 地基：applySocketNodeState 收到 running/success 自动清除资产节点 stale（与回写同路径零新 action）；getDownstreamIds 经共用 buildCausalIndex 导出，sequence/inactive 排除、locked 终止、环防御语义与 markStaleDownstream 单点一致
- 守卫链完整：graph null / 节点不存在 / kind!=='event' / 缺项目上下文 全部 warn/toast 早退不 throw，vitest 锁死

## Task Commits

1. **Task 1: updateEventParams + persistEventParams store actions + vitest** — `fb63a891` (feat)
2. **Task 2: applySocketNodeState stale 自动清除 + vitest** — `c4aa7c3d` (feat)
3. **Task 3: stale.ts buildCausalIndex 提取 + getDownstreamIds 导出 + vitest** — `61fb9220` (feat，含 deviation 修复)

**Plan metadata:** 见下（docs commit）

## Files Created/Modified

- `packages/infinite-canvas/src/store/canvasStore.ts` — interface 追加两 action 签名；updateEventParams（守卫+纯函数映射+空值删字段）；persistEventParams（乐观写→save-v2→回滚 prevParams+error toast）；applySocketNodeState transform map 内 stale 条件清除（含 plan 裁定注释）
- `packages/infinite-canvas/src/store/__tests__/canonicalWriteback.test.ts` — 追加 updateEventParams 4 组断言（写入/transform-survival/空值/三守卫）、persistEventParams 3 组（成功 payload V2 形状/失败回滚/缺上下文早退）、stale 清除 5 组（success 清/running 清/failed 留/transform-survival/evt_ 守卫）
- `packages/flowgraph-v3/ts/src/stale.ts` — buildCausalIndex 模块私有提取（markStaleDownstream 改调用，行为不变）；新导出 getDownstreamIds（BFS 下游资产 id 集）
- `packages/flowgraph-v3/ts/tests/stale.test.ts` — 追加 getDownstreamIds 7 用例（线性链/sequence/inactive/locked/环/事件起点/ghost）
- `packages/flowgraph-v3/ts/tests/layout.test.ts` — deviation：补 `FlowNodeV3` 类型 import（HEAD 预存 tsc 断点）

## Decisions Made

- **双 action 拆分**：同步版供 52-04 换 seed 回写（不触发整图保存），持久化版供 52-03 保存按钮；避免单 action 迫使轻量回写走 save-v2
- **不引 allowlist**：catchall 契约（research Task 1 明令），与 META_PATCHABLE_KEYS 的 strict 联合场景根本不同
- **failed 保留 stale**：plan 裁定，代码注释写明理由；error 归一为 failed 同样保留（测试锁死）
- **locked 计入结果集**：getDownstreamIds 返回的下游资产集含 locked 自身但不越过——裁定注释写在实现与测试两侧

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] 补 layout.test.ts 预存缺失的 `FlowNodeV3` 类型 import**
- **Found during:** Task 3 验收门 `npx tsc --noEmit`
- **Issue:** HEAD 上 layout.test.ts L500 使用 `FlowNodeV3` 但 import 未含（0796693f 引入的预存断点），tsc exit 2 阻塞 plan 验收门
- **Fix:** import 行追加 `FlowNodeV3`（一行改）
- **Files modified:** packages/flowgraph-v3/ts/tests/layout.test.ts
- **Verification:** `npx tsc --noEmit` exit 0；stale.test.ts 16/16 绿；flowgraph-v3 全套 125/125 绿
- **Committed in:** `61fb9220`（Task 3 commit 内）

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** 一行类型 import 修复，解锁验收门，无 scope creep。

## Issues Encountered

None — 三任务按计划落地，测试一次通过。

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 52-02（wire round-trip）可直接消费：persistEventParams 已走 serializeGraphToV2 通道，52-02 加事件配方反向覆盖后编辑即可跨刷新存活
- 52-05（stale 重跑链）可直接消费：getDownstreamIds 已导出（index.ts `export *` 自动生效），orchestrate nodeIds 子集计算就绪
- 遗留（归 52-06 VERIFICATION）：重生成后下游不自动标 stale（地雷 #11，本期不做）

---
*Phase: 52-prompt-edit-regenerate-loop*
*Completed: 2026-08-21*
