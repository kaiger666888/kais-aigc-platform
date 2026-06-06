# Phase 8: Learning Loop Integration - Research

**Researched:** 2026-06-06
**Domain:** Self-learning loop: audit history aggregation, EWMA confidence scoring, auto-learn trigger detection
**Confidence:** HIGH

## Summary

Phase 8 completes the self-learning loop by connecting audit data to decision-making. The current `DecisionEngine` already has stubs in place: `record_audit()` writes individual JSON files to `memory/{decision_id}.json` but always returns `auto_learn_triggered: False`; `decide()` returns `confidence: 0.0` as a static placeholder. This phase fills in those stubs with real logic.

The three core mechanisms are: (1) audit history aggregation -- maintaining a per-task summary file `memory/audit_history.json` that groups audit records by task, auto-prunes to 100 records per task, and returns aggregated stats on query; (2) EWMA-based dynamic confidence -- computing an Exponentially Weighted Moving Average from historical scores for each domain+task pair, requiring a minimum of 3 audits before departing from the 0.0 baseline; and (3) auto-learn trigger -- detecting when EWMA confidence drops below 0.5 and setting `auto_learn_triggered: true` in the audit response. Phase 8 only flags the trigger; skill extraction is Phase 9 work.

The implementation is purely additive. All existing 61 tests must continue to pass. New code lives in `decision_engine.py` (aggregation, confidence calculation, auto-learn detection), `routes.py` (new GET endpoint), and `models.py` (new response model). No new dependencies are needed -- EWMA is a 5-line function using only Python stdlib arithmetic.

**Primary recommendation:** Extend the existing `DecisionEngine` class with a `DomainMemory` helper class that manages audit aggregation and confidence computation. Add the `GET /v1/domains/:domain/memory` endpoint following the established route pattern. No external packages needed.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Audit data stored as JSON files in `memory/audit_history.json` grouped by task -- consistent with Phase 7's `{decision_id}.json` pattern
- Retain last 100 audit records per task, auto-prune oldest -- prevents unbounded disk growth
- Memory query returns aggregated summary (avg score per task, trend direction, record count) + recent 10 records
- Exponentially Weighted Moving Average (EWMA) for confidence -- recent results weighted higher, simple to compute
- Score < 0.5 triggers auto-learn detection -- configurable per-domain via config
- Auto-learn in Phase 8 only sets `auto_learn_triggered: true` and logs the trigger -- skill extraction is Phase 9 work
- Minimum 3 audits before adjusting confidence -- avoids premature swings
- Domain memory isolation via path derivation from `domain/` directory -- already established in Phase 7
- New endpoint: GET /v1/domains/:domain/memory returns JSON with task stats and grouped recent records -- matches other GET endpoint style

### Claude's Discretion
- Implementation details for EWMA alpha parameter
- Exact pruning logic for 100-record cap
- Memory response pagination if needed

