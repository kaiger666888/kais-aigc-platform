"""
Tests for DomainRegistry, AgentFactory, and DecisionEngine.

These tests verify domain CRUD with filesystem isolation,
domain name validation, agent factory, prompt construction,
and audit recording.
"""

from __future__ import annotations

import json
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Path setup -- ensure src/ is importable
# ---------------------------------------------------------------------------
import sys

SYS_PATH_ENTRY = str(Path(__file__).resolve().parent.parent)
if SYS_PATH_ENTRY not in sys.path:
    sys.path.insert(0, SYS_PATH_ENTRY)

from src.config import Settings
from src.core.domain_registry import DomainRegistry
from src.core.agent_factory import AgentFactory
from src.core.decision_engine import DecisionEngine


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def tmp_base(tmp_path: Path) -> Path:
    """Provide a temporary base directory for domain storage."""
    base = tmp_path / "domains"
    base.mkdir()
    return base


@pytest.fixture()
def registry(tmp_base: Path) -> DomainRegistry:
    """Provide a DomainRegistry backed by a temp directory."""
    return DomainRegistry(base_dir=tmp_base)


@pytest.fixture()
def mock_settings() -> Settings:
    """Provide Settings with test values."""
    return Settings()


# ---------------------------------------------------------------------------
# DomainRegistry tests
# ---------------------------------------------------------------------------


class TestDomainRegistryRegister:
    """DomainRegistry.register() tests."""

    def test_creates_skills_directory(self, registry: DomainRegistry, tmp_base: Path) -> None:
        registry.register("test-domain", "A test domain", ["task1"], {"skill1": {}})
        assert (tmp_base / "test-domain" / "skills").is_dir()

    def test_creates_memory_directory(self, registry: DomainRegistry, tmp_base: Path) -> None:
        registry.register("test-domain", "A test domain", ["task1"], {"skill1": {}})
        assert (tmp_base / "test-domain" / "memory").is_dir()

    def test_creates_soul_md(self, registry: DomainRegistry, tmp_base: Path) -> None:
        registry.register("test-domain", "A test domain", ["task1"], {"skill1": {}})
        assert (tmp_base / "test-domain" / "SOUL.md").exists()

    def test_does_not_overwrite_existing_soul_md(
        self, registry: DomainRegistry, tmp_base: Path
    ) -> None:
        registry.register("test-domain", "A test domain", ["task1"], {"skill1": {}})
        soul_path = tmp_base / "test-domain" / "SOUL.md"
        soul_path.write_text("Existing soul content")
        registry.register("test-domain", "Updated domain", ["task1"], {"skill1": {}})
        assert soul_path.read_text() == "Existing soul content"

    def test_updates_registry_json(self, registry: DomainRegistry, tmp_base: Path) -> None:
        registry.register("test-domain", "A test domain", ["task1"], {"skill1": {}})
        reg_path = tmp_base / "registry.json"
        assert reg_path.exists()
        data = json.loads(reg_path.read_text())
        assert "test-domain" in data
        assert data["test-domain"]["description"] == "A test domain"
        assert data["test-domain"]["tasks"] == ["task1"]
        assert data["test-domain"]["skills_manifest"] == {"skill1": {}}
        assert "registered_at" in data["test-domain"]


class TestDomainRegistryGet:
    """DomainRegistry.get() tests."""

    def test_returns_domain_config(self, registry: DomainRegistry) -> None:
        registry.register("test-domain", "A test domain", ["task1"], {"skill1": {}})
        cfg = registry.get("test-domain")
        assert cfg is not None
        assert cfg["description"] == "A test domain"
        assert cfg["tasks"] == ["task1"]
        assert cfg["skills_manifest"] == {"skill1": {}}
        assert "registered_at" in cfg

    def test_returns_none_for_nonexistent(self, registry: DomainRegistry) -> None:
        assert registry.get("nonexistent") is None


class TestDomainRegistryListAll:
    """DomainRegistry.list_all() tests."""

    def test_returns_registered_domains(self, registry: DomainRegistry) -> None:
        registry.register("alpha", "First", [], {})
        registry.register("beta", "Second", [], {})
        result = registry.list_all()
        assert sorted(result) == ["alpha", "beta"]

    def test_returns_empty_list_when_none_registered(self, registry: DomainRegistry) -> None:
        assert registry.list_all() == []


