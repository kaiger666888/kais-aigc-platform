---
phase: 51
slug: canonical-write-path-coordination-guard
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-21
---

# Phase 51 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (packages/infinite-canvas + packages/flowgraph-v3/ts) + tsx verify 脚本 |
| **Config file** | `packages/infinite-canvas/vite.config.ts` (test section) |
| **Quick run command** | `cd packages/infinite-canvas && npm test` |
| **Full suite command** | `cd packages/infinite-canvas && npm test && cd ../flowgraph-v3/ts && npm test && npx tsc --noEmit && npx tsx scripts/verify-phase-51.ts` |
| **Estimated runtime** | ~120 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd packages/infinite-canvas && npm test`(受影响包)
- **After every plan wave:** Run 双根 tsc + 双包 vitest
- **Before `/gsd:verify-work`:** Full suite must be green(含 verify-phase-51)
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 51-01-xx | 01 | 1 | WRITE-01 | — | N/A | unit+grep | `grep -r canvasToFlowGraph packages/infinite-canvas/src src/routes --include='*.ts*' \| wc -l` = 0 | ✅ | ⬜ pending |
| 51-01-xx | 01 | 1 | WRITE-01 | — | 保存失败 toast 可见 | unit | vitest handleSave failure case | ❌ W0 | ⬜ pending |
| 51-02-xx | 02 | 1 | WRITE-03 | — | canonical 回写不被 applyGraphTransform 覆盖 | unit | vitest store canonical actions | ❌ W0 | ⬜ pending |
| 51-03-xx | 03 | 2 | WRITE-02 | — | 删除带确认 | unit+集成 | vitest context menu + verify-phase-51 删除不复活断言 | ❌ W0 | ⬜ pending |
| 51-04-xx | 04 | 2 | WRITE-04 | — | N/A | grep+build | 死代码文件不存在 + package.json 含 @kais/flowgraph-v3 + tsc 双根 exit 0 | ✅ | ⬜ pending |
| 51-05-xx | 05 | 3 | COORD-01 | — | N/A | grep+文档 | COORD-01 约束文件存在 + checklist 含工作树检查项 | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/verify-phase-51.ts` — 集成断言(序列化 round-trip / 删除不复活 / canonical 回写持久),遵循 verify-phase-49/50 范式(真实模块、隔离 chdir、:memory:)
- [ ] packages/infinite-canvas vitest 新增:serializer 单测、store canonical actions 单测、context menu 确认流单测

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 保存失败 toast 视觉呈现 | WRITE-01 | UI 视觉确认 | 断网/停后端后点保存,确认 toast 弹出 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
