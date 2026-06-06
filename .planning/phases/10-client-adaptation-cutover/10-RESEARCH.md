# Phase 10: Client Adaptation & Cutover - Research

**Researched:** 2026-06-06
**Domain:** Client integration (Node.js -> Python FastAPI), Docker deployment, service migration
**Confidence:** HIGH

## Summary

Phase 10 connects the existing kais-movie-agent (Node.js) to the new hermes-agent FastAPI service (Python) built in Phases 7-9. The core deliverable is a single file `hermes-client.js` that calls `POST /v1/decide` and `POST /v1/audit` with graceful degradation to hardcoded `HERMES_DEFAULTS`. The phase also adds the hermes-agent container to `docker-compose.v9.yml`, documents the old hermes-worker-agent retirement, and runs end-to-end validation.

The API contract is fully implemented and tested (routes.py, models.py, decision_engine.py from Phase 7-9). The movie-agent pattern is established (gold-team-client.js). The old hermes-worker-agent (Node.js :3100) was never deployed to Docker -- it is a separate project at `~/.openclaw/workspace/hermes-worker-agent/` that needs only documentation-level retirement.

**Primary recommendation:** Follow the gold-team-client.js pattern exactly for hermes-client.js (class-based HTTP client with timeout + degraded fallback). The hermes-agent Dockerfile is minimal (python:3.11-slim + pip install + uvicorn). No new external packages needed for movie-agent (native fetch).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Hermes Client Design:** Single-file hermes-client.js, exports async functions (decide, audit) -- consistent with gold-team-client.js pattern
- **HERMES_DEFAULTS:** Embedded in hermes-client.js, grouped by task (soul-visual, video-gen, voice) -- zero external deps, always available
- **Timeout/retry:** 5s timeout, 1 retry with 1s delay -- fast degradation, pipeline never blocks
- **Domain:** Hardcoded "movie-pipeline" -- only current domain, avoids config complexity
- **Integration Points:** 7 pipeline phases with review call hermes decide: art-direction, character, scenario, storyboard, scene, camera-preview, camera-final
- **Phase handler import:** Each handler explicitly imports hermes-client -- traceable, no global interception
- **Audit after each phase:** After task completion, call /v1/audit with pass/fail + metrics to drive learning loop
- **Decide context:** Phase-specific: current params, prior results, style preferences
- **Deployment:** hermes-agent joins docker-compose.v9.yml alongside gold-team, core-backend
- **Old service:** hermes-worker-agent (Node.js :3100) never deployed to Docker, only needs documentation
- **Health check:** GET /v1/health, stateless service, movie-agent can optionally depend on hermes-agent healthy
- **Dockerfile:** Minimal Python Dockerfile -- pip install requirements + uvicorn main, no GPU
- **Testing:** Unit test hermes-client.js (mock HTTP) + integration test script against real hermes-agent Docker container
- **E2E script:** Register movie-pipeline domain -> each task decide -> verify response -> audit -> check memory stats
- **Unit test mock ECONNREFUSED** to verify degradation to HERMES_DEFAULTS
- **Docker docs check:** Confirm no old :3100 port references in docker-compose, update docs

### Claude's Discretion
- hermes-client.js specific error log format
- Dockerfile Python base image version selection
- Test file organization

