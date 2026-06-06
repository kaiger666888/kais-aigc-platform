"""
Integration test: Health endpoint — FR-01.1

Validates GET /v1/health against real hermes-agent container.
"""

from __future__ import annotations

import httpx
import pytest


def test_health_returns_ok(http_client: httpx.Client):
    """GET /v1/health returns 200 with status=ok and engine=hermes-agent."""
    resp = http_client.get("/v1/health")
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    data = resp.json()
    assert data["status"] == "ok"
    assert data["engine"] == "hermes-agent"


def test_health_has_domain_fields(http_client: httpx.Client):
    """Health response includes domains_count (int) and domains (list)."""
    resp = http_client.get("/v1/health")
    assert resp.status_code == 200

    data = resp.json()
    assert "domains_count" in data and isinstance(data["domains_count"], int)
    assert "domains" in data and isinstance(data["domains"], list)
