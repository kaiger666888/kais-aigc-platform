# Phase 7: Hermes Agent Core Service - Research

**Researched:** 2026-06-06
**Domain:** Python library integration (hermes-agent) + FastAPI REST API wrapper
**Confidence:** MEDIUM

## Summary

Phase 7 installs NousResearch/hermes-agent as a Python library and builds a domain-agnostic FastAPI REST wrapper running on :8080. The wrapper exposes four endpoints (`/v1/decide`, `/v1/audit`, `/v1/register`, `/v1/health`) that allow any domain to register skills and memory with hermes-agent, then use the AIAgent.chat() interface for decision-making.

The hermes-agent library (v0.16.0, 182k GitHub stars) is a mature, self-improving AI agent framework. Its core class `AIAgent` in `run_agent.py` (~12k LOC) exposes two key methods: `chat(message: str) -> str` for simple invocation and `run_conversation(user_message, system_message, conversation_history, task_id) -> dict` for full control. The `__init__` takes ~60 parameters, but the minimum subset needed for this phase is `base_url`, `api_key`, `provider`, and `model`.

The existing `kais-hermes` Decision API already runs on :8080 as a systemd service, using a simple rule-based approach (phase-to-expert mapping + JSON file persistence). The new service replaces this with hermes-agent's LLM-powered decision engine while maintaining API compatibility for the downstream clients.

**Primary recommendation:** Create `docker/hermes-agent/` with a FastAPI app that wraps `AIAgent` in a domain-agnostic API layer, using hermes-agent's built-in `~/.hermes/domains/` convention for skill/memory isolation per domain.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
1. hermes-agent Python library mode -- `from run_agent import AIAgent`, not CLI/Gateway
2. FastAPI wrapper -- exposes domain-agnostic REST API, replaces existing decision_api.py
3. Domain registration mechanism -- `POST /v1/register` dynamically registers domains, with skill/memory isolation between domains
4. Interface design -- decide accepts `{domain, task, context}`, audit accepts `{domain, decision_id, outcome, metrics}`
5. Deployment location -- new service listens on :8080, replaces old kais-hermes Decision API
6. Storage -- uses hermes-agent's built-in ~/.hermes/ directory structure (skills, memory, SOUL.md)
7. Runtime -- standalone Python process (systemd service or Docker container), movie-agent calls via HTTP

### Technical Selection
- Python 3.11+ + FastAPI + uvicorn
- NousResearch/hermes-agent (pip install)
- Config: ~/.hermes/config.yaml + .env

