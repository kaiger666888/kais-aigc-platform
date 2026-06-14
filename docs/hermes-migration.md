# Hermes Service Migration Guide

**Date:** 2026-06-06
**Status:** Active migration

## Overview

Migration from the old hermes-worker-agent (Node.js :3100) to the new hermes-agent (Python FastAPI :8080).

| Property | Old Service | New Service |
|----------|-------------|-------------|
| Runtime | Node.js | Python 3.11 + FastAPI |
| Port | :3100 | :8080 |
| Container | None (never Dockerized) | kais-hermes-agent |
| Location | ~/.openclaw/workspace/hermes-worker-agent/ | docker/hermes-agent/ |
| API surface | 6 tools (memory/plan/reflect/learn/llm/llm_vision) | 3 endpoints (decide/audit/register) |
| Storage | SQLite | File-based (~/.hermes/domains/) |
| GPU required | No | No |

## Step 1: Verify Old Service is Stopped

Check if the old hermes-worker-agent is still running on port 3100:

```bash
# Check if port 3100 is in use
ss -tlnp | grep 3100

# If the old service is running, stop it:
pm2 stop hermes-worker-agent
# OR
kill $(lsof -ti:3100)
```

Expected: `ss -tlnp | grep 3100` returns nothing (port is free).

## Step 2: Start New Service

The new hermes-agent runs as a Docker container via docker-compose:

```bash
# Build and start hermes-agent
docker compose -f docker-compose.v9.yml up -d hermes-agent

# Watch logs
docker compose -f docker-compose.v9.yml logs -f hermes-agent
```

## Step 3: Verify New Service

```bash
# Health check
curl http://localhost:8080/v1/health
# Expected: {"status":"ok","engine":"hermes-agent",...}

# Check Docker health status
docker inspect --format='{{.State.Health.Status}}' kais-hermes-agent
# Expected: healthy
```

## Step 4: Register movie-pipeline Domain

Before making decide/audit calls, register the movie-pipeline domain:

```bash
# Run registration script inside the container
docker compose -f docker-compose.v9.yml exec hermes-agent \
  python scripts/register_movie_pipeline.py

# Verify domain is registered
curl http://localhost:8080/v1/domains
# Expected: {"domains":[{"name":"movie-pipeline",...}]}
```

## API Migration

### Old API (6-tool interface on :3100)

| Old Endpoint | Purpose | Migration Path |
|--------------|---------|----------------|
| `POST /api/v1/tools/memory` | Memory store/retrieve | Merged into decide context |
| `POST /api/v1/tools/plan` | Pipeline planning | `POST /v1/decide` |
| `POST /api/v1/tools/reflect` | Quality evaluation | `POST /v1/decide` + `POST /v1/audit` |
| `POST /api/v1/tools/learn` | Experience learning | Automatic via `POST /v1/audit` |
| `POST /api/v1/tools/llm` | Text generation | `POST /v1/decide` |
| `POST /api/v1/tools/llm_vision` | Visual analysis | Not yet migrated (v2) |

### New API (3-endpoint interface on :8080)

| Endpoint | Purpose | Request Shape |
|----------|---------|---------------|
| `POST /v1/decide` | Get decision recommendation | `{domain, task, context}` |
| `POST /v1/audit` | Record outcome for learning | `{domain, decision_id, outcome, metrics}` |
| `POST /v1/register` | Register new domain | `{domain, description, tasks, skills_manifest}` |

## MCP Server (streamable-http)

