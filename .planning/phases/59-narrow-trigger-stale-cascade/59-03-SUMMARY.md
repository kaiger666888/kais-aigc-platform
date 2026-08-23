---
phase: 59-narrow-trigger-stale-cascade
plan: "03"
subsystem: infinite-canvas client wiring / stale-cascade
tags: [stale-cascade, d-01, g1-closure, regen-source, node-updated, flag-1-option-a, phase59]
dependency_graph:
  requires:
    - 服务端 wire 契约 (59-02 markStaleAndBroadcast: node:updated payload = { node: FlowNodeV2 行, changedFields: ["data.stale"] })
    - triggerStaleCascade + useStalePulse (packages/infinite-canvas/src/hooks/useStale.ts, 零改动复用)
    - useCanvasSocket 订阅三件套范式 (onGateState/onVariantSelected 先例) + node:created 坏形状守卫先例
    - executeNode extra 通道 (52-02 契约, ...extra 平铺透传)
  provides:
    - regenSource 两窄路径发射(panel-regen / reroll-seed,STALE-01/02 客户端触发面)
    - useCanvasSocket onNodeUpdated 订阅三件套(接口声明+两处 callbacksRef+socket.on 注册转发)
    - FlowCanvas onNodeUpdated → triggerStaleCascade 实时级联链(G1 缺口闭合,FLAG-1 Option A)
    - dist 构建产物(npm run build,59-04 e2e 前置)
  affects:
    - 59-04 e2e(SC1-5 断言面:mock 回放 node:updated 契约事件 → 角标实时出现;getCalls 断言请求体 regenSource)
    - 既有 node:updated 广播方(v2/nodes.ts PATCH 回声)——被新订阅静默忽略,行为不变
tech_stack:
  added: []
  patterns:
    - 订阅三件套范式复用(options 接口可选回调声明 + callbacksRef 两处字面量同步 + socket.on 注册)
    - 坏形状守卫先例复用(node:created: node != null && typeof node === 'object' 才转发)
    - FLAG-3 红线落地:独立订阅注册,绝不路由进 normalizeSocketNodeState/执行态映射(52-01 stale 保留)
    - 严格契约消费面:非 stale 载荷静默 return(校验失败分支零 store 写入,UI-SPEC §5)
key_files:
  created: []
  modified:
    - packages/infinite-canvas/src/services/canvasApi.ts
    - packages/infinite-canvas/src/components/panel/NodeDetailPanel.tsx
    - packages/infinite-canvas/src/components/eventParams/EventParamsPopover.tsx
    - packages/infinite-canvas/src/hooks/useCanvasSocket.ts
    - packages/infinite-canvas/src/components/FlowCanvas.tsx
decisions:
  - regenSource 形态: canvasApi executeNode extra 类型两值字面量联合('panel-regen'|'reroll-seed'),52-02 通道零逻辑改动(...extra 平铺透传加字段即达);orchestrate/ContextMenu 无此通道 = SC3 架构性保证(grep CanvasContextMenu regenSource = 0)
  - onNodeUpdated 订阅独立注册于 variant:selected 旁——绝不进 normalizeSocketNodeState 或任何执行态映射(FLAG-3 / 52-01 红线:stale 载荷误映射执行态会在 error 时错清 stale)
  - FlowCanvas 轻校验只认两字段: since 为 number + triggerAssetId 为 string(triggerEventId 不校验——级联派发只消费 triggerAssetId);非法或非 stale 载荷的 node:updated(如 nodes.ts PATCH 回声)静默忽略,副作用面=仅 triggerStaleCascade
  - 无 scope 守卫的理由: node:updated 广播走 room=project:{id}(io join 按 projectId 隔离,payload 无 projectId 字段可比),跨项目串扰在传输层已隔离——与 onGateState/onVariantSelected 的 payload 自带 scope 字段不同形
metrics:
  duration_min: 4
  tasks_completed: 2
  files_modified: 5
  completed_at: "2026-08-23T17:23:40Z"
---