### Deferred Ideas (OUT OF SCOPE)
- Self-learning loop (Phase 8)
- movie-pipeline domain registration (Phase 9)
- Client adaptation and old service replacement (Phase 10)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| API-01 | hermes-agent Python library installed, callable via `from run_agent import AIAgent` | hermes-agent v0.16.0 on PyPI [VERIFIED: PyPI registry]; AIAgent class documented in AGENTS.md [CITED: github.com/NousResearch/hermes-agent/blob/main/AGENTS.md] |
| API-02 | FastAPI service exposes `POST /v1/decide` accepting `{domain, task, context}` returning `{decision_id, recommendation, confidence}` | FastAPI 0.136.1 installed locally [VERIFIED]; existing decision_api.py provides reference pattern; AIAgent.chat() provides response generation |
| API-03 | FastAPI service exposes `POST /v1/audit` accepting `{domain, decision_id, outcome, metrics}` returning `{recorded, auto_learn_triggered}` | Existing audit endpoint pattern in decision_api.py [VERIFIED: local file read]; hermes-agent memory system for persistence |
| API-04 | FastAPI service exposes `POST /v1/register` accepting `{domain, description, tasks, skills_manifest}` | Domain isolation via ~/.hermes/domains/{domain}/ [CITED: AGENTS.md hermes_constants.py]; JSON registry at ~/.hermes/domains/registry.json |
| API-05 | `GET /v1/domains` lists registered domains, `GET /v1/domains/:domain/skills` lists domain skills | Domain registry pattern; hermes-agent skills scanning from agent/skill_commands.py [CITED: AGENTS.md] |
| API-06 | `GET /v1/health` returns service status and hermes-agent engine status | Existing /health pattern in decision_api.py; AIAgent instantiation check |
| DOMAIN-01 | Each domain has independent skills (`~/.hermes/domains/{domain}/skills/`) and memory (`memory/`) | hermes-agent uses `get_hermes_home()` from `hermes_constants` for path scoping [CITED: AGENTS.md]; `~/.hermes/skills/` structure documented |
| DOMAIN-02 | After registration, hermes-agent auto-loads domain's SOUL.md and skills as decision context | hermes-agent loads skills from `~/.hermes/skills/` via `agent/skill_commands.py` [CITED: AGENTS.md]; SOUL.md is the persona file |
| DOMAIN-03 | decide call uses only target domain's skills and memory, domains do not interfere | Domain isolation by constructing per-domain AIAgent instances or per-domain context injection |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| LLM decision inference | API / Backend (Python) | -- | hermes-agent is a Python library; AIAgent calls external LLM API |
| Domain registration & isolation | API / Backend (Python) | -- | Domain registry is server-side state |
| REST API exposure | API / Backend (Python) | -- | FastAPI on :8080 serves HTTP endpoints |
| Skill & memory persistence | Database / Storage (filesystem) | -- | hermes-agent uses ~/.hermes/ directory tree |
| Health monitoring | API / Backend (Python) | -- | /health endpoint checks engine + domain state |
| Client calls | Browser / Client (Node.js) | -- | movie-agent (Node.js) calls hermes via HTTP |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| hermes-agent | 0.16.0 | AI agent engine (AIAgent class) | NousResearch's official self-improving agent library [VERIFIED: PyPI registry] |
| fastapi | 0.136.1 | REST API framework | Already installed locally, used by existing decision_api.py [VERIFIED: pip show] |
| uvicorn | 0.46.0 | ASGI server | Already installed locally, standard for FastAPI [VERIFIED: pip show] |
| pydantic | 2.13.4 | Request/response validation | Already installed locally, FastAPI dependency [VERIFIED: pip show] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| uuid (stdlib) | -- | Generate decision_id | Every decide call |
| pathlib (stdlib) | -- | File path operations | Domain directory management |
| json (stdlib) | -- | Registry persistence | Domain registry read/write |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| FastAPI | Flask | FastAPI has built-in Pydantic validation, async support, auto-generated docs. Flask would work but require manual validation. |
| JSON file registry | SQLite | JSON is simpler for <100 domains. SQLite would be needed for concurrent write safety. For Phase 7 scale, JSON is fine. |
| AIAgent.chat() | AIAgent.run_conversation() | chat() is simpler (returns str). run_conversation() returns dict with full message history. Use chat() first, upgrade if more control needed. |

**Installation:**
```bash
pip install hermes-agent>=0.16.0,<0.17 fastapi>=0.136.1,<1 uvicorn>=0.46.0,<1 pydantic>=2.13,<3
```

**Version verification (completed):**
```
hermes-agent: 0.16.0 (PyPI, latest)
fastapi: 0.136.1 (installed locally, 0.136.3 available)
uvicorn: 0.46.0 (installed locally, 0.49.0 available)
pydantic: 2.13.4 (installed locally, latest)
```

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| hermes-agent | PyPI | ~6 months (v0.13.0+) | Significant (182k GitHub stars) | github.com/NousResearch/hermes-agent | N/A (PyPI) | Approved -- major open-source project |
| fastapi | PyPI | 5+ years | 50M+/month | github.com/fastapi/fastapi | N/A (PyPI) | Approved -- industry standard |
| uvicorn | PyPI | 5+ years | 40M+/month | github.com/encode/uvicorn | N/A (PyPI) | Approved -- industry standard |
| pydantic | PyPI | 5+ years | 100M+/month | github.com/pydantic/pydantic | N/A (PyPI) | Approved -- industry standard |

**Note:** slopcheck ran against npm registry by default (wrong ecosystem for Python packages). All packages verified via `pip index versions` on PyPI. slopcheck's npm-based `[SUS]` verdict for hermes-agent is irrelevant -- the npm "hermes-agent" is a different package. The real hermes-agent is a Python package from NousResearch (182k GitHub stars, MIT license).

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none (slopcheck npm verdict disregarded for PyPI packages)

*All packages above verified via PyPI registry (`pip index versions`) and confirmed as legitimate, well-established packages.*

## Architecture Patterns

### System Architecture Diagram

