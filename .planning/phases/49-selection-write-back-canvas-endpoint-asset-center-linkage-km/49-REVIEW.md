---
phase: 49-selection-write-back-canvas-endpoint-asset-center-linkage-km
reviewed: 2026-08-19T11:55:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - packages/infinite-canvas/src/services/canvasApi.ts
  - packages/infinite-canvas/src/store/canvasStore.ts
  - packages/infinite-canvas/src/store/__tests__/selectWinner.test.ts
  - scripts/verify-phase-49-bridge.ts
  - scripts/verify-phase-49-linkage.ts
  - src/lib/canvasAssetLinkage.ts
  - src/lib/reviewBridge.ts
  - src/routes/canvas/v2/select-winner.ts
  - src/routes/v1/assets-registry/index.ts
findings:
  critical: 1
  warning: 10
  info: 5
  total: 16
status: issues_found
---

# Phase 49: Code Review Report

**Reviewed:** 2026-08-19T11:55:00Z
**Depth:** standard (plus adversarial probes against real modules on isolated sqlite / mocked HTTP)
**Files Reviewed:** 9
**Status:** issues_found

## Summary

All four phase gates pass (`verify:phase-49` 65/65, `-bridge` 46/46, `-linkage` 42/42, vitest selectWinner 7/7). The core selection write-back is solid: transactional `winner_node_id` + `is_winner` writes are correct, idempotency is real (zero writes), loop prevention between the registry hook and the select-winner endpoint holds (both half-links write directly, neither re-enters the other's route), and the bridge is genuinely fire-and-forget (`void` + `.catch`, never awaited).

However, adversarial probing of the real modules confirmed one blocker and several significant defects, concentrated in the two "soft" integration surfaces — the review bridge and the registry→canvas linkage:

**Probes executed (real modules, isolated):** a local node:http mock of the review platform; a temp-file sqlite (chdir isolation mirroring the verify scripts). Results:

- **CONFIRMED (blocker):** `resolveOpenReviewForSelection` has no episode/project scoping in its candidate filter — a selection for project 777/episode 999 approved a review whose `content_ref` was `ep-OTHER/p11a0`. The ambiguity guard (>=2 matches → skip) does not protect the single-wrong-match case, which is exactly the case that occurs when the current episode has no open gate but another episode/project does.
- **CONFIRMED:** phase-token prefix collision — a `p1_*` phase token prefix-matches gate `p11a0` (both in `type` and in the `content_ref` phase segment), approving a different phase's gate.
- **CONFIRMED:** D-07 gap — selecting an *unmapped* winner leaves the old winner's `o_assets.isPrimaryView = 1` forever (`swappedAssetIds: []`).
- **CONFIRMED:** registry→canvas linkage picks an arbitrary episode when the same `a-oasset-{id}` node exists in multiple episodes (`.first()` with no `orderBy`), leaving sibling episodes' groups stale.
- **CONFIRMED:** legacy frontend path `syncWinnerToGroups(...)[0]` returns the *first* group, not the selected one — `variantGroups[].winnerNodeId` is silently never updated unless the target group happens to be first.
- **REFUTED (invariant held):** concurrent selects (same/different winners) on real sqlite — exactly-one-winner held; idempotency TOCTOU did not reproduce (better-sqlite3 serializes).

## Narrative Findings (AI reviewer)

### CR-01: Review bridge approves gates from other episodes/projects — no episode/project scoping in candidate filter

**File:** `src/lib/reviewBridge.ts:133-138` (probe evidence; consumed at `src/routes/canvas/v2/select-winner.ts:105-112`)
**Issue:** The client-side candidate filter checks only `type.startsWith(phaseToken)` and the `content_ref` phase segment. `params.episodesId` / `params.projectId` are never used in matching (they only appear in the approve comment). Gates are shared across episodes (same phase pipeline), and the platform list is global per `source=kais-movie-agent`. When the selecting episode has **no** open gate of that phase but exactly one **other** episode/project does, `candidates.length === 1` and the bridge POSTs `approve` with `result.selected` — auto-approving another episode's human gate and recording a chosen variant into its review record.

Probe (real module + mocked platform): selection for `{projectId: 777, episodesId: 999}` with the only open review `content_ref: "ep-OTHER/p11a0"` produced:

```
POST /api/v1/reviews/55/approve
{"comment":"choose:v2 (canvas group g1 winner n1, project 777/999)","result":{"selected":[2]}}
```

Mitigating context (honest note): the module header documents that kmc's poller currently cannot read platform resolves, so downstream auto-resume is muted today — but the review-platform record itself is corrupted (state → COMPLETE, someone else's gate marked approved with a foreign variant).
**Fix:** Encode the episode identity in the match. kmc's `content_ref` is `${episodeId}/${phase}`, so require the `content_ref` episode segment to correspond to `params.episodesId` (compare against both `ep${episodesId}` and `String(episodesId)` until the kmc format is frozen), e.g.:

