"""
DomainRegistry -- filesystem-based domain CRUD with skills/memory isolation.

Each domain gets its own directory tree under base_dir:
    base_dir/{domain}/
        skills/
        memory/
        SOUL.md

A shared registry.json at base_dir/registry.json tracks all registered domains.
"""

from __future__ import annotations

import json
import re
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Domain name validation: lowercase alphanumeric + hyphens, 2-64 chars.
DOMAIN_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$")


class DomainRegistry:
    """Manage domain registration with filesystem isolation."""

    def __init__(self, base_dir: Path | None = None) -> None:
        if base_dir is None:
            base_dir = Path.home() / ".hermes" / "domains"
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def register(
        self,
        domain: str,
        description: str,
        tasks: list[str],
        skills_manifest: dict[str, Any],
    ) -> dict[str, Any]:
        """Register a new domain (or update an existing one).

        Creates the domain directory tree and updates registry.json.
        Raises ValueError if the domain name fails validation.
        """
        self._validate_domain_name(domain)

        domain_dir = self.base_dir / domain
        (domain_dir / "skills").mkdir(parents=True, exist_ok=True)
        (domain_dir / "memory").mkdir(parents=True, exist_ok=True)

        # Create SOUL.md only if it does not already exist (preserve user edits)
        soul_path = domain_dir / "SOUL.md"
        if not soul_path.exists():
            soul_path.write_text("")

        entry: dict[str, Any] = {
            "description": description,
            "tasks": tasks,
            "skills_manifest": skills_manifest,
            "registered_at": datetime.now(timezone.utc).isoformat(),
        }

        registry_data = self._load_registry()
        registry_data[domain] = entry
        self._save_registry(registry_data)

        logger.info("Registered domain: %s", domain)
        return entry

    def get(self, domain: str) -> dict[str, Any] | None:
        """Return a domain's config dict, or None if not found."""
        registry_data = self._load_registry()
        return registry_data.get(domain)

    def list_all(self) -> list[str]:
        """Return all registered domain names."""
        registry_data = self._load_registry()
        return list(registry_data.keys())

    def get_skills(self, domain: str) -> list[str]:
        """Return skill names (filenames without .md extension) for a domain."""
        skills_dir = self.base_dir / domain / "skills"
        if not skills_dir.is_dir():
            return []
        return sorted(
            p.stem for p in skills_dir.iterdir() if p.is_file() and p.suffix == ".md"
        )

    def domain_exists(self, domain: str) -> bool:
        """Check if a domain is registered."""
        return domain in self._load_registry()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _validate_domain_name(domain: str) -> None:
        """Reject domain names that could enable path traversal or are malformed."""
        if not DOMAIN_NAME_RE.match(domain):
            raise ValueError(
                f"Invalid domain name '{domain}': must be 2-64 chars, "
                "lowercase alphanumeric with hyphens, "
                "starting and ending with alphanumeric"
            )

    def _load_registry(self) -> dict[str, Any]:
        """Read registry.json from disk (fresh read every time)."""
        reg_path = self.base_dir / "registry.json"
        if not reg_path.exists():
            return {}
        try:
            return json.loads(reg_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            logger.warning("Could not parse registry.json, starting fresh")
            return {}

    def _save_registry(self, data: dict[str, Any]) -> None:
        """Write registry.json atomically."""
        reg_path = self.base_dir / "registry.json"
        tmp_path = reg_path.with_suffix(".tmp")
        tmp_path.write_text(
            json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        tmp_path.replace(reg_path)
