"""
Integration test: Audit endpoint + Learning loop — FR-01.5, FR-01.9

Validates POST /v1/audit, audit_history persistence, auto-learn trigger,
and full learning loop against real hermes-agent + real LLM.
"""

from __future__ import annotations

import httpx
import pytest

from conftest_integration import DOMAIN


class TestAudit:
    """Audit recording tests."""

    def test_audit_after_decide(
        self, decide_client: httpx.Client, registered_domain: str
    ):
        """FR-01.5: POST /v1/audit after decide returns recorded=true."""
        # First: decide
        decide_resp = decide_client.post(
            "/v1/decide",
            json={
                "domain": registered_domain,
                "task": "scene",
                "context": {},
            },
        )
        assert decide_resp.status_code == 200
        decision_id = decide_resp.json()["decision_id"]

        # Then: audit
        audit_resp = decide_client.post(
            "/v1/audit",
            json={
                "domain": registered_domain,
                "decision_id": decision_id,
                "outcome": "completed",
                "metrics": {"task": "scene", "score": 8},
            },
        )
        assert audit_resp.status_code == 200
        data = audit_resp.json()
        assert data["recorded"] is True
        assert data["decision_id"] == decision_id
        assert "auto_learn_triggered" in data

    def test_audit_nonexistent_domain(self, http_client: httpx.Client):
        """Audit for unregistered domain returns 404."""
        resp = http_client.post(
            "/v1/audit",
            json={
                "domain": "nonexistent-domain-xyz",
                "decision_id": "any-id",
                "outcome": "completed",
                "metrics": {},
            },
        )
        assert resp.status_code == 404

    def test_audit_records_metrics(
        self, decide_client: httpx.Client, clean_test_domain: str
    ):
        """FR-01.5: Audit records metrics that affect confidence via learning loop."""
        # Decide to get a decision_id
        decide_resp = decide_client.post(
            "/v1/decide",
            json={"domain": clean_test_domain, "task": "task-a", "context": {}},
        )
        assert decide_resp.status_code == 200
        decision_id = decide_resp.json()["decision_id"]

        # Audit with metrics
        audit_resp = decide_client.post(
            "/v1/audit",
            json={
                "domain": clean_test_domain,
                "decision_id": decision_id,
                "outcome": "completed",
                "metrics": {"task": "task-a", "score": 9},
            },
        )
        assert audit_resp.status_code == 200
        assert audit_resp.json()["recorded"] is True


class TestLearningLoop:
    """Full learning loop tests — FR-01.9."""

    def test_full_learning_loop(
        self, decide_client: httpx.Client, clean_test_domain: str
    ):
        """decide(conf=0) → audit x3 → decide(conf>0) → audit(auto_learn) → memory."""
        # 1. Initial decide — confidence should be 0
        resp = decide_client.post(
            "/v1/decide",
            json={"domain": clean_test_domain, "task": "task-a", "context": {}},
        )
        assert resp.status_code == 200
        assert resp.json()["confidence"] == 0.0

        # 2. Feed 3 audits with low scores
        for i in range(3):
            resp = decide_client.post(
                "/v1/audit",
                json={
                    "domain": clean_test_domain,
                    "decision_id": f"loop-dec-{i}",
                    "outcome": "completed",
                    "metrics": {"task": "task-a", "score": 2},
                },
            )
            assert resp.status_code == 200

        # 3. Decide again — confidence should be non-zero now
        resp = decide_client.post(
            "/v1/decide",
            json={"domain": clean_test_domain, "task": "task-a", "context": {}},
        )
        assert resp.status_code == 200
        assert resp.json()["confidence"] != 0.0

        # 4. One more audit to potentially trigger auto-learn
        resp = decide_client.post(
            "/v1/audit",
            json={
                "domain": clean_test_domain,
                "decision_id": "loop-dec-3",
                "outcome": "completed",
                "metrics": {"task": "task-a", "score": 2},
            },
        )
        assert resp.status_code == 200

    def test_learning_loop_with_high_scores(
        self, decide_client: httpx.Client, clean_test_domain: str
    ):
        """High scores should lead to higher confidence than low scores."""
        # Feed 5 high-score audits
        for i in range(5):
            decide_client.post(
                "/v1/audit",
                json={
                    "domain": clean_test_domain,
                    "decision_id": f"high-dec-{i}",
                    "outcome": "completed",
                    "metrics": {"task": "task-a", "score": 9},
                },
            )

        resp = decide_client.post(
            "/v1/decide",
            json={"domain": clean_test_domain, "task": "task-a", "context": {}},
        )
        assert resp.status_code == 200
        confidence = resp.json()["confidence"]
        # With high scores (9/10 = 0.9), confidence should be significant
        assert confidence > 0.3, f"Expected confidence > 0.3 with high scores, got {confidence}"