```ts
const epSeg = item.content_ref.slice(0, item.content_ref.lastIndexOf("/"));
const epIds = new Set([`ep${params.episodesId}`, String(params.episodesId)]);
if (!epIds.has(epSeg)) return false;
```

If the format cannot be matched reliably, fail **closed**: when the phase matches but the episode cannot be verified, treat it as a mismatch and skip (a missed bridge is benign; a wrong approve is not).

### WR-01: Phase-token prefix collision — `p1` matches gate `p11a0`

**File:** `src/lib/reviewBridge.ts:83-87, 133-138`
**Issue:** `derivePhaseToken` takes the first `_`-segment and the filter uses `startsWith` with no boundary. A phase named `p1_tone` yields token `p1`, which prefix-matches both `type: "p11a0"` and the `content_ref` segment `"p11a0"` (the double filter does not help — both filters share the same prefix weakness). Probe confirmed: a `p1_tone` winner approved review 66 (`p11` gate) with `choose:v1`. Trigger is theorized to be rare while all phase names are zero-padded (`p01`–`p13`), but phase names are data-driven (`canvas_nodes.phase_name`) and nothing enforces padding — and a `p1` token would also collide with `p10_*`.
**Fix:** Match the gate's numeric prefix exactly: extract the leading `p\d+` from `item.type` and require equality with the token (or require the remainder after the token in `type` to be non-digit):

```ts
const m = /^p\d+/.exec(item.type);
if (!m || m[0] !== phaseToken) return false;
```

### WR-02: Bridge reads only the first page — `limit: 100` hardcoded, `has_more`/`next_cursor` never followed

**File:** `src/lib/reviewBridge.ts:115-128`
**Issue:** The GET is issued once with `limit=100`; `next_cursor`/`has_more` from the envelope are never read (probe: exactly 1 GET in all cases). With more than 100 APPROVING reviews from `kais-movie-agent`, the real gate can fall off page 1 → bridge silently info-skips (missed resolve), or — combined with CR-01's weak filter — a wrong single candidate from page 1 is approved.
**Fix:** Paginate with a bounded loop (e.g. max 5 pages) using `next_cursor` until `has_more` is false, then filter; or raise `limit` to the platform max and treat `has_more === true` as an ambiguity condition (skip + warn) rather than proceeding on a partial list.

### WR-03: D-07 reverse linkage silently no-ops when the new winner is unmapped — old winner's `isPrimaryView` stays `1`

**File:** `src/routes/canvas/v2/select-winner.ts:84-98` (guard), `src/lib/canvasRelationalStore.ts:564-569` (`syncAssetPrimaryForWinner` early `return []`)
**Issue:** The swap runs only `if (result.winnerOAssetId != null)`. Two proven stale-state paths: (a) the new winner node maps to no `o_assets` row (`data.oAssetId` absent and id not `a-oasset-<n>`); (b) the winner's asset row lives under a different `projectId` (asset moved projects) — `winnerRow` lookup misses and returns `[]`. In both cases the demotion of the *previous* winner's asset never happens: canvas says winner = `u1` while `o_assets` 21 remains `isPrimaryView = 1` (probe confirmed, `swappedAssetIds: []`). The registry and canvas truth sources diverge with no warn — this is not the documented "failure only warns" path, it is a silent no-op.
**Fix:** When `status === "updated"`, demote even when the new winner is unmapped — the *member* set is still known. Change the route guard to also run a demotion-only pass:

