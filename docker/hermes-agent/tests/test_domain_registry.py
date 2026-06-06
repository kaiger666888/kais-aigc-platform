"""
Unit tests for DomainRegistry CRUD and validation.

Covers:
- Domain registration creates correct directory structure
- Domain registration persists registry.json
- Domain registration creates SOUL.md
- Domain name validation rejects invalid names, path traversal
- get() returns domain config or None
- list_all() returns all registered domain names
- get_skills() returns skill names from .md files
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.core.domain_registry import DomainRegistry


# ---------------------------------------------------------------------------
# Registration creates directories
# ---------------------------------------------------------------------------


class TestDomainRegistryRegistration:
    """Tests for DomainRegistry.register() side effects."""

    def test_register_creates_directories(
        self, registry: DomainRegistry, tmp_hermes_dir: Path
    ) -> None:
        """register() creates skills/ and memory/ subdirectories."""
        registry.register("test-domain", "A test domain", ["task1"], {"skill1": {}})
        domain_dir = tmp_hermes_dir / "domains" / "test-domain"
        assert (domain_dir / "skills").is_dir()
        assert (domain_dir / "memory").is_dir()

    def test_register_creates_registry_json(
        self, registry: DomainRegistry, tmp_hermes_dir: Path
    ) -> None:
        """registry.json exists after registration with correct domain entry."""
        registry.register("test-domain", "A test domain", ["task1"], {"skill1": {}})
        reg_path = tmp_hermes_dir / "domains" / "registry.json"
        assert reg_path.exists()
        data = json.loads(reg_path.read_text())
        assert "test-domain" in data
        assert data["test-domain"]["description"] == "A test domain"
        assert data["test-domain"]["tasks"] == ["task1"]
        assert data["test-domain"]["skills_manifest"] == {"skill1": {}}
        assert "registered_at" in data["test-domain"]

    def test_register_creates_soul_md(
        self, registry: DomainRegistry, tmp_hermes_dir: Path
    ) -> None:
        """SOUL.md file exists in domain directory after registration."""
        registry.register("test-domain", "A test domain", ["task1"], {"skill1": {}})
        soul_path = tmp_hermes_dir / "domains" / "test-domain" / "SOUL.md"
        assert soul_path.exists()


# ---------------------------------------------------------------------------
# Domain name validation
# ---------------------------------------------------------------------------


class TestDomainNameValidation:
    """Tests for domain name validation."""

    def test_register_rejects_invalid_names(self, registry: DomainRegistry) -> None:
        """Invalid domain names raise ValueError."""
        # Too short (1 char)
        with pytest.raises(ValueError):
            registry.register("a", "Bad", [], {})
        # Uppercase
        with pytest.raises(ValueError):
            registry.register("UPPER", "Bad", [], {})
        # Special chars
        with pytest.raises(ValueError):
            registry.register("test@domain", "Bad", [], {})
        # Spaces
        with pytest.raises(ValueError):
            registry.register("test domain", "Bad", [], {})
        # Empty
        with pytest.raises(ValueError):
            registry.register("", "Bad", [], {})

    def test_register_rejects_path_traversal(self, registry: DomainRegistry) -> None:
        """Path traversal domain names raise ValueError."""
        with pytest.raises(ValueError):
            registry.register("../../etc", "Bad", [], {})
        with pytest.raises(ValueError):
            registry.register("../bad", "Bad", [], {})


# ---------------------------------------------------------------------------
# get()
# ---------------------------------------------------------------------------


class TestDomainRegistryGet:
    """Tests for DomainRegistry.get()."""

    def test_get_returns_config(self, registry: DomainRegistry) -> None:
        """get() returns dict with description, tasks, skills_manifest, registered_at."""
        registry.register("test-domain", "A test domain", ["task1"], {"skill1": {}})
        cfg = registry.get("test-domain")
        assert cfg is not None
        assert cfg["description"] == "A test domain"
        assert cfg["tasks"] == ["task1"]
        assert cfg["skills_manifest"] == {"skill1": {}}
        assert "registered_at" in cfg

    def test_get_nonexistent_returns_none(self, registry: DomainRegistry) -> None:
        """get() returns None for unregistered domain."""
        assert registry.get("no-such-domain") is None


# ---------------------------------------------------------------------------
# list_all()
# ---------------------------------------------------------------------------


class TestDomainRegistryListAll:
    """Tests for DomainRegistry.list_all()."""

    def test_list_all_returns_names(self, registry: DomainRegistry) -> None:
        """After registering two domains, list_all() returns both names."""
        registry.register("alpha", "First", [], {})
        registry.register("beta", "Second", [], {})
        names = registry.list_all()
        assert sorted(names) == ["alpha", "beta"]


# ---------------------------------------------------------------------------
# get_skills()
# ---------------------------------------------------------------------------


class TestDomainRegistryGetSkills:
    """Tests for DomainRegistry.get_skills()."""

    def test_get_skills_returns_names(
        self, registry: DomainRegistry, tmp_hermes_dir: Path
    ) -> None:
        """After writing .md files to skills/ dir, get_skills() returns filenames without extension."""
        registry.register("test-domain", "Test", [], {})
        skills_dir = tmp_hermes_dir / "domains" / "test-domain" / "skills"
        (skills_dir / "expert-drawer.md").write_text("# Drawer expert")
        (skills_dir / "expert-voicer.md").write_text("# Voicer expert")
        # Non-.md files should be ignored
        (skills_dir / "not-a-skill.txt").write_text("ignored")

        skills = registry.get_skills("test-domain")
        assert sorted(skills) == ["expert-drawer", "expert-voicer"]
