# Phase 61: 审计清债 TD-3/4/5 (Audit Debt Clearance) - Pattern Map

**Date:** 2026-08-24 (inline)
**Phase files:** ~12 (8 修改 + 4 新建) · **Analogs:** 全部有同仓先例

## File Classification

| File | Role | Closest Analog | Evidence |
|------|------|----------------|----------|
| `packages/infinite-canvas/src/utils/placeNewAsset.ts` | 修改?否——零改动复用（anchor='source' 分支已存在） | 自身 | RESEARCH F-4 |
| 资产中心拖入组件（AssetCenter/拖放处理） | 修改 — drag-in 接线 placeNewAsset(anchor='source') | FlowCanvas onNewAsset 消费侧（55-04 L284-304） | 59-PATTERNS「useCanvasSocket 三件套」姊妹面 |
| `packages/infinite-canvas/src/services/canvasApi.ts` | 修改 — placeAssetOnCanvas stub 处置 + POST /nodes 客户端 | 同文件 executeNode/saveCanvasGraph 既有调用范式 | 59-PATTERNS A |
| `src/lib/reviewBridge.ts` | 修改 — L182 尾斜杠一字修 + 文档注释同步 | gateStateService L323-324 同陷阱修复先例 | verify-phase-54 L193 回归锁范式 |
| `packages/flowgraph-v3/ts/src/migrate.ts` | 修改 — buildMeta 5 字段读回（script/storyboard/video/global 四分支） | 同文件既有字段读取范式（nullish 守卫 + warn） | RESEARCH F-3 |
| `packages/flowgraph-v3/ts/tests/`（roundtrip 测试） | 新建/扩充 | stale.test.ts / 既有 roundtrip 测试范式 | RESEARCH F-3 rawData=null 陷阱 |
| `packages/infinite-canvas/test/e2e/mock-backend/server.mjs` | 修改 — 两条新路由 | 既有 save-v2/load-v2/`/__mock/emit` 路由范式 | 59-PATTERNS「mock 回放契约」 |
| `packages/infinite-canvas/test/e2e/tests/phase61-debt.mjs` | 新建 — drag-in/add-to-canvas e2e | phase55-nav new-asset-placement（落点 ≤64px 有界断言）+ phase60 e2e 范式 | 59-PATTERNS J |
| `scripts/verify-phase-61.ts` | 新建 — 聚合门 | verify-phase-{59,60}.ts 骨架 | 59-PATTERNS H |
| `.planning/phases/61-audit-debt-clearance/61-DEBT-04-VERDICT.md` | 新建 — DEBT-04 裁定成文 | 60-DIAGNOSIS.md 证据裁定文档范式 | 60-01 |
| FlowCanvas onNewAsset 区 | 修改 — 守护注释强化（DEBT-04 锁） | 既有 WRITE-03 注释 | RESEARCH F-1 |

## Shared Patterns

1. **证据裁定文档**：60-DIAGNOSIS.md 范式 → 61-DEBT-04-VERDICT.md（Branch A 证据链成文）。
2. **回归锁双形态**：unit（注入 fetchImpl 断言 URL）+ 静态 grep（verify 门）——DEBT-02 两个都上（research 开放问题裁定：both cheap）。
3. **roundtrip 测试 rawData=null 陷阱**：flowgraph-v3 往返断言必须 rawDataByNodeId=null（raw 透传会掩盖 buildMeta 丢失）。
4. **e2e serve dist + mock 路由先建后测**（Wave 0）。
5. **放置有界断言**：phase55-nav ≤64px 先例。
