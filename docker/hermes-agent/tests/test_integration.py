"""
End-to-end integration tests with mocked LLM.

Covers:
- Full flow: register -> decide -> audit -> verify audit file -> health shows domain
- Domain isolation: register two domains, decide on one, verify other's memory is empty
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


class TestFullFlow:
    """End-to-end integration test: register -> decide -> audit -> health."""

    def test_full_flow(self, client: TestClient, tmp_hermes_dir: Path) -> None:
        """Register domain -> list domains -> decide -> audit -> verify audit file -> health check."""
        # 1. Register domain
        resp = client.post(
            "/v1/register",
            json={
                "domain": "movie-pipeline",
                "description": "AI short film pipeline",
                "tasks": ["character-design", "video-gen"],
                "skills_manifest": {"drawer": {}, "voicer": {}},
            },
        )
        assert resp.status_code == 201
        assert resp.json()["status"] == "registered"

        # 2. List domains confirms it
        resp = client.get("/v1/domains")
        assert resp.status_code == 200
        assert "movie-pipeline" in resp.json()

        # 3. Decide returns recommendation
        resp = client.post(
            "/v1/decide",
            json={
                "domain": "movie-pipeline",
                "task": "choose-model",
                "context": {"budget": "high", "priority": "quality"},
            },
        )
        assert resp.status_code == 200
        decision = resp.json()
        assert "decision_id" in decision
        assert "recommendation" in decision
        assert decision["confidence"] == 0.0
        assert decision["domain"] == "movie-pipeline"
        decision_id = decision["decision_id"]

        # 4. Audit records it
        resp = client.post(
            "/v1/audit",
            json={
                "domain": "movie-pipeline",
                "decision_id": decision_id,
                "outcome": "completed",
                "metrics": {"user_rating": 4, "latency_ms": 1200},
            },
        )
        assert resp.status_code == 200
        assert resp.json()["recorded"] is True
        assert resp.json()["auto_learn_triggered"] is False

        # 5. Verify audit file exists on disk
        audit_dir = tmp_hermes_dir / "domains" / "movie-pipeline" / "memory"
        assert audit_dir.is_dir()
        audit_files = list(audit_dir.glob("*.json"))
        assert len(audit_files) >= 1

        # Verify the audit file content
        audit_data = json.loads(audit_files[0].read_text())
        assert audit_data["decision_id"] == decision_id
        assert audit_data["outcome"] == "completed"
        assert audit_data["metrics"]["user_rating"] == 4

        # 6. Health shows domain
        resp = client.get("/v1/health")
        assert resp.status_code == 200
        health = resp.json()
        assert health["status"] == "ok"
        assert "movie-pipeline" in health["domains"]
        assert health["domains_count"] >= 1


class TestDomainIsolation:
    """Verify domain isolation (DOMAIN-03)."""

    def test_domain_isolation(
        self, client: TestClient, tmp_hermes_dir: Path
    ) -> None:
        """Register two domains, decide on domain A, verify domain B's memory/ is empty."""
        # Register domain-a
        resp = client.post(
            "/v1/register",
            json={
                "domain": "domain-a",
                "description": "Domain A",
                "tasks": ["task-a1"],
                "skills_manifest": {},
            },
        )
        assert resp.status_code == 201

        # Register domain-b
        resp = client.post(
            "/v1/register",
            json={
                "domain": "domain-b",
                "description": "Domain B",
                "tasks": ["task-b1"],
                "skills_manifest": {},
            },
        )
        assert resp.status_code == 201

        # Decide on domain-a only
        resp = client.post(
            "/v1/decide",
            json={
                "domain": "domain-a",
                "task": "task-a1",
                "context": {"key": "value"},
            },
        )
        assert resp.status_code == 200
        decision = resp.json()
        decision_id = decision["decision_id"]

        # Audit on domain-a only
        resp = client.post(
            "/v1/audit",
            json={
                "domain": "domain-a",
                "decision_id": decision_id,
                "outcome": "completed",
                "metrics": {},
            },
        )
        assert resp.status_code == 200

        # Verify domain-b's memory directory is empty (no files)
        domain_b_memory = tmp_hermes_dir / "domains" / "domain-b" / "memory"
        if domain_b_memory.is_dir():
            files_in_b = list(domain_b_memory.iterdir())
            assert len(files_in_b) == 0, (
                f"Domain B's memory should be empty but found: {files_in_b}"
            )

        # Verify domain-a's memory has the audit file
        domain_a_memory = tmp_hermes_dir / "domains" / "domain-a" / "memory"
        assert domain_a_memory.is_dir()
        files_in_a = list(domain_a_memory.glob("*.json"))
        assert len(files_in_a) >= 1, "Domain A should have at least one audit file"
