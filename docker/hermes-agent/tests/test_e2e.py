"""
End-to-end tests for hermes-agent Docker container + hermes-client.js integration.

Validates against a REAL running hermes-agent container (not TestClient mock).
Tests connect to HERMES_URL (default http://localhost:8080).

Prerequisites:
  - hermes-agent container running on HERMES_URL
  - movie-pipeline domain may or may not be registered (tests handle registration)

Run:
  cd docker/hermes-agent && python3 -m pytest tests/test_e2e.py -v
"""

from __future__ import annotations

import json
import os
import subprocess

import httpx
import pytest

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

HERMES_URL = os.environ.get("HERMES_URL", "http://localhost:8080")
DOMAIN = "movie-pipeline"

# 10 pipeline tasks from register_movie_pipeline.py
TASKS = [
    "requirement",
    "art-direction",
    "character",
    "scenario",
    "voice",
    "storyboard",
    "scene",
    "camera-preview",
    "camera-final",
    "post-production",
]

# Timeouts: generous for LLM latency
DECIDE_TIMEOUT = 30.0
AUDIT_TIMEOUT = 10.0
DEFAULT_TIMEOUT = 10.0

DESCRIPTION = "AI short film production pipeline - intelligent decision engine"


# ---------------------------------------------------------------------------
# Session-scoped health probe: skip all E2E tests if container not running
# ---------------------------------------------------------------------------


def _hermes_is_running() -> bool:
    """Check whether hermes-agent container is reachable."""
    try:
        resp = httpx.get(f"{HERMES_URL}/v1/health", timeout=3.0)
        return resp.status_code == 200
    except Exception:
        return False


@pytest.fixture(autouse=True, scope="session")
def _skip_if_no_container():
    """Auto-skip all tests in this module when hermes-agent is not running.

    This ensures `python -m pytest tests/ -x -q` still passes even when
    the Docker container is not available. E2E tests are only executed
    when the container is reachable.
    """
    if not _hermes_is_running():
        pytest.skip(
            "hermes-agent container not reachable at " + HERMES_URL,
            allow_module_level=True,
        )


# ---------------------------------------------------------------------------
# Test 1: Health check
# ---------------------------------------------------------------------------


def test_health():
    """GET /v1/health returns 200 with status=ok and engine=hermes-agent."""
    resp = httpx.get(f"{HERMES_URL}/v1/health", timeout=DEFAULT_TIMEOUT)
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    data = resp.json()
    assert data["status"] == "ok", f"Expected status='ok', got '{data.get('status')}'"
    assert data["engine"] == "hermes-agent", (
        f"Expected engine='hermes-agent', got '{data.get('engine')}'"
    )
    assert "domains_count" in data, "Missing 'domains_count' in health response"
    assert isinstance(data["domains_count"], int), "domains_count should be an integer"
    assert isinstance(data["domains"], list), "'domains' should be a list"


# ---------------------------------------------------------------------------
# Test 2: Idempotent domain registration
# ---------------------------------------------------------------------------


def test_register_movie_pipeline_if_needed():
    """Register movie-pipeline domain (idempotent: accepts 201 or 422).

    Then verify GET /v1/domains includes 'movie-pipeline'.
    """
    resp = httpx.post(
        f"{HERMES_URL}/v1/register",
        json={
            "domain": DOMAIN,
            "description": DESCRIPTION,
            "tasks": TASKS,
        },
        timeout=DEFAULT_TIMEOUT,
    )

    assert resp.status_code in (201, 422), (
        f"Expected 201 or 422, got {resp.status_code}: {resp.text}"
    )

    if resp.status_code == 201:
        data = resp.json()
        assert data["domain"] == DOMAIN
        assert data["status"] == "registered"

    # Verify domain appears in domain list
    domains_resp = httpx.get(f"{HERMES_URL}/v1/domains", timeout=DEFAULT_TIMEOUT)
    assert domains_resp.status_code == 200
    domains = domains_resp.json()
    assert DOMAIN in domains, f"Domain '{DOMAIN}' not found in: {domains}"


# ---------------------------------------------------------------------------
# Test 3: Decide for art-direction task
# ---------------------------------------------------------------------------


def test_decide_art_direction():
    """POST /v1/decide for art-direction returns valid DecideResponse."""
    resp = httpx.post(
        f"{HERMES_URL}/v1/decide",
        json={
            "domain": DOMAIN,
            "task": "art-direction",
            "context": {"style": "anime"},
        },
        timeout=DECIDE_TIMEOUT,
    )
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    data = resp.json()
    assert "decision_id" in data and isinstance(data["decision_id"], str) and data["decision_id"], (
        f"decision_id must be a non-empty string, got: {data.get('decision_id')}"
    )
    assert "recommendation" in data and isinstance(data["recommendation"], str) and data["recommendation"], (
        f"recommendation must be a non-empty string, got: {data.get('recommendation')}"
    )
    assert "confidence" in data and isinstance(data["confidence"], (int, float)) and data["confidence"] >= 0, (
        f"confidence must be a non-negative number, got: {data.get('confidence')}"
    )
    assert data["domain"] == DOMAIN, f"Expected domain='{DOMAIN}', got '{data.get('domain')}'"
    assert data["task"] == "art-direction", f"Expected task='art-direction', got '{data.get('task')}'"
    assert "timestamp" in data, "Missing 'timestamp' in decide response"