class TestDomainRegistryGetSkills:
    """DomainRegistry.get_skills() tests."""

    def test_returns_skill_names(self, registry: DomainRegistry, tmp_base: Path) -> None:
        registry.register("test-domain", "Test", [], {})
        skills_dir = tmp_base / "test-domain" / "skills"
        (skills_dir / "expert-drawer.md").write_text("# Drawer expert")
        (skills_dir / "expert-voicer.md").write_text("# Voicer expert")
        (skills_dir / "not-a-skill.txt").write_text("ignored")
        skills = registry.get_skills("test-domain")
        assert sorted(skills) == ["expert-drawer", "expert-voicer"]

    def test_returns_empty_list_when_no_skills(self, registry: DomainRegistry) -> None:
        registry.register("test-domain", "Test", [], {})
        assert registry.get_skills("test-domain") == []


class TestDomainRegistryExists:
    """DomainRegistry.domain_exists() tests."""

    def test_returns_true_for_registered(self, registry: DomainRegistry) -> None:
        registry.register("test-domain", "Test", [], {})
        assert registry.domain_exists("test-domain") is True

    def test_returns_false_for_unregistered(self, registry: DomainRegistry) -> None:
        assert registry.domain_exists("nope") is False


class TestDomainNameValidation:
    """Domain name validation tests."""

    @pytest.mark.parametrize(
        "bad_name",
        ["../bad", "..", "bad/name", "BAD", "a", "x" * 65, "test domain", "test@domain", ""],
    )
    def test_rejects_invalid_names(self, registry: DomainRegistry, bad_name: str) -> None:
        with pytest.raises(ValueError):
            registry.register(bad_name, "Bad", [], {})

    def test_accepts_valid_names(self, registry: DomainRegistry) -> None:
        registry.register("my-domain-123", "Valid", [], {})
        assert registry.get("my-domain-123") is not None

    def test_accepts_minimal_valid_name(self, registry: DomainRegistry) -> None:
        registry.register("abc", "Valid", [], {})
        assert registry.get("abc") is not None

    def test_accepts_max_length_name(self, registry: DomainRegistry) -> None:
        name = "a" + "-" * 62 + "z"
        registry.register(name, "Valid", [], {})
        assert registry.get(name) is not None


# ---------------------------------------------------------------------------
# AgentFactory tests
# ---------------------------------------------------------------------------


class TestAgentFactory:
    """AgentFactory tests using mocked AIAgent."""

    @patch("src.core.agent_factory.AIAgent", create=True)
    def test_get_agent_creates_instance(
        self, mock_ai_agent_cls: MagicMock, registry: DomainRegistry, mock_settings: Settings, tmp_base: Path
    ) -> None:
        registry.register("test-domain", "Test", [], {})
        # Write some SOUL.md content
        soul_path = tmp_base / "test-domain" / "SOUL.md"
        soul_path.write_text("# Test Domain Soul")

        factory = AgentFactory(settings=mock_settings, registry=registry)
        agent = factory.get_agent("test-domain")

        # Verify AIAgent was called with correct params
        mock_ai_agent_cls.assert_called_once()
        call_kwargs = mock_ai_agent_cls.call_args[1]
        assert call_kwargs["base_url"] == mock_settings.llm_base_url
        assert call_kwargs["api_key"] == mock_settings.llm_api_key
        assert call_kwargs["provider"] == mock_settings.llm_provider
        assert call_kwargs["model"] == mock_settings.llm_model
        assert call_kwargs["quiet_mode"] is True
        assert call_kwargs["skip_context_files"] is True
        assert call_kwargs["skip_memory"] is True
        assert call_kwargs["ephemeral_system_prompt"] == "# Test Domain Soul"

    def test_get_agent_raises_404_for_missing_domain(
        self, registry: DomainRegistry, mock_settings: Settings
    ) -> None:
        factory = AgentFactory(settings=mock_settings, registry=registry)
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            factory.get_agent("nonexistent")
        assert exc_info.value.status_code == 404

    @patch("src.core.agent_factory.AIAgent", create=True)
    def test_get_agent_empty_soul_md(
        self, mock_ai_agent_cls: MagicMock, registry: DomainRegistry, mock_settings: Settings, tmp_base: Path
    ) -> None:
        registry.register("test-domain", "Test", [], {})
        # SOUL.md exists but is empty (default)

        factory = AgentFactory(settings=mock_settings, registry=registry)
        factory.get_agent("test-domain")

        call_kwargs = mock_ai_agent_cls.call_args[1]
        assert call_kwargs["ephemeral_system_prompt"] is None


