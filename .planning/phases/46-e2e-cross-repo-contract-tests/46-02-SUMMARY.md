---
phase: 46-e2e-cross-repo-contract-tests
plan: 02
wave: 2
requirements: [VERIFY-03]
status: complete (structure shipped; live E2E deferred to manual setup)
autonomous: false
commits:
  - "72bc0f83 feat(46-02): add env-gated docker E2E (VERIFY-03)"
key-files:
  created:
    - scripts/verify-phase-46-e2e.ts
    - scripts/fixtures/p04-canvas-e2e-manifest.json
  modified:
    - package.json
---

# 46-02 — Env-gated Docker E2E (VERIFY-03)

## What was built

The receiver-side end-to-end test, marked `autonomous: false` because
it requires docker-compose v9 + manual opt-in via env var. Structure
shipped + validated; live assertion deferred to manual setup.

### Script (`verify-phase-46-e2e.ts`)

5 gates + 5 execution steps:

1. **Gate 1 (env-var):** `PHASE46_RUN_E2E=1` must be set, else SKIP
   + exit 0. This is the master safety — the script does NOTHING
   unless explicitly invoked.
2. **Gate 2 (fixture):** confirms `scripts/fixtures/p04-canvas-e2e-manifest.json` exists.
3. **Gate 3 (docker):** `docker info` works, else CHECKPOINT + exit 0.
4. **Gate 4 (compose):** `docker compose -f docker-compose.v9.yml ps` returns valid JSON, else CHECKPOINT + exit 0.
5. **Gate 5 (sibling repo):** `KAIS_HERMES_SKILLS_PATH` exists.

Execution:
1. Drop fixture into `$PHASE46_OSS_DIR/manifest.json` (default
   `<repo>/data/oss/e2e-test/p04/manifest.json`).
2. Trigger canvas_sync via `python3 -m plugins.kais_aigc.canvas_sync
   --project $PROJECT_ID --phase p04`. Fall back to CHECKPOINT if
   the CLI shape differs.
3. Poll `GET /api/v2/canvas/nodes?projectId=X&episodesId=Y` every 1s
   for up to 30s.
4. For each of the 3 matched fixture nodes:
   - Assert `data.description.length ≥ 20` (Phase 42 contract)
   - Assert ≥1 of `{archetype, role, era}` is non-empty (Phase 44
     import stamping + Phase 45 UI rendering)
5. On success: auto-delete the dropped fixture. On failure: leave it
   for inspection.

### Fixture (`p04-canvas-e2e-manifest.json`)

3 character asset nodes exercising the full archetype × era matrix:

| ID | archetype | era | description len |
|----|-----------|-----|-----------------|
| p04/char-e2e-01 | protagonist | 现代 (modern) | 32 chars |
| p04/char-e2e-02 | sidekick | 复古 (retro) | 33 chars |
| p04/char-e2e-03 | antagonist | 未来 (future) | 35 chars |

All descriptions ≥20 chars per Phase 42 contract.

## Notable decisions

- **Master verify does NOT chain this script.** `verify:phase-46-contracts`
  stays docker-free and CI-safe. The E2E script must be invoked
  explicitly via `PHASE46_RUN_E2E=1 npm run verify:phase-46-e2e`.
- **Cleanup only on success.** On assertion failure, the dropped
  fixture stays in the OSS dir for inspection. Operator cleans up
  manually after debugging.
- **Fallback canvas_sync invocation paths.** If `python3 -m
  plugins.kais_aigc.canvas_sync` doesn't work (e.g. the actual
  production trigger is via hermes-agent subscriber), the script
  emits a CHECKPOINT and continues to API poll — gives operator a
  chance to trigger manually and have the assertion still work.

## Session validation

| Check | Result |
|-------|--------|
| Fixture shape (3 nodes, all description ≥20, all ≥1 param) | ✓ |
| SKIP gate (env var unset) — exit 0, no docker | ✓ |
| Docker gate triggered (env var set, no compose up) — CHECKPOINT | ✓ |
| Live E2E assertion against full docker stack | ⏸ DEFERRED (manual) |

The deferred step requires:
- `docker compose -f docker-compose.v9.yml up -d` (start the stack)
- Project 1 + episodes 1 existing in the canvas DB
- canvas_sync CLI invocation path confirmed (or manual trigger)

Once those are in place, `PHASE46_RUN_E2E=1 npm run verify:phase-46-e2e`
should produce 7 PASS assertions (1 found-3-nodes + 3×2 per-node).

## Verification

```
SKIP gate:    "PHASE46_RUN_E2E=1 not set" + exit 0  ✓
Fixture:      "fixture OK: 3 nodes" (python json shape check)  ✓
Docker gate:  "CHECKPOINT: docker daemon not available" (when env set, no docker)  ✓
Phase 44 regression: 41 passed
Phase 45 regression: 13 passed
tsc: 3 baseline pre-existing errors, 0 new
```

## Forward enables

- **Phase 47 backfill** can run the E2E before `--apply` against the
  same docker stack where backfill will execute — proves the receiver
  side handles contract-compliant manifests correctly.
- **CI integration** (future): the E2E script could be wired into a
  GitHub Actions runner with docker-compose support; the env-gate
  prevents accidental GPU consumption.
- **Pattern reuse** — the env-gate + fixture-drop + API-poll structure
  generalizes to future Phase 47 backfill verification or any other
  docker-gated E2E test.

## Manual E2E runbook (from 46-VALIDATION.md)

```bash
# 1. Start docker compose v9
docker compose -f docker-compose.v9.yml up -d
# 2. Wait for services (comfyui downloads can take 30s+ on first start)
sleep 30
# 3. Set env vars
export PHASE46_RUN_E2E=1
# optional overrides:
# export PHASE46_API_PORT=3000
# export PHASE46_PROJECT_ID=1
# export PHASE46_EPISODES_ID=1
# export PHASE46_OSS_DIR=/data/workspace/kais-aigc-platform/data/oss/e2e-test/p04
# 4. Run the E2E
npm run verify:phase-46-e2e
# 5. Expected: 7 PASS assertions + "7 passed, 0 failed" + exit 0
```
