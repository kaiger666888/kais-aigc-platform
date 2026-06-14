"""FastMCP server exposing the Hermes Agent decision engine.

Each MCP tool mirrors an existing /v1/* REST endpoint and delegates to the
same singleton DecisionEngine / DomainRegistry used by the FastAPI routes.
This keeps REST and MCP behavior identical: a domain registered via MCP is
visible to REST, and vice versa.

Mount strategy (see src/main.py):
    mcp_app = create_mcp_app()
    app = FastAPI(lifespan=mcp_app.router.lifespan_context)  # CRITICAL
    app.include_router(router, prefix="/v1")
    app.mount("/", mcp_app)                                  # MCP owns /mcp

The lifespan forwarding is required because FastMCP's streamable-http
transport needs to initialize an asyncio task group at startup. Without
it, every tools/call raises "Task group is not initialized"
(see modelcontextprotocol/python-sdk#1367).

Final MCP endpoint URL: http://host:8080/mcp
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from mcp.server.fastmcp import FastMCP

from src.api.deps import (
    get_decision_engine,
    get_registry,
)
from src.core.domain_memory import DomainMemory
from src.core.domain_registry import DOMAIN_NAME_RE, DomainRegistry

logger = logging.getLogger("hermes.mcp")


# ---------------------------------------------------------------------------
# Domain validation helpers
# ---------------------------------------------------------------------------


def _validate_domain(domain: str) -> None:
    """Reject invalid domain names before they hit the registry.

    DomainRegistry.register() raises ValueError on bad names; we replicate
    the check here so MCP callers get a clear, structured error rather than
    a generic tool failure.
    """
    if not DOMAIN_NAME_RE.match(domain):
        raise ValueError(
            f"Invalid domain name '{domain}': must be 2-64 chars, "
            "lowercase alphanumeric with hyphens, "
            "starting and ending with alphanumeric"
        )


def _require_domain(registry: DomainRegistry, domain: str) -> None:
    """Raise ValueError if domain is not registered.

    REST routes translate this to HTTP 404; here we surface the same
    ValueError to MCP, which FastMCP converts into a tool error response.
    """
    _validate_domain(domain)
    if not registry.domain_exists(domain):
        raise ValueError(f"Domain '{domain}' not registered")


# ---------------------------------------------------------------------------
# FastMCP factory
# ---------------------------------------------------------------------------
#
# We construct a fresh FastMCP per create_mcp_app() call instead of holding
# a module-level singleton. Reason: FastMCP's StreamableHTTPSessionManager
# can only run() once per instance, so re-entering the lifespan (e.g.
# pytest TestClient starting the ASGI app multiple times) raises
# "StreamableHTTPSessionManager.run() can only be called once per instance".
# Per-call construction is cheap — no I/O, no network — and tools are
# registered declaratively inside the factory.
#
# Tools look up registry/engine lazily via src.api.deps.get_*() at call
# time, so they always see the current singletons (production wiring in
# deps.py, test wiring via direct attribute assignment in tests).
#


def _register_tools(mcp: FastMCP) -> None:
    """Attach all 7 decision-engine tools to a FastMCP instance."""

    # ------------------------------------------------------------------
    # Domain CRUD tools
    # ------------------------------------------------------------------

    @mcp.tool()
    def domain_register(
        domain: str,
        description: str,
        tasks: list[str],
        skills_manifest: dict | None = None,
    ) -> dict:
        """Register a new decision domain (or refresh an existing one).

        Creates base_dir/{domain}/ with skills/ and memory/ subdirs and
        updates registry.json. SOUL.md is preserved if it already exists;
        new domains get an empty SOUL.md that operators can edit in-place.

        Args:
            domain: 2-64 chars, lowercase alphanumeric + hyphens, must
                start and end with alphanumeric. Example: "movie-pipeline".
            description: Human-readable purpose, <= 500 chars.
            tasks: Task names this domain supports (max 50). Example:
                ["requirement", "storyboard", "scene"].
            skills_manifest: Optional metadata dict for downstream
                tooling. Stored verbatim, never interpreted by the engine.

        Returns:
            {"domain": str, "status": "registered", "message": str}

        Raises:
            ValueError: domain name fails validation.
        """
        registry = get_registry()
        registry.register(
            domain=domain,
            description=description,
            tasks=tasks,
            skills_manifest=skills_manifest or {},
        )
        return {
            "domain": domain,
            "status": "registered",
            "message": f"Domain '{domain}' registered successfully",
        }

    @mcp.tool()
    def domain_list() -> dict:
        """Return all registered domain names.

        Useful for clients to discover which domains are available before
        calling domain_decide. Empty list if nothing is registered.

        Returns:
            {"domains": list[str]}
        """
        return {"domains": get_registry().list_all()}

    @mcp.tool()
    def domain_skills(domain: str) -> dict:
        """Return the skill filenames (without .md) registered for a domain.

        Skills live at base_dir/{domain}/skills/*.md and are NOT
        interpreted by the engine — they are operator-authored references
        surfaced for tooling/observability.

        Args:
            domain: a registered domain name.

        Returns:
            {"domain": str, "skills": list[str]}

        Raises:
            ValueError: domain is not registered.
        """
        registry = get_registry()
        _require_domain(registry, domain)
        return {"domain": domain, "skills": registry.get_skills(domain)}

    @mcp.tool()
    def domain_memory(domain: str) -> dict:
        """Return aggregated audit-history stats for a domain.

        Surfaces per-task EWMA confidence, record counts, trend direction,
        and the 10 most recent audit records. Clients use this to decide
        whether a domain has learned enough to be trusted, or to debug a
        regression.

        Args:
            domain: a registered domain name.

        Returns:
            {"task_stats": {task: {avg_score, record_count,
                                  ewma_confidence, trend_direction}},
             "recent_records": list[dict]}

        Raises:
            ValueError: domain is not registered.
        """
        registry = get_registry()
        _require_domain(registry, domain)
        memory_dir = registry.base_dir / domain / "memory"
        return DomainMemory(memory_dir).get_summary()

    # ------------------------------------------------------------------
    # Decision + audit tools (the core loop)
    # ------------------------------------------------------------------

    @mcp.tool()
    async def domain_decide(domain: str, task: str, context: dict) -> dict:
        """Get a decision recommendation for a registered domain/task.

        Runs DecisionEngine.decide(): looks up dynamic confidence from
        prior audits, builds a structured prompt, invokes the AIAgent
        with the domain's SOUL.md as system prompt, returns the
        recommendation.

        This is a thin MCP wrapper around the synchronous AIAgent.chat()
        call. We offload to a thread to avoid blocking the MCP event loop
        while the LLM streams.

        Args:
            domain: a registered domain name.
            task: short task identifier (e.g. "storyboard", "scene").
                <= 200 chars.
            context: arbitrary JSON-serializable context for this
                decision.

        Returns:
            {"decision_id": str, "recommendation": str,
             "confidence": float, "domain": str, "task": str,
             "timestamp": str}

        Raises:
            ValueError: domain is not registered.
            RuntimeError: AgentFactory not configured (engine misconfigured).
        """
        registry = get_registry()
        _require_domain(registry, domain)

        engine = get_decision_engine()
        # Offload sync AIAgent.chat() to a worker thread so the MCP event
        # loop stays free to multiplex other streamable-http sessions.
        return await asyncio.to_thread(
            engine.decide, domain=domain, task=task, context=context
        )

    @mcp.tool()
    def domain_audit(
        domain: str,
        decision_id: str,
        outcome: str = "completed",
        metrics: dict | None = None,
    ) -> dict:
        """Record the outcome of a past decision for learning.

        Writes base_dir/{domain}/memory/{decision_id}.json, then appends
        to audit_history.json and recomputes EWMA confidence. If
        confidence drops below threshold with enough samples,
        auto_learn_triggered flips True — operators use this signal to
        retrain or rewrite SOUL.md.

        Args:
            domain: the domain the audited decision belongs to.
            decision_id: the UUID returned by domain_decide.
            outcome: short label, e.g. "completed", "rejected", "revised".
            metrics: arbitrary metrics dict. Convention: {"score": 0..10
                or 0..1, "task": str}. The "task" key is used to bucket
                records; if absent, the engine falls back to the stored
                decide task.

        Returns:
            {"recorded": True, "auto_learn_triggered": bool,
             "decision_id": str}

        Raises:
            ValueError: domain is not registered.
        """
        registry = get_registry()
        _require_domain(registry, domain)

        engine = get_decision_engine()
        result: dict[str, Any] = engine.record_audit(
            domain=domain,
            decision_id=decision_id,
            outcome=outcome,
            metrics=metrics or {},
        )
        result["decision_id"] = decision_id
        return result

    # ------------------------------------------------------------------
    # Health
    # ------------------------------------------------------------------

    @mcp.tool()
    def health_check() -> dict:
        """Return service health + registered domain names.

        Lightweight probe — does NOT call the LLM or read memory files.
        Use this as an MCP-side liveness check; for the REST equivalent
        see GET /v1/health.
        """
        engine = get_decision_engine()
        return engine.check_health()


def _build_mcp() -> FastMCP:
    """Construct a fresh FastMCP instance with all 7 decision-engine tools."""
    mcp = FastMCP(
        "hermes-decisions",
        instructions=(
            "Hermes Agent decision engine — domain-isolated intelligent "
            "decisions for AIGC pipelines. Use domain_register to onboard "
            "a new domain, domain_decide to get a recommendation, "
            "domain_audit to feed back outcomes for learning."
        ),
    )

    # Disable MCP's DNS-rebinding protection. The default allowlist is
    # loopback only (127.0.0.1, localhost, ::1), but this container is
    # reached from other docker-compose services as
    # `kais-hermes-agent:8080` and from host tooling as `localhost:8080`.
    # The protection is a browser-defense measure for exposed public
    # servers; in our private Docker network it only produces spurious
    # 421 Misdirected Request responses.
    mcp.settings.transport_security.enable_dns_rebinding_protection = False

    _register_tools(mcp)
    return mcp


# ---------------------------------------------------------------------------
# Module-level singleton for direct unit tests (call_tool without HTTP)
# ---------------------------------------------------------------------------
#
# Tests that exercise tool dispatch via mcp.call_tool() use this instance.
# Production HTTP serving always builds a fresh one via _build_mcp() /
# create_mcp_app() so the StreamableHTTPSessionManager doesn't collide
# across TestClient lifespan entries.
#
mcp = _build_mcp()


# ---------------------------------------------------------------------------
# ASGI factory
# ---------------------------------------------------------------------------


def create_mcp_app() -> Any:
    """Return a fresh Starlette ASGI app for the FastMCP server.

    Mounted onto the FastAPI app at "/" in src/main.py. The internal
    FastMCP route is "/mcp", so the final externally-accessible URL is
    http://host:8080/mcp.

    The returned Starlette app exposes its lifespan via
    `app.router.lifespan_context`, which src/main.py forwards into the
    parent FastAPI app. This is required for streamable-http's task group
    to initialize (see modelcontextprotocol/python-sdk#1367).
    """
    return _build_mcp().streamable_http_app()