### Deferred Ideas (OUT OF SCOPE)
- hermes-adapter.js (LLM routing) stays unchanged -- CLIENT-03 explicitly does not depend on new service
- Fully automated pipeline run validation -- beyond Phase 10 scope, needs complete GPU environment
- WebSocket real-time decision push -- v2 feature
- Batch decision interface -- v2 feature
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CLIENT-01 | hermes-client.js calls /v1/decide and /v1/audit with domain field | API models verified in models.py (DecideRequest/AuditRequest both require `domain`), gold-team-client.js pattern documented |
| CLIENT-02 | Graceful degradation to HERMES_DEFAULTS when hermes unavailable | SEED_MEMORY in register_movie_pipeline.py provides exact default values, gold-team-client.js submitTaskDegraded() shows pattern |
| CLIENT-03 | hermes-adapter.js (LLM routing) unchanged, no dependency on new hermes | Verified: no hermes-adapter.js or hermes-client.js exists in movie-agent codebase yet, hermes-adapter is out of scope |
| REPLACE-01 | New hermes wrapper service on :8080 replaces old kais-hermes Decision API | config.py confirms PORT=8080 default, Dockerfile needed at docker/hermes-agent/Dockerfile |
| REPLACE-02 | Stop hermes-worker-agent.service (Node.js :3100) | Old service is external project (~/.openclaw/workspace/hermes-worker-agent/), never in Docker, needs documentation only |
| REPLACE-03 | New systemd unit or Docker container deploys hermes-agent wrapper | Docker approach chosen: add to docker-compose.v9.yml, no systemd needed |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| HTTP client (decide/audit) | movie-agent (Node.js) | -- | Client runs inside movie-agent process, calls hermes-agent |
| Decision API serving | hermes-agent (Python/FastAPI) | -- | FastAPI service on :8080, stateless |
| Degradation/fallback logic | movie-agent (hermes-client.js) | -- | HERMES_DEFAULTS embedded in client, no server dependency |
| Docker orchestration | docker-compose.v9.yml | -- | Container lifecycle, health checks, networking |
| Service retirement documentation | docs/ | -- | Old hermes-worker-agent is external, documentation only |
| E2E test orchestration | hermes-agent tests/ | -- | pytest against real Docker container |

## Standard Stack

### Core (hermes-agent -- already installed from Phase 7)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| fastapi | 0.136.1 | REST API framework | [VERIFIED: pip registry] Already installed, API routes built |
| uvicorn | 0.46.0 | ASGI server | [VERIFIED: pip registry] Already installed, serves FastAPI app |
| pydantic | 2.13.4 | Request/response validation | [VERIFIED: pip registry] Already installed, models.py uses BaseModel |
| hermes-agent | 0.15.1 | NousResearch agent library | [VERIFIED: pip registry] Already installed, provides AIAgent |

### Supporting (hermes-agent test suite -- already installed)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pytest | 7.x+ | Test framework | All hermes-agent tests |
| pytest-asyncio | 0.21+ | Async test support | FastAPI async endpoints |
| httpx | 0.24+ | HTTP client for TestClient | FastAPI TestClient backend |

### movie-agent side (zero new dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| native fetch | Node.js 20+ built-in | HTTP client | [VERIFIED: `typeof fetch === 'function'` in Node 24.13.0] Zero deps |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| native fetch | node-fetch / axios | Unnecessary -- Node 20+ has native fetch, movie-agent Dockerfile uses node:20-slim |
| Class-based client | Function-only exports | CONTEXT.md says "exports async functions" but gold-team-client.js is class-based; follow class pattern for consistency, export convenience functions |

**Installation:**
No new npm packages needed. Python packages already installed from Phase 7-9.
Dockerfile `pip install -r requirements.txt` handles hermes-agent container.

**Version verification:**
```
fastapi==0.136.1        [VERIFIED: pip show]
uvicorn==0.46.0         [VERIFIED: pip show]
pydantic==2.13.4        [VERIFIED: pip show]
hermes-agent==0.15.1    [VERIFIED: pip show]
node --version = v24.13.0  [VERIFIED: runtime check]
```

## Package Legitimacy Audit

> All packages in this phase were installed in earlier phases (7-9). No new packages added.
> hermes-client.js uses zero external npm dependencies (native fetch only).

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| fastapi | PyPI | 5+ yrs | 50M+/mo | github.com/fastapi/fastapi | N/A (pre-installed) | Approved |
| uvicorn | PyPI | 6+ yrs | 40M+/mo | github.com/encode/uvicorn | N/A (pre-installed) | Approved |
| pydantic | PyPI | 6+ yrs | 100M+/mo | github.com/pydantic/pydantic | N/A (pre-installed) | Approved |
| hermes-agent | PyPI | 6+ mo | low | NousResearch/hermes-agent | N/A (pre-installed) | Approved (verified source repo) |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

*All packages were installed and verified in Phases 7-9. Phase 10 adds zero new external packages.*

## Architecture Patterns

### System Architecture Diagram

