"""
FastAPI dependency injection for Hermes Agent API.

Provides singleton instances of:
- Settings (from config.py)
- DomainRegistry
- AgentFactory
- DecisionEngine
"""

from __future__ import annotations

from pathlib import Path

from src.config import Settings, get_settings as _get_settings
from src.core.domain_registry import DomainRegistry
from src.core.agent_factory import AgentFactory
from src.core.decision_engine import DecisionEngine


# ---------------------------------------------------------------------------
# Settings singleton (re-export from config for DI consistency)
# ---------------------------------------------------------------------------

def get_settings() -> Settings:
    """Return cached Settings singleton."""
    return _get_settings()


# ---------------------------------------------------------------------------
# DomainRegistry singleton
# ---------------------------------------------------------------------------

_registry_instance: DomainRegistry | None = None


def get_registry() -> DomainRegistry:
    """Return cached DomainRegistry singleton."""
    global _registry_instance
    if _registry_instance is None:
        settings = get_settings()
        _registry_instance = DomainRegistry(
            base_dir=settings.hermes_home / "domains"
        )
    return _registry_instance


# ---------------------------------------------------------------------------
# AgentFactory singleton
# ---------------------------------------------------------------------------

_factory_instance: AgentFactory | None = None


def get_agent_factory() -> AgentFactory:
    """Return cached AgentFactory singleton."""
    global _factory_instance
    if _factory_instance is None:
        settings = get_settings()
        registry = get_registry()
        _factory_instance = AgentFactory(settings, registry)
    return _factory_instance


# ---------------------------------------------------------------------------
# DecisionEngine singleton
# ---------------------------------------------------------------------------

_engine_instance: DecisionEngine | None = None


def get_decision_engine() -> DecisionEngine:
    """Return cached DecisionEngine singleton."""
    global _engine_instance
    if _engine_instance is None:
        registry = get_registry()
        factory = get_agent_factory()
        _engine_instance = DecisionEngine(registry, factory)
    return _engine_instance
