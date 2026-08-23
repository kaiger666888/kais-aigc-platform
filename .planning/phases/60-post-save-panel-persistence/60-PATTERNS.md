# Phase 60: 保存后面板保持 (Post-Save Panel Persistence) - Pattern Map

**Date:** 2026-08-24 (inline — subagent quota circuit)
**Phase files:** 8 (6 修改 + 2 新建) · **Analogs:** 8/8（本 phase 全部改动落在既有文件/既有范式上，多处与 59-PATTERNS 同面）

## File Classification

| File | Role | Closest Analog | Evidence |
|------|------|----------------|----------|
| `src/routes/canvas/v2/save-v2.ts` | 修改 — savedBy zod + broadcast 回显 | 同文件 L60-77 既有 broadcast 行;59 CR-02 scope 字段随 wire 透传同型 | 59-PATTERNS Shared Pattern「node:updated 契约」 |
| `packages/infinite-canvas/src/services/canvasApi.ts` | 修改 — saveCanvasGraph 增 savedBy 参数 | 同文件 executeNode extra 通道（52-02→59 regenSource 同型扩法） | 59-PATTERNS A「execute.ts 契约接线」 |
| `packages/infinite-canvas/src/components/FlowCanvas.tsx` | 修改 — onGraphSaved 自回声判定 + tabId | 同文件 L328-342 既有 scope 守卫三段式;tabId 生成挂组件顶层 | 59-PATTERNS「useCanvasSocket 订阅三件套」姊妹面 |
| `packages/infinite-canvas/src/hooks/useCanvasSocket.ts` | 修改 — graph:saved payload 类型加 savedBy? | 同文件 L234-237 既有订阅;59 node:updated 订阅为最近同型新增 | 59-PATTERNS G1 接线 |
| `packages/infinite-canvas/src/store/canvasStore.ts` | 修改 —（视诊断结果）锚保持/loading 门 | setGraph L445-446 既有重锚;loadInitialGraph L477-493 | 59-PATTERNS「落库-广播序列」 |
| `packages/infinite-canvas/test/e2e/mock-backend/server.mjs` | 修改 — savedBy 透传 + 删 suppressGraphSaved | 同文件 L186-197 save-v2 handler;59-04 旋钮即被删对象 | 59-PATTERNS「mock 回放契约」 |
| `packages/infinite-canvas/test/e2e/tests/phase60-panel-persist.mjs` | 新建 — 四用例 e2e | `phase59-stale-cascade.mjs`（getCalls/body 断言/`/__mock/emit` 范式全套同型） | 59-PATTERNS J |
| `packages/infinite-canvas/test/e2e/probe-60-real.mjs` | 新建 — 零足迹真机探针 | `probe-59-real.mjs`（捕获-恢复 finally 范式） | 59-PATTERNS K |
| `scripts/verify-phase-60.ts` | 新建 — 聚合门 | `verify-phase-59.ts`（S 段/forced-failure/命令门全套骨架） | 59-PATTERNS H |

## Shared Patterns (cross-cutting)

1. **wire 契约扩展三件套**（59 CR-02 先例）：server zod → broadcast payload → useCanvasSocket 类型 → 消费方守卫。savedBy 走同一条链。
2. **可选参数向后兼容**（52-02 先例）：savedBy optional——既有调用方（kmc pipeline）不传 → 行为不变（无 savedBy 的广播=他端语义,所有客户端 reload,零回归）。
3. **e2e serve dist 非 source**（59 地雷 #10）。
4. **零足迹探针**：before/after 快照 diff + finally 恢复（probe-59-real 全套照搬）。
5. **静态锁写法**：verify grep 锚定源码 token（59 S4/S5 范式）——本 phase 锁「skip 分支保留 lastEventCountRef 重置」「suppressGraphSaved 已删」。
