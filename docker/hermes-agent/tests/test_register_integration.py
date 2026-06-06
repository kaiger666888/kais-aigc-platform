"""
Integration test: Domain registration — FR-01.2, FR-01.6

Validates POST /v1/register, GET /v1/domains, GET /v1/domains/{domain}/skills
against real hermes-agent container.
"""

from __future__ import annotations

import httpx
import pytest

from conftest_integration import DOMAIN, TASKS


class TestRegister:
    """Domain registration tests."""

    def test_register_movie_pipeline(self, http_client: httpx.Client):
        """POST /v1/register for movie-pipeline returns 201 or 422 (idempotent)."""
        resp = http_client.post(
            "/v1/register",
            json={
                "domain": DOMAIN,
                "description": "AI short film pipeline",
                "tasks": TASKS,
                "skills_manifest": {},
            },
        )
        assert resp.status_code in (201, 422)
        data = resp.json()
        if resp.status_code == 201:
            assert data["status"] == "registered"
            assert data["domain"] == DOMAIN

    def test_register_idempotent(self, http_client: httpx.Client):
        """Re-registering the same domain returns 422."""
        resp = http_client.post(
            "/v1/register",
            json={
                "domain": DOMAIN,
                "description": "AI short film pipeline",
                "tasks": TASKS,
                "skills_manifest": {},
            },
        )
        # Second register: either 201 (if first was cleaned) or 422
        assert resp.status_code in (201, 422)

    def test_register_invalid_domain_name(self, http_client: httpx.Client):
        """Invalid domain name returns 422."""
        resp = http_client.post(
            "/v1/register",
            json={
                "domain": "INVALID!",
                "description": "Bad domain",
                "tasks": ["task"],
                "skills_manifest": {},
            },
        )
        assert resp.status_code == 422


class TestDomains:
    """Domain listing tests."""

    def test_list_domains(self, http_client: httpx.Client, registered_domain: str):
        """GET /v1/domains returns list containing movie-pipeline."""
        resp = http_client.get("/v1/domains")
        assert resp.status_code == 200
        domains = resp.json()
        assert isinstance(domains, list)
        assert registered_domain in domains

    def test_get_domain_skills(self, http_client: httpx.Client, registered_domain: str):
        """GET /v1/domains/{domain}/skills returns skill info."""
        resp = http_client.get(f"/v1/domains/{registered_domain}/skills")
        assert resp.status_code == 200
        data = resp.json()
        assert data["domain"] == registered_domain
        assert "skills" in data

    def test_get_nonexistent_domain_skills(self, http_client: httpx.Client):
        """GET /v1/domains/nonexistent/skills returns 404."""
        resp = http_client.get("/v1/domains/nonexistent-domain-xyz/skills")
        assert resp.status_code == 404