```
                    ┌─────────────────────────────────────┐
                    │   Node.js Clients                    │
                    │   (kais-movie-agent, etc.)            │
                    └──────────┬──────────────────────────┘
                               │ HTTP (localhost:8080)
                               ▼
                    ┌─────────────────────────────────────┐
                    │   FastAPI Wrapper (:8080)             │
                    │   ┌─────────────────────────────┐   │
                    │   │  Domain Registry             │   │
                    │   │  (registry.json)             │   │
                    │   └────────┬────────────────────┘   │
                    │            │ domain lookup           │
                    │   ┌────────▼────────────────────┐   │
                    │   │  AIAgent Pool / Factory      │   │
                    │   │  (per-domain instances)      │   │
                    │   └────────┬────────────────────┘   │
                    │            │ AIAgent.chat()          │
                    │   ┌────────▼────────────────────┐   │
                    │   │  hermes-agent engine         │   │
                    │   │  (run_agent.AIAgent)         │   │
                    │   └────────┬────────────────────┘   │
                    │            │ OpenAI-compatible API   │
                    └────────────┼────────────────────────┘
                                 │
                    ┌────────────▼────────────────────────┐
                    │   External LLM Provider              │
                    │   (z.ai/GLM, OpenRouter, etc.)       │
                    └─────────────────────────────────────┘

     ┌──────────────────────────────────────────────────┐
     │   ~/.hermes/domains/                              │
     │   ├── registry.json                               │
     │   ├── movie-pipeline/                             │
     │   │   ├── SOUL.md                                 │
     │   │   ├── skills/                                 │
     │   │   └── memory/                                 │
     │   └── {other-domain}/                             │
     │       ├── SOUL.md                                 │
     │       ├── skills/                                 │
     │       └── memory/                                 │
     └──────────────────────────────────────────────────┘
```

### Recommended Project Structure
```
docker/hermes-agent/
├── Dockerfile                  # Python 3.11-slim + hermes-agent + FastAPI
├── requirements.txt            # hermes-agent, fastapi, uvicorn
├── src/
│   ├── __init__.py
│   ├── main.py                 # FastAPI app entrypoint, uvicorn config
│   ├── api/
│   │   ├── __init__.py
│   │   ├── routes.py           # All /v1/* route definitions
│   │   ├── models.py           # Pydantic request/response models
│   │   └── deps.py             # Dependency injection (agent factory, registry)
│   ├── core/
│   │   ├── __init__.py
│   │   ├── agent_factory.py    # AIAgent instantiation + per-domain config
│   │   ├── domain_registry.py  # Domain CRUD, file-system operations
│   │   └── decision_engine.py  # Decide/audit logic, prompt construction
│   └── config.py               # Settings from env vars / config file
└── tests/
    ├── __init__.py
    ├── conftest.py             # Shared fixtures, temp ~/.hermes/
    ├── test_routes.py          # API endpoint tests
    ├── test_domain_registry.py # Domain CRUD tests
    └── test_decision_engine.py # Decide/audit logic tests
```

### Pattern 1: Domain-Scoped AIAgent Factory
**What:** Create per-domain AIAgent instances with domain-specific context
**When to use:** Every decide/audit call needs domain-specific skills and memory
**Example:**
```python
# Source: Based on AIAgent API documented in AGENTS.md
# [CITED: github.com/NousResearch/hermes-agent/blob/main/AGENTS.md]
from run_agent import AIAgent

def create_domain_agent(domain: str, config: dict) -> AIAgent:
    """Create an AIAgent scoped to a specific domain."""
    domain_dir = Path.home() / ".hermes" / "domains" / domain

    # Load domain's SOUL.md for system prompt context
    soul_path = domain_dir / "SOUL.md"
    system_context = soul_path.read_text() if soul_path.exists() else ""

    agent = AIAgent(
        base_url=config["llm_base_url"],
        api_key=config["llm_api_key"],
        provider=config["llm_provider"],
        model=config["llm_model"],
        platform="api_server",  # custom platform identifier
        skip_context_files=False,
        skip_memory=False,
    )
    return agent
```

