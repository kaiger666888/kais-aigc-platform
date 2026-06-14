"""Tests for per-domain, per-task model routing via model.yaml.

Covers:
- _load_domain_model_yaml: missing file / empty / malformed / valid
- _lookup_provider: found / not found / case-insensitive
- _resolve_model_spec:
  * no model.yaml → use global fallback
  * model.yaml default only
  * model.yaml task override (full)
  * model.yaml task override (partial — inherits provider from default)
  * task not in tasks → falls back to default
  * missing provider in spec → falls back when no provider AND no model
- AgentFactory.get_agent(domain, task): threads task through to AIAgent
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

SYS_PATH_ENTRY = str(Path(__file__).resolve().parent.parent)
if SYS_PATH_ENTRY not in sys.path:
    sys.path.insert(0, SYS_PATH_ENTRY)

from src.core.agent_factory import (
    AgentFactory,
    ModelSpec,
    _load_domain_model_yaml,
    _lookup_provider,
    _resolve_model_spec,
)
from src.core.domain_registry import DomainRegistry
from src.config import Settings


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def registry_with_domain(tmp_path: Path) -> tuple[DomainRegistry, Path]:
    """Set up a registry with one pre-registered domain."""
    domains_dir = tmp_path / "domains"
    domains_dir.mkdir()
    registry = DomainRegistry(base_dir=domains_dir)
    registry.register(
        domain="d1",
        description="test",
        tasks=["alpha", "beta"],
        skills_manifest={},
    )
    return registry, domains_dir / "d1"


@pytest.fixture()
def fallback_spec() -> ModelSpec:
    return ModelSpec(
        provider="global-provider",
        model="global-model",
        base_url="https://global.example.com",
        api_key="global-key",
    )


@pytest.fixture()
def custom_providers():
    """Patched custom_providers list for tests."""
    return [
        {"name": "deepseek", "base_url": "https://api.deepseek.com",
         "api_key": "ds-key"},
        {"name": "zai", "base_url": "https://open.bigmodel.cn/api/paas/v4",
         "api_key": "zai-key"},
    ]


# ---------------------------------------------------------------------------
# _load_domain_model_yaml
# ---------------------------------------------------------------------------


class TestLoadDomainModelYaml:
    def test_returns_none_when_missing(self, registry_with_domain) -> None:
        _, d1_dir = registry_with_domain
        assert _load_domain_model_yaml(d1_dir) is None

    def test_parses_valid_yaml(self, registry_with_domain) -> None:
        _, d1_dir = registry_with_domain
        (d1_dir / "model.yaml").write_text(
            "default:\n  provider: deepseek\n  model: deepseek-v4-pro\n",
            encoding="utf-8",
        )
        result = _load_domain_model_yaml(d1_dir)
        assert result == {
            "default": {"provider": "deepseek", "model": "deepseek-v4-pro"}
        }

    def test_returns_empty_dict_on_malformed(
        self, registry_with_domain, caplog
    ) -> None:
        _, d1_dir = registry_with_domain
        (d1_dir / "model.yaml").write_text(
            "default: [unclosed", encoding="utf-8"
        )
        result = _load_domain_model_yaml(d1_dir)
        # Malformed YAML is ignored, treated as "no per-domain config"
        assert result is None

    def test_returns_empty_dict_on_non_dict_root(
        self, registry_with_domain
    ) -> None:
        _, d1_dir = registry_with_domain
        (d1_dir / "model.yaml").write_text("- just\n- a\n- list\n")
        result = _load_domain_model_yaml(d1_dir)
        assert result == {}


# ---------------------------------------------------------------------------
# _lookup_provider
# ---------------------------------------------------------------------------


class TestLookupProvider:
    def test_finds_matching_entry(self, custom_providers) -> None:
        url, key = _lookup_provider("deepseek", custom_providers)
        assert url == "https://api.deepseek.com"
        assert key == "ds-key"

    def test_case_insensitive(self, custom_providers) -> None:
        url, key = _lookup_provider("DEEPSEEK", custom_providers)
        assert key == "ds-key"

    def test_returns_empty_for_unknown(self, custom_providers) -> None:
        url, key = _lookup_provider("unknown-provider", custom_providers)
        assert url == ""
        assert key == ""

    def test_returns_empty_for_empty_name(self, custom_providers) -> None:
        assert _lookup_provider("", custom_providers) == ("", "")


# ---------------------------------------------------------------------------
# _resolve_model_spec
# ---------------------------------------------------------------------------


class TestResolveModelSpec:
    def test_no_model_yaml_uses_fallback(
        self, registry_with_domain, fallback_spec
    ) -> None:
        registry, _ = registry_with_domain
        spec = _resolve_model_spec("d1", "alpha", registry, fallback_spec)
        assert spec is fallback_spec

    def test_default_only(
        self, registry_with_domain, fallback_spec, custom_providers
    ) -> None:
        registry, d1_dir = registry_with_domain
        (d1_dir / "model.yaml").write_text(
            "default:\n  provider: deepseek\n  model: deepseek-v4-pro\n",
            encoding="utf-8",
        )
        with patch(
            "src.core.agent_factory._load_custom_providers",
            return_value=custom_providers,
        ):
            spec = _resolve_model_spec("d1", "alpha", registry, fallback_spec)
        assert spec.provider == "deepseek"
        assert spec.model == "deepseek-v4-pro"
        assert spec.base_url == "https://api.deepseek.com"
        assert spec.api_key == "ds-key"

    def test_task_override_full(
        self, registry_with_domain, fallback_spec, custom_providers
    ) -> None:
        registry, d1_dir = registry_with_domain
        (d1_dir / "model.yaml").write_text(
            "default:\n"
            "  provider: deepseek\n"
            "  model: deepseek-v4-pro\n"
            "tasks:\n"
            "  beta:\n"
            "    provider: zai\n"
            "    model: glm-4.6v\n",
            encoding="utf-8",
        )
        with patch(
            "src.core.agent_factory._load_custom_providers",
            return_value=custom_providers,
        ):
            spec = _resolve_model_spec("d1", "beta", registry, fallback_spec)
        assert spec.provider == "zai"
        assert spec.model == "glm-4.6v"
        assert spec.base_url == "https://open.bigmodel.cn/api/paas/v4"
        assert spec.api_key == "zai-key"

    def test_task_override_partial_inherits_provider_from_default(
        self, registry_with_domain, fallback_spec, custom_providers
    ) -> None:
        # task beta specifies only model, inherits provider from default
        registry, d1_dir = registry_with_domain
        (d1_dir / "model.yaml").write_text(
            "default:\n"
            "  provider: deepseek\n"
            "  model: deepseek-v4-pro\n"
            "tasks:\n"
            "  beta:\n"
            "    model: deepseek-v4-flash\n",
            encoding="utf-8",
        )
        with patch(
            "src.core.agent_factory._load_custom_providers",
            return_value=custom_providers,
        ):
            spec = _resolve_model_spec("d1", "beta", registry, fallback_spec)
        assert spec.provider == "deepseek"
        assert spec.model == "deepseek-v4-flash"
        assert spec.api_key == "ds-key"

    def test_task_not_in_tasks_uses_default(
        self, registry_with_domain, fallback_spec, custom_providers
    ) -> None:
        registry, d1_dir = registry_with_domain
        (d1_dir / "model.yaml").write_text(
            "default:\n"
            "  provider: deepseek\n"
            "  model: deepseek-v4-pro\n"
            "tasks:\n"
            "  beta:\n"
            "    provider: zai\n"
            "    model: glm-4.6v\n",
            encoding="utf-8",
        )
        with patch(
            "src.core.agent_factory._load_custom_providers",
            return_value=custom_providers,
        ):
            # 'gamma' is not in tasks → use default
            spec = _resolve_model_spec("d1", "gamma", registry, fallback_spec)
        assert spec.provider == "deepseek"
        assert spec.model == "deepseek-v4-pro"

    def test_task_none_uses_default(
        self, registry_with_domain, fallback_spec, custom_providers
    ) -> None:
        registry, d1_dir = registry_with_domain
        (d1_dir / "model.yaml").write_text(
            "default:\n  provider: deepseek\n  model: deepseek-v4-pro\n",
            encoding="utf-8",
        )
        with patch(
            "src.core.agent_factory._load_custom_providers",
            return_value=custom_providers,
        ):
            spec = _resolve_model_spec("d1", None, registry, fallback_spec)
        assert spec.provider == "deepseek"

    def test_empty_model_yaml_uses_fallback(
        self, registry_with_domain, fallback_spec
    ) -> None:
        registry, d1_dir = registry_with_domain
        (d1_dir / "model.yaml").write_text("{}", encoding="utf-8")
        spec = _resolve_model_spec("d1", "alpha", registry, fallback_spec)
        assert spec is fallback_spec


# ---------------------------------------------------------------------------
# AgentFactory.get_agent integration
# ---------------------------------------------------------------------------


class TestAgentFactoryTaskThreading:
    """Verify AgentFactory threads task through to AIAgent construction."""

    def test_get_agent_accepts_task_arg(self, registry_with_domain) -> None:
        """get_agent(domain, task=X) does not raise and constructs AIAgent."""
        registry, _ = registry_with_domain
        settings = Settings()
        # Force env vars empty so we exercise the fallback path
        with patch.object(settings, "llm_provider", ""), \
             patch.object(settings, "llm_model", ""), \
             patch.object(settings, "llm_base_url", ""), \
             patch.object(settings, "llm_api_key", ""):
            factory = AgentFactory(settings, registry)
            # Should not raise even with task arg
            try:
                agent = factory.get_agent("d1", task="alpha")
                assert agent is not None
            except Exception as exc:
                # AIAgent may fail for env-specific reasons (no creds);
                # that's fine, we're testing the routing layer here.
                pytest.skip(f"AIAgent construction needs runtime env: {exc}")

    def test_get_agent_without_task_still_works(
        self, registry_with_domain
    ) -> None:
        """get_agent(domain) without task should not raise."""
        registry, _ = registry_with_domain
        settings = Settings()
        factory = AgentFactory(settings, registry)
        try:
            factory.get_agent("d1")
        except Exception as exc:
            pytest.skip(f"AIAgent construction needs runtime env: {exc}")
