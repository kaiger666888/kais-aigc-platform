---
phase: 48-ingest-candidate-grouping-enum-unification-workflow-phase
verified: 2026-08-19T01:56:55Z
status: human_needed
score: 15/15 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Live HTTP smoke: POST /api/v1/pipeline/ingest/images with the fixture manifest payload against a running server, then POST /api/v1/assets-registry/search with type=character"
    expected: "Ingest returns 200 with 6 groups; o_assets rows land grouped (one isPrimaryView=1 per group, members' assetsId=primary id); the search returns both canonical 'character' rows and any legacy 'role' rows"
    why_human: "Requires a running server (verifier may not start servers). Machine checks exercised the real service on :memory: sqlite and statically verified middleware/mount/DDL compatibility, but the express body-parsing path (e.g. JSON body-size limits for 200-image + manifest payloads), validateFields 400 responses, and the live u.db → db2.sqlite round-trip are only observable live"
  - test: "Visual check in the asset center (AssetLibrary) after ingesting a fixture group"
    expected: "Group renders as one primary with variants (candidate group via getGroupKey / assetsId shape); no asset vanishes from canvas sync (state='active' filter)"
    why_human: "UI rendering of the grouped o_assets shape cannot be verified by grep/script"
---

# Phase 48: Ingest Candidate Grouping + Enum Unification + workflow_phase Verification Report

**Phase Goal:** kmc 产出的候选经 kap ingest 落库后自动成组——每组恰好一个 primary (`isPrimaryView=true`)、其余候选带正确 `state`、assetType 词汇全站统一、`workflow_phase` 非空（o_assets 分组契约源头）
**Verified:** 2026-08-19T01:56:55Z
**Status:** human_needed (all automated checks pass; 2 live/UI items await human testing)
**Re-verification:** No — initial verification (no previous VERIFICATION.md existed)

## Goal Achievement

### Observable Truths

