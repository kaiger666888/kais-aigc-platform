"""
Unit tests for DomainMemory -- audit aggregation, EWMA confidence,
auto-learn trigger detection, and memory query summarization.

Phase 8 Plan 01 (LEARN-01, LEARN-02, LEARN-03).
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Ensure src/ is importable
SYS_PATH_ENTRY = str(Path(__file__).resolve().parent.parent)
if SYS_PATH_ENTRY not in sys.path:
    sys.path.insert(0, SYS_PATH_ENTRY)

from src.core.domain_memory import (
    DomainMemory,
    EWMA_ALPHA,
    AUTO_LEARN_THRESHOLD,
    MIN_AUDITS_FOR_CONFIDENCE,
    MAX_RECORDS_PER_TASK,
    RECENT_RECORDS_LIMIT,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def domain_memory_dir(tmp_path: Path) -> Path:
    """Provide a temporary directory for DomainMemory storage."""
    mem_dir = tmp_path / "memory"
    mem_dir.mkdir()
    return mem_dir


def _make_record(decision_id: str, score: float, timestamp: str = "2026-01-01T00:00:00Z") -> dict:
    """Helper to create a minimal audit record."""
    return {
        "decision_id": decision_id,
        "metrics": {"score": score},
        "timestamp": timestamp,
    }


# ===================================================================
# LEARN-01: Audit aggregation
# ===================================================================


class TestAppendRecord:
    """Tests for DomainMemory.append_record() and audit history persistence."""

    def test_append_record_creates_history_file(
        self, domain_memory_dir: Path
    ) -> None:
        """append_record creates audit_history.json with task containing one record."""
        dm = DomainMemory(domain_memory_dir)
        dm.append_record("task-a", _make_record("d1", 7))
        history_path = domain_memory_dir / "audit_history.json"
        assert history_path.exists()
        import json
        data = json.loads(history_path.read_text(encoding="utf-8"))
        assert "task-a" in data
        assert len(data["task-a"]["records"]) == 1

    def test_append_record_groups_by_task(
        self, domain_memory_dir: Path
    ) -> None:
        """Two records with different tasks produce two task keys."""
        dm = DomainMemory(domain_memory_dir)
        dm.append_record("task-a", _make_record("d1", 7))
        dm.append_record("task-b", _make_record("d2", 8))
        import json
        data = json.loads(
            (domain_memory_dir / "audit_history.json").read_text(encoding="utf-8")
        )
        assert "task-a" in data
        assert "task-b" in data
        assert len(data) == 2

    def test_append_record_appends_to_existing(
        self, domain_memory_dir: Path
    ) -> None:
        """Three records to same task yield records list of length 3."""
        dm = DomainMemory(domain_memory_dir)
        dm.append_record("task-a", _make_record("d1", 7))
        dm.append_record("task-a", _make_record("d2", 8))
        dm.append_record("task-a", _make_record("d3", 9))
        import json
        data = json.loads(
            (domain_memory_dir / "audit_history.json").read_text(encoding="utf-8")
        )
        assert len(data["task-a"]["records"]) == 3


class TestHistoryPersistence:
    """Tests that audit history persists across DomainMemory instances."""

    def test_history_persists_to_disk(
        self, domain_memory_dir: Path
    ) -> None:
        """New DomainMemory instance reads persisted EWMA."""
        dm1 = DomainMemory(domain_memory_dir)
        dm1.append_record("task-a", _make_record("d1", 8, "2026-01-01T00:00:00Z"))
        dm1.append_record("task-a", _make_record("d2", 8, "2026-01-01T01:00:00Z"))
        dm1.append_record("task-a", _make_record("d3", 8, "2026-01-01T02:00:00Z"))

        dm2 = DomainMemory(domain_memory_dir)
        confidence = dm2.get_confidence("task-a")
        assert confidence > 0.0


class TestPruning:
    """Tests for per-task record pruning to MAX_RECORDS_PER_TASK."""

    def test_prune_keeps_last_100_records(
        self, domain_memory_dir: Path
    ) -> None:
        """After appending 105 records, only 100 remain."""
        dm = DomainMemory(domain_memory_dir)
        for i in range(105):
            dm.append_record("task-a", _make_record(f"d{i}", 5, f"2026-01-01T{i:04d}Z"))
        import json
        data = json.loads(
            (domain_memory_dir / "audit_history.json").read_text(encoding="utf-8")
        )
        assert len(data["task-a"]["records"]) == 100

    def test_prune_per_task_isolation(
        self, domain_memory_dir: Path
    ) -> None:
        """Pruning task-a to 100 does not affect task-b (5 records)."""
        dm = DomainMemory(domain_memory_dir)
        for i in range(105):
            dm.append_record("task-a", _make_record(f"da{i}", 5, f"2026-01-01T{i:04d}Z"))
        for i in range(5):
            dm.append_record("task-b", _make_record(f"db{i}", 5, f"2026-01-01T{i:04d}Z"))
        import json
        data = json.loads(
            (domain_memory_dir / "audit_history.json").read_text(encoding="utf-8")
        )
        assert len(data["task-a"]["records"]) == 100
        assert len(data["task-b"]["records"]) == 5


# ===================================================================
# LEARN-01: Summary query
# ===================================================================


class TestGetSummary:
    """Tests for DomainMemory.get_summary()."""

    def test_get_summary_returns_task_stats(
        self, domain_memory_dir: Path
    ) -> None:
        """Summary has task_stats with avg_score, record_count, ewma_confidence, trend_direction."""
        dm = DomainMemory(domain_memory_dir)
        dm.append_record("task-a", _make_record("d1", 7, "2026-01-01T00:00:00Z"))
        dm.append_record("task-a", _make_record("d2", 8, "2026-01-01T01:00:00Z"))
        dm.append_record("task-a", _make_record("d3", 9, "2026-01-01T02:00:00Z"))
        dm.append_record("task-b", _make_record("d4", 5, "2026-01-01T03:00:00Z"))

        summary = dm.get_summary()
        assert "task_stats" in summary
        assert "task-a" in summary["task_stats"]
        assert "task-b" in summary["task_stats"]

        stats_a = summary["task_stats"]["task-a"]
        assert "avg_score" in stats_a
        assert "record_count" in stats_a
        assert "ewma_confidence" in stats_a
        assert "trend_direction" in stats_a
        assert stats_a["record_count"] == 3

    def test_get_summary_returns_recent_records(
        self, domain_memory_dir: Path
    ) -> None:
        """Recent records limited to RECENT_RECORDS_LIMIT, sorted by timestamp desc."""
        dm = DomainMemory(domain_memory_dir)
        for i in range(15):
            task = "task-a" if i < 8 else "task-b"
            dm.append_record(task, _make_record(f"d{i}", 5, f"2026-01-0{i%9+1}T{i:02d}:00:00Z"))

        summary = dm.get_summary()
        assert len(summary["recent_records"]) <= RECENT_RECORDS_LIMIT
        # Verify descending timestamp order
        timestamps = [r["timestamp"] for r in summary["recent_records"]]
        assert timestamps == sorted(timestamps, reverse=True)

    def test_get_summary_empty_domain(
        self, domain_memory_dir: Path
    ) -> None:
        """Empty domain returns {task_stats: {}, recent_records: []}."""
        dm = DomainMemory(domain_memory_dir)
        summary = dm.get_summary()
        assert summary == {"task_stats": {}, "recent_records": []}


# ===================================================================
# LEARN-02: Auto-learn trigger
# ===================================================================


class TestAutoLearnTrigger:
    """Tests for DomainMemory.should_trigger_auto_learn()."""

    def test_auto_learn_triggered(
        self, domain_memory_dir: Path
    ) -> None:
        """3 records with scores [3, 2, 1] (all < 5/10=0.5) triggers auto-learn."""
        dm = DomainMemory(domain_memory_dir)
        dm.append_record("task-a", _make_record("d1", 3, "2026-01-01T00:00:00Z"))
        dm.append_record("task-a", _make_record("d2", 2, "2026-01-01T01:00:00Z"))
        dm.append_record("task-a", _make_record("d3", 1, "2026-01-01T02:00:00Z"))
        assert dm.should_trigger_auto_learn("task-a") is True

    def test_auto_learn_not_triggered_high_scores(
        self, domain_memory_dir: Path
    ) -> None:
        """3 records with scores [8, 9, 7] (all > 0.5 normalized) does NOT trigger."""
        dm = DomainMemory(domain_memory_dir)
        dm.append_record("task-a", _make_record("d1", 8, "2026-01-01T00:00:00Z"))
        dm.append_record("task-a", _make_record("d2", 9, "2026-01-01T01:00:00Z"))
        dm.append_record("task-a", _make_record("d3", 7, "2026-01-01T02:00:00Z"))
        assert dm.should_trigger_auto_learn("task-a") is False

    def test_auto_learn_minimum_audits(
        self, domain_memory_dir: Path
    ) -> None:
        """2 records with low scores but < MIN_AUDITS_FOR_CONFIDENCE does NOT trigger."""
        dm = DomainMemory(domain_memory_dir)
        dm.append_record("task-a", _make_record("d1", 1, "2026-01-01T00:00:00Z"))
        dm.append_record("task-a", _make_record("d2", 1, "2026-01-01T01:00:00Z"))
        assert dm.should_trigger_auto_learn("task-a") is False

    def test_auto_learn_no_history(
        self, domain_memory_dir: Path
    ) -> None:
        """Task with no records returns False."""
        dm = DomainMemory(domain_memory_dir)
        assert dm.should_trigger_auto_learn("unknown-task") is False


# ===================================================================
# LEARN-03: EWMA confidence
# ===================================================================


class TestEWMAConfidence:
    """Tests for DomainMemory.get_confidence() EWMA computation."""

    def test_ewma_confidence_with_3_records(
        self, domain_memory_dir: Path
    ) -> None:
        """3 records with scores [8, 8, 8] yields non-zero confidence (~0.8)."""
        dm = DomainMemory(domain_memory_dir)
        dm.append_record("task-a", _make_record("d1", 8, "2026-01-01T00:00:00Z"))
        dm.append_record("task-a", _make_record("d2", 8, "2026-01-01T01:00:00Z"))
        dm.append_record("task-a", _make_record("d3", 8, "2026-01-01T02:00:00Z"))
        confidence = dm.get_confidence("task-a")
        assert isinstance(confidence, float)
        assert confidence > 0.0
        # After normalization: 8/10 = 0.8 for all, EWMA should be ~0.8
        assert 0.75 < confidence < 0.85

    def test_ewma_confidence_returns_zero_below_minimum(
        self, domain_memory_dir: Path
    ) -> None:
        """2 records (below MIN_AUDITS_FOR_CONFIDENCE) returns 0.0."""
        dm = DomainMemory(domain_memory_dir)
        dm.append_record("task-a", _make_record("d1", 8, "2026-01-01T00:00:00Z"))
        dm.append_record("task-a", _make_record("d2", 9, "2026-01-01T01:00:00Z"))
        assert dm.get_confidence("task-a") == 0.0

    def test_ewma_confidence_no_records(
        self, domain_memory_dir: Path
    ) -> None:
        """Unknown task returns 0.0."""
        dm = DomainMemory(domain_memory_dir)
        assert dm.get_confidence("unknown-task") == 0.0

    def test_ewma_weights_recent_higher(
        self, domain_memory_dir: Path
    ) -> None:
        """Records [9, 1, 1, 1]: EWMA closer to 1 (recent) than to 9 (old)."""
        dm = DomainMemory(domain_memory_dir)
        dm.append_record("task-a", _make_record("d1", 9, "2026-01-01T00:00:00Z"))
        dm.append_record("task-a", _make_record("d2", 1, "2026-01-01T01:00:00Z"))
        dm.append_record("task-a", _make_record("d3", 1, "2026-01-01T02:00:00Z"))
        dm.append_record("task-a", _make_record("d4", 1, "2026-01-01T03:00:00Z"))
        confidence = dm.get_confidence("task-a")
        # Normalized: [0.9, 0.1, 0.1, 0.1]
        # EWMA: 0.9 -> 0.3*0.1 + 0.7*0.9 = 0.66 -> 0.3*0.1 + 0.7*0.66 = 0.492 -> 0.3*0.1 + 0.7*0.492 = 0.3744
        # Closer to 0.1 than to 0.9
        assert confidence < 0.5  # much closer to recent (0.1) than initial (0.9)


# ===================================================================
# LEARN-01: Score normalization
# ===================================================================


class TestScoreNormalization:
    """Tests for score normalization (0-10 -> 0-1, already 0-1 as-is)."""

    def test_score_normalization_0_to_10(
        self, domain_memory_dir: Path
    ) -> None:
        """Scores [5, 7, 8] (0-10 scale) produce EWMA in 0-1 range."""
        dm = DomainMemory(domain_memory_dir)
        dm.append_record("task-a", _make_record("d1", 5, "2026-01-01T00:00:00Z"))
        dm.append_record("task-a", _make_record("d2", 7, "2026-01-01T01:00:00Z"))
        dm.append_record("task-a", _make_record("d3", 8, "2026-01-01T02:00:00Z"))
        confidence = dm.get_confidence("task-a")
        assert 0.0 <= confidence <= 1.0
        # Normalized: [0.5, 0.7, 0.8]
        # EWMA: 0.5 -> 0.3*0.7 + 0.7*0.5 = 0.56 -> 0.3*0.8 + 0.7*0.56 = 0.632
        assert confidence > 0.0

    def test_score_normalization_already_0_to_1(
        self, domain_memory_dir: Path
    ) -> None:
        """Scores [0.5, 0.7, 0.8] (already normalized) produce correct EWMA."""
        dm = DomainMemory(domain_memory_dir)
        dm.append_record("task-a", _make_record("d1", 0.5, "2026-01-01T00:00:00Z"))
        dm.append_record("task-a", _make_record("d2", 0.7, "2026-01-01T01:00:00Z"))
        dm.append_record("task-a", _make_record("d3", 0.8, "2026-01-01T02:00:00Z"))
        confidence = dm.get_confidence("task-a")
        # EWMA: 0.5 -> 0.3*0.7 + 0.7*0.5 = 0.56 -> 0.3*0.8 + 0.7*0.56 = 0.632
        assert 0.0 <= confidence <= 1.0
        assert abs(confidence - 0.632) < 0.01