```ts
if (result.winnerOAssetId != null) {
  result.swappedAssetIds = await syncAssetPrimaryForWinner(db, projectId, result.winnerOAssetId, result.memberOAssetIds);
} else if (result.memberOAssetIds.length > 0) {
  result.swappedAssetIds = await demoteAssets(db, projectId, result.memberOAssetIds); // demote members, promote nothing
}
```

At minimum, `console.warn` when an updated selection changes no `o_assets` row while members were mapped.

### WR-04: Registry→canvas linkage picks an arbitrary episode when the asset's node exists in several episodes

**File:** `src/lib/canvasAssetLinkage.ts:64-72`
**Issue:** The lookup matches `id = 'a-oasset-{id}'` scoped to `project_id` but across **all** `episodes_id`, using `.first()` with no `orderBy` and no episodes input. Probe: nodes `a-oasset-30` in episodes 5 and 9 (groups `gE5`/`gE9`) — the linkage wrote the winner into `gE5` (rowid order) and left `gE9` untouched; which episode "wins" is an artifact of scan order, not a decision. A project with multiple episodes gets its winner written into an effectively random episode's group. The header documents "取首行" as a decision, but the row chosen is unspecified and the sibling-episode staleness is unhandled.
**Fix:** Add a deterministic `orderBy("episodes_id", "asc")` (so behavior is at least reproducible), and either log the sibling groups left stale or — better — apply the selection to **all** episodes' groups for that node id (the asset has no episode dimension, so all mapped groups should agree):

```ts
const nodes = await db("canvas_nodes")
  .where({ id: `a-oasset-${oAssetId}`, project_id: projectId })
  .orderBy("episodes_id", "asc");
```

…then loop `selectWinnerInGroup` per `(episodesId, variantGroupId)` ref.

### WR-05: Legacy path: `syncWinnerToGroups(...)[0]` returns the wrong group — `variantGroups[].winnerNodeId` never updated

**File:** `packages/infinite-canvas/src/store/canvasStore.ts:586-590`
**Issue:** `syncWinnerToGroups` maps over **all** groups and returns the whole array; `[0]` is the first element — `groups[0]`, not the group whose `groupId === variantGroupId`. Probe on the real `variantOps` module: with `variantGroups = [gA, gTarget]`, `[0]` yields `gA` (no `winnerNodeId` set) and `upsertVariantGroup(gA)` is a no-op; `gTarget.winnerNodeId` is silently never persisted in store state. Works only by accident when the target group is first. The test suite never exposes this — legacy fixtures run with `variantGroups: []`, so step 3 never executes (test gap).
**Fix:**

```ts
const updated = syncWinnerToGroups(variantGroups, variantGroupId, nodeId)
  .find((g) => g.groupId === variantGroupId)
if (updated) upsertVariantGroup(updated)
```

### WR-06: Legacy path rollback restores nodes+edges but not `variantGroups` — stale winner persists after rollback

**File:** `packages/infinite-canvas/src/store/canvasStore.ts:586-600`
**Issue:** Step 3 (`upsertVariantGroup`) mutates `variantGroups` on the optimistic path, but the failure handler (lines 597-600) restores only `rb.nodes` / `rb.edges`. After a failed API call the store holds the *new* winner in `variantGroups[].winnerNodeId` alongside the rolled-back nodes/edges — precisely the "UI 已换选但库里没写" inconsistency SC-2 exists to prevent, surviving in the deprecated-but-live persistence-layer state that legacy components consume.
**Fix:** Snapshot and restore `variantGroups` too:

