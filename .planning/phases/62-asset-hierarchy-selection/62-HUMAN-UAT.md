---
status: partial
phase: 62-asset-hierarchy-selection
source: [62-VERIFICATION.md]
started: 2026-08-25T00:20:00+08:00
updated: 2026-08-25T00:20:00+08:00
---

## Current Test

[awaiting human testing — deferred per user's phase-59/60/61 precedent: continue autonomous run]

## Tests

### 1. 层级视图真实观感（折叠导航/计数聚合/单件桶）
expected: :10588 资产管理中心 → 「资产层级」第 5 Tab;域树折叠导航流畅、组卡计数芯片与实际一致、单件桶与 reportAudit 排除面直观可辨(机器面已全绿: hierarchy e2e 8/8 含 D-04 跨源一致性与 D-03 负向断言)
result: [pending]

### 2. 批量决策操作观感（多选/arm-confirm 两击/手动组标注）
expected: 勾选多组 → 粘条「批量选定/批量淘汰」两击武装流畅;场景/声纹组「✋ 手动选择」chip 清晰不误导;汇总 toast 含跳过数(机器面已全绿: selection e2e 7/7 含 D-05 恰-1 POST 与负向断言)
result: [pending]

### 3. 冗余配置面板真机读写（三源角标/钳制拒绝/写回三态徽标）
expected: 层级视图右栏 ⚙ 展开;三源角标可辨;确定性键 pre 钉 1 不可改;保存后三态徽标准确(覆盖层已存/已同步 requirement.json/文件面寻址失败——覆盖层已保存)(机器面已全绿: redundancy-config e2e 7/7;真实后端 requirement.json 寻址面本机 pipe-* 恒 EACCES 属已知如实报错)
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps

机器面全部独立复跑绿(e2e 8+7+7 / verify:phase-62 27/27 含门能红证明 / vitest 489 / 双侧 tsc);三项均为合成事件无法覆盖的真实手感/观感验收。
