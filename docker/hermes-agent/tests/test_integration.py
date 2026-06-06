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


class TestLearningLoop:
    """Integration tests for the full learning loop: decide -> audit -> memory."""

    def test_learning_loop(self, client: TestClient) -> None:
        """Full loop: register -> decide(conf=0) -> audit x3 -> decide(conf!=0) -> audit(auto_learn) -> memory."""
        # 1. Register
        resp = client.post(
            "/v1/register",
            json={
                "domain": "test-domain",
                "description": "Learning loop test",
                "tasks": ["task-a"],
                "skills_manifest": {},
            },
        )
        assert resp.status_code == 201

        # 2. Decide with no history -> confidence 0.0
        resp = client.post(
            "/v1/decide",
            json={"domain": "test-domain", "task": "task-a", "context": {}},
        )
        assert resp.status_code == 200
        assert resp.json()["confidence"] == 0.0

        # 3. Audit x3 with low scores
        for i in range(3):
            resp = client.post(
                "/v1/audit",
                json={
                    "domain": "test-domain",
                    "decision_id": f"dec-{i}",
                    "outcome": "completed",
                    "metrics": {"task": "task-a", "score": 1},
                },
            )
            assert resp.status_code == 200

        # 4. Decide again -> confidence should be non-zero now
        resp = client.post(
            "/v1/decide",
            json={"domain": "test-domain", "task": "task-a", "context": {}},
        )
        assert resp.status_code == 200
        assert resp.json()["confidence"] != 0.0

        # 5. One more audit should trigger auto_learn
        resp = client.post(
            "/v1/audit",
            json={
                "domain": "test-domain",
                "decision_id": "dec-3",
                "outcome": "completed",
                "metrics": {"task": "task-a", "score": 1},
            },
        )
        assert resp.status_code == 200
        assert resp.json()["auto_learn_triggered"] is True

        # 6. Memory endpoint shows stats
        resp = client.get("/v1/domains/test-domain/memory")
        assert resp.status_code == 200
        data = resp.json()
        assert "task-a" in data["task_stats"]
        assert data["task_stats"]["task-a"]["record_count"] >= 4

    def test_learning_loop_domain_isolation(self, client: TestClient) -> None:
        """Domain A low scores, domain B high scores -> different confidence."""
        # Register both domains
        for d in ["domain-a", "domain-b"]:
            client.post(
                "/v1/register",
                json={
                    "domain": d,
                    "description": f"Domain {d}",
                    "tasks": ["shared-task"],
                    "skills_manifest": {},
                },
            )

        # Feed low scores to domain-a
        for i in range(5):
            client.post(
                "/v1/audit",
                json={
                    "domain": "domain-a",
                    "decision_id": f"a-dec-{i}",
                    "outcome": "completed",
                    "metrics": {"task": "shared-task", "score": 1},
                },
            )

        # Feed high scores to domain-b
        for i in range(5):
            client.post(
                "/v1/audit",
                json={
                    "domain": "domain-b",
                    "decision_id": f"b-dec-{i}",
                    "outcome": "completed",
                    "metrics": {"task": "shared-task", "score": 9},
                },
            )

        # Decide on both
        resp_a = client.post(
            "/v1/decide",
            json={"domain": "domain-a", "task": "shared-task", "context": {}},
        )
        resp_b = client.post(
            "/v1/decide",
            json={"domain": "domain-b", "task": "shared-task", "context": {}},
        )

        assert resp_a.json()["confidence"] != resp_b.json()["confidence"]