```ts
const prevGroups = variantGroups            // before optimistic upsert
...
catch (err) {
  const rb = rollbackWinnerSelection(outcome)
  set({ nodes: rb.nodes, variantGroups: prevGroups })
  setEdges(rb.edges)
  ...
}
```

(The graph path is unaffected — `setGraph` re-derives groups.)

### WR-07: `apiCall` disarms its timeout after the first attempt — retries have no timeout and all 4xx/5xx are retried

**File:** `packages/infinite-canvas/src/services/canvasApi.ts:78-137` (`clearTimeout` at 95 and 113 inside the retry loop)
**Issue:** `clearTimeout(timeoutId)` runs after attempt 0 completes (success or catch), but attempts 1–2 reuse the same `combinedController.signal` which nothing can abort anymore (except an explicit cancel token). A hung retry fetch never times out, so `selectVariantWinner` can hang indefinitely — the optimistic winner stays on screen with no toast and **no rollback**, violating SC-2's guarantee for the slow-failure path. Additionally, `!res.ok` is classified `'network'` (line 98), so business failures (400 validation, 404 group-missing, 409 multi-mode) are retried twice with 1s+2s backoff before the user sees the rollback toast — a deterministic 409 takes ~3s of pointless retries. This helper is pre-existing, but phase 49 put `selectWinner` persistence on it.
**Fix:** Arm a fresh timeout per attempt:

```ts
for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
  const attemptTimeout = new AbortController();
  const tid = setTimeout(() => attemptTimeout.abort(), timeout);
  // combine attemptTimeout.signal + cancelToken.signal per attempt; clearTimeout(tid) at loop-body end
}
```

And classify HTTP-status errors so non-idempotent business statuses (400/409/404) are not retried.

### WR-08: `variant:selected` broadcast is emitted but no client consumes it

**File:** `src/routes/canvas/v2/select-winner.ts:114-120` (frontend evidence: `packages/infinite-canvas/src/hooks/useCanvasSocket.ts` — full `socket.on` list has no `variant:selected` handler)
**Issue:** The endpoint broadcasts `variant:selected` to the project room, but the only socket client registers handlers for `node:*`, `branch:*`, `review:*`, `graph:saved`, `canvas:*`, `orchestrate:*` — never `variant:selected`. Consequence: a winner selection made in one tab/user is invisible to every other viewer until a full reload; the broadcast is a dead letter. The selecting client's state survives only via its own optimistic update (and the review-approve flows `review:approved` do have handlers, making this omission inconsistent).
**Fix:** Add a handler in `useCanvasSocket.ts` that applies the selection locally when it did not originate from this client (`payload.winnerNodeId` + `groupId` → `applyGraphTransform(selectVariant(...))` guarded against echo of the local selection), or drop the broadcast if cross-client sync is deferred.

### WR-09 (theorized): Server side lacks the `curation:'locked'` guard the client enforces — registry linkage bypasses it entirely

**File:** `src/routes/canvas/v2/select-winner.ts:52-57`, `src/lib/canvasAssetLinkage.ts:113-118`
**Issue:** `selectVariant` (client, `packages/flowgraph-v3/ts/src/variants.ts:54-63`) refuses to overwrite a group containing a `curation:'locked'` member (§11 reference-lock semantics). `selectWinnerInGroup` has no such check — it never reads curation (it lives in the `data` JSON blob, deliberately untouched). Therefore: (a) a direct API call to select-winner can flip a locked group's winner even though the UI would refuse; (b) the registry PATCH → linkage path (which never passes through the client) can do the same from the asset center. Marked theorized: trigger requires a persisted locked group carrying `variant_group_id`, which I could not confirm exists in production data.
**Fix:** In `selectWinnerInGroup`, after loading `memberRows`, reject with a new status (e.g. `locked`) when any member's parsed `data.curation === 'locked'`; map it to 409 in the route and to an info-skip in the linkage.

### WR-10 (pre-existing, in reviewed file): Asset creation uses read-then-increment `maxId + 1` — concurrent creates collide

