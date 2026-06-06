"""
Unit tests for DecisionEngine prompt building, audit recording, and health check.

Covers:
- build_prompt contains domain, task, and context
- record_audit writes JSON file to domain memory/ dir
- record_audit returns {recorded: True, auto_learn_triggered: False}
- check_health returns status dict with domains_count
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.core.decision_engine import DecisionEngine
from src.core.domain_memory import DomainMemory


class TestDecisionEngineLearningLoop:
    """Tests for DecisionEngine learning-loop integration with DomainMemory."""

    def test_record_audit_aggregates_to_history(
        self, registry: DecisionEngine, tmp_hermes_dir: Path
    ) -> None:
        """record_audit writes to audit_history.json grouped by task."""
        registry.register("test-domain", "Test", [], {})
        engine = DecisionEngine(registry=registry, agent_factory=None)

        engine.record_audit(
            "test-domain", "dec-1", "completed", {"task": "task-a", "score": 7}
        )

        history_path = (
            tmp_hermes_dir / "domains" / "test-domain" / "memory" / "audit_history.json"
        )
        assert history_path.exists()
        history = json.loads(history_path.read_text())
        assert "task-a" in history
        assert "records" in history["task-a"]

    def test_record_audit_auto_learn_triggered(
        self, registry: DecisionEngine, tmp_hermes_dir: Path
    ) -> None:
        """Three low-score audits trigger auto_learn."""
        registry.register("test-domain", "Test", [], {})
        engine = DecisionEngine(registry=registry, agent_factory=None)

        for i in range(3):
            result = engine.record_audit(
                "test-domain", f"dec-{i}", "completed", {"task": "task-a", "score": 1}
            )

        assert result["recorded"] is True
        assert result["auto_learn_triggered"] is True

    def test_record_audit_auto_learn_not_triggered(
        self, registry: DecisionEngine, tmp_hermes_dir: Path
    ) -> None:
        """Three high-score audits do NOT trigger auto_learn."""
        registry.register("test-domain", "Test", [], {})
        engine = DecisionEngine(registry=registry, agent_factory=None)

        for i in range(3):
            result = engine.record_audit(
                "test-domain", f"dec-{i}", "completed", {"task": "task-a", "score": 9}
            )

        assert result["auto_learn_triggered"] is False

    def test_record_audit_backward_compat(
        self, registry: DecisionEngine, tmp_hermes_dir: Path
    ) -> None:
        """record_audit without task key still works (defaults to 'unknown')."""
        registry.register("test-domain", "Test", [], {})
        engine = DecisionEngine(registry=registry, agent_factory=None)

        result = engine.record_audit(
            "test-domain", "dec-compat", "completed", {"score": 5}
        )

        assert result["recorded"] is True
        compat_path = (
            tmp_hermes_dir / "domains" / "test-domain" / "memory" / "dec-compat.json"
        )
        assert compat_path.exists()

    def test_decide_dynamic_confidence(
        self, registry: DecisionEngine, tmp_hermes_dir: Path
    ) -> None:
        """decide() returns non-zero confidence when DomainMemory has 3+ records."""
        registry.register("test-domain", "Test", [], {})
        engine = DecisionEngine(registry=registry, agent_factory=None)

        memory_dir = tmp_hermes_dir / "domains" / "test-domain" / "memory"
        dm = DomainMemory(memory_dir)
        for i in range(3):
            dm.append_record("task-a", {"metrics": {"score": 8}, "timestamp": f"2025-01-0{i+1}"})

        result = engine.decide("test-domain", "task-a", {})
        assert result["confidence"] != 0.0

    def test_decide_confidence_zero_below_minimum(
        self, registry: DecisionEngine, tmp_hermes_dir: Path
    ) -> None:
        """decide() returns 0.0 confidence with no prior audits."""
        registry.register("test-domain", "Test", [], {})
        engine = DecisionEngine(registry=registry, agent_factory=None)

        result = engine.decide("test-domain", "task-a", {})
        assert result["confidence"] == 0.0


class TestDecisionEngineBuildPrompt:
    """Tests for DecisionEngine.build_prompt()."""

    def test_build_prompt_contains_domain_task_context(
        self, registry: "DecisionEngine"
    ) -> None:
        """Prompt string contains 'Domain:', 'Task:', 'Context:' markers."""
        engine = DecisionEngine(registry=registry, agent_factory=None)
        prompt = engine.build_prompt(
            "test-domain", "choose-model", {"budget": "high", "quality": "best"}
        )
        assert "Domain:" in prompt
        assert "test-domain" in prompt
        assert "Task:" in prompt
        assert "choose-model" in prompt
        assert "Context:" in prompt
        assert "budget" in prompt


class TestDecisionEngineRecordAudit:
    """Tests for DecisionEngine.record_audit()."""

    def test_record_audit_writes_file(
        self, registry: DecisionEngine, tmp_hermes_dir: Path
    ) -> None:
        """record_audit writes JSON file to domain memory/ dir."""
        registry.register("test-domain", "Test", [], {})
        engine = DecisionEngine(registry=registry, agent_factory=None)

        engine.record_audit("test-domain", "decision-abc", "completed", {"score": 5})

        audit_path = tmp_hermes_dir / "domains" / "test-domain" / "memory" / "decision-abc.json"
        assert audit_path.exists()
        data = json.loads(audit_path.read_text())
        assert data["decision_id"] == "decision-abc"
        assert data["outcome"] == "completed"
        assert data["metrics"] == {"score": 5}

    def test_record_audit_returns_recorded(
        self, registry: DecisionEngine, tmp_hermes_dir: Path
    ) -> None:
        """record_audit returns {recorded: True, auto_learn_triggered: False}."""
        registry.register("test-domain", "Test", [], {})
        engine = DecisionEngine(registry=registry, agent_factory=None)

        result = engine.record_audit("test-domain", "dec-1", "ok", {})

        assert result["recorded"] is True
        assert result["auto_learn_triggered"] is False


class TestDecisionEngineCheckHealth:
    """Tests for DecisionEngine.check_health()."""

    def test_check_health_returns_status(self, registry: DecisionEngine) -> None:
        """check_health returns {status: 'ok', engine: 'hermes-agent', domains_count: N}."""
        registry.register("alpha", "First", [], {})
        registry.register("beta", "Second", [], {})
        engine = DecisionEngine(registry=registry, agent_factory=None)

        health = engine.check_health()

        assert health["status"] == "ok"
        assert health["engine"] == "hermes-agent"
        assert health["domains_count"] == 2
        assert sorted(health["domains"]) == ["alpha", "beta"]
