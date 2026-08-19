---
phase: 48-ingest-candidate-grouping-enum-unification-workflow-phase
reviewed: 2026-08-19T00:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - scripts/fixtures/phase48-p11-manifest.fixture.json
  - scripts/verify-phase-48.ts
  - src/lib/assetTypes.ts
  - src/lib/candidateGrouping.ts
  - src/lib/ingestAssets.ts
  - src/routes/v1/assets-registry/index.ts
  - src/routes/v1/pipeline/ingest/images.ts
  - package.json
findings:
  critical: 2
  warning: 5
  info: 7
  total: 14
status: issues_found
---

# Phase 48: Code Review Report

**Reviewed:** 2026-08-19
**Depth:** standard (with executable adversarial probes against `:memory:` sqlite)
**Files Reviewed:** 8
**Status:** issues_found

## Summary

The contract layer (`assetTypes.ts`, `candidateGrouping.ts`) is well-factored and the verify script passes 114/114 assertions; `tsc --noEmit` is clean. However, executable probing of the grouping engine and the transactional service confirmed **two silent data-corruption paths** that defeat the phase's central invariant ("exactly one `isPrimaryView=true` per group"): duplicate `filePath` entries in a batch, and duplicate `shot_id` (same side) across manifest entries. In both cases the API returns 200 OK, the on-disk group structure is corrupted, and the in-transaction D-04 assertion is structurally blind to the violation. Both are reachable through the HTTP route because the zod schemas enforce no uniqueness, and both are squarely in the path of the stated Phase-50 backfill reuse (raw kmc manifest JSON is exactly the kind of input that contains repeats).

All probe evidence below was reproduced against the real modules (`planGroups` + `ingestImagesPayload`) on a `:memory:` sqlite DB; production `db2.sqlite` was never touched.

## Critical Issues

### CR-01: Duplicate `filePath` in one batch silently breaks the exactly-one-primary invariant and defeats the D-04 assertion

**File:** `src/lib/ingestAssets.ts:111-116`, `src/lib/candidateGrouping.ts:245-260`, assertion blind spot at `src/lib/ingestAssets.ts:219-230`; missing rejection at `src/routes/v1/pipeline/ingest/images.ts:31-49`

**Issue:** `planGroups` builds the naming channel from unclaimed images without deduplicating by `filePath` (`variantsByBase` at candidateGrouping.ts:253-260 pushes every occurrence, including a second image object with an identical path), and `groupInfoByPath` (ingestAssets.ts:111-116) is keyed by `filePath`, so every duplicate of the primary path is written with `isPrimaryView=1, assetsId=NULL`.

The D-04 assertion (ingestAssets.ts:219-230) only counts rows matching `id = primary OR assetsId = primary`. A duplicated primary row has `id ≠ primary` and `assetsId = NULL`, so it is invisible to the assertion — the invariant is violated on disk while the batch commits successfully with 200 OK.

Reproduced (`ingestImagesPayload`, batch `[hero.png, hero_v1.png, hero_v1.png, hero.png]`):

```
P2 result: [{"groupKey":"name:hero","primaryAssetId":1,"memberAssetIds":[1,2,2]}] count: 4
P2 rows: id=1 hero.png   isPrimaryView=1 assetsId=null
         id=2 hero_v1    isPrimaryView=0 assetsId=1
         id=3 hero_v1    isPrimaryView=0 assetsId=1   ← duplicate member row
         id=4 hero.png   isPrimaryView=1 assetsId=null  ← SECOND primary, invisible to assertion
```

Downstream impact: `GET /assets/:id/variants` returns the duplicated member twice; `GET /assets/project/:id` (`whereNull("assetsId")`) lists the duplicated primary as a second top-level asset. The response `memberAssetIds` is also wrong (`[1,2,2]` — id 3 missing, id 2 listed twice).

