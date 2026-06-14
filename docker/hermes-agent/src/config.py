"""
Hermes Agent Core Service -- Configuration.

Resolution order for provider / model / base_url / api_key:
    1. ``LLM_*`` env vars (explicit override — wins if set)
    2. ``$HERMES_HOME/config.yaml``'s ``model:`` section and the matching
       ``custom_providers:`` entry (so an operator who ran
       ``hermes setup`` and chose e.g. deepseek gets deepseek here too)
    3. Empty string (which :mod:`src.core.agent_factory` converts back to
       ``None`` when constructing :class:`~run_agent.AIAgent`, telling the
       fork to use its own built-in defaults)

The fork's :func:`AIAgent.__init__` does NOT auto-read ``config.yaml``'s
``model:`` section to fill in ``provider`` / ``model`` / ``base_url`` —
that section only affects auxiliary settings (max_tokens, context_length,
auxiliary vision/compression models). So we read it ourselves here and
pass the resolved values explicitly. The fork DOES auto-load
``GLM_API_KEY`` / ``OPENAI_API_KEY`` from ``$HERMES_HOME/.env`` for the
api_key, so we leave that to the fork when no override is set.

Does NOT use pydantic-settings (extra dependency) -- plain class with
os.environ.get().
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


def _load_fork_config() -> dict[str, Any]:
    """Best-effort load of $HERMES_HOME/config.yaml via the fork's loader.

    Returns {} on any failure — caller treats missing keys as "use env
    var or fall through to fork defaults". This must never raise; it
    runs at module import time inside Settings.__init__.
    """
    try:
        from hermes_cli.config import load_config  # type: ignore[import-untyped]
    except Exception as exc:
        logger.debug("hermes_cli.config not available: %s", exc)
        return {}
    try:
        cfg = load_config() or {}
        return cfg if isinstance(cfg, dict) else {}
    except Exception as exc:
        logger.debug("load_config() failed: %s", exc)
        return {}


def _resolve_from_config(
    cfg: dict[str, Any],
) -> tuple[str, str, str, str]:
    """Pull (provider, model, base_url, api_key) from the fork's config.yaml.

    Reads the top-level ``model:`` section for provider/default model,
    then scans ``custom_providers:`` for a matching entry to get
    base_url + api_key. Returns ("", "", "", "") if config is missing
    or malformed.

    api_key is pulled from custom_providers because the fork's
    AIAgent.__init__ does NOT auto-look-up custom_providers' api_key
    when an explicit ``provider=`` arg is passed — it only auto-loads
    GLM_API_KEY/OPENAI_API_KEY from .env for its built-in defaults. So
    if the operator configured a custom provider (e.g. deepseek), we
    must surface the key ourselves.
    """
    model_cfg = cfg.get("model") or {}
    if not isinstance(model_cfg, dict):
        return "", "", "", ""
    provider = str(model_cfg.get("provider") or "").strip()
    model = str(model_cfg.get("default") or model_cfg.get("model") or "").strip()

    base_url = ""
    api_key = ""
    if provider:
        for entry in cfg.get("custom_providers") or []:
            if not isinstance(entry, dict):
                continue
            if str(entry.get("name") or "").strip().lower() == provider.lower():
                base_url = str(entry.get("base_url") or "").strip()
                api_key = str(entry.get("api_key") or "").strip()
                if not model:
                    model = str(entry.get("model") or "").strip()
                break

    return provider, model, base_url, api_key


class Settings:
    """Application settings loaded from env vars + fork's config.yaml."""

    def __init__(self) -> None:
        # Step 1: explicit env-var overrides (highest priority)
        env_provider = os.environ.get("LLM_PROVIDER", "").strip()
        env_model = os.environ.get("LLM_MODEL", "").strip()
        env_base_url = os.environ.get("LLM_BASE_URL", "").strip()
        env_api_key = os.environ.get("LLM_API_KEY", "").strip()

        # Step 2: fall back to the fork's config.yaml
        cfg = _load_fork_config()
        cfg_provider, cfg_model, cfg_base_url, cfg_api_key = _resolve_from_config(cfg)

        self.llm_provider: str = env_provider or cfg_provider
        self.llm_model: str = env_model or cfg_model
        self.llm_base_url: str = env_base_url or cfg_base_url
        # api_key: env override wins; otherwise pull from custom_providers
        # so a non-default provider (e.g. deepseek) actually authenticates.
        # The fork's auto-load of GLM_API_KEY/OPENAI_API_KEY from .env only
        # covers its built-in zai/openai defaults, not custom providers.
        self.llm_api_key: str = env_api_key or cfg_api_key

        self.hermes_home: Path = Path(
            os.environ.get("HERMES_HOME", str(Path.home() / ".hermes"))
        )
        self.host: str = os.environ.get("HOST", "0.0.0.0")
        self.port: int = int(os.environ.get("PORT", "8080"))
        self.log_level: str = os.environ.get("LOG_LEVEL", "INFO")

        logger.info(
            "Settings resolved: provider=%r model=%r base_url=%r "
            "api_key=%s (source: env+config)",
            self.llm_provider,
            self.llm_model,
            self.llm_base_url,
            "<set>" if self.llm_api_key else "<none>",
        )


_cached_settings: Settings | None = None


def get_settings() -> Settings:
    """Return a cached singleton Settings instance."""
    global _cached_settings
    if _cached_settings is None:
        _cached_settings = Settings()
    return _cached_settings

