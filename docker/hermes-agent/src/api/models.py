"""
Pydantic request/response models for all Hermes Agent API endpoints.

Defines validation schemas for:
- POST /v1/register  -> RegisterRequest / RegisterResponse
- POST /v1/decide    -> DecideRequest / DecideResponse
- POST /v1/audit     -> AuditRequest / AuditResponse
- GET  /v1/health    -> HealthResponse
- Error responses    -> ErrorResponse
"""

from __future__ import annotations

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Register
# ---------------------------------------------------------------------------

class RegisterRequest(BaseModel):
    """Request body for domain registration."""
    domain: str = Field(
        ...,
        pattern=r"^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$",
        max_length=64,
        description="Domain name: 2-64 chars, lowercase alphanumeric with hyphens",
    )
    description: str = Field(
        ...,
        max_length=500,
        description="Human-readable domain description",
    )
    tasks: list[str] = Field(
        ...,
        max_length=50,
        description="List of task names the domain supports (max 50 items)",
    )
    skills_manifest: dict = Field(
        default_factory=dict,
        description="Optional skills manifest for the domain",
    )


class RegisterResponse(BaseModel):
    """Response body for domain registration."""
    domain: str
    status: str = "registered"
    message: str


# ---------------------------------------------------------------------------
# Decide
# ---------------------------------------------------------------------------

class DecideRequest(BaseModel):
    """Request body for making a decision."""
    domain: str = Field(
        ...,
        max_length=64,
        description="Target domain name",
    )
    task: str = Field(
        ...,
        max_length=200,
        description="Task description for the decision",
    )
    context: dict = Field(
        default_factory=dict,
        description="Additional context for the decision",
    )


class DecideResponse(BaseModel):
    """Response body for a decision."""
    decision_id: str
    recommendation: str
    confidence: float
    domain: str
    task: str
    timestamp: str


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------

class AuditRequest(BaseModel):
    """Request body for recording an audit."""
    domain: str = Field(
        ...,
        max_length=64,
        description="Domain name the decision belongs to",
    )
    decision_id: str = Field(
        ...,
        max_length=64,
        description="ID of the decision being audited",
    )
    outcome: str = Field(
        default="completed",
        max_length=50,
        description="Outcome of the decision",
    )
    metrics: dict = Field(
        default_factory=dict,
        description="Metrics and evaluation data",
    )


class AuditResponse(BaseModel):
    """Response body for audit recording."""
    recorded: bool
    auto_learn_triggered: bool = False
    decision_id: str


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

class HealthResponse(BaseModel):
    """Response body for health check."""
    status: str
    engine: str
    domains_count: int
    domains: list[str]


# ---------------------------------------------------------------------------
# Error
# ---------------------------------------------------------------------------

class ErrorResponse(BaseModel):
    """Standard error response."""
    detail: str
