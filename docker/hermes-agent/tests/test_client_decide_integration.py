"""
Integration test: hermes-client.js decide() with real hermes-agent — FR-02.1, FR-02.3

Runs Node.js subprocess that imports hermes-client.js and calls decide()
against a real running hermes-agent container.
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
    """Ensure movie-pipeline is registered for client tests."""
    http_client.post(
        f"{HERMES_URL}/v1/register",
        json={
            "domain": DOMAIN,
            "description": "Client integration test",
            "tasks": TASKS,
            "skills_manifest": {},
        },
    )


def _run_node_decide(task: str, context: dict, url: str = HERMES_URL) -> subprocess.CompletedProcess:
    node_code = (
        "import {decide} from "
        + json.dumps(HERMES_CLIENT_PATH)
        + "; "
        + f"decide({json.dumps(task)}, {json.dumps(context)}).then(r => {{ "
        + "  console.log(JSON.stringify(r)); "
        + "}).catch(e => { console.error(e); process.exit(1); })"
    )
    return subprocess.run(
        ["node", "--input-type=module", "-e", node_code],
        capture_output=True,
        text=True,
        timeout=60,
        env={**os.environ, "HERMES_URL": url},
    )


class TestClientDecide:
    """hermes-client.js decide() against real hermes-agent."""

    def test_decide_art_direction_non_degraded(self):
        """FR-02.1: decide() returns non-degraded result from real service."""
        result = _run_node_decide("art-direction", {"style": "anime"})
        assert result.returncode == 0, f"Node failed: {result.stderr}"

        data = json.loads(result.stdout.strip())
        assert data.get("degraded") is not True, "Should not be degraded"
        assert data["decision_id"] and isinstance(data["decision_id"], str)
        assert data["recommendation"] and isinstance(data["recommendation"], str)
        assert data["domain"] == DOMAIN
        assert data["task"] == "art-direction"
        assert isinstance(data["confidence"], (int, float))

    def test_decide_all_10_tasks(self):
        """FR-02.3: decide() works for all 10 pipeline tasks."""
        for task in TASKS:
            result = _run_node_decide(task, {})
            assert result.returncode == 0, f"Failed for task={task}: {result.stderr}"

            data = json.loads(result.stdout.strip())
            assert data.get("degraded") is not True, f"Task {task} should not be degraded"
            assert data["decision_id"], f"Missing decision_id for task={task}"
            assert data["recommendation"], f"Missing recommendation for task={task}"
            assert data["task"] == task

    def test_decide_with_context(self):
        """decide() passes context through to hermes-agent."""
        result = _run_node_decide("scene", {"mood": "dramatic", "location": "rooftop"})
        assert result.returncode == 0, f"Node failed: {result.stderr}"

        data = json.loads(result.stdout.strip())
        assert data.get("degraded") is not True
        assert data["task"] == "scene"