# Phase 59 Plan 03: 客户端窄通道接线 Summary

**One-liner:** 两条窄触发路径(面板重生成/芯片换 seed)发射 regenSource 身份标识 + useCanvasSocket 新增 node:updated 订阅三件套,FlowCanvas 把 stale 载荷经三字段轻校验接到既有 triggerStaleCascade——G1 缺口闭合,服务端级联(59-02)实时落画布角标,非 stale 载荷零副作用,全部既有 stale 视觉词汇零改动复用。

## What Was Built

### Task 1 — regenSource 发射 (commit `7e5e5771`)

- `canvasApi.ts` executeNode extra 类型加 `regenSource?: 'panel-regen' | 'reroll-seed'`——52-02 注释段续 Phase 59 段(服务端任务成功且携带此标识时经 markStaleAndBroadcast 标下游 stale;orchestrate/ContextMenu 永不携带);展开逻辑零改动(`...extra` 平铺透传)。updateCanvasNode doc 注释同步:「前端 socket 当前未消费该事件」改为「自 59-03 起消费(仅 stale 载荷)」,乐观更新语义不变(非 stale 载荷——含本端点 PATCH 回声——被静默忽略)。
- `NodeDetailPanel.tsx` handleRegenerate extra 加 `regenSource: 'panel-regen'`(STALE-01 触发路径;prompt/params 保持不变)。
- `EventParamsPopover.tsx` handleRerollSeed extra 加 `regenSource: 'reroll-seed'`(STALE-02 触发路径;换 seed 语义本身仍由 params.seed 透传承担)。
- 既有调用方零改动实证:`grep -c regenSource CanvasContextMenu.tsx` = 0。

### Task 2 — node:updated 订阅三件套 + FlowCanvas 接线 (commit `b7aed918`)

- `useCanvasSocket.ts` 照 onGateState/onVariantSelected 范式逐处:
  - options 接口加 `onNodeUpdated?: (payload: { node: Record<string, unknown>; changedFields?: string[] }) => void`(doc 注释钉 Phase 59 D-01 服务端 stale 标记广播,消费方负责形状守卫与级联派发);
  - callbacksRef 两处字面量同步加 onNodeUpdated(防重连丢回调);
  - socket.on 注册独立置于 variant:selected 旁:`socket.on('node:updated', ...)` 坏形状守卫同 node:created 先例(node != null && typeof node === 'object' 才转发)——注释钉死 FLAG-3 / 52-01 红线(绝不路由进 normalizeSocketNodeState/执行态映射,stale 载荷误映射执行态会在 error 时错清 stale)。
- `FlowCanvas.tsx` useCanvasSocket 调用处加 onNodeUpdated 回调:
  - 轻校验:node.data.stale 形状合法(since 为 number、triggerAssetId 为 string)才继续;校验失败分支纯 return——零 store 写入、零 toast、零选中变更(UI-SPEC §5 严格契约;非 stale 载荷的 node:updated 如 nodes.ts PATCH 回声一律忽略);
  - 合法则 `triggerStaleCascade([stale.triggerAssetId])`(import 自 '../hooks/useStale')——内部即 store.markStaleDownstream 纯函数重算 + 脉动,与服务端真相幂等收敛(divergence impossible by construction);
  - 无 scope 守卫的依据:node:updated 走 room=project:{id} 传输层隔离,payload 无 projectId 字段可比(onGateState/onVariantSelected 的 payload 自带 scope 字段,不同形)。
- 角标/脉动/StaleSection/useStaleRerun 全部零改动消费——FLAG-1 Option A 落地。

## Verification Evidence

