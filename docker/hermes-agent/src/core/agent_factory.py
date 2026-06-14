"""
AgentFactory -- per-domain, per-task AIAgent instantiation.

For each (domain, task) pair, resolves which LLM provider+model to use:

    1. domain's ``model.yaml`` (optional) — ``tasks[task]`` overrides
       ``default``. Both sections reference provider names defined in the
       fork's main ``~/.hermes/config.yaml`` ``custom_providers:`` list;
       the wrapper looks up matching base_url + api_key from there.
    2. global :class:`~src.config.Settings` (env-var override or the
       main config.yaml's ``model:`` section) when no domain model.yaml.

Injects the domain's ``SOUL.md`` as the ephemeral system prompt.
Does NOT cache instances — AIAgent state is per-conversation.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import yaml
from fastapi import HTTPException

from src.config import Settings
from src.core.domain_registry import DomainRegistry

logger = logging.getLogger(__name__)

# Import AIAgent from the hermes-agent library.
# Verified working import path: "from run_agent import AIAgent"
from run_agent import AIAgent  # type: ignore[import-untyped]


# ---------------------------------------------------------------------------
# Model spec resolution
# ---------------------------------------------------------------------------


class ModelSpec:
    """A resolved (provider, model, base_url, api_key) tuple.

    ``base_url`` and ``api_key`` may be empty strings — :meth:`as_args`
    converts empty values to ``None`` so the fork's AIAgent falls back
    to its own defaults for whichever field is missing.
    """

    __slots__ = ("provider", "model", "base_url", "api_key")

    def __init__(
        self,
        provider: str = "",
        model: str = "",
        base_url: str = "",
        api_key: str = "",
    ) -> None:
        self.provider = provider
        self.model = model
        self.base_url = base_url
        self.api_key = api_key

    def as_args(self) -> dict[str, Any]:
        """Return kwargs for AIAgent.__init__, empty strings → None."""
        return {
            "provider": self.provider or None,
            "model": self.model or None,
            "base_url": self.base_url or None,
            "api_key": self.api_key or None,
        }

    def __repr__(self) -> str:  # pragma: no cover - debug only
        return (
            f"ModelSpec(provider={self.provider!r}, model={self.model!r}, "
            f"base_url={'<set>' if self.base_url else '<none>'!r}, "
            f"api_key={'<set>' if self.api_key else '<none>'!r})"
        )


def _load_custom_providers() -> list[dict[str, Any]]:
    """Return the ``custom_providers`` list from the fork's main config.

    Best-effort — returns [] if load_config fails or the key is absent.
    """
    try:
        from hermes_cli.config import load_config  # type: ignore[import-untyped]
    except Exception:
        return []
    try:
        cfg = load_config() or {}
        providers = cfg.get("custom_providers") or []
        return providers if isinstance(providers, list) else []
    except Exception:
        return []


def _lookup_provider(
    provider: str, custom_providers: list[dict[str, Any]]
) -> tuple[str, str]:
    """Find (base_url, api_key) for a provider name in custom_providers.

    Returns ("", "") if not found — caller treats empty as "let fork
    use defaults" (works for built-in providers like anthropic/openai).
    """
    if not provider:
        return "", ""
    target = provider.strip().lower()
    for entry in custom_providers:
        if not isinstance(entry, dict):
            continue
        if str(entry.get("name") or "").strip().lower() == target:
            return (
                str(entry.get("base_url") or "").strip(),
                str(entry.get("api_key") or "").strip(),
            )
    return "", ""


def _load_domain_model_yaml(domain_dir: Path) -> dict[str, Any] | None:
    """Read ``domains/<name>/model.yaml`` if it exists, else None.

    Returns None (not {}) on missing file so callers can distinguish
    "no per-domain config" from "per-domain config is empty".
    """
    model_yaml_path = domain_dir / "model.yaml"
    if not model_yaml_path.exists():
        return None
    try:
        with model_yaml_path.open("r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        return data if isinstance(data, dict) else {}
    except (yaml.YAMLError, OSError) as exc:
        logger.warning(
            "Failed to parse %s: %s — ignoring per-domain model spec",
            model_yaml_path,
            exc,
        )
        return None


def _resolve_model_spec(
    domain: str,
    task: str | None,
    registry: DomainRegistry,
    fallback: ModelSpec,
) -> ModelSpec:
    """Build a ModelSpec for (domain, task).

    Args:
        domain: registered domain name.
        task: task identifier (may be None for "use domain default").
        registry: domain registry (for path lookup).
        fallback: ModelSpec to use when domain has no model.yaml.

    Returns:
        Resolved ModelSpec. Always non-None; falls back to ``fallback``
        if domain has no model.yaml.

    Raises:
        ValueError: model.yaml references a provider not in
            custom_providers AND that provider is not the empty fallback
            (built-in providers like 'anthropic' work without entry).
    """
    domain_dir = registry.base_dir / domain
    domain_cfg = _load_domain_model_yaml(domain_dir)
    if domain_cfg is None:
        # No per-domain spec — use global fallback (current behavior)
        return fallback

    default_cfg = domain_cfg.get("default") or {}
    tasks_cfg = domain_cfg.get("tasks") or {}
    if not isinstance(default_cfg, dict):
        default_cfg = {}
    if not isinstance(tasks_cfg, dict):
        tasks_cfg = {}

    # Pick the task-level spec if present; otherwise fall through to
    # the domain default. A task spec may be partial (only specify model,
    # inheriting provider from default).
    task_cfg: dict[str, Any] = {}
    if task and task in tasks_cfg and isinstance(tasks_cfg[task], dict):
        task_cfg = tasks_cfg[task]

    spec = ModelSpec(
        provider=str(task_cfg.get("provider") or default_cfg.get("provider") or "").strip(),
        model=str(task_cfg.get("model") or default_cfg.get("model") or "").strip(),
    )

    # If the chosen spec didn't pick a provider/model, use the global
    # fallback rather than constructing an AIAgent with no model.
    if not spec.provider and not spec.model:
        logger.debug(
            "domain %s task %s: model.yaml has no matching spec, "
            "using global fallback",
            domain,
            task,
        )
        return fallback

    # Resolve base_url + api_key from custom_providers in main config.
    custom_providers = _load_custom_providers()
    base_url, api_key = _lookup_provider(spec.provider, custom_providers)

    # Built-in providers (anthropic, openai, zai, ...) may legitimately
    # not appear in custom_providers — the fork resolves their creds from
    # env vars / .env. Only warn if the operator referenced a clearly
    # custom name we've never heard of.
    if not base_url and not api_key and spec.provider.lower() not in {
        "anthropic", "openai", "zai", "openrouter", "z-ai", "zhipu",
    }:
        logger.warning(
            "domain %s task %s: provider %r not found in custom_providers "
            "and not a known built-in — AIAgent may fail to authenticate. "
            "Add it to ~/.hermes/config.yaml custom_providers or switch to "
            "a different provider.",
            domain,
            task,
            spec.provider,
        )

    spec.base_url = base_url
    spec.api_key = api_key
    return spec


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


class AgentFactory:
    """Create per-domain, per-task AIAgent instances."""

    def __init__(self, settings: Settings, registry: DomainRegistry) -> None:
        self.settings = settings
        self.registry = registry

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_agent(self, domain: str, task: str | None = None) -> AIAgent:
        """Create a fresh AIAgent for (domain, task).

        Resolution order:
            1. domains/<domain>/model.yaml ``tasks[task]`` → ``default``
            2. Global Settings (env var or main config.yaml's model:)

        The domain's SOUL.md is always injected as the ephemeral system
        prompt, regardless of which model is chosen.

        Args:
            domain: registered domain name.
            task: task identifier within the domain. May be None for
                "use the domain's default model".

        Raises:
            HTTPException 404: domain not registered.
        """
        if not self.registry.domain_exists(domain):
            raise HTTPException(status_code=404, detail=f"Domain '{domain}' not found")

        # Build the fallback ModelSpec from global Settings
        fallback = ModelSpec(
            provider=self.settings.llm_provider,
            model=self.settings.llm_model,
            base_url=self.settings.llm_base_url,
            api_key=self.settings.llm_api_key,
        )

        spec = _resolve_model_spec(domain, task, self.registry, fallback)

        # Load SOUL.md content for the domain
        domain_dir = self.registry.base_dir / domain
        soul_path = domain_dir / "SOUL.md"
        soul_content: str | None = None
        if soul_path.exists():
            text = soul_path.read_text(encoding="utf-8").strip()
            if text:
                soul_content = text

        agent = AIAgent(
            platform="api_server",
            quiet_mode=True,
            skip_context_files=True,
            skip_memory=True,
            ephemeral_system_prompt=soul_content,
            **spec.as_args(),
        )

        logger.info(
            "Created AIAgent: domain=%s task=%s → provider=%s model=%s",
            domain,
            task or "<none>",
            getattr(agent, "provider", "?") or "<default>",
            getattr(agent, "model", "?") or "<default>",
        )
        return agent
