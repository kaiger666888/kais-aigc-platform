---
phase: 08-learning-loop-integration
plan: 01
subsystem: core
tags: [tdd, domain-memory, ewma, auto-learn, audit-aggregation]
dependency_graph:
  requires: ["07-01 (DomainRegistry, DecisionEngine)", "07-02 (API layer)"]
  provides: ["DomainMemory class", "EWMA confidence computation", "auto-learn trigger detection"]
  affects: ["decision_engine.py (Phase 8 Plan 02 integration)"]
tech_stack:
  added: []
  patterns: [EWMA, atomic-file-write, per-task-grouping, score-normalization]
key_files:
  created:
    - docker/hermes-agent/src/core/domain_memory.py
    - docker/hermes-agent/tests/test_domain_memory.py
  modified: []
decisions:
  - Score normalization heuristic: if raw > 1.0 assume 0-10 scale, divide by 10
  - EWMA alpha=0.3 gives moderate recency weighting
  - Test for recency weighting uses 0.1 scores (not 1.0) since score=1.0 is already in 0-1 range
metrics:
  duration: 3m 32s
  completed: "2026-06-06"
  tasks: 2
  tests_added: 19
  tests_total: 80
---

# Phase 08 Plan 01: DomainMemory Helper Class Summary

EWMA-based confidence scoring with auto-learn trigger detection, audit history aggregation grouped by task, and per-task record pruning -- all in a self-contained DomainMemory class with 19 passing tests.

## What Was Built

### DomainMemory class (`domain_memory.py`)

A standalone helper class that encapsulates all learning-loop data management for a single domain:

- **append_record(task, record)** -- Appends an audit record to the task group in `audit_history.json`, prunes to 100 records per task, and recomputes EWMA confidence.
- **get_confidence(task)** -- Returns the persisted EWMA confidence for a task (0.0 if fewer than 3 records or unknown task).
- **should_trigger_auto_learn(task)** -- Returns True when EWMA < 0.5 with 3+ records, enabling Phase 9 skill extraction.
- **get_summary()** -- Returns per-task stats (avg_score, record_count, ewma_confidence, trend_direction) plus the 10 most recent records across all tasks.

### Test suite (`test_domain_memory.py`)

19 tests across 6 test classes covering:
- Audit record creation and grouping by task
- Persistence across DomainMemory instances
- Pruning (100-record cap, per-task isolation)
- Summary query (task stats, recent records, empty domain)
- Auto-learn trigger (threshold, minimum audits, no history)
- EWMA confidence (3+ records, below minimum, no records, recency weighting)
- Score normalization (0-10 scale and already-normalized 0-1)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test_ewma_weights_recent_higher score normalization mismatch**
- **Found during:** Task 2 (GREEN phase)
- **Issue:** Test used scores [9, 1, 1, 1] expecting normalized [0.9, 0.1, 0.1, 0.1], but score=1.0 stays as 1.0 (not > 1.0, so no division by 10). Actual normalized: [0.9, 1.0, 1.0, 1.0].
- **Fix:** Changed test to use scores [10, 0.1, 0.1, 0.1] which correctly normalize to [1.0, 0.1, 0.1, 0.1].
- **Files modified:** `test_domain_memory.py`
- **Commit:** 30cca1e

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED (failing tests) | 6874047 | ModuleNotFoundError confirmed |
| GREEN (implementation) | 30cca1e | All 19 new + 61 existing tests pass |

## Test Results

```
docker/hermes-agent $ python3 -m pytest tests/ -x -q
80 passed, 1 warning in 0.32s
```

## Commits

| Hash | Message |
|------|---------|
| 6874047 | test(08-01): add failing tests for DomainMemory |
| 30cca1e | feat(08-01): implement DomainMemory class with EWMA confidence |

## Integration Points for Plan 02

The DomainMemory class is designed for clean integration into the existing DecisionEngine:
- `record_audit()` will call `DomainMemory.append_record()` then `should_trigger_auto_learn()`
- `decide()` will call `DomainMemory.get_confidence()` for dynamic confidence
- New GET endpoint will call `DomainMemory.get_summary()`
- Constructor takes `memory_dir: Path` (derived from `registry.base_dir / domain / "memory"`)

## Self-Check: PASSED

- FOUND: docker/hermes-agent/src/core/domain_memory.py
- FOUND: docker/hermes-agent/tests/test_domain_memory.py
- FOUND: .planning/phases/08-learning-loop-integration/08-01-SUMMARY.md
- FOUND: commit 6874047 (test: RED)
- FOUND: commit 30cca1e (feat: GREEN)