### Pattern 2: Domain Registry with Filesystem Isolation
**What:** JSON-based registry with per-domain directories
**When to use:** Domain registration, listing, skill/memory management
**Example:**
```python
# Registry at ~/.hermes/domains/registry.json
# Each domain gets ~/.hermes/domains/{domain}/ structure

import json
from pathlib import Path
from datetime import datetime

class DomainRegistry:
    def __init__(self, base_dir: Path):
        self.base_dir = base_dir
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self.registry_path = base_dir / "registry.json"

    def _load(self) -> dict:
        if self.registry_path.exists():
            return json.loads(self.registry_path.read_text())
        return {"domains": {}}

    def _save(self, data: dict):
        self.registry_path.write_text(json.dumps(data, indent=2))

    def register(self, domain: str, description: str, tasks: list, skills_manifest: dict):
        data = self._load()
        # Create domain directory structure
        domain_dir = self.base_dir / domain
        (domain_dir / "skills").mkdir(parents=True, exist_ok=True)
        (domain_dir / "memory").mkdir(parents=True, exist_ok=True)

        data["domains"][domain] = {
            "description": description,
            "tasks": tasks,
            "skills_manifest": skills_manifest,
            "registered_at": datetime.utcnow().isoformat(),
        }
        self._save(data)

    def get(self, domain: str) -> dict | None:
        return self._load()["domains"].get(domain)

    def list_all(self) -> list[str]:
        return list(self._load()["domains"].keys())
```

### Pattern 3: Decide Endpoint with Domain Context Injection
**What:** Construct a decision prompt from domain skills + memory + task context, then call AIAgent.chat()
**When to use:** Every POST /v1/decide call
**Example:**
```python
# Construct decision prompt from domain context
def build_decision_prompt(domain: str, task: str, context: dict, domain_config: dict) -> str:
    """Build a structured prompt for hermes-agent decision-making."""
    prompt_parts = [
        f"Domain: {domain}",
        f"Task: {task}",
        f"Context: {json.dumps(context, ensure_ascii=False)}",
    ]
    return "\n".join(prompt_parts)
```

### Anti-Patterns to Avoid
- **Hardcoding ~/.hermes paths:** Use `get_hermes_home()` from `hermes_constants` for all paths [CITED: AGENTS.md -- "DO NOT hardcode `~/.hermes` paths"]
- **Sharing AIAgent instances across domains:** Each domain should have its own agent instance or carefully injected context to prevent cross-domain contamination
- **Blocking the event loop:** AIAgent.chat() is synchronous. Use `asyncio.to_thread()` in FastAPI routes to avoid blocking
- **Modifying hermes-agent internals:** Only use public API (AIAgent.chat(), AIAgent.run_conversation()). Never import from internal modules

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| LLM API calls | Custom HTTP client to LLM provider | AIAgent (hermes-agent) | AIAgent handles provider routing, retries, streaming, tool calls, context management |
| Memory persistence | Custom JSON/SQLite memory layer | hermes-agent memory system | Built-in memory provider plugins (honcho, mem0, etc.) with proven persistence |
| Skill loading | Custom skill file parser | hermes-agent skill_commands.py | Handles SKILL.md frontmatter, auto-discovery, platform gating |
| Config management | Custom config parser | hermes-agent config.yaml + .env | Built-in config loader with profile support |
| Session management | Custom session tracker | hermes-agent SessionDB (SQLite FTS5) | Full-text search across conversation history |

**Key insight:** hermes-agent is a 12k LOC engine with mature patterns for all these concerns. The wrapper should be a thin REST layer that delegates everything possible to hermes-agent internals.

## Common Pitfalls

### Pitfall 1: AIAgent Synchronous Blocking
**What goes wrong:** AIAgent.chat() is synchronous. Calling it directly in async FastAPI route blocks the entire event loop.
**Why it happens:** FastAPI routes are async, AIAgent uses blocking OpenAI-compatible client calls internally.
**How to avoid:** Wrap AIAgent.chat() in `asyncio.to_thread()` or `asyncio.get_event_loop().run_in_executor()`.
**Warning signs:** API responses hang, other concurrent requests time out.

### Pitfall 2: Missing hermes-agent Configuration
**What goes wrong:** AIAgent.__init__ requires valid LLM provider config (base_url, api_key, provider). Without ~/.hermes/config.yaml or explicit parameters, instantiation fails.
**Why it happens:** hermes-agent reads config from ~/.hermes/config.yaml by default. In a Docker container, this file may not exist.
**How to avoid:** Either mount the host's ~/.hermes/ into the container, or pass all config explicitly via AIAgent constructor parameters.
**Warning signs:** `KeyError` or `ConfigError` at AIAgent initialization.

