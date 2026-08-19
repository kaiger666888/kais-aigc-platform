---
status: partial
phase: 49-selection-write-back-canvas-endpoint-asset-center-linkage-km
source: [49-VERIFICATION.md]
started: 2026-08-19T00:00:00+08:00
updated: 2026-08-19T00:00:00+08:00
---

## Current Test

[awaiting human testing]

## Tests

### 1. SC-2 browser smoke: select → persist → rollback
expected: On infinite-canvas, select a variant winner → F5 refresh → winner persists (loaded from canvas_variant_groups.winner_node_id, not local state). Simulate offline (devtools network offline or stop server) → attempt select → visible rollback to previous winner + error toast; no "UI 已换选但库里没写" state.
result: [pending]

### 2. SC-3 bidirectional refresh check
expected: 资产中心 select an asset (isPrimaryView=true) → refresh canvas → same winner shown in the mapped group; canvas select-winner on a group whose members map to o_assets → refresh asset center → same primary shown. Unmapped cases show info logs, no UI breakage.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps

### G-1 (known limitation, cross-repo debt): SC-4 消费侧半环
SELECT-04 的 "kmc 30s 轮询读到画布换选" 需 review-platform 提供 chosen_variant_id/suggested_action 字段与 resolved/closed 态词汇（现 COMPLETE 永不匹配）。kap 侧桥接已按真实契约交付（fail-closed 三重过滤 + 有界分页 + never-throw）。对齐动作需改 kais-review-platform / kmc（D-11 冻结，本期不动）——登记为跨仓库债务，Phase 50 GUARD 或后续里程碑处理。
status: documented