**Fix:**
1. Reject duplicates at the route (400 with the offending paths):
```ts
const paths = images.map((i: any) => i.filePath);
const dups = paths.filter((p: string, i: number) => paths.indexOf(p) !== i);
if (dups.length > 0) return res.status(400).send(error("filePath 重复: " + [...new Set(dups)].join(", ")));
```
2. Defensively, dedupe by `filePath` at the top of `planGroups` (`const images = raw.filter((img, i) => raw.findIndex(o => o.filePath === img.filePath) === i)`).
3. Fix the assertion's blind spot — verify the primary count across the group's *inserted* ids, not by id-reference:
```ts
const groupIds = s.memberAssetIds; // must contain exactly the rows written for this group
const primaryRows = await trx("o_assets").whereIn("id", groupIds).where("isPrimaryView", 1);
if (primaryRows.length !== 1) throw new Error(...);
```

### CR-02: Duplicate `shot_id` (same side) across manifest entries cross-links groups and makes the response disagree with the database

**File:** `src/lib/ingestAssets.ts:117-118` and `145-147` (`groupByKey` / `primaryAssetIdByGroup` last-writer-wins), `src/lib/candidateGrouping.ts:226-236` (no groupKey uniqueness); missing uniqueness check at `src/routes/v1/pipeline/ingest/images.ts:50-63`

**Issue:** Two manifest entries with the same `shot_id` and the same side produce two `AssetGroupPlan`s with an identical `groupKey`. `groupInfoByPath` then labels the first entry's members with that `groupKey`, but `primaryAssetIdByGroup` (ingestAssets.ts:145-147) is built from a `Map` where the second group's primary overwrites the first — so the first group's members get `assetsId` pointing at the **second** group's primary. The response `groups` array then claims a primary/member pairing that does not exist on disk.

Reproduced (two manifest entries, both `shot_id: "S1_B1"`, both `first` side, disjoint frame sets):

```
A groups: [{groupKey:"shot:S1_B1:first", primaryAssetId:2, memberAssetIds:[1,2]},
           {groupKey:"shot:S1_B1:first", primaryAssetId:3, memberAssetIds:[3,4]}]
A rows:   id=1 f_v1 assetsId=3   ← member of group 1 attached to group 2's primary
          id=2 f_v2 assetsId=null isPrimaryView=1  ← group 1's primary, zero members on disk
          id=3 g_v1 assetsId=null isPrimaryView=1
          id=4 g_v2 assetsId=3
```

`GET /assets/2/variants` returns empty although the API response said member 1 belongs to group primary 2. The D-04 assertion passes for both groups (each primary row has exactly one `isPrimaryView=1` in its own reference scope). A concatenated/merged kmc manifest listing a shot twice is a realistic input for this endpoint and for the Phase-50 backfill.

**Fix:** Enforce `shot_id` uniqueness in the route schema (`.refine(ms => new Set(ms.map(m => m.shot_id)).size === ms.length, "manifests 中 shot_id 重复")`), and/or in `planGroups` throw (`groupKey already planned`) when pushing a duplicate `groupKey` instead of silently emitting colliding groups. Optionally extend the in-transaction check to assert `memberAssetIds`-derived rows all carry `assetsId = primaryAssetId` (except the primary), which would have caught this cross-link.

## Warnings

### WR-01: `planGroups` throws `TypeError` on a non-string manifest list entry when the selected index resolves it

**File:** `src/lib/candidateGrouping.ts:213-215`

**Issue:** The members loop guards `typeof p !== "string"` (line 204) and `useDirBase` guards it (line 195-197), but the selected-variant resolution `resolveImage(list[selected - 1])` does not — `basename()`/`segments()` call `p.split` and crash. Reproduced: manifest `{ all_first_frames: [str, 42], selected_first_variant: 2 }` → `TypeError: p.split is not a function`, killing the whole batch (500 via route is impossible — zod blocks it — but the direct service call path that Phase 50 will use on raw manifest JSON has no such guard). The transaction rolls back, so no partial writes, but one malformed manifest entry takes down the entire backfill run.