### Deferred Ideas (OUT OF SCOPE)
- Skill extraction from auto-learn triggers (Phase 9)
- Movie-pipeline domain registration (Phase 9)
- Client adaptation and old service replacement (Phase 10)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LEARN-01 | Audit data writes to hermes-agent memory system (not JSON files), as next decide context | Current `record_audit()` writes `{decision_id}.json` per decision; this phase adds aggregation into `audit_history.json` grouped by task. Aggregation file serves as the "memory system" for the wrapper -- no external memory library needed [VERIFIED: decision_engine.py lines 52-80] |
| LEARN-02 | Continuous low scores trigger auto-learn (like `_check_auto_learn`), hermes-agent auto-extracts improvement skills | EWMA confidence < 0.5 after minimum 3 audits triggers `auto_learn_triggered: true`. Phase 8 only flags; skill extraction is Phase 9 [VERIFIED: CONTEXT.md locked decision] |
| LEARN-03 | decide returns confidence dynamically calculated from that domain+task's historical success rate | EWMA formula: `confidence = alpha * latest_score + (1 - alpha) * previous_confidence`. Requires minimum 3 audit records before departing from 0.0 baseline. No external library needed [VERIFIED: standard algorithm] |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Audit history aggregation | API / Backend (Python) | Database / Storage (filesystem) | Aggregation logic lives in DecisionEngine; persistence is JSON files in domain memory/ |
| EWMA confidence computation | API / Backend (Python) | -- | Pure arithmetic, no I/O, runs synchronously in decide() |
| Auto-learn trigger detection | API / Backend (Python) | -- | Boolean check on confidence value, runs in record_audit() |
| Memory query endpoint | API / Backend (Python) | Database / Storage (filesystem) | Route handler reads aggregated memory file |
| Per-task record pruning | Database / Storage (filesystem) | -- | File I/O during record_audit(), capped at 100 records |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| fastapi | 0.136.1 | REST API framework | Already installed, all routes use it [VERIFIED: requirements.txt] |
| pydantic | 2.13 | Request/response validation | Already installed, all models use it [VERIFIED: requirements.txt] |
| json (stdlib) | -- | Memory file read/write | Phase 7 pattern, no external dependency needed |
| pathlib (stdlib) | -- | File path operations | Phase 7 pattern for domain directory management |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| logging (stdlib) | -- | Auto-learn trigger logging | When auto_learn_triggered fires |
| datetime (stdlib) | -- | Timestamp generation | Audit records and memory queries |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual EWMA (5 lines) | pandas ewm() | pandas is 30MB+ dependency for a 5-line calculation. Unjustifiable. |
| JSON file aggregation | SQLite | JSON files are consistent with Phase 7 pattern, simpler for <100 records/task. SQLite would need schema migration. |
| Per-decision JSON files | audit_history.json only | CONTEXT.md locks audit_history.json grouped by task. Individual `{decision_id}.json` files remain for backward compat. |

**Installation:**
```bash
# No new packages needed -- all stdlib or already installed
```

**Version verification (no changes from Phase 7):**
```
fastapi: 0.136.1 (installed)
pydantic: 2.13 (installed)
pytest: 7.0+ (installed)
```

## Package Legitimacy Audit

> No new packages introduced in this phase. All functionality uses Python stdlib and existing dependencies from Phase 7.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| (none new) | -- | -- | -- | -- | -- | -- |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
                    ┌─────────────────────────────────────────────────┐
                    │   Node.js Clients                                │
                    │   (kais-movie-agent)                             │
                    └──────────┬──────────────────────────────────────┘
                               │ HTTP
                               ▼
            ┌──────────────────────────────────────────────────────────┐
            │   FastAPI Wrapper (:8080)                                 │
            │                                                          │
            │   POST /v1/audit ──► record_audit()                      │
            │         │                                                │
            │         ├── 1. Write {decision_id}.json to memory/       │
            │         │         (Phase 7 behavior, unchanged)          │
            │         │                                                │
            │         ├── 2. Update audit_history.json ──────┐         │
            │         │    (group by task, append record)     │         │
            │         │                                        │         │
            │         ├── 3. Prune to 100 records/task ◄──────┘         │
            │         │                                                │
            │         ├── 4. Compute EWMA confidence per task           │
            │         │                                                │
            │         └── 5. If EWMA < 0.5 && count >= 3:              │
            │               auto_learn_triggered = true                 │
            │                                                          │
            │   POST /v1/decide ──► decide()                           │
            │         │                                                │
            │         ├── 1. Read audit_history.json                    │
            │         ├── 2. Compute EWMA for {domain, task}            │
            │         ├── 3. If < 3 audits: confidence = 0.0           │
            │         │    Else: confidence = EWMA value                │
            │         └── 4. Return confidence in response              │
            │                                                          │
            │   GET /v1/domains/:domain/memory ──► query_memory()       │
            │         │                                                │
            │         ├── Read audit_history.json                       │
            │         └── Return {task_stats, recent_records}           │
            └──────────────────────────────────────────────────────────┘

                    ┌─────────────────────────────────────┐
                    │   ~/.hermes/domains/{domain}/memory/  │
                    │                                       │
                    │   ├── {decision_id}.json    (Phase 7) │
                    │   ├── {decision_id}.json    (Phase 7) │
                    │   └── audit_history.json   (Phase 8)  │
                    │       {                                │
                    │         "task-a": {                    │
                    │           "records": [...],            │
                    │           "ewma_confidence": 0.72      │
                    │         },                             │
                    │         "task-b": { ... }              │
                    │       }                                │
                    └─────────────────────────────────────┘