# ---------------------------------------------------------------------------
# Test 4: Audit after decide
# ---------------------------------------------------------------------------


def test_audit_after_decide():
    """POST /v1/decide for scene, then POST /v1/audit returns recorded=true."""
    # First: decide
    decide_resp = httpx.post(
        f"{HERMES_URL}/v1/decide",
        json={
            "domain": DOMAIN,
            "task": "scene",
            "context": {},
        },
        timeout=DECIDE_TIMEOUT,
    )
    assert decide_resp.status_code == 200, (
        f"Decide failed: {decide_resp.status_code}: {decide_resp.text}"
    )
    decision_id = decide_resp.json()["decision_id"]

    # Then: audit
    audit_resp = httpx.post(
        f"{HERMES_URL}/v1/audit",
        json={
            "domain": DOMAIN,
            "decision_id": decision_id,
            "outcome": "completed",
            "metrics": {"task": "scene", "score": 8},
        },
        timeout=AUDIT_TIMEOUT,
    )
    assert audit_resp.status_code == 200, (
        f"Expected 200, got {audit_resp.status_code}: {audit_resp.text}"
    )

    data = audit_resp.json()
    assert data["recorded"] is True, f"Expected recorded=True, got {data.get('recorded')}"
    assert "auto_learn_triggered" in data, "Missing 'auto_learn_triggered' in audit response"
    assert data["decision_id"] == decision_id, (
        f"decision_id mismatch: sent={decision_id}, got={data.get('decision_id')}"
    )


# ---------------------------------------------------------------------------
# Test 5: Decide across multiple tasks
# ---------------------------------------------------------------------------


def test_decide_all_tasks():
    """Decide for a representative subset of tasks; each returns valid response."""
    subset = ["art-direction", "storyboard", "camera-preview"]

    for task in subset:
        resp = httpx.post(
            f"{HERMES_URL}/v1/decide",
            json={
                "domain": DOMAIN,
                "task": task,
                "context": {},
            },
            timeout=DECIDE_TIMEOUT,
        )
        assert resp.status_code == 200, (
            f"Decide failed for task='{task}': {resp.status_code}: {resp.text}"
        )

        data = resp.json()
        assert data["decision_id"], f"Empty decision_id for task='{task}'"
        assert data["recommendation"], f"Empty recommendation for task='{task}'"
        assert isinstance(data["confidence"], (int, float)), (
            f"Invalid confidence for task='{task}': {data.get('confidence')}"
        )
        assert data["domain"] == DOMAIN, f"Wrong domain for task='{task}'"
        assert data["task"] == task, f"Wrong task in response: expected='{task}', got='{data.get('task')}'"


# ---------------------------------------------------------------------------
# Test 6: hermes-client.js degradation (dead port)
# ---------------------------------------------------------------------------


def test_client_degradation():
    """hermes-client.js returns degraded=true when hermes-agent is unreachable.

    Runs a node subprocess that imports hermes-client.js with HERMES_URL pointing
    to a dead port (19999). Verifies the subprocess exits 0 and output contains
    a degradation marker.
    """
    # Resolve path to hermes-client.js (in docker/movie-agent/lib/)
    hermes_client_path = os.path.join(
        os.path.dirname(__file__),
        "..",
        "..",
        "movie-agent",
        "lib",
        "hermes-client.js",
    )
    hermes_client_path = os.path.abspath(hermes_client_path)

    if not os.path.isfile(hermes_client_path):
        pytest.skip(f"hermes-client.js not found at {hermes_client_path}")

    node_code = (
        "import {decide} from "
        + json.dumps(hermes_client_path)
        + "; "
        + "decide('soul-visual', {}).then(r => { "
        + "  console.log(JSON.stringify(r)); "
        + "  process.exit(r.degraded === true ? 0 : 1); "
        + "}).catch(e => { console.error(e); process.exit(1); })"
    )

    result = subprocess.run(
        ["node", "--input-type=module", "-e", node_code],
        capture_output=True,
        text=True,
        timeout=30,
        env={**os.environ, "HERMES_URL": "http://localhost:19999"},
    )

    assert result.returncode == 0, (
        f"Subprocess exited {result.returncode}. stderr: {result.stderr}. stdout: {result.stdout}"
    )

    output = result.stdout.strip()
    assert "degraded" in output, (
        f"Expected 'degraded' in output, got: {output}"
    )

    # Parse the JSON and verify structure
    data = json.loads(output)
    assert data.get("degraded") is True, f"Expected degraded=true, got: {data}"
    assert data.get("domain") == DOMAIN, f"Expected domain='{DOMAIN}', got: {data.get('domain')}"
    assert data.get("task") == "soul-visual", f"Expected task='soul-visual', got: {data.get('task')}"
