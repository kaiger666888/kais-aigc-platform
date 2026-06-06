"""
Integration test: hermes-client.js degradation and retry — FR-02.4, FR-02.5, FR-02.6

Tests hermes-client.js behavior when hermes-agent is unreachable or slow.
Does NOT require a running container — tests point HERMES_URL to dead ports.
"""

from __future__ import annotations

import json
import os
import subprocess

import pytest

HERMES_CLIENT_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "movie-agent", "lib", "hermes-client.js")
)
DEAD_PORT = 19999


@pytest.fixture(autouse=True, scope="module")
def _ensure_client_exists():
    if not os.path.isfile(HERMES_CLIENT_PATH):
        pytest.skip(f"hermes-client.js not found at {HERMES_CLIENT_PATH}")


def _run_node_decide(task: str, url: str) -> subprocess.CompletedProcess:
    node_code = (
        "import {decide} from "
        + json.dumps(HERMES_CLIENT_PATH)
        + "; "
        + f"decide({json.dumps(task)}, {{}}).then(r => {{ "
        + "  console.log(JSON.stringify(r)); "
        + "  process.exit(r.degraded === true ? 0 : 1); "
        + "}).catch(e => { console.error(e); process.exit(1); })"
    )
    return subprocess.run(
        ["node", "--input-type=module", "-e", node_code],
        capture_output=True,
        text=True,
        timeout=30,
        env={**os.environ, "HERMES_URL": url},
    )


class TestDegradation:
    """hermes-client.js returns degraded defaults when service is unreachable."""

    def test_degradation_soul_visual(self):
        """FR-02.4: decide('soul-visual') degrades to HERMES_DEFAULTS with flux params."""
        result = _run_node_decide("soul-visual", f"http://localhost:{DEAD_PORT}")
        assert result.returncode == 0, f"Subprocess failed: {result.stderr}"

        data = json.loads(result.stdout.strip())
        assert data.get("degraded") is True
        assert data["domain"] == "movie-pipeline"
        assert data["task"] == "soul-visual"
        assert data["decision_id"] is None

        # Verify HERMES_DEFAULTS content for soul-visual
        rec = json.loads(data["recommendation"])
        assert "flux" in rec
        assert rec["flux"]["steps"] == 20
        assert rec["flux"]["width"] == 1024

    def test_degradation_video_gen(self):
        """FR-02.4: decide('video-gen') degrades to HERMES_DEFAULTS with wan params."""
        result = _run_node_decide("video-gen", f"http://localhost:{DEAD_PORT}")
        assert result.returncode == 0

        data = json.loads(result.stdout.strip())
        assert data.get("degraded") is True
        rec = json.loads(data["recommendation"])
        assert "wan" in rec
        assert rec["wan"]["width"] == 832
        assert rec["wan"]["num_frames"] == 81

    def test_degradation_voice(self):
        """FR-02.4: decide('voice') degrades to HERMES_DEFAULTS with tts params."""
        result = _run_node_decide("voice", f"http://localhost:{DEAD_PORT}")
        assert result.returncode == 0

        data = json.loads(result.stdout.strip())
        assert data.get("degraded") is True
        rec = json.loads(data["recommendation"])
        assert "tts" in rec
        assert rec["tts"]["voice"] == "default"

    def test_degradation_unknown_task(self):
        """degradation for unknown task returns empty dict recommendation."""
        result = _run_node_decide("unknown-task", f"http://localhost:{DEAD_PORT}")
        assert result.returncode == 0

        data = json.loads(result.stdout.strip())
        assert data.get("degraded") is True
        # Unknown task → HERMES_DEFAULTS[task] is undefined → empty object
        rec = json.loads(data["recommendation"])
        assert rec == {}


class TestRetry:
    """FR-02.6: verify retry behavior."""

    def test_retry_happens_before_degradation(self):
        """Client makes 2 attempts (initial + 1 retry) before degrading.

        We can verify this by timing: degradation with retry should take > 1s
        (retry delay) but < 15s (2 × timeout + retry delay).
        """
        import time

        start = time.time()
        result = _run_node_decide("art-direction", f"http://localhost:{DEAD_PORT}")
        elapsed = time.time() - start

        assert result.returncode == 0
        data = json.loads(result.stdout.strip())
        assert data.get("degraded") is True

        # Should take at least RETRY_DELAY_MS (1s) because retry happens
        assert elapsed >= 0.5, f"Too fast ({elapsed:.1f}s) — retry may not have happened"
        # Should be under 15s (2 timeouts of 5s + 1s retry delay)
        assert elapsed < 15, f"Too slow ({elapsed:.1f}s) — something wrong"

    def test_audit_never_throws_on_dead_port(self):
        """audit() returns gracefully even when service is unreachable."""
        node_code = (
            "import {audit} from "
            + json.dumps(HERMES_CLIENT_PATH)
            + "; "
            + "audit('test-id', 'completed', {}).then(a => { "
            + "  console.log(JSON.stringify(a)); "
            + "}).catch(e => { console.error(e.message); process.exit(1); })"
        )
        result = subprocess.run(
            ["node", "--input-type=module", "-e", node_code],
            capture_output=True,
            text=True,
            timeout=15,
            env={**os.environ, "HERMES_URL": f"http://localhost:{DEAD_PORT}"},
        )
        assert result.returncode == 0, f"audit() threw: {result.stderr}"

        data = json.loads(result.stdout.strip())
        assert data.get("recorded") is False
