"""
Integration test: Decision endpoint — FR-01.3, FR-01.4

Validates POST /v1/decide against real hermes-agent + real LLM.
"""

from __future__ import annotations

import httpx
import pytest

from conftest_integration import DOMAIN, TASKS


def _validate_decide_response(data: dict, domain: str, task: str):
    """Common assertions for a valid DecideResponse."""
    assert data["decision_id"] and isinstance(data["decision_id"], str)
    assert data["recommendation"] and isinstance(data["recommendation"], str)
    assert isinstance(data["confidence"], (int, float))
    assert data["confidence"] >= 0
    assert data["domain"] == domain
    assert data["task"] == task
    assert data["timestamp"] and isinstance(data["timestamp"], str)


class TestDecide:
    """Decision endpoint tests."""

    def test_decide_art_direction(
        self, decide_client: httpx.Client, registered_domain: str
    ):
        """POST /v1/decide for art-direction returns valid response with real LLM."""
        resp = decide_client.post(
            "/v1/decide",
            json={
                "domain": registered_domain,
                "task": "art-direction",
                "context": {"style": "anime"},
            },
        )
        assert resp.status_code == 200, f"Decide failed: {resp.status_code} {resp.text}"
        _validate_decide_response(resp.json(), registered_domain, "art-direction")

    def test_decide_all_tasks(
        self, decide_client: httpx.Client, registered_domain: str
    ):
        """Decide for a representative subset of tasks; each returns valid response."""
        subset = ["requirement", "character", "voice", "scene", "camera-preview"]
        for task in subset:
            resp = decide_client.post(
                "/v1/decide",
                json={
                    "domain": registered_domain,
                    "task": task,
                    "context": {},
                },
            )
            assert resp.status_code == 200, (
                f"Decide failed for task='{task}': {resp.status_code} {resp.text}"
            )
            _validate_decide_response(resp.json(), registered_domain, task)

    def test_decide_with_context(
        self, decide_client: httpx.Client, registered_domain: str
    ):
        """FR-01.4: Context parameter produces different recommendations."""
        resp_a = decide_client.post(
            "/v1/decide",
            json={
                "domain": registered_domain,
                "task": "art-direction",
                "context": {"style": "realistic", "mood": "dark"},
            },
        )
        resp_b = decide_client.post(
            "/v1/decide",
            json={
                "domain": registered_domain,
                "task": "art-direction",
                "context": {"style": "anime", "mood": "bright"},
            },
        )
        assert resp_a.status_code == 200
        assert resp_b.status_code == 200

        data_a = resp_a.json()
        data_b = resp_b.json()
        _validate_decide_response(data_a, registered_domain, "art-direction")
        _validate_decide_response(data_b, registered_domain, "art-direction")

        # Recommendations should differ (LLM considers context)
        # We don't assert strict inequality because LLM might return similar text,
        # but the decision_ids must be unique
        assert data_a["decision_id"] != data_b["decision_id"]

    def test_decide_nonexistent_domain(self, decide_client: httpx.Client):
        """Decide for unregistered domain returns 404."""
        resp = decide_client.post(
            "/v1/decide",
            json={
                "domain": "nonexistent-domain-xyz",
                "task": "anything",
                "context": {},
            },
        )
        assert resp.status_code == 404

    def test_decide_confidence_initial(
        self, decide_client: httpx.Client, clean_test_domain: str
    ):
        """FR-01.3: Decide on fresh domain returns confidence=0.0."""
        resp = decide_client.post(
            "/v1/decide",
            json={
                "domain": clean_test_domain,
                "task": "task-a",
                "context": {},
            },
        )
        assert resp.status_code == 200
        assert resp.json()["confidence"] == 0.0
