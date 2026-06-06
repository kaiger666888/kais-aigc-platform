"""
Hermes Agent Core Service -- Configuration.

Reads settings from environment variables with sensible defaults.
Does NOT use pydantic-settings (extra dependency) -- plain class with os.environ.get().
"""

from __future__ import annotations

import os
from pathlib import Path


class Settings:
    """Application settings loaded from environment variables."""

    def __init__(self) -> None:
        self.llm_base_url: str = os.environ.get(
            "LLM_BASE_URL", "https://open.bigmodel.cn/api/paas/v4"
        )
        self.llm_api_key: str = os.environ.get("LLM_API_KEY", "")
        self.llm_provider: str = os.environ.get("LLM_PROVIDER", "zai")
        self.llm_model: str = os.environ.get("LLM_MODEL", "glm-5.1")
        self.hermes_home: Path = Path(
            os.environ.get("HERMES_HOME", str(Path.home() / ".hermes"))
        )
        self.host: str = os.environ.get("HOST", "0.0.0.0")
        self.port: int = int(os.environ.get("PORT", "8080"))
        self.log_level: str = os.environ.get("LOG_LEVEL", "INFO")


_cached_settings: Settings | None = None


def get_settings() -> Settings:
    """Return a cached singleton Settings instance."""
    global _cached_settings
    if _cached_settings is None:
        _cached_settings = Settings()
    return _cached_settings