### Pitfall 3: Cross-Domain Memory Leakage
**What goes wrong:** If a single AIAgent instance is shared across domains, memory from domain A appears in domain B's decisions.
**Why it happens:** AIAgent uses a shared memory provider that writes to ~/.hermes/memories/ without domain scoping.
**How to avoid:** Either (a) create separate AIAgent instances per domain with different HERMES_HOME paths, or (b) construct per-domain system prompts that include domain context and explicitly instruct the agent to use only that domain's skills.
**Warning signs:** Decisions reference information from wrong domain.

### Pitfall 4: hermes-agent Import Path
**What goes wrong:** `from run_agent import AIAgent` fails because the module is not at the expected path.
**Why it happens:** hermes-agent's run_agent.py is deep inside the package. The correct import path depends on how it's installed.
**How to avoid:** After `pip install hermes-agent`, verify the import works in a test script. The package may expose AIAgent through a different top-level module. If `from run_agent import AIAgent` does not work, check `from hermes_agent.run_agent import AIAgent` or similar.
**Warning signs:** ModuleNotFoundError at import time.

### Pitfall 5: Port Conflict with Existing Service
**What goes wrong:** New hermes-agent wrapper fails to bind :8080 because the existing kais-hermes.service (systemd) is still running.
**Why it happens:** Both services try to listen on the same port.
**How to avoid:** Stop kais-hermes.service before starting the new wrapper. Include a migration step to disable the old service.
**Warning signs:** `Address already in use` error at startup.

## Code Examples

### AIAgent Minimal Instantiation (from AGENTS.md)
```python
# Source: [CITED: github.com/NousResearch/hermes-agent/blob/main/AGENTS.md]
# AIAgent class in run_agent.py -- minimum subset of ~60 parameters

from run_agent import AIAgent

agent = AIAgent(
    base_url="https://open.bigmodel.cn/api/paas/v4",
    api_key="your-api-key",
    provider="zai",           # z.ai/GLM provider
    model="glm-5.1",
    platform="api_server",    # custom platform identifier
    skip_context_files=False,
    skip_memory=False,
    quiet_mode=True,          # suppress terminal output in server mode
)

# Simple call -- returns final response string
response = agent.chat("Based on the storyboard context, recommend camera angle for shot 3")
print(response)  # str with the LLM's decision
```

### AIAgent Full Conversation (from AGENTS.md)
```python
# Source: [CITED: github.com/NousResearch/hermes-agent/blob/main/AGENTS.md]
# Full interface -- returns dict with final_response + messages

result = agent.run_conversation(
    user_message="Analyze this storyboard sequence for continuity errors",
    system_message="You are a film continuity expert. Focus on visual consistency.",
    conversation_history=[...],  # OpenAI-format messages
    task_id="unique-task-id",
)
# result is a dict with "final_response" (str) + "messages" (list)
```