```
                    docker-compose.v9.yml (kais-net bridge)
                    ========================================
                    
  movie-agent (:8001)                    hermes-agent (:8080)
  +-------------------------+            +-------------------------+
  |                         |            |                         |
  | Phase handlers          |            | FastAPI /v1 routes      |
  | (art-direction, etc.)   |            |                         |
  |         |               |            | POST /v1/decide         |
  |         v               |  HTTP      |   <- {domain, task, ctx}|
  | hermes-client.js  ------+----------->+   -> {decision_id,      |
  | (decide/audit funcs)    |   5s/1r    |       recommendation,   |
  |         |               |            |       confidence}       |
  |  HERMES_DEFAULTS        |            |                         |
  |  (fallback if down)     |  HTTP      | POST /v1/audit          |
  |                         |<-----------+   <- {domain, decision_id|
  | gold-team-client.js     |            |       outcome, metrics} |
  | (existing, unchanged)   |            |   -> {recorded,         |
  |                         |            |       auto_learn}       |
  +-------------------------+            |                         |
                                         | GET /v1/health          |
                                         |   -> {status, engine,   |
                                         |       domains_count}    |
                                         |                         |
                                         +-------------------------+
                                                    |
                                                    | file I/O
                                                    v
                                         ~/.hermes/domains/
                                           movie-pipeline/
                                             skills/ (14 files)
                                             memory/ (audit_history.json)
                                             SOUL.md
```

### Recommended Project Structure
```
docker/movie-agent/lib/
  hermes-client.js          # NEW -- hermes HTTP client + HERMES_DEFAULTS
  gold-team-client.js       # EXISTING -- pattern reference
  pipeline.js               # EXISTING -- PHASES array (no changes)
  phases/index.js           # EXISTING -- phase handlers (add imports later)

docker/hermes-agent/
  Dockerfile                # NEW -- minimal Python container
  requirements.txt          # EXISTING -- fastapi, uvicorn, pydantic, hermes-agent
  src/
    main.py                 # EXISTING -- FastAPI app entry
    config.py               # EXISTING -- PORT=8080, LLM settings
    api/
      routes.py             # EXISTING -- /v1/decide, /v1/audit, /v1/health
      models.py             # EXISTING -- Pydantic models
      deps.py               # EXISTING -- dependency injection
    core/
      decision_engine.py    # EXISTING -- decide + audit logic
      domain_registry.py    # EXISTING -- domain CRUD
      domain_memory.py      # EXISTING -- memory aggregation
  tests/
    test_e2e.py             # NEW -- end-to-end validation against Docker container

docker-compose.v9.yml       # MODIFY -- add hermes-agent service
```

### Pattern 1: HTTP Client with Degraded Fallback (gold-team-client.js pattern)
**What:** Class-based HTTP client with `submitTaskDegraded()` that catches errors and returns fallback result.
**When to use:** For hermes-client.js decide() and audit() -- same pattern.
**Example:**
```javascript
// Source: docker/movie-agent/lib/gold-team-client.js lines 168-181
async submitTaskDegraded(options) {
  try {
    return await this.submitTask(options);
  } catch (err) {
    console.warn(`[GoldTeamClient] GPU service unavailable, degrading: ${err.message}`);
    this._logDegraded({ taskType: options.taskType, reason: err.message });
    return {
      taskId: null,
      state: 'DEGRADED_SKIPPED',
      degraded: true,
      reason: err.message,
    };
  }
}
```

