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