```

### Recommended Project Structure (changes only)
```
docker/hermes-agent/src/
├── core/
│   ├── domain_memory.py     # NEW: audit aggregation, EWMA, pruning
│   ├── decision_engine.py   # MODIFY: call DomainMemory in record_audit/decide
│   ├── domain_registry.py   # UNCHANGED
│   └── agent_factory.py     # UNCHANGED
├── api/
│   ├── routes.py            # MODIFY: add GET /v1/domains/{domain}/memory
│   ├── models.py            # MODIFY: add MemoryResponse, MemoryTaskStat models
│   └── deps.py              # UNCHANGED (or add get_domain_memory if needed)
└── config.py                # UNCHANGED

docker/hermes-agent/tests/
├── conftest.py              # MODIFY: add domain_memory fixture
├── test_domain_memory.py    # NEW: unit tests for DomainMemory
├── test_decision_engine.py  # MODIFY: update tests for new record_audit/decide behavior
├── test_routes.py           # MODIFY: add GET /memory endpoint tests
└── test_integration.py      # MODIFY: update integration tests for learning loop
```

### Pattern 1: DomainMemory Helper Class
**What:** Encapsulates audit history aggregation, EWMA computation, pruning, and memory queries per domain.
**When to use:** Called by `record_audit()` (to aggregate after writing), `decide()` (to compute confidence), and the new memory endpoint (to query stats).
**Example:**
```python
# Source: [ASSUMED] -- design based on CONTEXT.md locked decisions + EWMA algorithm
# Located at: docker/hermes-agent/src/core/domain_memory.py

import json
from pathlib import Path
from typing import Any

EWMA_ALPHA = 0.3         # Smoothing factor -- higher = more weight on recent
AUTO_LEARN_THRESHOLD = 0.5
MIN_AUDITS_FOR_CONFIDENCE = 3
MAX_RECORDS_PER_TASK = 100
RECENT_RECORDS_LIMIT = 10