### Pattern 2: hermes-client.js Decide/Audit API Contract
**What:** Exact request/response shapes for the two endpoints hermes-client.js calls.
**When to use:** When implementing decide() and audit() in hermes-client.js.
**Example:**
```javascript
// Source: docker/hermes-agent/src/api/models.py (verified)

// POST /v1/decide request body:
const decideBody = {
  domain: "movie-pipeline",  // required, max 64 chars
  task: "art-direction",     // required, max 200 chars
  context: {                 // optional, default {}
    current_params: { flux: { steps: 20, guidance_scale: 3.5 } },
    prior_results: "...",
    style_preference: "..."
  }
};

// POST /v1/decide response (200):
// {
//   decision_id: "uuid-string",
//   recommendation: "LLM-generated text",
//   confidence: 0.75,           // float from EWMA
//   domain: "movie-pipeline",
//   task: "art-direction",
//   timestamp: "2026-06-06T12:00:00+00:00"
// }

// POST /v1/audit request body:
const auditBody = {
  domain: "movie-pipeline",       // required
  decision_id: "uuid-from-decide", // required, max 64 chars
  outcome: "completed",           // default "completed", max 50 chars
  metrics: {                      // optional, default {}
    task: "art-direction",
    score: 8,
    params_used: { flux: { steps: 20 } }
  }
};

// POST /v1/audit response (200):
// {
//   recorded: true,
//   auto_learn_triggered: false,
//   decision_id: "uuid-string"
// }

// Error responses:
// 404: { detail: "Domain 'xxx' not registered" }
// 422: { detail: "validation error message" }
// 502: { detail: "Decision engine error" }
```

### Pattern 3: Docker Service Integration
**What:** How to add hermes-agent to docker-compose.v9.yml following existing conventions.
**When to use:** When writing the hermes-agent service entry.
**Example:**
```yaml
# Pattern from docker-compose.v9.yml -- all services follow this structure:
# - container_name: kais-{name}
# - restart: unless-stopped
# - networks: [kais-net]
# - healthcheck with interval/timeout/retries/start_period
# - env_file: .env (for LLM keys)
# - No GPU needed for hermes-agent (CPU-only service)

hermes-agent:
  build:
    context: ./docker/hermes-agent
    dockerfile: Dockerfile
  container_name: kais-hermes-agent
  restart: unless-stopped
  ports:
    - "127.0.0.1:${HERMES_PORT:-8080}:8080"
  env_file: .env
  environment:
    PORT: 8080
    LLM_API_KEY: ${LLM_API_KEY:-}
    LLM_BASE_URL: ${LLM_BASE_URL:-https://open.bigmodel.cn/api/paas/v4}
    HERMES_HOME: /app/data
  volumes:
    - hermes-data:/app/data
  networks:
    - kais-net
  healthcheck:
    test: ["CMD", "python3", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8080/v1/health')"]
    interval: 30s
    timeout: 10s
    retries: 3
    start_period: 30s
```

### Anti-Patterns to Avoid
- **Don't use axios or node-fetch:** movie-agent uses native fetch (Node 20+), no npm dependencies. [VERIFIED: movie-agent Dockerfile uses node:20-slim, `typeof fetch === 'function'`]
- **Don't add hermes-agent as depends_on for movie-agent:** Hermes is optional (degradation supported). movie-agent should start even if hermes is down.
- **Don't use HERMES_URL as a required env var:** gold-team-client.js falls back to default URLs from env vars with hardcoded defaults. Follow same pattern.
- **Don't create a global interceptor or middleware:** CONTEXT.md says "each phase handler explicitly imports hermes-client" -- no global interception.
- **Don't change pipeline.js or phase handler signatures:** CONTEXT.md: "movie-agent pipeline code zero changes, only hermes-client.js API paths"

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP timeout/retry | Custom setTimeout + retry loop | AbortSignal.timeout(5000) + simple try/catch with 1 retry | Native API, gold-team-client.js already uses AbortSignal.timeout |
| JSON validation | Manual type checking | Trust FastAPI Pydantic validation (server-side) | Server validates; client trusts or degrades |
| Domain registration from client | Registration endpoint call in hermes-client.js | register_movie_pipeline.py (pre-existing) | Registration is a one-time admin action, not per-request |
| Health monitoring | Custom ping loop | Docker healthcheck + GET /v1/health | Docker-native, consistent with all other services |

**Key insight:** hermes-client.js is a thin HTTP wrapper with fallback. The server does all validation and business logic. The client's only job is call-or-degrade.

## Runtime State Inventory

