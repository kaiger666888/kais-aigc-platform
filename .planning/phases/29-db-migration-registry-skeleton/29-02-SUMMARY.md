---
phase: 29-db-migration-registry-skeleton
plan: 02
subsystem: skills
tags: [skill-contract, registry, loader, boot, verify-runner]
requires:
  - "Phase 28 CONTRACT (validateManifest + SkillManifest/PhaseDecl/NodeTypeDecl types)"
  - "Plan 29-01 (o_skillRegistry table + skill_id/workflow_phase columns + movie-v1 backfill)"
provides:
  - "src/skills/registry.ts singleton (REGISTRY-05) — frozen object with list/get/phaseById/nodeTypeById/register, O(1) lookups via secondary indexes"
  - "src/skills/loader.ts loadAllFromDB(knex) (REGISTRY-06) — boot loader that hydrates registry from o_skillRegistry WHERE active=1"
  - "Boot wiring in src/utils/db.ts — loadAllFromDB(db) called after fixDB(db) in the IIFE"
  - "scripts/verify-phase-29.ts — regression guard proving all 4 Phase 29 success criteria (24 assertions)"
affects:
  - "Phase 30 API-06: default seed writes movie-v1 into o_skillRegistry; POST /api/v1/skills/register calls registry.register()"
  - "Phase 31 callback refactor: replaces hardcoded PHASE_ORDER/REVIEW_REQUIRED_PHASES/PHASE_INGEST_MAP with registry.phaseById() + registry.nodeTypeById()"
  - "Phase 32 canvas: node type registry sources from manifest via registry.nodeTypeById()"
tech-stack:
  added: []
  patterns:
    - "Frozen object literal singleton with closure-private module-scoped Maps (CONTEXT.md decision)"
    - "Secondary indexes built inside register() for O(1) phaseById/nodeTypeById lookups"
    - "Per-row try/catch in loader — one bad row does not abort boot (T-29-05)"
    - "Defensive double-validation: register() re-validates via validateManifest() even though loader validated first (Pitfalls A5)"
    - "Standalone tsx verify runner with :memory: SQLite, no initDB/fixDB imports (avoids singleton db chain)"
key-files:
  created:
    - src/skills/registry.ts
    - src/skills/loader.ts
    - scripts/verify-phase-29.ts
  modified:
    - src/utils/db.ts
decisions:
  - "Frozen object literal over class+DI — no DI container in this codebase, frozen object reads cleanly at call sites (CONTEXT.md)"
  - "register() throws on invalid input (not silent ignore) — every call site is controlled (loader catches+logs, REST handler catches+4xx)"
  - "Secondary indexes built inside register(), not lazily on first lookup — non-negotiable for Success Criterion #4 (no fallback to movie-v1)"
  - "No try/catch around loadAllFromDB in db.ts IIFE — boot failures surface as unhandled rejections (correct signal)"
  - "Verify runner does NOT import initDB — initDB transitively imports getEmbedding → singleton db; runner creates the 3 needed tables inline"
metrics:
  duration: "~220s"
  completed: "2026-06-15"
  tasks: 3
  files: 4
---

# Phase 29 Plan 02: Registry + Loader + Boot Wiring Summary

In-memory skill registry singleton with O(1) secondary indexes, boot loader that hydrates it from `o_skillRegistry` with per-row validation, boot wiring in db.ts, and a 24-assertion verify runner proving all 4 Phase 29 success criteria.

## What Was Built

### REGISTRY-05: src/skills/registry.ts — singleton with secondary indexes

A frozen object literal exporting 5 methods backed by three closure-private module-scoped Maps:

| Map | Key | Value | Purpose |
|-----|-----|-------|---------|
| `manifests` | `skill_id` | `SkillManifest` | Primary index |
| `phaseIndex` | `skill_id` → `phase_id` | `PhaseDecl` | Secondary index for O(1) phaseById |
| `nodeTypeIndex` | `skill_id` → `type` (namespaced) | `NodeTypeDecl` | Secondary index for O(1) nodeTypeById |

Method semantics:
- **register(manifest)** — defensive double-check via `validateManifest()`; on failure throws `Error` naming the first ruleId. On success, sets primary entry + builds both inner index maps from `manifest.phase_taxonomy` and `manifest.node_types`. Re-registering overwrites.
- **get(skillId)** — `manifests.get(skillId)` → `SkillManifest | undefined`
- **list()** — `Array.from(manifests.values())` → `SkillManifest[]` (empty when registry is empty)
- **phaseById(skillId, phaseId)** — `phaseIndex.get(skillId)?.get(phaseId)` → `PhaseDecl | undefined`
- **nodeTypeById(skillId, typeId)** — `nodeTypeIndex.get(skillId)?.get(typeId)` → `NodeTypeDecl | undefined`

No method falls back to movie-v1 or any hardcoded skill id. Unknown lookups return `undefined`.

### REGISTRY-06: src/skills/loader.ts — boot loader

`export async function loadAllFromDB(knex: Knex): Promise<number>`

Implementation:
1. `SELECT skill_id, manifest_json FROM o_skillRegistry WHERE active = 1` — only the columns needed
2. For each row, wrap JSON.parse + validateManifest + register in try/catch:
   - Valid manifest → `registry.register(result.value)`, increment count
   - Invalid manifest (validator returns `{ok: false}`) → `console.warn` with skill_id + ruleId, skip
   - JSON.parse failure or register throw → `console.warn` with skill_id + error message, skip
3. Return count of successfully registered skills

