"""
Shared fixtures for hermes-agent integration tests.

Provides:
- httpx client connected to real hermes-agent container
- Session-scoped health probe (auto-skip if container not running)
- Domain registration/cleanup helpers
"""

from __future__ import annotations

import os
import time

import httpx
import pytest

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

HERMES_URL = os.environ.get("HERMES_URL", "http://localhost:8090")
HEALTH_TIMEOUT = 5.0
DEFAULT_TIMEOUT = 10.0
DECIDE_TIMEOUT = 45.0
AUDIT_TIMEOUT = 10.0


# ---------------------------------------------------------------------------
# Health probe
# ---------------------------------------------------------------------------


def _hermes_is_running() -> bool:
    try:
        resp = httpx.get(f"{HERMES_URL}/v1/health", timeout=HEALTH_TIMEOUT)
        return resp.status_code == 200
    except Exception:
        return False


@pytest.fixture(autouse=True, scope="session")
def _skip_if_no_container():
    if not _hermes_is_running():
        pytest.skip(
            "hermes-agent test container not reachable at " + HERMES_URL,
            allow_module_level=True,
        )


# ---------------------------------------------------------------------------
# HTTP client fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def base_url() -> str:
    return HERMES_URL


@pytest.fixture(scope="session")
def http_client() -> httpx.Client:
    with httpx.Client(timeout=DEFAULT_TIMEOUT) as client:
        yield client


@pytest.fixture(scope="session")
def decide_client() -> httpx.Client:
    with httpx.Client(timeout=DECIDE_TIMEOUT) as client:
        yield client


# ---------------------------------------------------------------------------
# Domain helpers
# ---------------------------------------------------------------------------

DOMAIN = "movie-pipeline"
DESCRIPTION = "AI short film production pipeline - intelligent decision engine"
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


@pytest.fixture(scope="session")
def registered_domain(http_client: httpx.Client) -> str:
    """Ensure movie-pipeline domain is registered (idempotent)."""
    resp = http_client.post(
        f"{HERMES_URL}/v1/register",
        json={
            "domain": DOMAIN,
            "description": DESCRIPTION,
            "tasks": TASKS,
            "skills_manifest": {},
        },
    )
    assert resp.status_code in (201, 422), f"Register failed: {resp.status_code} {resp.text}"
    return DOMAIN


@pytest.fixture()
def clean_test_domain(http_client: httpx.Client):
    """Register a fresh test domain and clean up after test.

    Uses a unique name per test to avoid collisions.
    """
    import uuid

    domain = f"test-{uuid.uuid4().hex[:8]}"
    resp = http_client.post(
        f"{HERMES_URL}/v1/register",
        json={
            "domain": domain,
            "description": "Ephemeral test domain",
            "tasks": ["task-a", "task-b"],
            "skills_manifest": {},
        },
    )
    assert resp.status_code == 201, f"Register clean domain failed: {resp.text}"
    yield domain


# ---------------------------------------------------------------------------
# Utility: wait for domain to appear in domains list
# ---------------------------------------------------------------------------


def wait_for_domain(client: httpx.Client, domain: str, timeout: float = 5.0) -> bool:
    """Poll until domain appears in GET /v1/domains."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        resp = client.get(f"{HERMES_URL}/v1/domains")
        if resp.status_code == 200 and domain in resp.json():
            return True
        time.sleep(0.5)
    return False