**File:** `src/routes/v1/assets-registry/index.ts:51-55`
**Issue:** `POST /` selects all ids, reduces to max, inserts `maxId + 1`. Two concurrent creates compute the same id; the second insert fails the PK with a 500. Pre-existing (not introduced by this phase's PATCH hook), but it sits on the same table the phase-49 linkage reads.
**Fix:** Drop the manual id (let SQLite `increments` assign) and return `insertedId` via the insert callback, or wrap create in a transaction with an exclusive lock.

## Info

### IN-01: `groupId` path param unvalidated — asymmetric with `winnerNodeId` max(128)

**File:** `src/routes/canvas/v2/select-winner.ts:44-49`
**Issue:** T-49-01 capped `winnerNodeId` (`min(1).max(128)`) but `req.params.groupId` flows into the where-clause and the bridge comment unbounded. Parameterized (no injection), but an oversized/malformed id produces a raw sqlite 500 instead of a 400.
**Fix:** `const groupId = z.string().min(1).max(128).parse(req.params.groupId)` inside the same safeParse try, returning 400 on failure.

### IN-02: Bridge interpolates `target.id` into the URL without encoding

**File:** `src/lib/reviewBridge.ts:152-154`
**Issue:** `` `${baseUrl}/api/v1/reviews/${target.id}/approve` `` — `id` comes from the external platform response (`id?: number | string`). A non-numeric id would silently alter the request path. Low risk (source is the platform itself), but trivially hardened.
**Fix:** `encodeURIComponent(String(target.id))`.

### IN-03 (pre-existing): `openAssetDetail` doc comment contradicts implementation

**File:** `packages/infinite-canvas/src/store/canvasStore.ts:167-169, 692`
**Issue:** Comment says "同时设选中 + 切到 detail 子视图" but the implementation only sets `selectedAssetUuid` — it never sets `assetView: 'detail'`. Either the comment is stale or the view switch is missing.
**Fix:** Align: `set({ selectedAssetUuid: uuid, assetView: 'detail' })` or fix the comment.

### IN-04: `json_extract` fallback throws on malformed `data` JSON rows

**File:** `src/lib/canvasAssetLinkage.ts:67-72`
**Issue:** SQLite `json_extract` raises `malformed JSON` if any scanned row's `data` is non-JSON text; the exported `findCanvasNodeForAsset` would reject. Contained today because the only caller wraps in try/catch (warn), but the export's contract ("returns null when unmapped") does not hold for dirty data.
**Fix:** `whereRaw("json_valid(data) AND json_extract(data, '$.oAssetId') = ?", [oAssetId])` or wrap the fallback query in its own try/catch returning `null`.

### IN-05: New state-changing endpoint follows the platform's no-auth posture

**File:** `src/routes/canvas/v2/select-winner.ts:41` (mount at `src/router.ts:202`)
**Issue:** `select-winner` mutates canvas truth, swaps registry primaries, and triggers external approvals with no authentication/authorization — consistent with the rest of `src/router.ts` (no auth middleware anywhere; `/canvas/v2/health` is explicitly documented as unauthenticated), so not a phase-49 regression. On a shared LAN/tailscale network this is an unauthenticated write surface.
**Fix:** Platform-level decision (auth middleware or network isolation); out of this phase's scope to change unilaterally.

---

**Invariants probed and held:** exactly-one-winner under concurrent selects (different and same winners) on real sqlite — serialized by better-sqlite3, final `is_winner=1` row count always 1; idempotent re-select performs zero writes; loop prevention (PATCH → linkage → `selectWinnerInGroup` performs no `o_assets` write, no HTTP; select-winner D-07 writes `o_assets` directly, never via the registry route); bridge never blocks or throws into the endpoint path (`void` + `.catch` + internal swallow, verified by source and gate); frontend graph-path rollback restores the exact prior graph (including edge state via wholesale `prevGraph`).

_Reviewed: 2026-08-19T11:55:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
