---
status: partial
phase: 59-narrow-trigger-stale-cascade
source: [59-VERIFICATION.md]
started: 2026-08-24T04:40:00Z
updated: 2026-08-24T04:40:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. 引擎环境补跑 probe-59-real
expected: GOLD_TEAM_URL 指向 :8002 的环境下重跑 probe-59-real——触发节点 data.filePath 本次新增(/oss/ web 路径)、node:preview 广播、真实引擎接受 ref_images(宿主路径)提交;级联断言同绿
result: [pending]

### 2. 生产 :10588 引擎配置裁决
expected: 是否配置 GOLD_TEAM_URL(配了走真实引擎链;不配保持 simulateOnly——成功信号真实但无引擎产物)
result: [pending]

### 3. 真机肉眼确认 stale 角标 UX
expected: 面板重生成成功后下游角标实时出现;重跑完成后消失;偶发时序下角标短暂复活后由后续 success 收敛(Known Issue #1)
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