Empty-table behavior (Success Criterion #3): SELECT returns zero rows, loop never executes, resolves with 0. `registry.list()` returns `[]`.

### Boot wiring: src/utils/db.ts

Added import `import { loadAllFromDB } from "@/skills/loader"` and inserted `await loadAllFromDB(db)` into the IIFE after `await fixDB(db)` and before the `NODE_ENV` check:

```typescript
(async () => {
  await initDB(db);
  await fixDB(db);
  await loadAllFromDB(db);           // ← new
  if (process.env.NODE_ENV == "dev") initKnexType(db);
})();
```

No try/catch wraps loadAllFromDB — if the loader throws (which it should not, since every per-row error is caught), the IIFE's implicit rejection surfaces as an unhandled promise rejection. This is the correct signal that something is fundamentally broken.

### scripts/verify-phase-29.ts — regression guard

Standalone tsx script with 24 assertions across 5 test groups:

| Test | Success Criterion | Assertions |
|------|------------------|------------|
| 1. Backfill | SC1 | 6 (NULLs gone, orphan covered, non-NULL untouched, workflow_phase stays NULL) |
| 2. Empty-table boot | SC3 | 3 (no throw, returns 0, registry stays empty) |
| 3. Populated-table boot | SC2 | 5 (count=1, valid registered, invalid skipped, secondary indexes built) |
| 4. Registry lookups | SC4 | 8 (known/unknown for get/phaseById/nodeTypeById, list length >= 2) |
| 5. register rejection | Pitfalls A5 | 2 (throws on invalid, does not corrupt) |

**Test ordering (Warn 4 fix):** Test 2 runs BEFORE any `registry.register()` call. The registry is a non-clearable singleton — once register fires in Test 3, `list()` never returns `[]` again within the process. Running the empty-table proof first lets it assert `registry.list().length === 0` cleanly.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Verify runner does NOT import initDB (avoids singleton db chain)**
- **Found during:** Task 3 verification (first runner run exited 1 despite 24/24 pass)
- **Issue:** The plan said to call `initDB(transientKnex)` directly in the runner. However, `initDB.ts` imports `getEmbedding` from `@/utils/agent/embedding` at module level, which in turn imports the singleton `db` from `@/utils/db`. When the runner imported initDB, the entire db.ts module loaded, its IIFE fired, and `await initDB(db)` threw `TypeError: (0, import_initDB.default) is not a function` due to ESM/CJS interop when the same initDB module is imported twice via different paths. The runner's own tests all passed (24/24), but the process exited 1 due to the unhandled rejection from the db.ts IIFE.
- **Fix:** Removed the `import initDB from "../src/lib/initDB"` line. The runner now creates the 3 tables it needs (o_assets, kv_pipelineRun, o_skillRegistry) inline via `db.schema.createTable()`, mirroring the same schemas from initDB.ts but only including the columns the tests exercise. This is consistent with how the runner already avoids importing fixDB.ts. The header comment was updated to document why initDB is not imported.
- **Files modified:** `scripts/verify-phase-29.ts`
- **Commit:** `4cd103d`

## Verification Results

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| `grep -q 'export const registry' src/skills/registry.ts` | match | match | PASS |
| `grep -q 'new Map<string, SkillManifest>()' src/skills/registry.ts` | match | match | PASS |
| `grep -q 'phaseIndex' src/skills/registry.ts` | match | match | PASS |
| `grep -q 'nodeTypeIndex' src/skills/registry.ts` | match | match | PASS |
| `grep -q 'validateManifest' src/skills/registry.ts` | match | match | PASS |
| `grep -q 'Object.freeze' src/skills/registry.ts` | match | match | PASS |
| `grep -q 'export async function loadAllFromDB' src/skills/loader.ts` | match | match | PASS |
| `grep -q 'knex("o_skillRegistry")' src/skills/loader.ts` | match | match | PASS |
| `grep -q 'where("active", 1)' src/skills/loader.ts` | match | match | PASS |
| `grep -q 'registry.register' src/skills/loader.ts` | match | match | PASS |
| `grep -q 'import { loadAllFromDB } from "@/skills/loader"' src/utils/db.ts` | match | match | PASS |
| `grep -q 'await loadAllFromDB(db)' src/utils/db.ts` | match | match | PASS |
| `npx tsc --noEmit` | 0 errors | 0 errors | PASS |
| `tsx scripts/verify-phase-29.ts` | exit 0, all pass | exit 0, 24/24 pass | PASS |

## Commits

| Hash | Type | Description |
|------|------|-------------|
| `15a08f5` | feat | Task 1: src/skills/registry.ts singleton with secondary indexes |
| `054ee69` | feat | Task 2: src/skills/loader.ts + boot wiring in src/utils/db.ts |
| `4cd103d` | test | Task 3: scripts/verify-phase-29.ts runner (24 assertions, all pass) |

## Self-Check: PASSED

- [x] `src/skills/registry.ts` exists — frozen singleton with 5 methods, 3 module-scoped Maps
- [x] `src/skills/loader.ts` exists — loadAllFromDB(knex) with per-row try/catch
- [x] `src/utils/db.ts` — `await loadAllFromDB(db)` wired after fixDB, before NODE_ENV check
- [x] `scripts/verify-phase-29.ts` — 24/24 assertions pass, exit code 0
- [x] Commit `15a08f5` exists in git log
- [x] Commit `054ee69` exists in git log
- [x] Commit `4cd103d` exists in git log
- [x] TypeScript compiles with 0 errors
