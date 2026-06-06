"""
Integration test: hermes-client.js audit() with real hermes-agent — FR-02.2

Runs Node.js subprocess that imports hermes-client.js, first decides then audits.
"""

from __future__ import annotations

import json
import os
import subprocess

import httpx
import pytest

from conftest_integration import HERMES_URL, DOMAIN, TASKS

HERMES_CLIENT_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "movie-agent", "lib", "hermes-client.js")
)


@pytest.fixture(autouse=True, scope="module")
def _ensure_client_exists():
    if not os.path.isfile(HERMES_CLIENT_PATH):
        pytest.skip(f"hermes-client.js not found at {HERMES_CLIENT_PATH}")


@pytest.fixture(autouse=True, scope="module")
def _register_domain(http_client: httpx.Client):
    http_client.post(
        f"{HERMES_URL}/v1/register",
        json={
            "domain": DOMAIN,
            "description": "Client audit test",
            "tasks": TASKS,
            "skills_manifest": {},
        },
    )


def _run_node(code: str, url: str = HERMES_URL) -> subprocess.CompletedProcess:
    full_code = (
        "import {decide, audit} from "
        + json.dumps(HERMES_CLIENT_PATH)
        + "; "
        + code
    )
    return subprocess.run(
        ["node", "--input-type=module", "-e", full_code],
        capture_output=True,
        text=True,
        timeout=60,
        env={**os.environ, "HERMES_URL": url},
    )


class TestClientAudit:
    """hermes-client.js audit() against real hermes-agent."""

    def test_audit_after_decide(self):
        """FR-02.2: audit() records feedback for a real decision."""
        node_code = (
            "decide('voice', {}).then(d => { "
            + "  if (d.degraded) { console.log(JSON.stringify({error: 'degraded'})); process.exit(0); } "
            + "  return audit(d.decision_id, 'completed', {task: 'voice', score: 8}); "
            + "}).then(a => { "
            + "  console.log(JSON.stringify(a)); "
            + "}).catch(e => { console.error(e); process.exit(1); })"
        )
        result = _run_node(node_code)
        assert result.returncode == 0, f"Node failed: {result.stderr}"

        data = json.loads(result.stdout.strip())
        if data.get("error") == "degraded":
            pytest.skip("hermes-agent returned degraded — service may be slow")

        assert data.get("recorded") is True, f"Expected recorded=true, got: {data}"
        assert "decision_id" in data

    def test_audit_with_metrics(self):
        """audit() passes metrics through to hermes-agent."""
        node_code = (
            "decide('storyboard', {}).then(d => { "
            + "  if (d.degraded) { console.log(JSON.stringify({error: 'degraded'})); process.exit(0); } "
            + "  return audit(d.decision_id, 'completed', {task: 'storyboard', score: 9, latency_ms: 2500}); "
            + "}).then(a => { "
            + "  console.log(JSON.stringify(a)); "
            + "}).catch(e => { console.error(e); process.exit(1); })"
        )
        result = _run_node(node_code)
        assert result.returncode == 0, f"Node failed: {result.stderr}"

        data = json.loads(result.stdout.strip())
        if data.get("error") == "degraded":
            pytest.skip("hermes-agent returned degraded")

        assert data.get("recorded") is True

    def test_audit_never_throws(self):
        """audit() with invalid decision_id still returns (not throws)."""
        node_code = (
            "audit('invalid-uuid-12345', 'completed', {}).then(a => { "
            + "  console.log(JSON.stringify(a)); "
            + "}).catch(e => { console.error(e); process.exit(1); })"
        )
        result = _run_node(node_code)
        assert result.returncode == 0, f"audit() threw unexpectedly: {result.stderr}"

        data = json.loads(result.stdout.strip())
        # audit may return recorded=false for invalid ID, but it should NOT throw
        assert "recorded" in data
