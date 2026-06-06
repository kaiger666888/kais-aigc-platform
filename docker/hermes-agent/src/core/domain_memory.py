"""
DomainMemory -- audit history aggregation, EWMA confidence computation,
auto-learn trigger detection, and memory query summarization.

Encapsulates all learning-loop data management for a single domain,
isolating it from the decision engine (Phase 8 Plan 01).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Tunable constants
# ---------------------------------------------------------------------------

EWMA_ALPHA: float = 0.3
AUTO_LEARN_THRESHOLD: float = 0.5
MIN_AUDITS_FOR_CONFIDENCE: int = 3
MAX_RECORDS_PER_TASK: int = 100
RECENT_RECORDS_LIMIT: int = 10


class DomainMemory:
    """Manage audit history aggregation and confidence for a single domain."""

    def __init__(self, memory_dir: Path) -> None:
        self.memory_dir = memory_dir
        self.history_path = memory_dir / "audit_history.json"

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _load_history(self) -> dict[str, Any]:
        """Read audit_history.json.  Return {} if missing or corrupt."""
        if not self.history_path.exists():
            return {}
        try:
            return json.loads(self.history_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {}

    def _save_history(self, data: dict[str, Any]) -> None:
        """Atomic write: write .tmp then rename (matches Phase 7 pattern)."""
        self.memory_dir.mkdir(parents=True, exist_ok=True)
        tmp = self.history_path.with_suffix(".tmp")
        tmp.write_text(
            json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        tmp.replace(self.history_path)

    @staticmethod
    def _prune_task(task_data: dict[str, Any]) -> None:
        """Keep only the last *MAX_RECORDS_PER_TASK* records."""
        records = task_data["records"]
        if len(records) > MAX_RECORDS_PER_TASK:
            task_data["records"] = records[-MAX_RECORDS_PER_TASK:]

    @staticmethod
    def _normalize_score(raw: Any) -> float:
        """Normalize a raw score to the 0-1 range.

        Convention (per RESEARCH.md):
        - If the value is > 1.0, assume 0-10 scale and divide by 10.0.
        - Clamp to [0.0, 1.0].
        - TypeError / ValueError -> 0.0.
        """
        try:
            val = float(raw)
        except (TypeError, ValueError):
            return 0.0
        if val > 1.0:
            val = val / 10.0
        return max(0.0, min(1.0, val))

    def _compute_ewma(self, records: list[dict[str, Any]]) -> float:
        """Compute EWMA from audit scores.  Returns 0.0 if < MIN_AUDITS_FOR_CONFIDENCE."""
        if len(records) < MIN_AUDITS_FOR_CONFIDENCE:
            return 0.0
        scores = [
            self._normalize_score(r.get("metrics", {}).get("score", 0.0))
            for r in records
        ]
        ewma = scores[0]
        for score in scores[1:]:
            ewma = EWMA_ALPHA * score + (1 - EWMA_ALPHA) * ewma
        return round(ewma, 4)

    @staticmethod
    def _trend(scores: list[float]) -> str:
        """Simple trend direction: compare avg of last 3 vs avg of earlier scores."""
        if len(scores) < 4:
            return "stable"
        recent_avg = sum(scores[-3:]) / 3
        earlier_avg = sum(scores[:-3]) / (len(scores) - 3)
        if recent_avg > earlier_avg * 1.1:
            return "improving"
        if recent_avg < earlier_avg * 0.9:
            return "declining"
        return "stable"

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def append_record(self, task: str, record: dict[str, Any]) -> None:
        """Append an audit record under the task group, prune, and recompute EWMA."""
        history = self._load_history()
        if task not in history:
            history[task] = {"records": [], "ewma_confidence": 0.0}

        history[task]["records"].append(record)
        self._prune_task(history[task])
        history[task]["ewma_confidence"] = self._compute_ewma(history[task]["records"])
        self._save_history(history)

    def get_confidence(self, task: str) -> float:
        """Return the current EWMA confidence for *task*.  0.0 if unknown."""
        history = self._load_history()
        task_data = history.get(task)
        if task_data is None:
            return 0.0
        return task_data.get("ewma_confidence", 0.0)

    def should_trigger_auto_learn(self, task: str) -> bool:
        """Return True when EWMA confidence < threshold and enough audits exist."""
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
        task_stats: dict[str, Any] = {}
        all_recent: list[dict[str, Any]] = []

        for task, data in history.items():
            records = data.get("records", [])
            normalized_scores = [
                self._normalize_score(r.get("metrics", {}).get("score", 0.0))
                for r in records
            ]

            task_stats[task] = {
                "avg_score": round(
                    sum(normalized_scores) / len(normalized_scores), 4
                )
                if normalized_scores
                else 0.0,
                "record_count": len(records),
                "ewma_confidence": data.get("ewma_confidence", 0.0),
                "trend_direction": self._trend(normalized_scores),
            }
            all_recent.extend(records)

        # Sort recent by timestamp descending, take top RECENT_RECORDS_LIMIT
        all_recent.sort(key=lambda r: r.get("timestamp", ""), reverse=True)
        return {
            "task_stats": task_stats,
            "recent_records": all_recent[:RECENT_RECORDS_LIMIT],
        }
