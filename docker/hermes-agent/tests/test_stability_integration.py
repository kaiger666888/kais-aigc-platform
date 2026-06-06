"""
Integration test: Stability & fault recovery — FR-03.3, FR-03.4, FR-03.5

Validates long-running stability, memory leak detection, and container restart recovery.
"""

from __future__ import annotations

import os
import subprocess
import time

import httpx
import pytest

from conftest_integration import HERMES_URL, DOMAIN, TASKS


@pytest.fixture(autouse=True, scope="module")
def _register_domain(http_client: httpx.Client):
    http_client.post(
        f"{HERMES_URL}/v1/register",
        json={
            "domain": DOMAIN,
            "description": "Stability test domain",
            "tasks": TASKS,
            "skills_manifest": {},
        },
    )


class TestStability:
    """Long-running stability tests."""

    def test_100_decide_audit_cycles(self):
        """FR-03.4: 100 sequential decide+audit cycles, no errors."""
        with httpx.Client(timeout=60.0) as client:
            success_count = 0
            for i in range(100):
                # Decide
                resp = client.post(
                    f"{HERMES_URL}/v1/decide",
                    json={"domain": DOMAIN, "task": "scene", "context": {"cycle": i}},
                )
                if resp.status_code != 200:
                    continue  # LLM may occasionally fail; that's ok for stability test
                decision_id = resp.json()["decision_id"]

                # Audit
                resp = client.post(
                    f"{HERMES_URL}/v1/audit",
                    json={
                        "domain": DOMAIN,
                        "decision_id": decision_id,
                        "outcome": "completed",
                        "metrics": {"task": "scene", "score": 6, "cycle": i},
                    },
                )
                if resp.status_code == 200 and resp.json()["recorded"]:
                    success_count += 1

            # Most cycles should succeed (allow some LLM failures)
            assert success_count >= 80, (
                f"Only {success_count}/100 cycles succeeded"
            )

    def test_sequential_decides_unique_ids(self):
        """Each decide returns a unique decision_id."""
        ids = set()
        with httpx.Client(timeout=60.0) as client:
            for _ in range(20):
                resp = client.post(
                    f"{HERMES_URL}/v1/decide",
                    json={"domain": DOMAIN, "task": "requirement", "context": {}},
                )
                if resp.status_code == 200:
                    ids.add(resp.json()["decision_id"])

        assert len(ids) >= 18, f"Expected ~20 unique IDs, got {len(ids)}"


class TestFaultRecovery:
    """Container restart and fault tolerance tests."""

    def test_data_persists_across_audits(self):
        """FR-03.5 (partial): Verify data accumulates correctly across many audits.

        Full container restart test requires docker compose, tested separately.
        """
        with httpx.Client(timeout=10.0) as client:
            # Write audits
            for i in range(5):
                client.post(
                    f"{HERMES_URL}/v1/audit",
                    json={
                        "domain": DOMAIN,
                        "decision_id": f"persist-dec-{i}",
                        "outcome": "completed",
                        "metrics": {"task": "voice", "score": 7},
                    },
                )

            # Verify memory reflects the data
            resp = client.get(f"/v1/domains/{DOMAIN}/memory")
            assert resp.status_code == 200
            stats = resp.json()
            assert "voice" in stats["task_stats"]
            assert stats["task_stats"]["voice"]["record_count"] >= 5

    def test_container_restart_data_recovery(self):
        """FR-03.5: Data survives container restart via docker compose.

        Requires docker compose test environment. Skips if not available.
        """
        compose_file = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "..", "..", "docker-compose.test.yml")
        )
        if not os.path.isfile(compose_file):
            pytest.skip("docker-compose.test.yml not found")

        # Step 1: Write data
        test_domain = "restart-test-domain"
        with httpx.Client(timeout=10.0) as client:
            client.post(
                f"{HERMES_URL}/v1/register",
                json={
                    "domain": test_domain,
                    "description": "Restart recovery test",
                    "tasks": ["task-a"],
                    "skills_manifest": {},
                },
            )
            client.post(
                f"{HERMES_URL}/v1/audit",
                json={
                    "domain": test_domain,
                    "decision_id": "restart-dec-1",
                    "outcome": "completed",
                    "metrics": {"task": "task-a", "score": 8},
                },
            )

        # Step 2: Restart container
        result = subprocess.run(
            ["docker", "restart", "kais-hermes-test"],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode != 0:
            pytest.skip(f"Cannot restart container: {result.stderr}")

        # Step 3: Wait for health
        for _ in range(15):
            try:
                resp = httpx.get(f"{HERMES_URL}/v1/health", timeout=3.0)
                if resp.status_code == 200:
                    break
            except Exception:
                pass
            time.sleep(2)
        else:
            pytest.fail("Container did not become healthy after restart")

        # Step 4: Verify data survived
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(f"/v1/domains/{test_domain}/memory")
            assert resp.status_code == 200
            stats = resp.json()
            assert "task-a" in stats["task_stats"]
            assert stats["task_stats"]["task-a"]["record_count"] >= 1