class DomainMemory:
    """Manage audit history aggregation and confidence for a single domain."""

    def __init__(self, memory_dir: Path) -> None:
        self.memory_dir = memory_dir
        self.history_path = memory_dir / "audit_history.json"

    def _load_history(self) -> dict[str, Any]:
        if not self.history_path.exists():
            return {}
        try:
            return json.loads(self.history_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {}

    def _save_history(self, data: dict[str, Any]) -> None:
        self.memory_dir.mkdir(parents=True, exist_ok=True)
        tmp = self.history_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(self.history_path)

    def append_record(self, task: str, record: dict[str, Any]) -> None:
        """Append an audit record under the task group, then prune and recompute."""
        history = self._load_history()
        if task not in history:
            history[task] = {"records": [], "ewma_confidence": 0.0}

        history[task]["records"].append(record)
        self._prune_task(history[task])
        history[task]["ewma_confidence"] = self._compute_ewma(history[task]["records"])
        self._save_history(history)

    @staticmethod
    def _prune_task(task_data: dict[str, Any]) -> None:
        """Keep only the last MAX_RECORDS_PER_TASK records."""
        records = task_data["records"]
        if len(records) > MAX_RECORDS_PER_TASK:
            task_data["records"] = records[-MAX_RECORDS_PER_TASK:]

    @staticmethod
    def _compute_ewma(records: list[dict[str, Any]]) -> float:
        """Compute EWMA from audit scores. Returns 0.0 if < MIN_AUDITS."""
        if len(records) < MIN_AUDITS_FOR_CONFIDENCE:
            return 0.0
        scores = [r.get("metrics", {}).get("score", 0.0) for r in records]
        # Normalize scores to 0-1 range if needed
        normalized = []
        for s in scores:
            try:
                val = float(s)
                normalized.append(max(0.0, min(1.0, val / 10.0 if val > 1.0 else val)))
            except (TypeError, ValueError):
                normalized.append(0.0)
        ewma = normalized[0]
        for score in normalized[1:]:
            ewma = EWMA_ALPHA * score + (1 - EWMA_ALPHA) * ewma
        return round(ewma, 4)

    def get_confidence(self, task: str) -> float:
        """Return the current EWMA confidence for a task."""
        history = self._load_history()
        task_data = history.get(task)
        if task_data is None:
            return 0.0
        return task_data.get("ewma_confidence", 0.0)

    def should_trigger_auto_learn(self, task: str) -> bool:
        """Return True if confidence < threshold and enough audits exist."""
        history = self._load_history()
        task_data = history.get(task)
        if task_data is None:
            return False
        records = task_data.get("records", [])
        if len(records) < MIN_AUDITS_FOR_CONFIDENCE:
            return False
        return task_data.get("ewma_confidence", 0.0) < AUTO_LEARN_THRESHOLD

    def get_summary(self) -> dict[str, Any]:
        """Return aggregated summary: per-task stats + recent records."""
        history = self._load_history()
        task_stats = {}
        all_recent = []
        for task, data in history.items():
            records = data.get("records", [])
            scores = []
            for r in records:
                try:
                    scores.append(float(r.get("metrics", {}).get("score", 0)))
                except (TypeError, ValueError):
                    scores.append(0.0)

            task_stats[task] = {
                "avg_score": round(sum(scores) / len(scores), 4) if scores else 0.0,
                "record_count": len(records),
                "ewma_confidence": data.get("ewma_confidence", 0.0),
                "trend_direction": self._trend(scores),
            }
            all_recent.extend(records[-RECENT_RECORDS_LIMIT:])
        # Sort recent by timestamp descending, take top RECENT_RECORDS_LIMIT
        all_recent.sort(key=lambda r: r.get("timestamp", ""), reverse=True)
        return {
            "task_stats": task_stats,
            "recent_records": all_recent[:RECENT_RECORDS_LIMIT],
        }

    @staticmethod
    def _trend(scores: list[float]) -> str:
        """Simple trend: compare avg of last 3 vs avg of all before."""
        if len(scores) < 4:
            return "stable"
        recent_avg = sum(scores[-3:]) / 3
        earlier_avg = sum(scores[:-3]) / (len(scores) - 3)
        if recent_avg > earlier_avg * 1.1:
            return "improving"
        elif recent_avg < earlier_avg * 0.9:
            return "declining"
        return "stable"
```

### Pattern 2: Integration with DecisionEngine (existing code modified)
**What:** Extend `record_audit()` to aggregate into audit_history.json and detect auto-learn. Extend `decide()` to read EWMA confidence.
**When to use:** Every audit and decide call.
**Example:**
```python
# Source: [ASSUMED] -- modification plan for existing decision_engine.py
# Key change: record_audit() now also aggregates and returns auto_learn_triggered based on EWMA

def record_audit(self, domain, decision_id, outcome, metrics):
    # Phase 7 behavior: write individual JSON file
    memory_dir = self.registry.base_dir / domain / "memory"
    memory_dir.mkdir(parents=True, exist_ok=True)
    record = {
        "decision_id": decision_id,
        "outcome": outcome,
        "metrics": metrics,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    audit_path = memory_dir / f"{decision_id}.json"
    audit_path.write_text(json.dumps(record, indent=2, ensure_ascii=False), encoding="utf-8")

    # Phase 8 additions: aggregate + auto-learn
    # Extract task from metrics or use a default
    task = metrics.get("task", "unknown")
    domain_memory = DomainMemory(memory_dir)
    domain_memory.append_record(task, record)
    auto_learn = domain_memory.should_trigger_auto_learn(task)
    if auto_learn:
        logger.warning("Auto-learn triggered for domain=%s task=%s", domain, task)

    return {"recorded": True, "auto_learn_triggered": auto_learn}
```

### Pattern 3: New GET /v1/domains/:domain/memory Endpoint
**What:** Returns aggregated memory stats for a domain.
**When to use:** When querying learning loop status.
**Example:**
```python
# Source: [ASSUMED] -- follows existing route pattern from routes.py

@router.get("/domains/{domain}/memory")
async def get_domain_memory(
    domain: str,
    registry: DomainRegistry = Depends(get_registry),
) -> dict:
    if not registry.domain_exists(domain):
        raise HTTPException(status_code=404, detail=f"Domain '{domain}' not registered")

    memory_dir = registry.base_dir / domain / "memory"
    domain_memory = DomainMemory(memory_dir)
    return domain_memory.get_summary()
```

### Anti-Patterns to Avoid
- **Adding pandas or numpy for EWMA:** The computation is 5 lines of Python arithmetic. Any external math library is massive overkill for a single weighted average.
- **Loading all decision JSON files on every decide() call:** The `audit_history.json` aggregation file exists precisely to avoid scanning hundreds of individual files. Always read the aggregation file, not individual decision files.
- **Storing EWMA in the decide() response only:** The EWMA must be persisted in `audit_history.json` so it survives service restarts. Computing it on-the-fly from raw records is wasteful and fragile.
- **Breaking existing tests:** The existing 61 tests assert `confidence == 0.0` and `auto_learn_triggered == False`. For tests that do not set up audit history, these values must remain the same. Only new tests with explicit history setup should see non-zero confidence.
- **Coupling auto-learn to skill extraction:** Phase 8 only sets the flag. Do not add any skill extraction or modification logic -- that is Phase 9's job.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| EWMA computation | pandas.ewm() or numpy.convolve | 5-line stdlib function | No external dependency, 30 seconds to write, no edge case risk for simple scalar EWMA |
| Audit history storage | SQLite or custom database | JSON file (audit_history.json) | Consistent with Phase 7 pattern, <100 records/task, no concurrent access concerns |
| File write safety | Custom locking mechanism | Atomic write (write .tmp then rename) | Phase 7 already established this pattern in domain_registry.py |

**Key insight:** This phase is entirely about logic, not infrastructure. No new libraries, no new services, no new processes. The entire implementation is ~150 lines of Python across one new file and modifications to three existing files.

## Common Pitfalls

### Pitfall 1: Breaking Existing Tests with Confidence Changes
**What goes wrong:** Changing `decide()` to return dynamic confidence causes existing tests that assert `confidence == 0.0` to fail.
**Why it happens:** Existing tests use `mock_agent` but don't set up any audit history, so `DomainMemory.get_confidence()` returns 0.0. But if the code path changes and starts raising errors when no history exists, tests break.
**How to avoid:** Ensure `DomainMemory.get_confidence()` returns 0.0 when no `audit_history.json` exists or when the task has no records. This preserves backward compatibility.
**Warning signs:** `test_decide_returns_decision` in test_routes.py fails with unexpected confidence value.

### Pitfall 2: Missing "task" Field in Audit Metrics
**What goes wrong:** `record_audit()` needs to know which task an audit belongs to for grouping in audit_history.json. The current `AuditRequest` model has no `task` field -- only `domain`, `decision_id`, `outcome`, `metrics`.
**Why it happens:** Phase 7's audit endpoint was a stub that wrote individual files without grouping. Phase 8 needs task-level grouping but the audit request doesn't carry task info.
**How to avoid:** Either (a) add an optional `task` field to `AuditRequest`, or (b) look up the task from the decision_id by reading the original decision record. Option (a) is simpler and aligns with the CONTEXT.md decision of grouping by task. Option (b) requires storing the decision_id-to-task mapping.
**Warning signs:** All records grouped under "unknown" task because task field is missing from metrics.

### Pitfall 3: Score Normalization Inconsistency
**What goes wrong:** Audit metrics contain scores in different scales (0-5, 0-10, 0-100, 0-1) and the EWMA treats them all as 0-1.
**Why it happens:** The `metrics` dict is free-form. Different domains might send scores in different scales.
**How to avoid:** Normalize scores in `_compute_ewma()`. If score > 1.0, assume it's on a 0-10 scale and divide by 10. This is a heuristic -- document it clearly so domain integrators know the convention.
**Warning signs:** Confidence values > 1.0 or negative, or auto-learn triggering on good scores because they were interpreted as 0-1 when they were actually 0-10.

### Pitfall 4: Concurrent File Access
**What goes wrong:** Two audit requests arrive simultaneously, both read audit_history.json, both append their records, and one overwrites the other's changes.
**Why it happens:** The JSON file is read-modify-write without any locking.
**How to avoid:** For Phase 8 scale (single-instance FastAPI with sequential audit processing within a domain), this risk is negligible. If needed later, add a threading.Lock per domain. Do not add file-locking complexity now.
**Warning signs:** Audit records disappearing after concurrent requests.

### Pitfall 5: Audit Request Missing Task Field
**What goes wrong:** The `record_audit()` method needs the task name to group records, but `AuditRequest` (from Phase 7) doesn't have a `task` field -- only `domain`, `decision_id`, `outcome`, `metrics`.
**Why it happens:** Phase 7's audit was a simple stub. Phase 8 needs task-level grouping.
**How to avoid:** Either look up the task from the decide record (the `decision_id` maps to a task), or add `task` as an optional field to `AuditRequest`. The simpler approach: the audit endpoint can look up the task from the decide response stored in memory, but that requires decide to also persist its response. The CONTEXT.md-locked approach groups by task, so the task must come from somewhere.
**Recommendation:** Read the individual `{decision_id}.json` file to extract task info, OR require `task` in the metrics dict. The cleanest approach: persist the decide response to `memory/{decision_id}.json` during `decide()` (which already includes `task`), then `record_audit()` can enrich the audit record with task info from the original decision.
**Warning signs:** All audit records grouped under "unknown" task.

## Code Examples

### EWMA Core Algorithm (verified)
```python
# Source: [CITED: towardsdatascience.com/time-series-from-scratch-exponentially-weighted-moving-averages-ewma-theory-and-implementation-607661d574fe]
# Also verified via Stack Overflow canonical answer:
# [CITED: stackoverflow.com/questions/488670/calculate-exponential-moving-average-in-python]

def compute_ewma(scores: list[float], alpha: float = 0.3) -> float:
    """Compute Exponentially Weighted Moving Average.

    Args:
        scores: List of numeric scores (normalized to 0-1).
        alpha: Smoothing factor (0 < alpha <= 1). Higher alpha = more weight on recent.

    Returns:
        The EWMA value.

    Formula: EWMA_t = alpha * x_t + (1 - alpha) * EWMA_{t-1}
    """
    if not scores:
        return 0.0
    ewma = scores[0]
    for score in scores[1:]:
        ewma = alpha * score + (1 - alpha) * ewma
    return round(ewma, 4)
```

### Pydantic Models for Memory Response
```python
# Source: [ASSUMED] -- follows existing pattern from models.py

class MemoryTaskStat(BaseModel):
    """Statistics for a single task within a domain's memory."""
    avg_score: float
    record_count: int
    ewma_confidence: float
    trend_direction: str  # "improving" | "declining" | "stable"

class MemoryResponse(BaseModel):
    """Response body for GET /v1/domains/:domain/memory."""
    task_stats: dict[str, MemoryTaskStat]
    recent_records: list[dict]
```

### Updated record_audit() Integration Point
```python
# Source: [VERIFIED] -- based on existing decision_engine.py lines 52-80
# Shows the EXACT current code and where Phase 8 hooks in

def record_audit(self, domain, decision_id, outcome, metrics):
    # ---- Phase 7 code (UNCHANGED) ----
    memory_dir = self.registry.base_dir / domain / "memory"
    memory_dir.mkdir(parents=True, exist_ok=True)
    record = {
        "decision_id": decision_id,
        "outcome": outcome,
        "metrics": metrics,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    audit_path = memory_dir / f"{decision_id}.json"
    audit_path.write_text(
        json.dumps(record, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    # ---- Phase 8 additions (NEW) ----
    task = self._resolve_task(domain, decision_id, metrics)
    domain_memory = DomainMemory(memory_dir)
    domain_memory.append_record(task, record)
    auto_learn = domain_memory.should_trigger_auto_learn(task)
    if auto_learn:
        logger.warning(
            "Auto-learn triggered: domain=%s task=%s confidence=%.3f",
            domain, task, domain_memory.get_confidence(task),
        )

    return {"recorded": True, "auto_learn_triggered": auto_learn}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Static confidence: 0.0 | EWMA-based dynamic confidence | Phase 8 (this phase) | Decisions carry real quality signal |
| auto_learn always False | Auto-learn triggered when EWMA < 0.5 | Phase 8 (this phase) | Low-performing tasks flagged for Phase 9 skill extraction |
| Individual audit JSON files only | Aggregated audit_history.json per task | Phase 8 (this phase) | Efficient confidence lookup without scanning all files |
| No memory query API | GET /v1/domains/:domain/memory | Phase 8 (this phase) | External systems can inspect learning state |

**Deprecated/outdated:**
- `confidence: 0.0` hardcoded in `decide()` -- replaced by EWMA lookup
- `auto_learn_triggered: False` hardcoded in `record_audit()` -- replaced by threshold check

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The `task` field can be extracted from `metrics.get("task")` or looked up from the decide record stored in memory | Architecture Patterns, Pitfalls 2/5 | If no task is available, all records group under "unknown" -- confidence computation still works but loses task-level granularity |
| A2 | Score normalization heuristic (if > 1.0, divide by 10) is sufficient for Phase 8 | Pitfall 3 | If domains use 0-100 or other scales, confidence values will be wrong. Mitigation: document the convention clearly |
| A3 | Single-instance FastAPI means no concurrent write risk for audit_history.json | Pitfall 4 | If deployed with multiple workers, race conditions possible. Mitigation: use single worker for Phase 8 |
| A4 | EWMA alpha=0.3 is a reasonable starting value (gives ~85% weight to last 5 observations) | Pattern 1 | If alpha is too low, confidence lags behind reality. If too high, it's noisy. Mitigation: alpha is a constant, easy to tune |
| A5 | Existing test assertions `confidence == 0.0` and `auto_learn_triggered == False` will still pass because tests don't set up audit history | Pitfall 1 | If code paths change unexpectedly, tests break. Mitigation: DomainMemory returns 0.0 when no history exists |

## Open Questions

1. **Task field source for audit records**
   - What we know: `AuditRequest` has `domain`, `decision_id`, `outcome`, `metrics`. No explicit `task` field. CONTEXT.md says records are grouped by task.
   - What's unclear: How to get the task name during `record_audit()`.
   - Recommendation: Two options -- (a) require `task` in `metrics` dict (simplest, but puts burden on caller), or (b) during `decide()`, write the decision response to `memory/{decision_id}.json` so `record_audit()` can look it up. Option (b) is cleaner because it doesn't change the API contract and Phase 7 already writes individual audit files. The planner should decide based on API ergonomics.

2. **Auto-learn threshold configurability**
   - What we know: CONTEXT.md says "configurable per-domain via config". Current Settings class has no per-domain config mechanism.
   - What's unclear: How per-domain config would work. The registry.json has `skills_manifest` but no learning config.
   - Recommendation: Use a constant `AUTO_LEARN_THRESHOLD = 0.5` for Phase 8. Per-domain config can be added later via a `learning_config` key in registry.json entry. The code should read the threshold from a method that can be extended later.

3. **Decide response persistence**
   - What we know: `decide()` currently does NOT persist the decision response to disk. It returns it to the caller. `record_audit()` writes a separate file keyed by `decision_id`.
   - What's unclear: Whether `decide()` should also write its response to `memory/{decision_id}.json` so `record_audit()` can look up the task.
   - Recommendation: Yes -- modify `decide()` to write the response to `memory/{decision_id}.json` as the "decision record". Then `record_audit()` reads this to get the task. This creates a clear audit trail: decision file written by decide(), audit file written by record_audit(), aggregation by DomainMemory.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python 3.12 | Runtime | Yes | 3.12.3 | -- |
| pytest | Testing | Yes | 7.0+ | -- |
| FastAPI | API framework | Yes | 0.136.1 | -- |
| pydantic | Validation | Yes | 2.13 | -- |
| httpx | Test client | Yes | 0.24+ | -- |

**Missing dependencies with no fallback:**
- None -- all dependencies available.

**Missing dependencies with fallback:**
- None.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest |
| Config file | none (uses conftest.py fixtures) |
| Quick run command | `cd docker/hermes-agent && python3 -m pytest tests/ -x -q` |
| Full suite command | `cd docker/hermes-agent && python3 -m pytest tests/ -v --tb=short` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LEARN-01 | record_audit() aggregates into audit_history.json grouped by task | unit | `python3 -m pytest tests/test_domain_memory.py::test_append_record_groups_by_task -x` | No -- Wave 0 |
| LEARN-01 | Aggregated memory queryable via GET /v1/domains/:domain/memory | unit | `python3 -m pytest tests/test_routes.py::TestMemoryEndpoint -x` | No -- Wave 0 |
| LEARN-01 | Aggregation persists across service restarts | unit | `python3 -m pytest tests/test_domain_memory.py::test_history_persists_to_disk -x` | No -- Wave 0 |
| LEARN-02 | EWMA < 0.5 with >= 3 audits triggers auto_learn_triggered: true | unit | `python3 -m pytest tests/test_domain_memory.py::test_auto_learn_triggered -x` | No -- Wave 0 |
| LEARN-02 | EWMA >= 0.5 does NOT trigger auto_learn | unit | `python3 -m pytest tests/test_domain_memory.py::test_auto_learn_not_triggered -x` | No -- Wave 0 |
| LEARN-02 | < 3 audits does NOT trigger auto_learn regardless of score | unit | `python3 -m pytest tests/test_domain_memory.py::test_auto_learn_minimum_audits -x` | No -- Wave 0 |
| LEARN-03 | decide() returns EWMA confidence for domain+task with >= 3 audits | unit | `python3 -m pytest tests/test_decision_engine.py::test_decide_dynamic_confidence -x` | No -- Wave 0 |
| LEARN-03 | decide() returns 0.0 confidence for domain+task with < 3 audits | unit | `python3 -m pytest tests/test_decision_engine.py::test_decide_confidence_minimum_audits -x` | No -- Wave 0 |
| LEARN-03 | Full loop: register -> decide -> audit x3 -> decide with confidence | integration | `python3 -m pytest tests/test_integration.py::test_learning_loop -x` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `cd docker/hermes-agent && python3 -m pytest tests/ -x -q`
- **Per wave merge:** `cd docker/hermes-agent && python3 -m pytest tests/ -v --tb=short`
- **Phase gate:** Full suite green (61 existing + new tests), all passing

### Wave 0 Gaps
- [ ] `docker/hermes-agent/tests/test_domain_memory.py` -- covers LEARN-01 (aggregation), LEARN-02 (auto-learn trigger), LEARN-03 (EWMA computation)
- [ ] `docker/hermes-agent/src/core/domain_memory.py` -- new module for DomainMemory class
- [ ] `docker/hermes-agent/tests/conftest.py` -- add `domain_memory` fixture
- [ ] `docker/hermes-agent/tests/test_routes.py` -- add TestMemoryEndpoint class
- [ ] `docker/hermes-agent/tests/test_decision_engine.py` -- add dynamic confidence tests
- [ ] `docker/hermes-agent/tests/test_integration.py` -- add test_learning_loop integration test

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No user auth (internal service) |
| V3 Session Management | no | No user sessions |
| V4 Access Control | no | No user roles |
| V5 Input Validation | yes | Pydantic models for all request/response schemas; domain name regex validation already enforced |
| V6 Cryptography | no | No encryption needed (internal HTTP) |

### Known Threat Patterns for Python FastAPI Services

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal in domain names | Tampering | Domain name regex `^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$` already enforced in Phase 7 |
| Audit metrics injection (large JSON payloads) | Denial of Service | Limit metrics dict size in Pydantic model; audit_history.json prune cap prevents unbounded growth |
| Score manipulation to avoid auto-learn | Tampering | Accept as low risk -- internal service, callers are trusted pipelines |

## Sources

### Primary (HIGH confidence)
- Existing codebase: `docker/hermes-agent/src/core/decision_engine.py` -- record_audit() and decide() stubs [VERIFIED: file read]
- Existing codebase: `docker/hermes-agent/src/api/routes.py` -- route handler patterns [VERIFIED: file read]
- Existing codebase: `docker/hermes-agent/src/api/models.py` -- Pydantic model patterns [VERIFIED: file read]
- Existing test suite: `docker/hermes-agent/tests/` -- 61 tests, all passing [VERIFIED: pytest run]
- CONTEXT.md -- locked decisions on memory strategy, EWMA, auto-learn threshold [VERIFIED: file read]

### Secondary (MEDIUM confidence)
- EWMA algorithm and formula [CITED: towardsdatascience.com/time-series-from-scratch-exponentially-weighted-moving-averages-ewma-theory-and-implementation-607661d574fe]
- EWMA Python implementation patterns [CITED: stackoverflow.com/questions/488670/calculate-exponential-moving-average-in-python]
- Audit log best practices (append-only, immutable, separate storage) [CITED: sonarsource.com/resources/library/audit-logging]

### Tertiary (LOW confidence)
- None -- all research based on verified codebase reads and well-established algorithm references

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new packages, all existing verified dependencies
- Architecture: HIGH -- extending existing patterns, all integration points identified in codebase
- Pitfalls: HIGH -- based on thorough codebase analysis and understanding of existing test constraints
- EWMA algorithm: HIGH -- well-documented standard algorithm, verified via multiple sources

**Research date:** 2026-06-06
**Valid until:** 2026-07-06 (30 days -- no external dependencies that could change)