### FastAPI Decide Route with Domain Isolation
```python
# Pattern for wrapping synchronous AIAgent in async FastAPI
import asyncio
import uuid
from datetime import datetime, timezone
from fastapi import HTTPException

@app.post("/v1/decide", response_model=DecideResponse)
async def decide(req: DecideRequest):
    # 1. Validate domain exists
    domain_config = registry.get(req.domain)
    if not domain_config:
        raise HTTPException(status_code=404, detail=f"Domain '{req.domain}' not registered")

    # 2. Get or create domain agent
    agent = agent_factory.get_agent(req.domain)

    # 3. Build decision prompt
    prompt = build_decision_prompt(req.domain, req.task, req.context, domain_config)

    # 4. Call AIAgent.chat() in thread pool (it's synchronous)
    try:
        response = await asyncio.to_thread(agent.chat, prompt)
    except Exception as e:
        logger.error("AIAgent.chat() failed: %s", e)
        raise HTTPException(status_code=502, detail="Decision engine error")

    # 5. Return structured response
    return DecideResponse(
        decision_id=str(uuid.uuid4()),
        recommendation=response,
        confidence=0.0,  # TODO: dynamic confidence from Phase 8
        domain=req.domain,
        task=req.task,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Rule-based phase-to-expert mapping | LLM-powered decision via hermes-agent | Phase 7 (this phase) | Decisions become contextual, not just routing |
| JSON file per expert (metrics.json) | hermes-agent memory system (SQLite + optional vector DB) | Phase 7 (this phase) | Richer, searchable memory with FTS5 |
| Phase-scoped decisions | Domain-scoped decisions | Phase 7 (this phase) | Any domain can register, not just movie pipeline |
| Node.js hermes-worker-agent | Python hermes-agent library | Phase 7 (this phase) | Direct library use, no HTTP bridge overhead |

**Deprecated/outdated:**
- hermes-worker-agent (Node.js, :3100): Being replaced entirely. Not used in new architecture.
- kais-hermes Decision API (Python, :8080): Being replaced by this new wrapper.
- Phase-expert mapping (PHASE_EXPERTS dict): Replaced by domain registration.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `from run_agent import AIAgent` is the correct import path after `pip install hermes-agent` | Standard Stack, Code Examples | Need to verify actual import path after installation; may be `from hermes_agent.run_agent import AIAgent` or similar |
| A2 | AIAgent can be instantiated with just `base_url`, `api_key`, `provider`, `model` parameters | Code Examples | If AIAgent requires ~/.hermes/config.yaml to exist, need to create it during setup |
| A3 | AIAgent.chat() works in server mode (no terminal/UI dependencies) | Pitfalls, Code Examples | If chat() requires terminal I/O, need to use run_conversation() or find quiet_mode workaround |
| A4 | Domain isolation can be achieved by constructing per-domain system prompts + skills paths | Architecture Patterns | If hermes-agent doesn't support path-scoping, need to use separate HERMES_HOME per domain |
| A5 | hermes-agent's ~60 init parameters can be safely defaulted for most values | Code Examples | If some defaults cause runtime errors, need explicit parameter passing |
| A6 | The existing ~/.hermes/ directory (with movie-production skills, SOUL.md, etc.) won't conflict with the new wrapper | Architecture | May need to back up existing ~/.hermes/ before first run |

**If this table is empty:** All claims in this research were verified or cited.

## Open Questions

1. **Exact import path for AIAgent**
   - What we know: AGENTS.md shows `from run_agent import AIAgent` as the canonical import
   - What's unclear: Whether this works directly after `pip install hermes-agent` or requires cloning the repo
   - Recommendation: First task in implementation should be `pip install hermes-agent && python3 -c "from run_agent import AIAgent"` to verify

2. **AIAgent server-mode compatibility**
   - What we know: AIAgent has `platform` parameter ("cli", "telegram", etc.) and `quiet_mode` flag
   - What's unclear: Whether "api_server" is a valid platform value or if chat() tries to access terminal
   - Recommendation: Test with `platform="cli", quiet_mode=True` first, then adjust if terminal access errors occur

3. **Domain memory scoping mechanism**
   - What we know: hermes-agent uses ~/.hermes/memories/ for persistent storage
   - What's unclear: How to scope memory per-domain without separate HERMES_HOME directories
   - Recommendation: Start with per-domain system prompt injection (simpler), upgrade to HERMES_HOME isolation if needed

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python 3.11+ | hermes-agent | Yes | 3.12.3 | -- |
| pip3 | Package management | Yes | 24.0 | -- |
| FastAPI | REST API | Yes | 0.136.1 | -- |
| uvicorn | ASGI server | Yes | 0.46.0 | -- |
| pydantic | Request validation | Yes | 2.13.4 | -- |
| hermes-agent | AI engine | Not installed | 0.16.0 (PyPI) | Must install |
| curl | Health checks | Yes | -- | wget |
| Docker | Containerized deployment | Yes | -- | systemd service |

**Missing dependencies with no fallback:**
- hermes-agent: Must `pip install` before any code works. This is the first implementation task.

**Missing dependencies with fallback:**
- None -- all other dependencies are available.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (standard for Python) |
| Config file | none -- see Wave 0 |
| Quick run command | `cd docker/hermes-agent && python -m pytest tests/ -x -q` |
| Full suite command | `cd docker/hermes-agent && python -m pytest tests/ -v --tb=short` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| API-01 | `from run_agent import AIAgent` works | smoke | `python -c "from run_agent import AIAgent"` | No -- Wave 0 |
| API-02 | `POST /v1/decide` returns `{decision_id, recommendation, confidence}` | unit | `pytest tests/test_routes.py::test_decide -x` | No -- Wave 0 |
| API-03 | `POST /v1/audit` returns `{recorded, auto_learn_triggered}` | unit | `pytest tests/test_routes.py::test_audit -x` | No -- Wave 0 |
| API-04 | `POST /v1/register` creates domain | unit | `pytest tests/test_routes.py::test_register -x` | No -- Wave 0 |
| API-05 | `GET /v1/domains` lists registered domains | unit | `pytest tests/test_routes.py::test_list_domains -x` | No -- Wave 0 |
| API-06 | `GET /v1/health` returns engine + domain status | unit | `pytest tests/test_routes.py::test_health -x` | No -- Wave 0 |
| DOMAIN-01 | Domain has independent skills/ and memory/ dirs | unit | `pytest tests/test_domain_registry.py::test_domain_isolation -x` | No -- Wave 0 |
| DOMAIN-02 | Registered domain's SOUL.md loaded as context | unit | `pytest tests/test_decision_engine.py::test_soul_loading -x` | No -- Wave 0 |
| DOMAIN-03 | Decide uses only target domain skills | unit | `pytest tests/test_decision_engine.py::test_domain_scoping -x` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `python -m pytest tests/ -x -q`
- **Per wave merge:** `python -m pytest tests/ -v --tb=short`
- **Phase gate:** Full suite green, plus smoke test: `python -c "from run_agent import AIAgent"` and `curl http://localhost:8080/v1/health`

