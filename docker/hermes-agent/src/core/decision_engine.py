"""
DecisionEngine -- prompt construction and audit recording.

Validates domain existence, builds structured prompts for AIAgent.chat(),
records audit outcomes to domain memory, and provides health checks.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

from src.core.agent_factory import AgentFactory
from src.core.domain_memory import DomainMemory
from src.core.domain_registry import DomainRegistry

logger = logging.getLogger(__name__)


class DecisionEngine:
    """Orchestrate decision-making: prompt construction, agent invocation, audit."""

    def __init__(
        self, registry: DomainRegistry, agent_factory: AgentFactory | None
    ) -> None:
        self.registry = registry
        self.agent_factory = agent_factory

    # ------------------------------------------------------------------
    # Prompt construction
    # ------------------------------------------------------------------

    @staticmethod
    def build_prompt(
        domain: str, task: str, context: dict[str, Any]
    ) -> str:
        """Construct a structured decision prompt."""
        return (
            f"Domain: {domain}\n"
            f"Task: {task}\n"
            f"Context: {json.dumps(context, ensure_ascii=False)}"
        )

    # ------------------------------------------------------------------
    # Audit recording
    # ------------------------------------------------------------------

    def _resolve_task(
        self, domain: str, decision_id: str, metrics: dict[str, Any]
    ) -> str:
        """Resolve task name from metrics, audit file, or default to 'unknown'."""
        task = metrics.get("task")
        if task and isinstance(task, str):
            return task
        audit_path = self.registry.base_dir / domain / "memory" / f"{decision_id}.json"
        if audit_path.exists():
            try:
                data = json.loads(audit_path.read_text(encoding="utf-8"))
                task = data.get("task") or data.get("metrics", {}).get("task")
                if task and isinstance(task, str):
                    return task
            except (json.JSONDecodeError, OSError):
                pass
        return "unknown"

    def record_audit(
        self,
        domain: str,
        decision_id: str,
        outcome: str,
        metrics: dict[str, Any],
    ) -> dict[str, Any]:
        """Write an audit record to the domain's memory directory.

        Aggregates into audit_history.json via DomainMemory and returns
        auto_learn_triggered based on EWMA confidence threshold.
        """
        memory_dir = self.registry.base_dir / domain / "memory"
        memory_dir.mkdir(parents=True, exist_ok=True)

        record: dict[str, Any] = {
            "decision_id": decision_id,
            "outcome": outcome,
            "metrics": metrics,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

        audit_path = memory_dir / f"{decision_id}.json"
        audit_path.write_text(
            json.dumps(record, indent=2, ensure_ascii=False), encoding="utf-8"
        )

        # Aggregate into DomainMemory and check auto-learn
        task = self._resolve_task(domain, decision_id, metrics)
        domain_memory = DomainMemory(memory_dir)
        domain_memory.append_record(task, record)
        auto_learn = domain_memory.should_trigger_auto_learn(task)

        if auto_learn:
            logger.warning(
                "Auto-learn triggered: domain=%s task=%s confidence=%.3f",
                domain,
                task,
                domain_memory.get_confidence(task),
            )

        logger.info("Recorded audit for domain=%s decision_id=%s", domain, decision_id)
        return {"recorded": True, "auto_learn_triggered": auto_learn}

    # ------------------------------------------------------------------
    # Decide
    # ------------------------------------------------------------------

    def decide(
        self, domain: str, task: str, context: dict[str, Any]
    ) -> dict[str, Any]:
        """Make a decision for the given domain/task/context.

        Validates domain exists, builds prompt, calls agent.chat(),
        returns structured result.
        """
        if not self.registry.domain_exists(domain):
            raise HTTPException(status_code=404, detail=f"Domain '{domain}' not found")

        # Dynamic confidence from DomainMemory
        memory_dir = self.registry.base_dir / domain / "memory"
        domain_memory = DomainMemory(memory_dir)
        confidence = domain_memory.get_confidence(task)

        prompt = self.build_prompt(domain, task, context)

        # agent_factory is required for decide calls
        if self.agent_factory is None:
            raise RuntimeError("AgentFactory not configured -- cannot make decisions")

        agent = self.agent_factory.get_agent(domain)
        chat_response: str = agent.chat(prompt)

        return {
            "decision_id": str(uuid.uuid4()),
            "recommendation": chat_response,
            "confidence": confidence,
            "domain": domain,
            "task": task,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    # ------------------------------------------------------------------
    # Health check
    # ------------------------------------------------------------------

    def check_health(self) -> dict[str, Any]:
        """Return service health status."""
        domains = self.registry.list_all()
        return {
            "status": "ok",
            "engine": "hermes-agent",
            "domains_count": len(domains),
            "domains": domains,
        }
