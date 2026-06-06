"""
Unit tests for all 6 API endpoints via FastAPI TestClient.

Covers:
- POST /v1/register (201 happy path, 422 invalid domain)
- GET /v1/domains (empty, after registration)
- GET /v1/domains/{domain}/skills (happy path, 404 for nonexistent)
- POST /v1/decide (happy path, 404 for unregistered domain)
- POST /v1/audit (happy path, 404 for unregistered domain)
- GET /v1/health (status ok)
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


def _register_domain(client: TestClient, domain: str = "test-domain") -> None:
    """Helper to register a domain via the test client."""
    resp = client.post(
        "/v1/register",
        json={
            "domain": domain,
            "description": "A test domain",
            "tasks": ["task1"],
            "skills_manifest": {"skill1": {}},
        },
    )
    assert resp.status_code == 201


# ---------------------------------------------------------------------------
# POST /v1/register
# ---------------------------------------------------------------------------


class TestRegisterEndpoint:
    """Tests for POST /v1/register."""

    def test_register_returns_201(self, client: TestClient) -> None:
        """POST /v1/register with valid data returns 201."""
        resp = client.post(
            "/v1/register",
            json={
                "domain": "test-domain",
                "description": "A test domain",
                "tasks": ["task1"],
                "skills_manifest": {"skill1": {}},
            },
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["domain"] == "test-domain"
        assert data["status"] == "registered"

    def test_register_rejects_invalid_domain(self, client: TestClient) -> None:
        """POST /v1/register with domain='../bad' returns 422."""
        resp = client.post(
            "/v1/register",
            json={
                "domain": "../bad",
                "description": "Bad domain",
                "tasks": [],
                "skills_manifest": {},
            },
        )
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# GET /v1/domains
# ---------------------------------------------------------------------------


class TestListDomainsEndpoint:
    """Tests for GET /v1/domains."""

    def test_list_domains_empty(self, client: TestClient) -> None:
        """GET /v1/domains returns [] initially."""
        resp = client.get("/v1/domains")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_list_domains_after_register(self, client: TestClient) -> None:
        """GET /v1/domains returns ['test-domain'] after registration."""
        _register_domain(client)
        resp = client.get("/v1/domains")
        assert resp.status_code == 200
        assert resp.json() == ["test-domain"]


# ---------------------------------------------------------------------------
# GET /v1/domains/{domain}/skills
# ---------------------------------------------------------------------------


class TestGetDomainSkillsEndpoint:
    """Tests for GET /v1/domains/{domain}/skills."""

    def test_get_domain_skills(self, client: TestClient) -> None:
        """GET /v1/domains/test-domain/skills returns {domain, skills: [...]}"."""
        _register_domain(client)
        resp = client.get("/v1/domains/test-domain/skills")
        assert resp.status_code == 200
        data = resp.json()
        assert data["domain"] == "test-domain"
        assert "skills" in data
        assert isinstance(data["skills"], list)

    def test_get_domain_skills_404(self, client: TestClient) -> None:
        """GET /v1/domains/nonexistent/skills returns 404."""
        resp = client.get("/v1/domains/nonexistent/skills")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# POST /v1/decide
# ---------------------------------------------------------------------------


class TestDecideEndpoint:
    """Tests for POST /v1/decide."""

    def test_decide_returns_decision(self, client: TestClient) -> None:
        """POST /v1/decide with registered domain returns {decision_id, recommendation, confidence}."""
        _register_domain(client)
        resp = client.post(
            "/v1/decide",
            json={
                "domain": "test-domain",
                "task": "choose model",
                "context": {"budget": "high"},
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "decision_id" in data
        assert "recommendation" in data
        assert "confidence" in data
        assert data["domain"] == "test-domain"
        assert data["task"] == "choose model"

    def test_decide_unregistered_404(self, client: TestClient) -> None:
        """POST /v1/decide with unregistered domain returns 404."""
        resp = client.post(
            "/v1/decide",
            json={
                "domain": "no-such-domain",
                "task": "test",
                "context": {},
            },
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# POST /v1/audit
# ---------------------------------------------------------------------------


class TestAuditEndpoint:
    """Tests for POST /v1/audit."""

    def test_audit_returns_recorded(self, client: TestClient) -> None:
        """POST /v1/audit returns {recorded: True, auto_learn_triggered: False}."""
        _register_domain(client)
        resp = client.post(
            "/v1/audit",
            json={
                "domain": "test-domain",
                "decision_id": "dec-123",
                "outcome": "completed",
                "metrics": {"score": 5},
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["recorded"] is True
        assert data["auto_learn_triggered"] is False

    def test_audit_unregistered_404(self, client: TestClient) -> None:
        """POST /v1/audit with unregistered domain returns 404."""
        resp = client.post(
            "/v1/audit",
            json={
                "domain": "no-such-domain",
                "decision_id": "dec-123",
                "outcome": "completed",
                "metrics": {},
            },
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# GET /v1/health
# ---------------------------------------------------------------------------


class TestHealthEndpoint:
    """Tests for GET /v1/health."""

    def test_health_returns_ok(self, client: TestClient) -> None:
        """GET /v1/health returns {status: 'ok', engine: 'hermes-agent'}."""
        resp = client.get("/v1/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["engine"] == "hermes-agent"