> Phase 10 is partially a migration phase (replacing old hermes-worker-agent). Runtime state audit follows.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| **Stored data** | ~/.hermes/domains/movie-pipeline/ (skills, memory, SOUL.md) -- created by Phase 9 registration script | None -- hermes-agent Docker mounts this via volume; must ensure HERMES_HOME path is consistent between registration script and container |
| **Live service config** | Old hermes-worker-agent at ~/.openclaw/workspace/hermes-worker-agent/ (Node.js project, never Dockerized) | Documentation only -- record migration notes, no data migration needed |
| **OS-registered state** | None found -- no systemd .service files in repo, old hermes-worker-agent runs via pm2 or manual `node index.js` per docs | Verify old process not running; document stop command |
| **Secrets/env vars** | LLM_API_KEY, LLM_BASE_URL needed by hermes-agent (already in .env for other services) | Ensure hermes-agent env_file: .env picks these up |
| **Build artifacts** | hermes-agent Docker image (not yet built -- no Dockerfile exists) | Create Dockerfile, add to docker-compose, build image |

**Nothing found requiring data migration.** The old hermes-worker-agent was a separate project with its own storage, never connected to the new hermes-agent's ~/.hermes directory structure.

## Common Pitfalls

### Pitfall 1: HERMES_HOME Path Mismatch Between Registration and Container
**What goes wrong:** register_movie_pipeline.py writes to ~/.hermes/domains/ (host), but Docker container mounts /app/data as HERMES_HOME, so domain data is invisible inside container.
**Why it happens:** Registration script runs on host with default Settings.hermes_home = ~/.hermes, but Docker volume maps differently.
**How to avoid:** Either (a) mount host ~/.hermes into container as /app/data, or (b) run registration inside the container as a startup step. Option (a) is simpler and matches the pattern.
**Warning signs:** /v1/health returns domains_count=0 after registration; decide returns 404 "Domain not registered".

### Pitfall 2: Decide Response recommendation is Raw LLM Text, Not JSON
**What goes wrong:** Client expects structured JSON params from decide, but recommendation is free-form LLM text.
**Why it happens:** decision_engine.py line 142: `agent.chat(prompt)` returns raw string. The LLM response is not parsed into structured params.
**How to avoid:** hermes-client.js should treat `recommendation` as advisory text, not as parseable params. HERMES_DEFAULTS provides the actual param values. The decide response informs but doesn't override defaults.
**Warning signs:** JSON.parse(recommendation) throws; client code assumes specific structure in recommendation field.

### Pitfall 3: Async Blocking in FastAPI Event Loop
**What goes wrong:** AIAgent.chat() is synchronous and blocks the FastAPI event loop, causing timeouts for concurrent requests.
**Why it happens:** AIAgent.chat() makes blocking HTTP calls to the LLM API.
**How to avoid:** Already handled -- routes.py line 122: `await asyncio.to_thread(engine.decide, ...)`. This wraps the sync call properly. [VERIFIED: code inspection]
**Warning signs:** Concurrent decide requests timeout despite reasonable LLM response times.

