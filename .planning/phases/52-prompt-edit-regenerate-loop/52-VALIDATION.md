---
phase: 52
slug: prompt-edit-regenerate-loop
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-21
---

# Phase 52 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (packages/infinite-canvas + packages/flowgraph-v3/ts) + e2e (node:test, dist-based) + tsx verify 脚本 |
| **Config file** | `packages/infinite-canvas/vite.config.ts` |
| **Quick run command** | `cd packages/infinite-canvas && npm test` |
| **Full suite command** | `cd packages/infinite-canvas && npm run build && npm test && npm run test:e2e && cd ../flowgraph-v3/ts && npm test && npx tsc --noEmit && npx tsx scripts/verify-phase-52.ts` |
| **Estimated runtime** | ~180 seconds(e2e 需先 build,51-02 已记录该前置) |

---

## Sampling Rate

- **After every task commit:** Run `cd packages/infinite-canvas && npm test`
- **After every plan wave:** Run 双根 tsc + 双包 vitest
- **Before `/gsd:verify-work`:** Full suite must be green(含 verify-phase-52)
- **Max feedback latency:** 180 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 52-01-xx | 01 | 1 | REGEN-01 | — | updateEventParams 落 canonical + 事件配方序列化反向覆盖 | unit | vitest store action + serialize round-trip(事件配方保存/刷新不丢) | ❌ W0 | ⬜ pending |
| 52-02-xx | 02 | 1 | REGEN-03 | — | stale wire 化(data.stale 序列化+migrate 还原) | unit | flowgraph-v3 stale/serialize 单测 | ❌ W0 | ⬜ pending |
| 52-03-xx | 03 | 2 | REGEN-01 | — | PromptSection 保存→重生成,任务参数含新 prompt | unit+e2e | mock logCall 完整 body 断言 | ❌ W0 | ⬜ pending |
| 52-04-xx | 04 | 2 | REGEN-02 | — | 换 seed 提交同配方+新 seed,pending 反馈 | unit+e2e | popover 提交断言 | ❌ W0 | ⬜ pending |
| 52-05-xx | 05 | 3 | REGEN-03 | — | stale 重跑链(orchestrate 不跳过 stale-success,success 自动清 stale) | unit+集成 | orchestrate 断言 + applySocketNodeState 单测 | ❌ W0 | ⬜ pending |
| 52-06-xx | 06 | 3 | REGEN-04 | — | 面板 480px + 单击切换保持打开 | e2e | 面板宽断言 + 单击切换断言 | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/verify-phase-52.ts` — 聚合门(正则化 grep 门 + 关键契约 source-shape,遵循 verify-phase-51 范式)
- [ ] vitest 新增:updateEventParams、事件配方序列化 round-trip、stale wire round-trip、getDownstreamIds、orchestrate stale 包含、applySocketNodeState stale 清除
- [ ] e2e mock-backend:logCall 记完整 body;stale 镜像

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 审片场景面板开合体验(480px 视觉、单击跟随流畅度) | REGEN-04 | UI 主观体验 | 打开面板→单击多个节点→确认不反复开合 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 180s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