Roadmap Success Criteria (1–4) merged with PLAN must-have truths (5–15). Every truth was verified against actual code and re-executed checks, not SUMMARY claims.

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC-1: Fixture manifest (all_first_frames[]/all_last_frames[] + canonical/_v{N} turnaround) ingests to o_assets sharing one assetsId → primary; flat orphan insert gone | ✓ VERIFIED | `npm run verify:phase-48` Part 2 on :memory: sqlite with the REAL `ingestImagesPayload`: 17 rows → 6 groups + 1 standalone; SQL assertion "every member's assetsId is a group primary id from this batch (self-consistency, no orphans)" + per-group on-disk member count. `src/routes/v1/pipeline/ingest/images.ts` (read in full, 97 lines) contains NO insert loop — thin wrapper calling `ingestImagesPayload(u.db, …)` only |
| 2 | SC-2: selected_*_variant lands isPrimaryView=true; others false + state='active'; exactly one primary per group, DB-query verifiable | ✓ VERIFIED | Part 2 DB queries: "exactly 6 rows with isPrimaryView=1 (one per group)"; per-group primary landing asserted (S01:first→v2 [selected=2], S01:last→v1 [fallback], S02:first→v1, S02:last→v2 [selected=2], turnaround→canonical, scene→v1); "all 17 rows state='active'". In-transaction D-04 assertion scoped to memberAssetIds (`whereIn("id", s.memberAssetIds)`, ingestAssets.ts:262-281) throws → rollback on violation |
| 3 | SC-3: images.ts + assets-registry consume a single truth source; new-vocab assets filterable; legacy rows queryable; two-vocabulary split gone | ✓ VERIFIED | Both files import `@/lib/assetTypes` (images.ts:6, registry:6); `grep -c 'script_phase", "outline"' registry` = 0; `grep -c '\["role", "scene", "tool"\]' images.ts` = 0; registry :22 `z.enum(CANONICAL_ASSET_TYPES)`, :127 `whereIn("a.type", expandTypesForQuery(s.type))`. Part 2 machine-asserts a type='role' row IS returned by the expanded query and NOT matched by 'voice' passthrough. Direct spot-check (tsx, real module): registry enum rejects 'keyframe', accepts 'delivery' |
| 4 | SC-4: New-ingest assets carry workflow_phase derived from p{NN} path | ✓ VERIFIED (per D-08) | Part 2: 10/10 frame rows = 'p11' (from /p11/ segment), 4/4 turnaround rows = 'p04'; NULL = exactly 3 underivable rows (scene pair + standalone under /oss/manual/, no phase field), each with one `console.warn` per row (observed in script output). **Interpretation note:** ROADMAP's literal "IS NULL returns 0 rows" conflicts with LOCKED decision D-08 (48-CONTEXT.md: "推导不出 → 允许 NULL 并 logger.warn（不猜）"). Verified per D-08 semantics — derivable rows are 100% non-null, NULL only on underivable rows. For a fully-derivable batch the literal 0-row reading also holds. Pre-flagged by plan-checker; see Gaps Summary |
| 5 | normalizeAssetType role→character, tool→prop, canonical identity, unknown→null | ✓ VERIFIED | Part 1 assertions on real module (all 6 cases) + verifier's direct tsx spot-check re-confirmed |
| 6 | expandTypesForQuery('character') → ["character","role"], passthrough no-crash | ✓ VERIFIED | Part 1 (5 cases incl. 'bogus' passthrough) + direct spot-check |
| 7 | planGroups manifest channel: per-shot first/last groups; primary = selected else first present | ✓ VERIFIED | Part 1 fixture round-trip (groupKeys shot:S01_B01:first/last, shot:S02_B01:first/last; primaries v2/v1/v1/v2) + partial-batch variant (2 members, first-present primary) |
| 8 | planGroups naming channel: groups _v{N}; primary = canonical else lowest variant | ✓ VERIFIED | Part 1: canonical present → canonical primary + characterId 'chengyu' + metaSubtype 'turnaround_sheet'; canonical absent → v1 |
| 9 | deriveWorkflowPhase: normalized lowercase p{NN} from phase or path; null when underivable | ✓ VERIFIED | Part 1 PHASE-01 section: p11/P04/p04_turnaround → normalized; "pipeline"/"4"/no-segment → null (never guesses) |
| 10 | npm run verify:phase-48 exits 0, Part 1 passing | ✓ VERIFIED | Re-executed by verifier: 135/135 assertions, exit 0 |
| 11 | Plan 48-02: fixture batch → non-primary members assetsId = primary.id (integer), primary assetsId NULL, no flat orphans | ✓ VERIFIED | Part 2 SQL: primaries assetsId NULL; 10 member rows all assetsId ∈ batch primary ids; integer-typed column (DDL) |
| 12 | Plan 48-02: selected asset isPrimaryView=true; others false state='active'; exactly one primary per group via DB query | ✓ VERIFIED | Same evidence as truth 2 (machine-checked over the batch) |
| 13 | Plan 48-02: images.ts + registry import from assetTypes.ts; legacy rows queryable via /search expansion | ✓ VERIFIED | Same evidence as truth 3 |
| 14 | Plan 48-02: workflow_phase per D-08; NULL only on underivable rows, each console.warn'd | ✓ VERIFIED | Same evidence as truth 4; warn lines observed in verifier's run output |
| 15 | Plan 48-02: verify:phase-48 (Part 1+2) AND npx tsc --noEmit both exit 0 | ✓ VERIFIED | Re-executed by verifier: verify 135/135 exit 0; `npx tsc --noEmit` exit 0 (zero output) |

