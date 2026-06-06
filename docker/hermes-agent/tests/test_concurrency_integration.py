"""
Integration test: Concurrency & mixed load — FR-03.1, FR-03.2, FR-03.6

Validates hermes-agent handles concurrent requests without errors or data corruption.
"""

from __future__ import annotations

import httpx
import pytest
from concurrent.futures import ThreadPoolExecutor, as_completed

from conftest_integration import HERMES_URL, DOMAIN, TASKS


@pytest.fixture(autouse=True, scope="module")
def _register_domain(http_client: httpx.Client):
    http_client.post(
        f"{HERMES_URL}/v1/register",
        json={
            "domain": DOMAIN,
            "description": "Concurrency test domain",
            "tasks": TASKS,
            "skills_manifest": {},
        },
    )


class TestConcurrency:
    """Concurrent request handling."""

    def test_10_concurrent_decides(self):
        """FR-03.1: 10 concurrent decide requests all return 200."""
        results = []

        def decide_task(idx: int) -> dict:
            with httpx.Client(timeout=60.0) as client:
                resp = client.post(
                    f"{HERMES_URL}/v1/decide",
                    json={
                        "domain": DOMAIN,
                        "task": TASKS[idx % len(TASKS)],
                        "context": {"batch_idx": idx},
                    },
                )
                return {"idx": idx, "status": resp.status_code, "data": resp.json() if resp.status_code == 200 else resp.text}

        with ThreadPoolExecutor(max_workers=10) as pool:
            futures = [pool.submit(decide_task, i) for i in range(10)]
            for f in as_completed(futures):
                results.append(f.result())

        assert len(results) == 10
        for r in results:
            assert r["status"] == 200, f"Request {r['idx']} failed: {r.get('data', '')}"
            data = r["data"]
            assert data["decision_id"], f"Missing decision_id for idx={r['idx']}"
            assert data["recommendation"], f"Missing recommendation for idx={r['idx']}"

    def test_20_mixed_decide_audit(self):
        """FR-03.2: 20 mixed decide+audit requests, no data corruption or 500 errors."""
        results = []

        def decide_task(idx: int) -> dict:
            with httpx.Client(timeout=60.0) as client:
                resp = client.post(
                    f"{HERMES_URL}/v1/decide",
                    json={"domain": DOMAIN, "task": "scene", "context": {"idx": idx}},
                )
                return {"type": "decide", "idx": idx, "status": resp.status_code}

        def audit_task(idx: int) -> dict:
            with httpx.Client(timeout=10.0) as client:
                resp = client.post(
                    f"{HERMES_URL}/v1/audit",
                    json={
                        "domain": DOMAIN,
                        "decision_id": f"concurrent-audit-{idx}",
                        "outcome": "completed",
                        "metrics": {"task": "scene", "score": 5, "idx": idx},
                    },
                )
                return {"type": "audit", "idx": idx, "status": resp.status_code}

        with ThreadPoolExecutor(max_workers=20) as pool:
            futures = []
            # 10 decides + 10 audits
            for i in range(10):
                futures.append(pool.submit(decide_task, i))
            for i in range(10):
                futures.append(pool.submit(audit_task, i))

            for f in as_completed(futures):
                results.append(f.result())

        assert len(results) == 20
        for r in results:
            assert r["status"] in (200, 201), (
                f"{r['type']} idx={r['idx']} returned {r['status']}"
            )
            # No 500 errors
            assert r["status"] < 500, (
                f"Server error on {r['type']} idx={r['idx']}: {r['status']}"
            )

    def test_error_requests_dont_affect_normal(self):
        """FR-03.6: Error requests return 4xx, normal requests still work."""
        with httpx.Client(timeout=60.0) as client:
            # Send bad requests
            for _ in range(3):
                resp = client.post(
                    f"{HERMES_URL}/v1/decide",
                    json={"domain": "nonexistent-domain", "task": "bad", "context": {}},
                )
                assert resp.status_code == 404

            # Normal request should still work
            resp = client.post(
                f"{HERMES_URL}/v1/decide",
                json={"domain": DOMAIN, "task": "character", "context": {}},
            )
            assert resp.status_code == 200
            assert resp.json()["decision_id"]
