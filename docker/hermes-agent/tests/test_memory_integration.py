"""
Integration test: Memory endpoint — FR-01.7

Validates GET /v1/domains/{domain}/memory returns correct task_stats
and confidence values after audit operations.
"""

from __future__ import annotations

import httpx
import pytest

from conftest_integration import HERMES_URL


class TestMemory:
    """Memory endpoint tests."""

    def test_memory_empty_for_new_domain(
        self, http_client: httpx.Client, clean_test_domain: str
    ):
        """GET /v1/domains/{domain}/memory returns empty stats for fresh domain."""
        resp = http_client.get(f"/v1/domains/{clean_test_domain}/memory")
        assert resp.status_code == 200
        data = resp.json()
        assert "task_stats" in data
        assert "recent_records" in data
        assert isinstance(data["task_stats"], dict)
        assert isinstance(data["recent_records"], list)

    def test_memory_after_audits(
        self, http_client: httpx.Client, clean_test_domain: str
    ):
        """After audits, memory endpoint shows task_stats with confidence."""
        # Feed some audits
        for i in range(4):
            http_client.post(
                "/v1/audit",
                json={
                    "domain": clean_test_domain,
                    "decision_id": f"mem-dec-{i}",
                    "outcome": "completed",
                    "metrics": {"task": "task-a", "score": 7},
                },
            )

        resp = http_client.get(f"/v1/domains/{clean_test_domain}/memory")
        assert resp.status_code == 200
        data = resp.json()

        assert "task-a" in data["task_stats"]
        stats = data["task_stats"]["task-a"]
        assert stats["record_count"] >= 4
        assert isinstance(stats["ewma_confidence"], (int, float))
        assert isinstance(stats["avg_score"], (int, float))
        assert isinstance(stats["trend_direction"], str)

    def test_memory_nonexistent_domain(self, http_client: httpx.Client):
        """GET /v1/domains/nonexistent/memory returns 404."""
        resp = http_client.get("/v1/domains/nonexistent-xyz/memory")
        assert resp.status_code == 404

    def test_memory_recent_records(
        self, http_client: httpx.Client, clean_test_domain: str
    ):
        """recent_records contains the most recent audit entries."""
        for i in range(5):
            http_client.post(
                "/v1/audit",
                json={
                    "domain": clean_test_domain,
                    "decision_id": f"recent-dec-{i}",
                    "outcome": "completed",
                    "metrics": {"task": "task-b", "score": 5},
                },
            )

        resp = http_client.get(f"/v1/domains/{clean_test_domain}/memory")
        assert resp.status_code == 200
        records = resp.json()["recent_records"]
        assert len(records) >= 5
        # Most recent first
        ids = [r["decision_id"] for r in records[:5]]
        assert "recent-dec-4" in ids