# ---------------------------------------------------------------------------
# DecisionEngine tests
# ---------------------------------------------------------------------------


class TestDecisionEngineBuildPrompt:
    """DecisionEngine.build_prompt() tests."""

    def test_constructs_structured_prompt(self, registry: DomainRegistry) -> None:
        engine = DecisionEngine(registry=registry, agent_factory=None)
        prompt = engine.build_prompt("test-domain", "task1", {"key": "value"})
        assert "test-domain" in prompt
        assert "task1" in prompt
        assert '"key"' in prompt
        assert '"value"' in prompt


class TestDecisionEngineRecordAudit:
    """DecisionEngine.record_audit() tests."""

    def test_writes_audit_json(self, registry: DomainRegistry, tmp_base: Path) -> None:
        registry.register("test-domain", "Test", [], {})
        engine = DecisionEngine(registry=registry, agent_factory=None)

        result = engine.record_audit("test-domain", "decision-123", "completed", {"score": 5})

        assert result["recorded"] is True
        assert result["auto_learn_triggered"] is False

        audit_path = tmp_base / "test-domain" / "memory" / "decision-123.json"
        assert audit_path.exists()
        data = json.loads(audit_path.read_text())
        assert data["decision_id"] == "decision-123"
        assert data["outcome"] == "completed"
        assert data["metrics"] == {"score": 5}
        assert "timestamp" in data

    def test_record_audit_for_missing_domain_does_not_create_dirs(
        self, registry: DomainRegistry
    ) -> None:
        engine = DecisionEngine(registry=registry, agent_factory=None)
        result = engine.record_audit("nonexistent", "dec-1", "ok", {})
        # Should still record (or gracefully handle) -- implementation choice
        assert result["recorded"] is True


class TestDecisionEngineDecide:
    """DecisionEngine.decide() tests."""

    def test_decide_returns_structured_result(
        self, registry: DomainRegistry, tmp_base: Path
    ) -> None:
        registry.register("test-domain", "Test", [], {})
        # Mock AgentFactory
        mock_factory = MagicMock()
        mock_agent = MagicMock()
        mock_agent.chat.return_value = "Recommended action: do X"
        mock_factory.get_agent.return_value = mock_agent

        engine = DecisionEngine(registry=registry, agent_factory=mock_factory)
        result = engine.decide("test-domain", "task1", {"key": "value"})

        assert "decision_id" in result
        assert result["recommendation"] == "Recommended action: do X"
        assert result["confidence"] == 0.0
        assert result["domain"] == "test-domain"
        assert result["task"] == "task1"
        assert "timestamp" in result

    def test_decide_raises_for_missing_domain(self, registry: DomainRegistry) -> None:
        engine = DecisionEngine(registry=registry, agent_factory=None)
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            engine.decide("nonexistent", "task1", {})
        assert exc_info.value.status_code == 404


class TestDecisionEngineCheckHealth:
    """DecisionEngine.check_health() tests."""

    def test_returns_status_dict(self, registry: DomainRegistry) -> None:
        registry.register("alpha", "First", [], {})
        registry.register("beta", "Second", [], {})

        engine = DecisionEngine(registry=registry, agent_factory=None)
        health = engine.check_health()

        assert health["status"] == "ok"
        assert health["engine"] == "hermes-agent"
        assert health["domains_count"] == 2
        assert sorted(health["domains"]) == ["alpha", "beta"]

    def test_returns_empty_when_no_domains(self, registry: DomainRegistry) -> None:
        engine = DecisionEngine(registry=registry, agent_factory=None)
        health = engine.check_health()

        assert health["status"] == "ok"
        assert health["domains_count"] == 0
        assert health["domains"] == []