**Fix:** Guard before resolving:
```ts
if (typeof selected === "number" && Number.isInteger(selected) && selected >= 1 && selected <= list.length) {
  const selPath = list[selected - 1];
  const selImg = typeof selPath === "string" ? resolveImage(selPath) : undefined;
  ...
}
```

### WR-02: Unknown `assetType` is silently written raw, contradicting the D-06 "never silently pass through on the write path" policy

**File:** `src/lib/ingestAssets.ts:199`

**Issue:** `type: normalizeAssetType(img.assetType ?? "") ?? img.assetType ?? null` — when normalization fails, the *original* unknown token is written to `o_assets.type`. `assetTypes.ts:69-71` explicitly documents "anything else → null (unknown is UNKNOWN, never silently passed through on the write path)", but the write path does exactly the passthrough the truth source forbids. Reproduced: direct call with `assetType: "keyframe"` → DB row `type = "keyframe"`. The route's zod enum protects HTTP callers, but the Phase-50 backfill this service is built for will feed it legacy rows/manifests with arbitrary tokens, re-introducing exactly the vocabulary drift this phase exists to eliminate — and those new junk values will never be found by `expandTypesForQuery` (only `role`/`tool` alias).

**Fix:** Write `null` (or a `"unknown"` sentinel) plus a `console.warn` when normalization fails, matching `deriveWorkflowPhase`'s documented null policy one block above:
```ts
const normalizedType = normalizeAssetType(img.assetType ?? "");
if (normalizedType === null) console.warn(`${LOG_PREFIX} unknown assetType ${JSON.stringify(img.assetType)}, 写入 null`);
...
type: normalizedType,
```

### WR-03: Naming channel groups by bare base stem, merging unrelated files across directories

**File:** `src/lib/candidateGrouping.ts:253-260` (`variantsByBase` keyed by stem only), `245-249` (`canonicalByStem` same)

