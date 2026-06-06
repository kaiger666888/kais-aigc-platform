"""
Integration test: Domain isolation — FR-01.8

Validates that operations on one domain do not affect another domain's
memory or skills.
"""

from __future__ import annotations

import httpx
import pytest

from conftest_integration import HERMES_URL


class TestDomainIsolation:
    """Verify domain isolation between independent domains."""

    def test_decide_on_a_does_not_affect_b(
        self, http_client: httpx.Client, decide_client: httpx.Client
    ):
        """Register two domains, decide+audit on A, verify B's memory is empty."""
        # Register domain-a
        resp = http_client.post(
            "/v1/register",
            json={
                "domain": "iso-domain-a",
                "description": "Isolation test A",
                "tasks": ["task-a1"],
                "skills_manifest": {},
            },
        )
        assert resp.status_code == 201

        # Register domain-b
        resp = http_client.post(
            "/v1/register",
            json={
                "domain": "iso-domain-b",
                "description": "Isolation test B",
                "tasks": ["task-b1"],
                "skills_manifest": {},
            },
        )
        assert resp.status_code == 201

        # Decide on domain-a
        resp = decide_client.post(
            "/v1/decide",
            json={"domain": "iso-domain-a", "task": "task-a1", "context": {"key": "val"}},
        )
        assert resp.status_code == 200
        decision_id = resp.json()["decision_id"]

        # Audit on domain-a
        resp = http_client.post(
            "/v1/audit",
            json={
                "domain": "iso-domain-a",
                "decision_id": decision_id,
                "outcome": "completed",
                "metrics": {"task": "task-a1", "score": 7},
            },
        )
        assert resp.status_code == 200

        # Verify domain-a has memory stats
        resp_a = http_client.get("/v1/domains/iso-domain-a/memory")
        assert resp_a.status_code == 200
        stats_a = resp_a.json()
        assert "task-a1" in stats_a["task_stats"]
        assert stats_a["task_stats"]["task-a1"]["record_count"] >= 1

        # Verify domain-b has no memory for task-a1
        resp_b = http_client.get("/v1/domains/iso-domain-b/memory")
        assert resp_b.status_code == 200
        stats_b = resp_b.json()
        # domain-b should NOT have task-a1 in its memory
        assert "task-a1" not in stats_b["task_stats"]
        # domain-b should have no records at all
        assert all(
            s["record_count"] == 0 for s in stats_b["task_stats"].values()
        ), f"Domain B has unexpected records: {stats_b}"

    def test_confidence_isolation(
        self, decide_client: httpx.Client, http_client: httpx.Client
    ):
        """Different domains with different audit scores have different confidence."""
        # Register both
        for name in ["conf-domain-x", "conf-domain-y"]:
            http_client.post(
                "/v1/register",
                json={
                    "domain": name,
                    "description": f"Confidence test {name}",
                    "tasks": ["shared-task"],
                    "skills_manifest": {},
                },
            )

        # Feed low scores to domain-x
        for i in range(5):
            http_client.post(
                "/v1/audit",
                json={
                    "domain": "conf-domain-x",
                    "decision_id": f"x-dec-{i}",
                    "outcome": "completed",
                    "metrics": {"task": "shared-task", "score": 1},
                },
            )

        # Feed high scores to domain-y
        for i in range(5):
            http_client.post(
                "/v1/audit",
                json={
                    "domain": "conf-domain-y",
                    "decision_id": f"y-dec-{i}",
                    "outcome": "completed",
                    "metrics": {"task": "shared-task", "score": 9},
                },
            )

        # Check confidence differs
        resp_x = decide_client.post(
            "/v1/decide",
            json={"domain": "conf-domain-x", "task": "shared-task", "context": {}},
        )
        resp_y = decide_client.post(
            "/v1/decide",
            json={"domain": "conf-domain-y", "task": "shared-task", "context": {}},
        )
        assert resp_x.status_code == 200
        assert resp_y.status_code == 200

        conf_x = resp_x.json()["confidence"]
        conf_y = resp_y.json()["confidence"]
        assert conf_x != conf_y, (
            f"Confidence should differ: x={conf_x} (low scores) vs y={conf_y} (high scores)"
        )
