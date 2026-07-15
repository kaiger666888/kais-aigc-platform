---
phase: 42
slug: source-side-manifest-contract-hardening
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-15
completed: 2026-07-15
formalized: 2026-07-16  # GSD artifacts backfilled after the fact
---

# Phase 42 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
>
> Phase 42 work was executed directly in the kais-hermes-skills repo
> before GSD tracking artifacts were formalized. This validation strategy
> was backfilled on 2026-07-16 from the existing test suite + pre-commit
> hooks that were already in place.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (Python stdlib + pytest) |
| **Config file** | none — tests are self-contained |
| **Quick run command** | `cd kais-hermes-skills && python3 -m pytest skills/kais-movie-pipeline/tests/test_manifest_schema.py skills/kais-movie-pipeline/tests/test_manifest_phase_required.py skills/kais-movie-pipeline/tests/test_manifest_golden.py --no-header -q` |
| **Full suite command** | Same as quick (all 3 files); plus `pre-commit run --all-files` for the AST guard |
| **Estimated runtime** | ~0.43 seconds (132 tests) |

---

## Sampling Rate

- **On every commit (pre-commit hook):** all 132 manifest contract tests + AST bare-except guard
- **Before merging changes to _manifest.py:** full suite + manual golden-fixture inspection
- **Before v2.0 milestone close:** confirm cross-repo drift test (Phase 46) references this suite as source-of-truth

---

## Per-Task Verification Map

> The Phase 42 work was a single coherent plan (42-01) with 7 sub-tasks.
> All 7 sub-tasks are covered by the 3 test files + AST guard.

### Plan 42-01 (single plan, 7 sub-tasks)

| Task ID | Sub-task | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | Status |
|---------|----------|-------------|------------|-----------------|-----------|-------------------|--------|
| 42-01-01 | MIN_DESCRIPTION_LEN + _validate_node_content upgrade | MANIFEST-03 | T-42-02 | Bare label echoes ("角色 A", 4 chars) fail loudly | unit + boundary | `python3 -m pytest skills/kais-movie-pipeline/tests/test_manifest_schema.py::TestMinDescriptionLen -q --no-header` | ✅ green |
| 42-01-02 | PHASE_REQUIRED_FIELDS extension (p01/p03/p04) | MANIFEST-01 | T-42-01 | Phase-specific requireds enforced via (type, phase:id_suffix) + (type, phase_prefix) fallback | unit | `python3 -m pytest skills/kais-movie-pipeline/tests/test_manifest_phase_required.py -q --no-header` | ✅ green |
| 42-01-03 | validate_text_coverage helper | MANIFEST-04 | — | Opt-in; returns orphan .txt files; tested across 10 scenarios | unit | `python3 -m pytest skills/kais-movie-pipeline/tests/test_manifest_schema.py::TestValidateTextCoverage -q --no-header` | ✅ green |
| 42-01-04 | Replace bare except: pass with typed handler | MANIFEST-05 | T-42-03 | AST guard prevents regression; typed exceptions raise/log correctly | AST + integration | `python3 scripts/check_manifest_no_bare_except.py` | ✅ green |
| 42-01-05 | Enrich phase fallback descriptions to ≥20 chars | MANIFEST-03 | T-42-02 | Every phase module's `or "fallback"` string is ≥20 chars | integration (via golden fixtures) | `python3 -m pytest skills/kais-movie-pipeline/tests/test_manifest_golden.py -q --no-header` | ✅ green |
| 42-01-06 | Golden fixtures + test_manifest_golden.py | MANIFEST-02 | — | 14 fixtures (p01..p14); 44 test cases; coverage gate | integration | `ls skills/kais-movie-pipeline/tests/fixtures/manifests/ \| wc -l` returns 14 | ✅ green |
| 42-01-07 | .pre-commit-config.yaml + AST guard | MANIFEST-05 | T-42-03 | Both hooks pass on every commit | pre-commit | `pre-commit run --all-files` | ✅ green |

---

## Wave 0 Requirements

All present and accounted for:

- [x] `pipeline/phases/_manifest.py` — hardened with MIN_DESCRIPTION_LEN + validate_text_coverage + typed exceptions
- [x] `tests/test_manifest_schema.py` — 77 test functions across multiple classes
- [x] `tests/test_manifest_phase_required.py` — 11 test functions
- [x] `tests/test_manifest_golden.py` — 5 parametrized functions × 14 fixtures = 44 cases
- [x] `tests/fixtures/manifests/p01..p14.json` — 14 golden fixtures
- [x] `scripts/check_manifest_no_bare_except.py` — AST guard
- [x] `.pre-commit-config.yaml` — both hooks wired

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live phase run (e.g. p04_character_design) emits a manifest that passes the contract | MANIFEST-01..05 | Requires running the full pipeline with real input | Phase 46 VERIFY-03 covers this end-to-end |
| Pre-commit hook blocks a deliberately malformed commit | MANIFEST-05 | Requires staging a bad commit and observing rejection | `git commit --no-verify` bypasses; verify CI catches it |

---

## Validation Sign-Off

- [x] All sub-tasks have automated verification (3 test files + AST guard)
- [x] Sampling continuity: pre-commit hook enforces on every commit
- [x] All Wave 0 deliverables present before Phase 43/44 consume the contract
- [x] No watch-mode flags
- [x] Feedback latency < 1s (132 tests in 0.43s)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ready (work shipped 2026-07-15; artifacts formalized 2026-07-16)