**Issue:** The manifest channel carefully disambiguates by parent directory (`dirBase`, with a comment explaining why basename-only would "steal a sibling shot's file"), but the naming channel has no directory awareness at all. Reproduced: `/oss/projA/p04/turnaround_sheets/hero_v1.png` + `/oss/projB/p09/fanart/hero_v2.png` → one group `name:hero`. Within a single-project batch this still merges unrelated same-named families from different skill output dirs (p04 turnarounds vs p09 fanart), producing a wrong primary (canonical of family A may outrank family B's lowest variant) and cross-family `assetsId` links that the asset center UI will render as variants of each other.

**Fix:** Key the naming channel by `dirBase`-style parent+stem (`${parentDir}/${base}`), or minimally require variant and canonical to share the immediate parent directory before joining them into one base.

### WR-04: `.max(200)` on `images` is a silent breaking change for legacy callers

**File:** `src/routes/v1/pipeline/ingest/images.ts:49`

**Issue:** The old schema had no cap; a previously-valid 250-image kmc batch now fails with 400 mid-run, while the file header claims "old payloads … stay valid by construction". No in-repo caller exists to prove breakage (only `src/router.ts:312` mounts the route), but the endpoint's consumers are external kmc/register scripts, and nothing documents the new limit or a chunking contract.

**Fix:** Either document the 200 cap in the route header and return a chunking hint in the 400 message, or raise the cap to a value safely above known batch sizes (turnaround registers scale with character count × views).

### WR-05: Basename-fallback mode silently drops/mis-attributes shot groups when batch dirs are not preserved

**File:** `src/lib/candidateGrouping.ts:195-208`

**Issue:** When `useDirBase` is false (batch doesn't preserve `iframes_{shot}` dirs) and frame basenames repeat across shots — which the module's own header says is the kmc norm ("every iframes_{shot} dir holds first_frame_v1.png …") — the first manifest entry claims the shared basename and later sibling entries get `members.length < 1` and are silently skipped (their frames land as standalones, their manifest prompts never applied). The inline comment acknowledges the theft risk when *mixing* modes but the pure-basename mode itself still mis-attributes, with no signal to the caller.

**Fix:** When a manifest list resolves fewer members than its length in basename mode, surface it (e.g. include a `degraded: true` flag or a warnings array on `GroupPlanResult`) so the route/backfill can log or reject instead of silently degrading.

## Info

### IN-01: Unused import `validateFields`

**File:** `src/routes/v1/assets-registry/index.ts:5`
**Issue:** Imported but never used in this file (all handlers use `safeParse` directly). Pre-existing.
**Fix:** Delete the import.

### IN-02: Verify-script DDL comment overclaims "column-for-column" parity

**File:** `scripts/verify-phase-48.ts:322-352`
**Issue:** The mirrored `o_assets` table omits `promptErrorReason` (production DDL `src/lib/initDB.ts:462`) and drops the `imageId` FK. Harmless for the assertions run, but the comment invites future maintainers to trust a parity that doesn't exist.
**Fix:** Reword to "subset mirror" or add the missing column.

### IN-03: Registry `POST /` still uses non-transactional `maxId+1` (pre-existing)

**File:** `src/routes/v1/assets-registry/index.ts:50-53`
**Issue:** Concurrent creates can compute the same id → one caller gets a raw UNIQUE-violation 500. The new `ingestAssets.ts` demonstrates the correct in-transaction `maxId` pattern; this older sibling wasn't aligned.
**Fix:** Wrap in `u.db.transaction(...)` using the same `maxId` helper.

### IN-04: `meta` field unbounded while siblings are capped

**File:** `src/routes/v1/pipeline/ingest/images.ts:46`
**Issue:** `prompt`/`description` are capped at 10 000 chars but `meta: z.record(z.string(), z.unknown())` accepts arbitrarily large nested structures into a TEXT column.
**Fix:** Add a refine on serialized size (e.g. `JSON.stringify(value).length <= 10000`).

### IN-05: Group-level `characterId` overwrites members' own values

**File:** `src/lib/ingestAssets.ts:204` (`group?.characterId || img.characterId || null`)
**Issue:** `group.characterId` is derived from *any one* member (candidateGrouping.ts:220-225, 273-276); when members differ, every row in the group gets the first-found member's id and its own `characterId` is silently discarded. Intended for turnarounds (same character), but for manifest frame groups a frame carrying its own explicit `characterId` loses it.
**Fix:** Prefer `img.characterId || group?.characterId || null` (per-image wins, group fills gaps).

### IN-06: Dead guards in `parseVariantName`

**File:** `src/lib/candidateGrouping.ts:118-119`
**Issue:** `!Number.isFinite(variant)` and `variant < 0` are unreachable — `parseInt` on a `\d+` capture is always a finite non-negative integer.
**Fix:** Remove both checks (keep the `!m` null path).

### IN-07: Per-batch `uuid` scheme has a small collision envelope and no unique constraint

**File:** `src/lib/ingestAssets.ts:196`
**Issue:** All rows in a batch share the `now.toString(36)` prefix and differ only by 6 base-36 random chars (~36⁶ space); a 200-image batch has roughly a 1-in-10⁵ birthday chance of an internal collision, and the `uuid` column has no UNIQUE constraint to detect it. Pre-existing pattern (registry POST does the same).
**Fix:** Use `crypto.randomUUID()` (or add a UNIQUE index) — cheap insurance for the Phase-50 backfill that will mint these at scale.

---

**What checked out clean (verified, not assumed):** enum unification is real, not wrapped (`z.enum(CANONICAL_ASSET_TYPES)`, inline literal gone); `whereIn` chaining is AND-equivalent in knex; `expandTypesForQuery` legacy match and non-over-matching both proven on a real query; `workflow_phase` column has a `fixDB.ts` migration path (line 76) so the new insert column won't hit "no such column" on existing DBs; `z.record(z.string(), z.unknown())` uses the correct zod v4 two-arg form; `npm run verify:phase-48` passes 114/114 and `tsc --noEmit` is clean; manifest-priority, selected-variant fallback, canonical-primary, empty-payload no-op, and empty-table `maxId` behavior all reproduce as documented.

_Reviewed: 2026-08-19_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
