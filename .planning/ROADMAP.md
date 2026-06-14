# Roadmap

## Milestones

- ✅ **v1.0 MVP** — Phases 1-6 (shipped)
- ✅ **v1.1 Hermes Intelligent Decision Engine** — Phases 7-10 (shipped 2026-06-06)
- ✅ **v1.2 Integration Testing** — Phases 11-14 (shipped 2026-06-07)
- ✅ **v1.3 Architecture Alignment** — Phases 15-19.1 (shipped 2026-06-13)
- ✅ **v1.4 Production Verification + Repo Governance** — Phases 20-22 (shipped 2026-06-13, partial)
- ✅ **v1.5 Architecture Hardening + Code Hygiene** — Phases 23-27 (shipped 2026-06-14)

## Phases

**Phase Numbering:**

- Integer phases (1-14): Shipped in v1.0-v1.2
- Integer phases (15-19) + decimal (19.1): Shipped v1.3
- Integer phases (20-22): v1.4
- Integer phases (23-27): v1.5 (this milestone)
- Decimal phases (e.g., 23.1): Urgent insertions

Decimal phases appear between their surrounding integers in numeric order.

### ✅ Previous Milestones (Shipped)

<details>
<summary>Phases 1-22: v1.0, v1.1, v1.2, v1.3, v1.4 — collapsed</summary>

#### v1.0 MVP (Phases 1-6)
Core video/image/audio generation pipeline via ComfyUI + cloud fallback.

#### v1.1 Hermes Intelligent Decision Engine (Phases 7-10)
Domain-agnostic REST API with self-learning loop. 21 requirements satisfied.

#### v1.2 Integration Testing (Phases 11-14)
Complete hermes-agent integration test suite. 42+ tests, CI pipeline. 22 requirements satisfied.

#### v1.3 Architecture Alignment (Phases 15-19.1)
Engine consolidation, workflow builder expansion, BackendType classification. 102/102 tests passing. Shipped 2026-06-13 with 4 deferred gaps (FIX-02/03, MERGE-03, ENG-04) carried into v1.4.

#### v1.4 Production Verification + Repo Governance (Phases 20-22)
ENG-04 fix shipped (commit 1d5996a). Live runtime verification partial — VERIFY-03 hardware-blocked. 19 sibling repos audited (commit 6c9c3b1). Mid-milestone acceleration: ACE route convergence (commits e3d649e, e817e18) closed v1.5 scope ahead of plan.

</details>

### ✅ v1.5 Architecture Hardening + Code Hygiene (Shipped 2026-06-14)

**Milestone Goal:** Close gaps exposed by v1.4 ACE route convergence — multi-process coordination, Python dead code, scattered output paths, vendored TS noise, router auto-gen root cause.

**Architecture decisions (v1.5):**
1. Phase numbering continues from v1.4 (Phase 23+)
2. v1.4 phase directories preserved as audit evidence
3. Scope strictly limited to 5 identified improvements, no new features
4. Hermes fix at main-project tsconfig level (exclude vendored dirs, not modify them)
5. Output paths: new convention + legacy alias (zero breaking changes)
6. router.ts auto-gen fix in core.ts (root cause) + cleanup of 12 existing config files

- [x] **Phase 23: GpuScheduler Redis Migration** — StateStore abstraction + memory/redis backends + factory with fallback (commit f302758)
- [x] **Phase 24: gold-team Python Cleanup** — Deleted acestep.py + docker_polling.py + 5 cleanup sites + Dockerfile stripping (commit 318e489)
- [x] **Phase 25: Output Path Convention** — src/lib/paths.ts + migration guide + ace/config demo (commit 25225a2)
- [x] **Phase 26: Hermes TS Exclude** — tsconfig.json exclude vendored dirs, 12,447 → 0 lint errors (commit a60b192)
- [x] **Phase 27: router.ts Auto-gen Fix** — core.ts SKIP_PATTERNS + cleanup of 12 config/shared files (commit 34393f1)

## Progress

**Execution Order:**
v1.5: Phases 23 and 24 independent (parallelizable); 25, 26, 27 independent and self-contained. Executed sequentially: 23 → 24 → 25 → 26 → 27.

| Phase | Milestone | Status | Completed |
|-------|-----------|--------|-----------|
| 23. GpuScheduler Redis Migration | v1.5 | ✅ Complete | 2026-06-14 |
| 24. gold-team Python Cleanup | v1.5 | ✅ Complete | 2026-06-14 |
| 25. Output Path Convention | v1.5 | ✅ Complete | 2026-06-14 |
| 26. Hermes TS Exclude | v1.5 | ✅ Complete | 2026-06-14 |
| 27. router.ts Auto-gen Fix | v1.5 | ✅ Complete | 2026-06-14 |

### Completed Milestones

| Phase | Milestone | Status | Completed |
|-------|-----------|--------|-----------|
| 20-22 | v1.4 Production Verification + Repo Governance | ✅ Partial Complete | 2026-06-13 |
| 15-19.1 | v1.3 Architecture Alignment | ✅ Complete | 2026-06-13 |
| 11-14 | v1.2 Integration Testing | ✅ Complete | 2026-06-07 |
| 7-10 | v1.1 Hermes Decision Engine | ✅ Complete | 2026-06-06 |
| 1-6 | v1.0 MVP | ✅ Complete | - |
