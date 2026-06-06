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