### Pitfall 4: Movie-agent Not on kais-net
**What goes wrong:** movie-agent container cannot reach hermes-agent by container name.
**Why it happens:** movie-agent is NOT currently in docker-compose.v9.yml (verified: no grep matches). It runs standalone.
**How to avoid:** Either (a) add movie-agent to docker-compose.v9.yml, or (b) use host-network access (http://host.docker.internal:8080 or host IP), or (c) connect movie-agent to kais-net externally. For Phase 10, hermes-client.js should use configurable HERMES_URL env var that defaults to a Docker-internal URL but can be overridden for standalone movie-agent.
**Warning signs:** ECONNREFUSED when calling http://kais-hermes-agent:8080 from movie-agent.

### Pitfall 5: Domain Not Registered Before First Request
**What goes wrong:** Client calls /v1/decide before domain is registered, gets 404.
**Why it happens:** Registration is a separate manual step (register_movie_pipeline.py).
**How to avoid:** Document registration as prerequisite. E2E test script should register first. Consider adding a startup check in Dockerfile entrypoint or a docker-compose healthcheck dependency.
**Warning signs:** 404 responses on all decide/audit calls.

## Code Examples

### hermes-client.js Core Structure (pattern from gold-team-client.js)
```javascript
// Source: Pattern from docker/movie-agent/lib/gold-team-client.js
// Native fetch, no npm dependencies

const HERMES_URL = process.env.HERMES_URL || 'http://kais-hermes-agent:8080';
const HERMES_DOMAIN = 'movie-pipeline';
const TIMEOUT_MS = 5000;
const RETRY_DELAY_MS = 1000;

const HERMES_DEFAULTS = {
  'soul-visual': {
    flux: { steps: 20, guidance_scale: 3.5, sampler: 'euler', scheduler: 'normal',
            width: 1024, height: 1024, denoise: 1.0, seed: -1 },
  },
  'video-gen': {
    wan: { width: 832, height: 480, num_frames: 81, fps: 16,
           cfg: 3.5, shift: 5.0, total_steps: 20 },
  },
  'voice': {
    tts: { voice: 'default', speed: 1.0 },
  },
};

export async function decide(task, context = {}) {
  try {
    const resp = await fetch(`${HERMES_URL}/v1/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: HERMES_DOMAIN, task, context }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (err) {
    // Retry once
    try {
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      const resp = await fetch(`${HERMES_URL}/v1/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: HERMES_DOMAIN, task, context }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.json();
    } catch {
      // Degrade to defaults
      console.warn(`[hermes-client] Service unavailable, using defaults for task=${task}`);
      return {
        decision_id: null,
        recommendation: JSON.stringify(HERMES_DEFAULTS[task] || {}),
        confidence: 0,
        domain: HERMES_DOMAIN,
        task,
        timestamp: new Date().toISOString(),
        degraded: true,
      };
    }
  }
}

export async function audit(decisionId, outcome = 'completed', metrics = {}) {
  try {
    const resp = await fetch(`${HERMES_URL}/v1/audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain: HERMES_DOMAIN,
        decision_id: decisionId,
        outcome,
        metrics,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (err) {
    // Audit failure is non-blocking -- log and return
    console.warn(`[hermes-client] Audit failed: ${err.message}`);
    return { recorded: false, auto_learn_triggered: false, decision_id: decisionId };
  }
}
```

### Minimal Dockerfile for hermes-agent
```dockerfile
# Source: Pattern from docker/gold-team/Dockerfile (Python base)
FROM python:3.11-slim

WORKDIR /app

# Use TUNA mirror (consistent with gold-team Dockerfile)
RUN sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || \
    sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list 2>/dev/null || true

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

COPY src/ ./src/
COPY scripts/ ./scripts/

ENV PORT=8080
EXPOSE 8080

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8080"]
```

### E2E Test Script Structure
```python
# Source: Pattern from docker/hermes-agent/tests/conftest.py + test_routes.py
# Uses httpx against real Docker container

import httpx
import pytest

HERMES_URL = "http://localhost:8080"  # Or from env
DOMAIN = "movie-pipeline"

def test_health():
    resp = httpx.get(f"{HERMES_URL}/v1/health", timeout=5)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["engine"] == "hermes-agent"

def test_decide_for_registered_task():
    resp = httpx.post(f"{HERMES_URL}/v1/decide", json={
        "domain": DOMAIN,
        "task": "art-direction",
        "context": {"style": "anime"}
    }, timeout=30)
    assert resp.status_code == 200
    data = resp.json()
    assert "decision_id" in data
    assert "recommendation" in data
    assert data["domain"] == DOMAIN

def test_audit_after_decide():
    # First decide
    decide_resp = httpx.post(f"{HERMES_URL}/v1/decide", json={
        "domain": DOMAIN, "task": "scene", "context": {}
    }, timeout=30)
    decision_id = decide_resp.json()["decision_id"]
    
    # Then audit
    audit_resp = httpx.post(f"{HERMES_URL}/v1/audit", json={
        "domain": DOMAIN,
        "decision_id": decision_id,
        "outcome": "completed",
        "metrics": {"task": "scene", "score": 8}
    }, timeout=10)
    assert audit_resp.json()["recorded"] is True
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| hermes-worker-agent (Node.js :3100, 6 tools, complex routing) | hermes-agent (Python :8080, domain/task/context API) | Phase 7-9 | Simpler API surface, domain-agnostic |
| Old 6-tool interface (memory, plan, reflect, learn, llm, llm_vision) | 3-endpoint interface (decide, audit, register) | Phase 7 | Client only needs decide + audit |
| External Skill Router routing to :3100 | Direct HTTP from hermes-client.js to :8080 | Phase 10 | No middleware layer needed |
| SQLite storage in hermes-worker-agent | File-based domain memory (~/.hermes/domains/) | Phase 7 | Simpler, inspectable, no DB dependency |

**Deprecated/outdated:**
- docs/hermes-worker-agent.md: Describes the old 6-tool architecture on port :3100. Entirely superseded by new hermes-agent on :8080. Document is kept for historical reference.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | movie-agent will be able to reach hermes-agent via Docker network or host networking | Architecture Patterns | Network connectivity fails, decide always degrades. Mitigated by configurable HERMES_URL env var. |
| A2 | register_movie_pipeline.py was run on host and data is at ~/.hermes/domains/movie-pipeline/ | Runtime State Inventory | Container starts with no domain, all requests return 404. Mitigated by volume mount or in-container registration. |
| A3 | LLM_API_KEY is present in .env file (shared by other services) | Deployment | hermes-agent cannot make LLM calls, decide returns 502. Client degrades gracefully. |
| A4 | The old hermes-worker-agent process is not currently running on the host | Service Retirement | Port conflict if old :3100 still bound. Verify with `ss -tlnp \| grep 3100`. |

## Open Questions

1. **HERMES_HOME volume mount strategy**
   - What we know: register_movie_pipeline.py writes to ~/.hermes/domains/ on the host. Container needs access to this data.
   - What's unclear: Should the Docker volume map host ~/.hermes into container /app/data, or should registration happen inside the container?
   - Recommendation: Mount host ~/.hermes as /app/data in the container. This is simpler and allows re-running registration from host without container restart.

2. **movie-agent networking**
   - What we know: movie-agent is NOT in docker-compose.v9.yml. It has its own Dockerfile at docker/movie-agent/Dockerfile.
   - What's unclear: Will movie-agent run standalone (outside Docker) or will it be added to docker-compose during this phase?
   - Recommendation: hermes-client.js uses HERMES_URL env var with sensible default. If movie-agent runs on host, use http://localhost:8080. If in Docker, use http://kais-hermes-agent:8080. This is already handled by the env var pattern.

3. **Domain registration timing**
   - What we know: Phase 9 created the registration script and skill files. The script needs to run against the same HERMES_HOME that the container uses.
   - What's unclear: Whether registration was already run on the host, or needs to be run as part of Phase 10 deployment.
   - Recommendation: E2E test should include a registration step. Deployment plan should include running register_movie_pipeline.py against the container's HERMES_HOME.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | movie-agent (hermes-client.js) | available | v24.13.0 | -- |
| Python 3 | hermes-agent | available | 3.12.3 | -- |
| Docker | Container build/run | available | 29.5.3 | -- |
| npm | Not needed (no new deps) | available | 11.6.2 | -- |
| pip | hermes-agent deps | available | pip3 | -- |
| pytest | E2E tests | available | 7.x | -- |
| httpx | E2E tests / FastAPI TestClient | available | 0.24+ | -- |
| hermes-agent (pip) | Agent library | available | 0.15.1 | -- |
| fastapi | API server | available | 0.136.1 | -- |

**Missing dependencies with no fallback:** none

**Missing dependencies with fallback:** none

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework (hermes-agent) | pytest 7.x + pytest-asyncio |
| Framework (movie-agent) | None -- hermes-client.js tests will use Node.js native test runner or simple scripts |
| Config file (hermes-agent) | docker/hermes-agent/tests/conftest.py (pre-existing) |
| Config file (movie-agent) | none -- no test framework installed, no package.json |
| Quick run command (hermes-agent) | `cd docker/hermes-agent && python -m pytest tests/ -x -q` |
| Full suite command (hermes-agent) | `cd docker/hermes-agent && python -m pytest tests/ -v` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CLIENT-01 | hermes-client.js calls /v1/decide with domain field | unit | `node docker/movie-agent/tests/test-hermes-client.js` | Wave 0 -- needs creation |
| CLIENT-01 | hermes-client.js calls /v1/audit with domain field | unit | `node docker/movie-agent/tests/test-hermes-client.js` | Wave 0 -- needs creation |
| CLIENT-02 | Degradation to HERMES_DEFAULTS when hermes down | unit | `node docker/movie-agent/tests/test-hermes-client.js` | Wave 0 -- needs creation |
| CLIENT-02 | Timeout triggers degradation within 6s (5s + 1s retry) | unit | `node docker/movie-agent/tests/test-hermes-client.js` | Wave 0 -- needs creation |
| REPLACE-01 | hermes-agent container responds on :8080/v1/health | integration | `cd docker/hermes-agent && python -m pytest tests/test_e2e.py -x` | Wave 0 -- needs creation |
| REPLACE-03 | Docker compose starts hermes-agent and passes healthcheck | integration | `docker compose -f docker-compose.v9.yml up hermes-agent --wait` | Wave 0 -- manual + script |

### Sampling Rate
- **Per task commit:** `cd docker/hermes-agent && python -m pytest tests/ -x -q`
- **Per wave merge:** `cd docker/hermes-agent && python -m pytest tests/ -v`
- **Phase gate:** Full suite green + E2E Docker test passes

### Wave 0 Gaps
- [ ] `docker/movie-agent/tests/test-hermes-client.js` -- unit tests for hermes-client.js (mock fetch, verify decide/audit/degradation)
- [ ] `docker/hermes-agent/tests/test_e2e.py` -- E2E tests against real Docker container
- [ ] Node.js test runner setup for movie-agent -- use `node --test` (built-in in Node 20+) or simple standalone scripts

## Security Domain

> Phase 10 involves network communication between containers and external LLM API calls.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth on hermes-agent API (internal Docker network only, not exposed externally) |
| V3 Session Management | no | Stateless service, no sessions |
| V4 Access Control | partial | Docker network isolation; ports bound to 127.0.0.1 |
| V5 Input Validation | yes | Pydantic models validate all request fields server-side |
| V6 Cryptography | yes | LLM_API_KEY via env var, HTTPS to LLM API |

### Known Threat Patterns for Docker + Internal API Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| LLM prompt injection via decide context | Tampering | hermes-agent uses context as advisory input, not executable code; recommendation is not auto-applied |
| Unrestricted API access from any container | Information Disclosure | Port 8080 bound to 127.0.0.1 on host; only kais-net bridge containers can reach it |
| LLM API key exposure | Information Disclosure | Key in .env (gitignored), passed via env_file to container |
| Domain pollution (registering arbitrary domains) | Tampering | Register endpoint is admin-only (manual script), not called by client |

## Sources

### Primary (HIGH confidence)
- docker/hermes-agent/src/api/routes.py -- verified API endpoint implementations
- docker/hermes-agent/src/api/models.py -- verified Pydantic request/response models
- docker/hermes-agent/src/core/decision_engine.py -- verified decide() and record_audit() logic
- docker/hermes-agent/src/config.py -- verified PORT=8080 default
- docker/movie-agent/lib/gold-team-client.js -- verified HTTP client pattern (class + degraded fallback)
- docker/movie-agent/lib/pipeline.js -- verified PHASES array and phase handler pattern
- docker-compose.v9.yml -- verified service structure, networking, healthcheck patterns
- docker/hermes-agent/scripts/register_movie_pipeline.py -- verified SEED_MEMORY default values
- docker/hermes-agent/tests/conftest.py -- verified test fixture pattern

### Secondary (MEDIUM confidence)
- docker/movie-agent/Dockerfile -- verified Node 20 base image, zero npm deps
- docker/gold-team/Dockerfile -- verified Python Dockerfile pattern for reference
- docs/hermes-worker-agent.md -- verified old architecture (:3100, 6 tools, Node.js)

### Tertiary (LOW confidence)
- None -- all findings verified against source code

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all packages pre-installed and verified via pip show
- Architecture: HIGH -- API contract, client pattern, and Docker integration all verified in codebase
- Pitfalls: HIGH -- derived from code inspection of actual models.py, routes.py, decision_engine.py, gold-team-client.js
- Networking: MEDIUM -- movie-agent networking to hermes-agent depends on deployment topology (assumption A1, A2)

**Research date:** 2026-06-06
**Valid until:** 2026-07-06 (30 days -- stable architecture, no fast-moving dependencies)