In addition to the REST API, the same FastAPI process exposes a standard
[MCP](https://modelcontextprotocol.io) server at `POST /mcp` using the
streamable-http transport. This lets OpenClaw and other MCP clients
(Claude Code, Cursor, Codex, custom MCP-aware runtimes) consume the
decision engine through the standard protocol instead of bespoke REST.

### Endpoint

```
http://kais-hermes-agent:8080/mcp     # from other compose services
http://localhost:8080/mcp             # from host
```

The MCP app is mounted onto the existing FastAPI app at `/` (FastMCP's
internal route is `/mcp`). REST endpoints under `/v1/*` are unaffected —
the two coexist on the same port.

### Tools exposed

| Tool | Mirrors REST | Purpose |
|------|--------------|---------|
| `domain_register` | `POST /v1/register` | Register or refresh a domain |
| `domain_list` | `GET /v1/domains` | List registered domains |
| `domain_skills` | `GET /v1/domains/{d}/skills` | List skill filenames for a domain |
| `domain_memory` | `GET /v1/domains/{d}/memory` | Per-task EWMA stats + recent audits |
| `domain_decide` | `POST /v1/decide` | Get a decision recommendation |
| `domain_audit` | `POST /v1/audit` | Record an outcome for learning |
| `health_check` | `GET /v1/health` | Liveness probe (no LLM, no disk) |

REST and MCP share the same `DecisionEngine` / `DomainRegistry`
singletons — a domain registered via MCP is immediately visible to REST,
and vice versa.

### OpenClaw client configuration

OpenClaw reads MCP server config from its config file. Add an entry for
the hermes decision engine:

```json
{
  "mcpServers": {
    "hermes-decisions": {
      "url": "http://kais-hermes-agent:8080/mcp",
      "transport": "streamable-http"
    }
  }
}
```

Or from the host (not inside compose network):

```json
{
  "mcpServers": {
    "hermes-decisions": {
      "url": "http://localhost:8080/mcp",
      "transport": "streamable-http"
    }
  }
}
```

### Smoke test from host

```bash
# Verify MCP responds to initialize
curl -X POST http://localhost:8080/mcp \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize",
       "params":{"protocolVersion":"2025-03-26","capabilities":{},
                 "clientInfo":{"name":"curl-test","version":"0.1"}}}'
# Expect: HTTP 200, mcp-session-id header, initialize result in SSE stream
```

Then capture the session id and call tools/list / tools/call with header
`mcp-session-id: <id-from-initialize>`. For Python clients, use the
official `mcp.client.streamable_http` transport.

### Dependencies added

`docker/hermes-agent/requirements.txt` now pins `mcp>=1.26.0,<2` and
`starlette>=1.0.1,<2` (the latter for CVE-2026-48710, same pin as the
upstream fork).

### Operational notes

- **DNS-rebinding protection disabled**: `src/mcp/server.py` sets
  `transport_security.enable_dns_rebinding_protection = False`. The
  default allowlist only permits loopback hosts, but the container is
  reached as `kais-hermes-agent:8080` from other compose services. The
  protection is a browser-defense measure for exposed public servers;
  on the private Docker network it only produces spurious 421s.
- **Lifespan forwarding**: `src/main.py` passes
  `lifespan=mcp_app.router.lifespan_context` to FastAPI so MCP's
  streamable-http task group initializes correctly. Without this, every
  `tools/call` raises "Task group is not initialized"
  (see modelcontextprotocol/python-sdk#1367).
- **No new port**: MCP rides on :8080 alongside REST. The compose
  `ports:` and `healthcheck:` blocks do not change.
- **Domain registration**: MCP `domain_register` is equivalent to
  running `docker compose exec hermes-agent python
  scripts/register_movie_pipeline.py`. After initial registration via
  either path, both REST and MCP see the domain.

## Per-Task Model Routing (model.yaml)

By default every decide call uses the provider/model resolved from
`~/.hermes/config.yaml`'s `model:` section (or `LLM_*` env overrides).
For finer control — e.g. one model for long-context screenplay analysis,
another for vision-heavy storyboard work — drop a `model.yaml` next to
the domain's `SOUL.md`:

```
~/.hermes/domains/movie-pipeline/
  SOUL.md
  model.yaml          ← optional, per-task routing
  skills/
  memory/
```

Schema:

```yaml
default:
  provider: deepseek            # references custom_providers[name]
  model: deepseek-v4-pro

tasks:                          # optional per-task overrides
  storyboard:                   # task name must match registered tasks
    provider: zai               # built-in, reads GLM_API_KEY from .env
    model: glm-4.6v
  voice:
    provider: zai
    model: glm-5.1
  camera-preview:
    model: glm-4.6v             # partial: inherits provider from default
```

### Resolution rules

For each `domain_decide(domain, task)`:

1. Read `domains/<domain>/model.yaml` (skip if absent → use global default).
2. Look up `tasks[task]`. If present:
   - `provider`: take from task spec, else inherit from `default`.
   - `model`: take from task spec, else inherit from `default`.
3. If task not in `tasks:` → use `default` spec.
4. Resolve `base_url` + `api_key` from `~/.hermes/config.yaml`
   `custom_providers[name]`. Built-in providers (`zai`, `anthropic`,
   `openai`, `openrouter`, `zhipu`) fall through to the fork's own
   credential loading (`GLM_API_KEY` from `.env`, etc.).

If both `provider` and `model` end up empty (e.g. model.yaml is `{}` or
task matches nothing and no default), the wrapper uses the global
Settings — same behavior as not having a model.yaml at all.

### Adding a new provider

To use a provider not yet in `custom_providers`:

```bash
# Edit ~/.hermes/config.yaml directly, or use hermes CLI:
hermes provider add my-provider \
  --base-url https://api.example.com \
  --api-key sk-xxx

# Then reference it from any domain's model.yaml:
#   default:
#     provider: my-provider
#     model: my-model
```

The wrapper's `AgentFactory` warns loudly if a model.yaml references a
provider that's neither in `custom_providers` nor a known built-in, so
typos fail fast.

### Example: movie-pipeline with mixed providers

```bash
# Verify routing by inspecting container logs after a decide call:
docker logs kais-hermes-agent --tail 5 | grep "Created AIAgent"
# Expected: Created AIAgent: domain=movie-pipeline task=storyboard → provider=zai model=glm-4.6v
# Expected: Created AIAgent: domain=movie-pipeline task=requirement → provider=deepseek model=deepseek-v4-pro
```

REST `/v1/decide` and MCP `domain_decide` both honor model.yaml — the
routing layer is below the protocol layer.

## What Has NOT Changed

- **hermes-adapter.js** (LLM routing in movie-agent) remains unchanged. It does not call the new hermes-agent service (CLIENT-03).
- **gold-team-client.js** remains unchanged.
- **pipeline.js** and phase handler signatures remain unchanged.
- hermes-client.js handles all communication with the new service, with graceful degradation to HERMES_DEFAULTS when hermes-agent is unavailable.

## Rollback

If the new service has issues, movie-agent continues working via HERMES_DEFAULTS (embedded in hermes-client.js). No rollback needed -- the pipeline never blocks on hermes-agent availability.

To fully revert:

```bash
# Stop new service
docker compose -f docker-compose.v9.yml stop hermes-agent

# Restart old service if needed
cd ~/.openclaw/workspace/hermes-worker-agent/
pm2 start hermes-worker-agent
```

## Data Persistence

The hermes-agent stores domain data (skills, memory, SOUL.md) in the Docker named volume `hermes-data`, mounted at `/app/data` inside the container.

```bash
# Inspect volume location
docker volume inspect kais-hermes-data

# Backup domain data
docker run --rm -v kais-hermes-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/hermes-data-backup.tar.gz -C /data .
```
