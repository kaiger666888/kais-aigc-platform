"""
AgentFactory -- per-domain AIAgent instantiation.

Creates fresh AIAgent instances scoped to a specific domain,
injecting the domain's SOUL.md as ephemeral system prompt.
Does NOT cache instances -- AIAgent state is per-conversation.
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import HTTPException

from src.config import Settings
from src.core.domain_registry import DomainRegistry

logger = logging.getLogger(__name__)

# Import AIAgent from the hermes-agent library.
# Verified working import path: "from run_agent import AIAgent"
from run_agent import AIAgent  # type: ignore[import-untyped]


class AgentFactory:
    """Create per-domain AIAgent instances with domain-specific context."""

    def __init__(self, settings: Settings, registry: DomainRegistry) -> None:
        self.settings = settings
        self.registry = registry

    def get_agent(self, domain: str) -> AIAgent:
        """Create a fresh AIAgent instance scoped to the given domain.

        Raises HTTPException 404 if the domain is not registered.
        """
        if not self.registry.domain_exists(domain):
            raise HTTPException(status_code=404, detail=f"Domain '{domain}' not found")

        # Load SOUL.md content for the domain
        domain_dir = self.registry.base_dir / domain
        soul_path = domain_dir / "SOUL.md"
        soul_content: str | None = None
        if soul_path.exists():
            text = soul_path.read_text(encoding="utf-8").strip()
            if text:
                soul_content = text

        agent = AIAgent(
            base_url=self.settings.llm_base_url,
            api_key=self.settings.llm_api_key,
            provider=self.settings.llm_provider,
            model=self.settings.llm_model,
            platform="api_server",
            quiet_mode=True,
            skip_context_files=True,  # We manage context ourselves
            skip_memory=True,  # We manage memory via domain memory/ dir
            ephemeral_system_prompt=soul_content,
        )

        logger.debug("Created AIAgent for domain: %s", domain)
        return agent