### Wave 0 Gaps
- [ ] `docker/hermes-agent/tests/conftest.py` -- shared fixtures (temp ~/.hermes/, mock AIAgent)
- [ ] `docker/hermes-agent/tests/test_routes.py` -- covers API-02 through API-06
- [ ] `docker/hermes-agent/tests/test_domain_registry.py` -- covers DOMAIN-01, DOMAIN-02
- [ ] `docker/hermes-agent/tests/test_decision_engine.py` -- covers DOMAIN-03
- [ ] Framework install: `pip install pytest pytest-asyncio httpx` -- test dependencies

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No user auth in Phase 7 (internal service) |
| V3 Session Management | no | No user sessions |
| V4 Access Control | no | No user roles |
| V5 Input Validation | yes | Pydantic models for all request/response schemas |
| V6 Cryptography | no | No encryption needed (internal HTTP) |

### Known Threat Patterns for Python FastAPI Services

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious prompt injection via domain context | Tampering | Sanitize domain input, limit context size |
| Path traversal in domain names (e.g., `../../etc/passwd`) | Tampering | Validate domain names with regex `^[a-z0-9-]+$` |
| Unbounded memory consumption from large skills manifests | Denial of Service | Limit request body size, cap skills per domain |
| LLM API key exposure in logs | Information Disclosure | Never log API keys, use environment variables |

## Sources

### Primary (HIGH confidence)
- AGENTS.md (hermes-agent development guide) - AIAgent API, project structure, config system, pitfalls [CITED: github.com/NousResearch/hermes-agent/blob/main/AGENTS.md]
- PyPI registry - hermes-agent v0.16.0 existence and version history [VERIFIED: `pip index versions hermes-agent`]
- Local codebase - existing decision_api.py at ~/.hermes/mcp/decision_api.py [VERIFIED: file read]
- Local environment - FastAPI 0.136.1, uvicorn 0.46.0, pydantic 2.13.4, Python 3.12.3 [VERIFIED: `pip show`]

### Secondary (MEDIUM confidence)
- GitHub README - hermes-agent overview, installation, features [CITED: github.com/NousResearch/hermes-agent]
- Towards AI article - confirmed run_agent.py is ~10,700 lines, notes aggressive shipping pace [CITED: pub.towardsai.net]
- Existing hermes config (~/.hermes/config.yaml) - confirmed z.ai/GLM provider, model glm-5.1 [VERIFIED: file read]
- docker-compose.v9.yml - current deployment architecture, kais-net network [VERIFIED: file read]

### Tertiary (LOW confidence)
- [ASSUMED] AIAgent.chat() works without terminal I/O in server mode -- needs verification
- [ASSUMED] `from run_agent import AIAgent` works after pip install -- needs verification
- [ASSUMED] Domain isolation achievable via system prompt injection -- may need HERMES_HOME separation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all packages verified on PyPI, versions confirmed locally
- Architecture: MEDIUM - based on AGENTS.md documentation, but AIAgent server-mode usage is untested in this project
- Pitfalls: HIGH - based on AGENTS.md explicit warnings and existing codebase analysis

**Research date:** 2026-06-06
**Valid until:** 2026-07-06 (30 days -- hermes-agent is pre-1.0 and ships aggressively)