| Gate | Result |
|------|--------|
| `npx tsc -b` (packages/infinite-canvas, Task 1 + Task 2) | exit 0 |
| `npm run build` (packages/infinite-canvas, Task 2) | exit 0,✓ built in 2.71s(dist 为 59-04 e2e 前置) |
| `npx vitest run` (packages/infinite-canvas 既有套件回归) | 37 files / 411 tests 全 PASS |
| grep `regenSource` canvasApi.ts | FOUND(两值字面量联合) |
| grep `'panel-regen'` NodeDetailPanel.tsx / `'reroll-seed'` EventParamsPopover.tsx | FOUND(L735 / L87) |
| `grep -c regenSource CanvasContextMenu.tsx` | 0(既有调用方零改动) |
| `grep -c "socket.on('node:updated'" useCanvasSocket.ts` | 1 |
| `grep -c onNodeUpdated useCanvasSocket.ts` | 5 ≥ 4(接口+解构+两处 callbacksRef+注册转发) |
| `grep triggerStaleCascade FlowCanvas.tsx` | 2(import+调用) |
| onNodeUpdated 回调体内 showToast/setSelected/normalizeSocketNodeState | 0(scoped grep,读源码断言) |
| 校验失败分支 store 写入 | 无(纯 return,读源码断言) |
| 两 commit 零 deletion(`git diff --diff-filter=D HEAD~1 HEAD`) | 全部为空 |

行为级验证(角标实时出现/SC1/SC2/非 stale 忽略/SC3 负向)在 59-04 e2e 落地(mock 回放 node:updated 契约事件)——本 plan 为纯接线,e2e 为验收面。

## Deviations from Plan

**None** — plan executed exactly as written. 全部门一次通过,未触发 Rule 1-4。

(说明:Task 2 plan 原文示意 `triggerStaleCascade([String(node.data.stale.triggerAssetId)])`,实现采用两步收窄(校验 `typeof triggerAssetId !== 'string'` 早退后直接传 `stale.triggerAssetId`)——语义完全等价,plan 的 String() 是 unknown 类型访问的防御性转换,收窄后为恒等;无行为差异。)

## Auth Gates

None.

## Known Stubs

None. 纯接线改动;「非 stale 载荷静默忽略」是 UI-SPEC §5 锁定的严格契约,不是缺失功能。

## Threat Flags

None. 本 plan 实现的 mitigation 全部落地:THREAT T-59-07(轻校验 stale 形状三字段中消费侧依赖的两字段——since number + triggerAssetId string——畸形静默忽略;严格契约限定副作用=仅 stale 级联,无面板/选中/toast 面)、T-59-08(独立订阅注册,零 normalizeSocketNodeState 路由,52-01 stale 保留语义结构性保持;59-04 e2e SC4 与 phase52-stale-panel 回归为后续守卫面)。未引入 plan 外新攻击面(订阅消费既有 socket 通道,无新网络端点/鉴权路径/文件访问/schema 变更)。

## Requirements Closed

- **STALE-01/STALE-02 客户端半边**:两条窄路径请求体携带 regenSource(59-02 服务端标记的触发前提);node:updated → triggerStaleCascade 实时链就位(角标实时出现,无需 reload)。服务端半边由 59-02 关闭;行为级 e2e 证明归 59-04。
- **SC3 客户端侧结构性保证**:CanvasContextMenu/orchestrate 客户端链零 regenSource 通道(grep 0)。
- **G1 缺口闭合**(Pitfall 1 / UI-SPEC FLAG-1):D-01 设想的 socket node:updated → triggerStaleCascade 链今天不存在的缺口,由本 plan 补齐。

## Self-Check: PASSED

- Commit `7e5e5771` (Task 1) FOUND in git log
- Commit `b7aed918` (Task 2) FOUND in git log
- `packages/infinite-canvas/src/hooks/useCanvasSocket.ts` 含 socket.on('node:updated' 与两处 callbacksRef onNodeUpdated FOUND
- `packages/infinite-canvas/src/components/FlowCanvas.tsx` 含 onNodeUpdated → triggerStaleCascade FOUND
- `packages/infinite-canvas/src/services/canvasApi.ts` 含 regenSource 两值字面量联合 FOUND
- `packages/infinite-canvas/src/components/panel/NodeDetailPanel.tsx` 含 'panel-regen' FOUND
- `packages/infinite-canvas/src/components/eventParams/EventParamsPopover.tsx` 含 'reroll-seed' FOUND
