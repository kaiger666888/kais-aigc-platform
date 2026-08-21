---
phase: 51
slug: canonical-write-path-coordination-guard
status: approved
nyquist_compliant: true
wave_0_complete: true
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
| 51-01-xx | 01 | 1 | WRITE-01 | — | N/A | unit+grep | `grep -r canvasToFlowGraph packages/infinite-canvas/src src/routes --include='*.ts*' \| wc -l` = 0 | ✅ | ✅ green |
| 51-01-xx | 01 | 1 | WRITE-01 | — | 保存失败 toast 可见 | unit | vitest handleSave failure case | ✅ | ✅ green |
| 51-02-xx | 02 | 1 | WRITE-03 | — | canonical 回写不被 applyGraphTransform 覆盖 | unit | vitest store canonical actions | ✅ | ✅ green |
| 51-03-xx | 03 | 2 | WRITE-02 | — | 删除带确认 | unit+集成 | vitest context menu + verify-phase-51 删除不复活断言 | ✅ | ✅ green |
| 51-04-xx | 04 | 2 | WRITE-04 | — | N/A | grep+build | 死代码文件不存在 + package.json 含 @kais/flowgraph-v3 + tsc 双根 exit 0 | ✅ | ✅ green |
| 51-05-xx | 05 | 3 | COORD-01 | — | N/A | grep+文档 | COORD-01 约束文件存在 + checklist 含工作树检查项 | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `scripts/verify-phase-51.ts` — 集成断言(删除不复活 saveFullGraph→saveFullGraph(减节点)→loadFullGraph + 幂等),遵循 verify-phase-49/50 范式(真实模块、隔离 chdir、临时文件库;序列化 round-trip 与 canonical 回写持久由包内 vitest serialize.test.ts / canonicalWriteback.test.ts 覆盖)
- [x] packages/infinite-canvas vitest 新增:serializer 单测(51-01)、store canonical actions 单测(51-02)、context menu 删除流单测(51-03 deleteNode.test.ts)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 保存失败 toast 视觉呈现 | WRITE-01 | UI 视觉确认 | 断网/停后端后点保存,确认 toast 弹出 |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved (51-05, 2026-08-21 — 全量回归绿:双包 vitest 202+118、e2e 40/40、双根 tsc、vite build、verify:phase-51 46/46)
