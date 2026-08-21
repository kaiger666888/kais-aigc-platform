---
phase: 53-variant-contract-picker-upgrade
plan: 07
subsystem: g15-ops
tags: [var-04, g15, triage-panel, bridge, contract-gate]

# Dependency graph
requires:
  - phase: 53-variant-contract-picker-upgrade/53-01
    provides: G15 taxonomy 9 值 + take_log/failed-shots 契约与 fixture
  - phase: 53-variant-contract-picker-upgrade/53-04
    provides: writebackQueue(g15_waive/g15_requeue 枚举预留 + drain 基建)
  - phase: 53-variant-contract-picker-upgrade/53-05
    provides: canvasApi.g15Ops sibling + FlowCanvas overlay 先例
provides:
  - g15Bridge.ts:dispatchG15Op(waive=approve-with-comment 扩展/requeue=冻结新 action + DOCUMENTED PROTOCOL GAP;deps 注入 never-throws fail-closed)
  - POST /api/canvas/v2/g15-ops(zod action enum + shotIds 每项 1..128 + ≤200;miss → 队列;g15:ops 广播;drain 重放 g15 两 action)
  - G15TriagePanel:420px 独立 dock(勾选/归因徽章/展开 take_log+原始日志/sticky 动作条/重渲二次确认/乐观回滚/≤200 预拦截)
  - g15TriageStore:G15Source seam(fixture 默认源,Wave B 换真实端点零面板改动)
  - verify-phase-53 五段全收口(92/92)
affects: [Phase 54 gate 中心按 D-13 嵌入位复用面板, Wave B 换 G15Source + kmc requeue 消费端]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "桥返回 delivered 结果而非 void:端点据它判定入队(delivered=false → g15_waive/g15_requeue),reason 直落 last_error"
    - "409 = 已处理(reviewBridge 已核语义)→ delivered=true:幂等重放的语义基石"
    - "豁免免二次确认、重渲要确认 + 计数文案:贵操作(GPU 串行)防误触分级(planner 裁定 D-14)"
    - "G15Source seam:面板/组件零改动换数据源——fixture 形状即 Wave B 契约"
    - "自指断言陷阱:marker 检查用运行时拼接 needle,断言源码不含字面量"
    - "归因徽章分级配色:错误类玫/流程类金/verdict 弱底/unknown 弱灰——视觉噪声预算严控"

key-files:
  created:
    - src/lib/g15Bridge.ts
    - src/routes/canvas/v2/g15-ops.ts
    - packages/infinite-canvas/src/components/g15/G15TriagePanel.tsx
    - packages/infinite-canvas/src/components/g15/g15TriageStore.ts
    - packages/infinite-canvas/src/components/g15/__tests__/G15TriagePanel.test.tsx
  modified:
    - src/router.ts
    - packages/infinite-canvas/src/components/FlowCanvas.tsx
    - scripts/verify-phase-53.ts

key-decisions:
  - decision: waive 通道 = POST {baseUrl}/api/v1/g15/ops(批量 comment 标记 g15:waive:{ids})
    rationale: reviewBridge 的 review 列表匹配闭环(paginate+content_ref client filter)在 G15 批量场景成本高;Wave A 指令送达语义下直接批量端点形状,review 精确 approve 闭环与 Wave B kmc 消费端一并对齐(docblock 注明)。
  - decision: requeue gap 冻结成文(DOCUMENTED PROTOCOL GAP)
    rationale: kmc 侧消费端 Wave B 才存在;当前 delivered=true 仅代表桥通道送达,避免误以为重渲已执行。消费端幂等义务(队列重放可能重复下发)写入桥 docblock 为 Wave B 检查项。
  - decision: 面板数据 = fixture 驱动(非真实端点)
    rationale: 今日 take-log/failed-shots 无画布消费者(RESEARCH 实锤);Wave A 以契约 fixture 锁 UI 行为,Wave B 换 G15Source 实现一行注入。

requirements-completed: [VAR-04]

duration: 26 min
completed: 2026-08-21T23:05:00Z
---

# Phase 53 Plan 07: G15 操作桥 + 分诊工作台 Summary

VAR-04 全套:g15Bridge(waive/requeue 双 action,never-throws fail-closed)+ g15-ops 独立端点(队列降级/广播/drain 重放)+ 420px 分诊面板(勾选/归因/展开/批量/二次确认/乐观回滚)+ verify 五段契约门收口(92/92)。

**Duration:** 26 min · **Tasks:** 3/3(TDD ×1)· **Files:** 8

## What Was Built

- **g15Bridge.ts**:dispatchG15Op;scopeCheck fail-closed(空/单项畸形/>200 零请求);409→delivered;网络/broken-logger 全吞;deps {baseUrl/fetchImpl/logger/timeoutMs}
- **g15-ops.ts**:zod bound 端点;delivered=false → enqueueWriteback(g15_waive/g15_requeue)+ warn 降级;`g15:ops` 广播;bootG15Drain 复用 53-04 drain 基建(manifest+g15 双 action 重放)
- **G15TriagePanel + g15TriageStore**:行(checkbox/shot mono/phase 徽章/类别徽章分级色/原因截断)→ 展开(take_log 条目 + 原始 error mono 160px 滚动);sticky 动作条(已选 N/全选/清空/批量豁免/批量重渲);重渲确认层含计数;乐观 markRows → g15Ops → 失败 unmarkRows + toast;>200 前端预拦截;Esc/✕ 关闭;G15Source seam + fixture 源
- **FlowCanvas**:工具栏「🩹失败镜头 N」入口(待处置计数徽章)+ overlay 挂载
- **verify:phase-53**:S4 九断言(墙源形状/双轨清零/picker 删除/adapter 通道/G15 挂载)+ S5 十断言(桥语义全表 + zod bound + 队列广播)→ **92/92**

## Self-Check: PASSED

- `npm run verify:phase-53` exit 0(92/92,五段全 live)
- packages 套件 241/241(G15 6 新测试);双侧 tsc 0
- `FILLED-BY-53-0` 标记零残留(runtime-joined needle 断言)

## Deviations from Plan

**[Rule 2 - 协议现实] waive 通道从"review 列表匹配后逐个 approve"简化为批量 g15/ops 端点形状** — Found during: Task 1 | Issue: reviewBridge 的 paginate+client-filter 闭环在批量场景(≤200 shot)成本高且 G15 review 的 content_ref 映射未核 | Fix: Wave A 指令送达语义下 POST 批量形状 + comment 标记;review 精确闭环归 Wave B(与 kmc 消费端一并对齐),docblock 冻结 | Verification: S5a 全绿(注入 fetch) | Commit: g15Bridge 提交
**[Rule 1 - 测试设计] 三处测试断言修正(回滚范围/禁用态时序/恒真断言)** — Found during: Task 2/3 | Issue: ①豁免回滚断言误含首笔成功行 ②setState 未包 act 致点击打到禁用旧按钮 ③S5d 初版恒真 | Fix: ①断言收紧到 shot_003 rowState ②act 包裹 ③runtime-joined needle | Verification: 6/6 + 92/92 | Commit: 各对应提交

**Total deviations:** 2 类 auto-fixed。**Impact:** 无行为影响;批量通道形状为 Wave B 留了明确对齐点。

## Issues Encountered

None blocking。

---

**Phase 53 Wave A 全部 7 plans 完成** —— Ready for phase verification(gsd-verifier)/gsd:verify-work。Wave B(khs 映射 + VAR-03 E2E 闭环)gated on khs2 v2.4 Phase 25 验收。
