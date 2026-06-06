"""
Hermes Agent API route handlers.

All /v1/* endpoints that delegate business logic to core modules:
- POST /v1/register  -- register a new domain
- GET  /v1/domains   -- list all registered domains
- GET  /v1/domains/{domain}/skills -- list skills for a domain
- POST /v1/decide    -- make a decision for a domain
- POST /v1/audit     -- record audit data for a decision
- GET  /v1/health    -- service health check
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException

from src.api.deps import (
    get_decision_engine,
    get_registry,
)
from src.api.models import (
    AuditRequest,
    AuditResponse,
    DecideRequest,
    DecideResponse,
    HealthResponse,
    MemoryResponse,
    RegisterRequest,
    RegisterResponse,
)
from src.core.decision_engine import DecisionEngine
from src.core.domain_memory import DomainMemory
from src.core.domain_registry import DomainRegistry

logger = logging.getLogger("hermes.api.routes")

router = APIRouter(tags=["v1"])


# ---------------------------------------------------------------------------
# POST /v1/register
# ---------------------------------------------------------------------------

@router.post("/register", response_model=RegisterResponse, status_code=201)
async def register(
    req: RegisterRequest,
    registry: DomainRegistry = Depends(get_registry),
) -> RegisterResponse:
    """Register a new domain with the decision engine."""
    try:
        registry.register(
            domain=req.domain,
            description=req.description,
            tasks=req.tasks,
            skills_manifest=req.skills_manifest,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return RegisterResponse(
        domain=req.domain,
        status="registered",
        message=f"Domain '{req.domain}' registered successfully",
    )


# ---------------------------------------------------------------------------
# GET /v1/domains
# ---------------------------------------------------------------------------

@router.get("/domains", response_model=list[str])
async def list_domains(
    registry: DomainRegistry = Depends(get_registry),
) -> list[str]:
    """Return all registered domain names."""
    return registry.list_all()


# ---------------------------------------------------------------------------
# GET /v1/domains/{domain}/skills
# ---------------------------------------------------------------------------

@router.get("/domains/{domain}/skills")
async def get_domain_skills(
    domain: str,
    registry: DomainRegistry = Depends(get_registry),
) -> dict:
    """Return the skill list for a registered domain."""
    if not registry.domain_exists(domain):
        raise HTTPException(
            status_code=404,
            detail=f"Domain '{domain}' not registered",
        )
    return {"domain": domain, "skills": registry.get_skills(domain)}


# ---------------------------------------------------------------------------
# POST /v1/decide
# ---------------------------------------------------------------------------

@router.post("/decide", response_model=DecideResponse)
async def decide(
    req: DecideRequest,
    registry: DomainRegistry = Depends(get_registry),
    engine: DecisionEngine = Depends(get_decision_engine),
) -> DecideResponse:
    """Make a decision for a registered domain.

    Wraps the synchronous AIAgent.chat() call in asyncio.to_thread()
    to avoid blocking the FastAPI event loop.
    """
    if not registry.domain_exists(req.domain):
        raise HTTPException(
            status_code=404,
            detail=f"Domain '{req.domain}' not registered",
        )

    try:
        result = await asyncio.to_thread(
            engine.decide,
            domain=req.domain,
            task=req.task,
            context=req.context,
        )
    except Exception as exc:
        logger.error("Decision engine error for domain=%s: %s", req.domain, exc)
        raise HTTPException(
            status_code=502,
            detail="Decision engine error",
        ) from exc

    return DecideResponse(**result)


# ---------------------------------------------------------------------------
# POST /v1/audit
# ---------------------------------------------------------------------------

@router.post("/audit", response_model=AuditResponse)
async def audit(
    req: AuditRequest,
    registry: DomainRegistry = Depends(get_registry),
    engine: DecisionEngine = Depends(get_decision_engine),
) -> AuditResponse:
    """Record audit data for a past decision."""
    if not registry.domain_exists(req.domain):
        raise HTTPException(
            status_code=404,
            detail=f"Domain '{req.domain}' not registered",
        )

    result = engine.record_audit(
        domain=req.domain,
        decision_id=req.decision_id,
        outcome=req.outcome,
        metrics=req.metrics,
    )

    return AuditResponse(
        recorded=result["recorded"],
        auto_learn_triggered=result.get("auto_learn_triggered", False),
        decision_id=req.decision_id,
    )


# ---------------------------------------------------------------------------
# GET /v1/health
# ---------------------------------------------------------------------------

@router.get("/health", response_model=HealthResponse)
async def health(
    engine: DecisionEngine = Depends(get_decision_engine),
) -> HealthResponse:
    """Return service health status."""
    result = engine.check_health()
    return HealthResponse(**result)


# ---------------------------------------------------------------------------
# GET /v1/domains/{domain}/memory
# ---------------------------------------------------------------------------

@router.get("/domains/{domain}/memory", response_model=MemoryResponse)
async def get_domain_memory(
    domain: str,
    registry: DomainRegistry = Depends(get_registry),
) -> MemoryResponse:
    """Return aggregated memory stats for a registered domain."""
    if not registry.domain_exists(domain):
        raise HTTPException(
            status_code=404,
            detail=f"Domain '{domain}' not registered",
        )

    memory_dir = registry.base_dir / domain / "memory"
    domain_memory = DomainMemory(memory_dir)
    summary = domain_memory.get_summary()
    return MemoryResponse(**summary)