**Score:** 15/15 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/assetTypes.ts` | Truth source: CANONICAL_ASSET_TYPES (11), aliases, 13-value input tuple, normalize/expand | ✓ VERIFIED | 96 lines, all 6 exports present; pure (no zod/fs/knex imports); header documents single-truth-source contract |
| `src/lib/candidateGrouping.ts` | planGroups / parseVariantName / deriveWorkflowPhase pure contracts | ✓ VERIFIED | 423 lines; all exports present; pure module; manifest channel (dirBase disambiguation, selected-variant, fallback), naming channel (dir-aware WR-03), CR-02 duplicate-groupKey throw, WR-05 warnings array |
| `scripts/fixtures/phase48-p11-manifest.fixture.json` | kmc iframe-manifest shape, Phase-50 reusable | ✓ VERIFIED | 2 entries mirroring real manifest fields; contains `"selected_first_variant": 2` and `"selected_last_variant": null`; consumed by Part 1+2 round-trips |
| `scripts/verify-phase-48.ts` | Part 1 + Part 2 machine verification | ✓ VERIFIED | 836 lines, 135 assertions, dynamic imports of the REAL modules (assetTypes:58, candidateGrouping:59, ingestAssets:463); `:memory:` only, `grep '"db2.sqlite"'` = 0 |
| `src/lib/ingestAssets.ts` | ingestImagesPayload(db, payload) transactional service | ✓ VERIFIED | 293 lines; exports ingestImagesPayload/IngestImagesPayload/IngestResult; db.transaction, MAX(id)+1 in-trx, CR-01 duplicate-path rejection, membership-scoped D-04 assertion + member-linkage check, state='active' only, WR-02 unknown-type → NULL + warn |
| `src/routes/v1/pipeline/ingest/images.ts` | Candidate-aware ingest endpoint | ✓ VERIFIED | 97 lines; contains ingestImagesPayload (call :90); inline legacy enum gone; caps ≤1000 images / ≤100 manifests / ≤20 frames; `..` refine; CR-01 400 rejection + CR-02 shot_id uniqueness refine; mounted at router.ts:312 |
| `src/routes/v1/assets-registry/index.ts` | Registry read-side compat | ✓ VERIFIED | Contains expandTypesForQuery (:127 usage) + z.enum(CANONICAL_ASSET_TYPES) (:22); PATCH/variants/project endpoints untouched; mounted at router.ts:292 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| scripts/verify-phase-48.ts | src/lib/assetTypes.ts | dynamic import + behavior assertions | ✓ WIRED | import :58; normalizeAssetType used 8× |
| scripts/verify-phase-48.ts | src/lib/candidateGrouping.ts | dynamic import + fixture grouping assertions | ✓ WIRED | import :59; planGroups used 13× |
| package.json | scripts/verify-phase-48.ts | npm script verify:phase-48 | ✓ WIRED | package.json:38 |
| src/routes/v1/pipeline/ingest/images.ts | src/lib/ingestAssets.ts | ingestImagesPayload(u.db, body) | ✓ WIRED | import :7, call :90; route's only DB access is passing u.db |
| src/lib/ingestAssets.ts | src/lib/candidateGrouping.ts | planGroups + deriveWorkflowPhase | ✓ WIRED | imports :29-35; calls :119, :192 |
| src/lib/ingestAssets.ts | src/lib/assetTypes.ts | normalizeAssetType | ✓ WIRED | import :28; call :227 |
| src/routes/v1/assets-registry/index.ts | src/lib/assetTypes.ts | CANONICAL_ASSET_TYPES + expandTypesForQuery | ✓ WIRED | import :6; usages :22, :127 |
| scripts/verify-phase-48.ts | src/lib/ingestAssets.ts | temp sqlite knex + ingestImagesPayload | ✓ WIRED | import :463; 8 usages incl. CR-01/CR-02/WR-02 regression batches |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| ingestAssets.ts | plan (group plans) | planGroups(images, manifests) | Yes — real fixture batch, 17 images | ✓ FLOWING |
| ingestAssets.ts | workflowPhase | deriveWorkflowPhase(phase, filePath) | Yes — p11/p04 from real paths; NULL only underivable | ✓ FLOWING |
| ingestAssets.ts | o_assets/o_image rows | knex trx inserts | Yes — verified by SQL queries over inserted rows | ✓ FLOWING |
| assets-registry /search | q.whereIn("a.type", …) | expandTypesForQuery(s.type) | Yes — legacy 'role' row found, 'voice' non-match asserted | ✓ FLOWING |
| verify-phase-48.ts Part 2 | manifests | scripts/fixtures/phase48-p11-manifest.fixture.json (real kmc shape) | Yes | ✓ FLOWING |

Production-DDL compatibility (verify script mirrors the DDL, so checked statically): every column the service inserts (id, uuid, name, prompt, type, describe, projectId, imageId, assetsId, characterId, viewAngle, isPrimaryView, promptState, startTime, state, meta, createdAt, createdBy, workflow_phase; o_image: id, filePath, type, assetsId, state) exists in `src/lib/initDB.ts` o_assets/o_image builders; `fixDB.ts:76` adds workflow_phase to existing DBs. No "no such column" risk on db2.sqlite.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full phase contract (Part 1+2) | `npm run verify:phase-48` | 135/135 PASSED, exit 0 (re-run by verifier) | ✓ PASS |
| Type safety whole repo | `npx tsc --noEmit` | exit 0, zero errors (re-run by verifier) | ✓ PASS |
| Registry enum rejects unknown / ingest enum accepts legacy | tsx direct import of real assetTypes + zod | rejects 'keyframe', accepts 'delivery'/'role'/'tool' | ✓ PASS |
| Inline vocab literals gone | `grep -c '\["role", "scene", "tool"\]' images.ts` / `grep -c 'script_phase", "outline"'` registry | 0 / 0 | ✓ PASS |
| Truth-source behaviors direct | tsx (normalize/expand) | role→character, tool→prop, keyframe→null, expand→["character","role"] | ✓ PASS |
| npm registration | `grep verify:phase-48 package.json` | 1 (line 38) | ✓ PASS |

### Probe Execution

| Probe | Command | Result | Status |
| ----- | ------- | ------ | ------ |
| scripts/verify-phase-48.ts (phase-declared runnable check) | `npm run verify:phase-48` (own process) | exit 0 — "135/135 assertions passed (Part 1 + Part 2)", incl. CR-01/CR-02/WR-01/02/03/05 regression sections | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|---------------------|----------|
| INGEST-01 | 48-01, 48-02 | Ingest recognizes candidate groups (kmc variant naming + manifest all_*_frames); members write assetsId → primary; no more flat orphans | ✓ SATISFIED | Truths 1, 7, 8, 11 |
| INGEST-02 | 48-01, 48-02 | selected_first/last_variant → isPrimaryView=true; others false + state='active'; primary uniqueness guaranteed by ingest | ✓ SATISFIED | Truths 2, 12 + in-transaction D-04 assertion with rollback |
| INGEST-03 | 48-01, 48-02 | assetType single truth source; eliminate two-vocabulary split (images.ts:18 + registry index.ts:21); legacy-value compat mapping | ✓ SATISFIED | Truths 3, 5, 6, 13; both named locations unified; legacy rows queryable via expansion (machine-asserted) |
| PHASE-01 | 48-01, 48-02 | Ingest path auto-writes o_assets.workflow_phase (p{NN} from manifest path/DAG); new assets no longer empty | ✓ SATISFIED | Truths 4, 9, 14. Note: sync-assets.ts is a read-only consumer of o_assets (no writes — verified: only .where clauses), so the write obligation rests on the ingest path, which is machine-verified |

Orphaned-requirement check: REQUIREMENTS.md v2.1 traceability maps exactly INGEST-01..03 + PHASE-01 to Phase 48 — matches both plans' `requirements` fields. No orphans. (INGEST-04/PHASE-02 → Phase 50; SELECT-01..04 → Phase 49.)

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| src/routes/v1/pipeline/callback/phase-complete.ts | 132 | Legacy role/scene/tool writer remains | ℹ️ Info | Explicitly out of locked boundary D-09 (plan context documents it); its rows remain queryable via /search expansion; Phase 50 GUARD-02 territory |
| src/routes/v1/assets/from_node.ts | 15, 32 | Legacy vocabulary writer remains | ℹ️ Info | Same as above |
| scripts/verify-phase-48.ts | 94-101 | Registry-enum assertion is source-pattern, not behavioral | ℹ️ Info | Closed by verifier's direct tsx spot-check (enum rejects unknown); behavior is zod-guaranteed over the 11-value tuple |

No TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER markers in any of the 7 phase files. No empty implementations. `return { count: 0, assets: [], groups: [] }` (ingestAssets.ts:93) is the specified empty-batch no-op, not a stub. Review fix-round commits verified in git history: 51d936c5, a22b3e99, f4d72b8e, bfc65c13, 6e7a6743, 1e162ede, a89a7800 (CR-01/CR-02 + WR-01..WR-05 all land as claimed, each with regression assertions in the probe).

### Human Verification Required

### 1. Live HTTP ingest + registry search round-trip

**Test:** Start the server; POST /api/v1/pipeline/ingest/images with the fixture manifest payload (projectId + images with OSS-style p11/p04 paths + manifests from scripts/fixtures/phase48-p11-manifest.fixture.json); then POST /api/v1/assets-registry/search with `{ type: "character" }`.
**Expected:** 200 with 6 groups / 17 assets; o_assets lands grouped (exactly one isPrimaryView=1 per group, member assetsId = primary integer id, all state='active', frame rows workflow_phase='p11', turnaround 'p04'); search returns canonical rows AND any legacy 'role' rows.
**Why human:** Needs a running server (verifier constraint: no server starts). Machine checks covered the real service on :memory: sqlite plus static middleware/mount/production-DDL verification, but express body parsing (JSON size limits on large manifest payloads), validateFields 400 paths, and the live db2.sqlite round-trip are only observable live.

### 2. Asset-center visual rendering of a new group

**Test:** Ingest a fixture group (above), open the asset center (AssetLibrary) for that project.
**Expected:** Group renders as one primary with variant members (candidate group); nothing disappears from canvas sync (state='active' preserved).
**Why human:** UI rendering cannot be verified by grep/script; downstream consumer of the shape landed here.

### Gaps Summary

No gaps. All 15 truths verified, all 7 artifacts exist- substantive- wired- flowing, all 8 key links wired, 4/4 requirements satisfied, no blockers, probe re-executed green (135/135), tsc clean. Status is human_needed solely for the two live/UI confirmation items above.

**SC-4 interpretation note (not a gap):** ROADMAP SC-4's literal "workflow_phase IS NULL … returns 0 rows" and LOCKED decision D-08 (48-CONTEXT.md: underivable → NULL + warn, never guess) are in tension, as pre-flagged by the plan-checker. Verified per D-08 semantics — the self-consistent reading: derivable rows are 100% non-null (10/10 p11, 4/4 p04 machine-proven), NULL occurs only on underivable rows with per-row console.warn, and a fully-derivable batch yields 0 NULL rows. If the literal wording is ever wanted, the fixture batch would need to drop its deliberately-underivable rows; no code change is implied.

**Code-review closure verified:** CR-01 (duplicate filePath: route 400 + service throw + membership-scoped D-04 assertion — 3 regression assertions PASS), CR-02 (planGroups duplicate-groupKey throw + route shot_id refine — 3 regression assertions PASS), WR-01/02/03/05 fixes present in code with regression assertions; WR-04 resolved by raising the cap to 1000 with chunking contract documented. Remaining REVIEW Info items (IN-01..IN-07) are pre-existing/decorative, none block the goal.

---

_Verified: 2026-08-19T01:56:55Z_
_Verifier: Claude (gsd-verifier)_
