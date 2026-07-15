# Phase 47: Historical Backfill + Archival - Context

**Gathered:** 2026-07-16
**Status:** Ready for planning
**Source:** Inline planning session (skipped discuss-phase + research subagents per user preference)

<domain>
## Phase Boundary

Final v2.0 phase. One-shot repair of historical empty-shell asset nodes
in the canvas DB, then archive the repair script as a one-off so it
can't accidentally re-run on data that now satisfies the contract.

**Current state (snapshot 2026-07-16):**
- 751 total asset nodes in `canvas_nodes` table
- 417 empty-shell (no `description` AND no `prompt`) — down from the
  530 mentioned in the original ROADMAP (some repaired incidentally by
  subsequent canvas writes since 2026-07-12)
- 334 non-empty (already carry `prompt` or `description`)

The backfill script `scripts/backfill-asset-descriptions.py` (195 lines)
was created in the 2026-07-12 schema-ui-backfill quick task. It's
dry-run by default; `--apply` writes to the DB. The 4-step repair
algorithm per node:
1. Flatten `data.params.*` scalars to top-level (no overwrite)
2. Mirror `description` ↔ `prompt` if only one is present
3. Synthesize a description from provenance fields (filename, name,
   output_key, archetype+role, scene_id)

The script is correct + safe. Phase 47 is operational: run it with
`--apply`, verify the post-run state, manually sample, then archive.

In scope:
- Pre-flight contract gate (`npm run verify:phase-46-contracts` green)
- Snapshot baseline (417 empty-shells)
- Apply run with `--apply`
- Post-run automated verify (count drops significantly)
- Manual sampling checklist (10 nodes each from P04/P07/P08)
- Archive script to `scripts/oneoffs/` with deprecation header

Out of scope:
- Source-side manifest contract (Phase 42)
- canvas_sync cleanup (Phase 43)
- Receiver schema strictness (Phase 44 — already prevents new empty-shells)
- Text UI (Phase 45 — already renders repaired descriptions correctly)
- E2E contract tests (Phase 46 — gate is in place)

</domain>

<decisions>
## Implementation Decisions

### D1: Two-plan split — apply (autonomous: false) + archive (autonomous: true)

Plan 47-01 (Wave 1, `autonomous: false`) covers the apply step:
- Pre-flight verify:phase-46-contracts gate (BACKFILL-01 prerequisite)
- Baseline snapshot via dry-run
- Apply run
- Post-run automated verify

Plan 47-02 (Wave 2, depends on 47-01) covers archival + manual sampling:
- Move script to `scripts/oneoffs/`
- Add deprecation header
- Manual sampling checklist (BACKFILL-02)
- Final verify script that confirms the archival (BACKFILL-03)

### D2: Snapshot before apply is mandatory

`scripts/backfill-asset-descriptions.py` (dry-run) prints the
would-change count. We capture this BEFORE apply so the post-run count
can be compared. If apply fails mid-run, the snapshot is the recovery
reference. The snapshot lives at `.planning/phases/47-.../baseline-snapshot.txt`.

### D3: Post-run automated verify checks 3 things

A new script `scripts/verify-phase-47-backfill.ts`:
1. The empty-shell count is < 50% of baseline (significant reduction)
2. No `description` field is < 20 chars on a sampled node (Phase 42
   contract floor)
3. The backfill script has been moved to `scripts/oneoffs/` (archival
   verification)

The verify script does NOT require docker — it reads the SQLite DB
directly + checks the filesystem. Safe-tier like Phase 46 Plan 01.

### D4: Manual sampling checklist is human-only

Per the 47-VALIDATION.md Manual E2E section pattern: the plan documents
the sampling procedure (10 nodes each from P04/P07/P08 via the canvas
UI's search filter from Phase 45) but doesn't try to automate visual
inspection. Operator signs off in the VERIFICATION.md when done.

### D5: Archival location — scripts/oneoffs/

The script moves to `scripts/oneoffs/backfill-asset-descriptions.py`.
A deprecation header is prepended:

```python
"""
[DEPRECATED — Phase 47 archive, 2026-07-16]
This script was a one-shot repair for the 2026-07-12 empty-shell
asset nodes. Phase 42 hardened the source-side contract; Phase 44
hardened the receiver-side import; re-running this on data that now
satisfies the contract is unnecessary and risks overwriting newer
descriptions with synthesized ones.

Kept for audit/reproducibility. Do NOT add to cron. Do NOT run
against production data without explicit approval.
"""
```

A README in `scripts/oneoffs/` documents the convention for future
one-off scripts.

### Claude's Discretion

- Exact post-run assertion threshold — 50% reduction is the minimum;
  if the script's algorithm is sound, expect ≥90% reduction (417 →
  ~40 or fewer). Document the actual outcome.
- Whether to gzip the pre-apply DB snapshot — disk is cheap, skip
  gzip for simplicity.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The script being archived
- `scripts/backfill-asset-descriptions.py` — 195-line Python script; dry-run by default; `--apply` writes to SQLite. DB path: `/data/workspace/kais-aigc-platform/data/db2.sqlite` (hard-coded constant at line 35).

### Phase 46 contract gate (BACKFILL-01 prerequisite)
- `npm run verify:phase-46-contracts` — 62 assertions, ~1.5s; MUST pass before apply
- `scripts/verify-schema-roundtrip.ts` — Phase 44 Wave 3 (still green)
- `scripts/verify-phase-45.ts` — Phase 45 verifier (still green)

### Phase 45 UI (BACKFILL-02 sampling surface)
- `packages/infinite-canvas/src/components/NodeDetailPanel.tsx:472-621` — AssetDetail renders description + prompt + tags + provenance fallback (post-repair nodes will render all 4 sections)
- `packages/infinite-canvas/src/components/FlowCanvas.tsx` — Phase 45 toolbar search input lets operators find nodes by description keyword

### Canvas DB write path (post-run inspection surface)
- `src/lib/canvasRelationalStore.ts:42-110` — `canvas_nodes` table writes via Knex transactions
- The `data` column stores JSON; backfill script parses + writes JSON

</canonical_refs>

<scope_fence>
## Scope Fence

In scope:
- `.planning/phases/47-historical-backfill-archival/baseline-snapshot.txt` — pre-apply capture
- `scripts/verify-phase-47-backfill.ts` (NEW) — post-run automated verify
- `scripts/oneoffs/backfill-asset-descriptions.py` — MOVED here from `scripts/` + deprecation header
- `scripts/oneoffs/README.md` (NEW) — one-off script convention
- `package.json` — register `verify:phase-47-backfill`
- `.planning/phases/47-historical-backfill-archival/47-VERIFICATION.md` — manual sampling sign-off section

Out of scope (Phase fences):
- Modifying the backfill script's algorithm — it's correct as shipped; Phase 47 runs it as-is
- Adding new tests to Phase 42 / 44 / 45 / 46 — those phases are complete
- Running the script against non-asset node types — explicitly out of scope per script docstring
- Cross-project backfill — only the DB at `data/db2.sqlite` is in scope

Anti-patterns to avoid:
- DO NOT run `--apply` without first capturing the dry-run baseline
- DO NOT run `--apply` without `verify:phase-46-contracts` green
- DO NOT re-run the script after archival (Phase 42 + 44 prevent new empty-shells; Phase 47 is a one-shot)
- DO NOT delete the backfill script — archived code is reproducibility evidence

</scope_fence>

<specifics>
## Specific Ideas

- The Phase 45 search filter (`packages/infinite-canvas/src/components/FlowCanvas.tsx`)
  makes manual sampling dramatically faster — operators can type
  "P04" / "P07" / "P08" to narrow visible nodes, then click 10 each.
- The Phase 44 `__incomplete` stamping on nodes that lack baseline
  expected params will still appear on backfilled nodes (the script
  populates description but doesn't add archetype/role/era for p04).
  This is intentional — Phase 45 UI shows the warning; future Phase 48+
  work could address it.
- The `data/db2.sqlite` is 328MB; backing up to `data/db2-backup-pre-phase-47.sqlite`
  before apply is cheap insurance.

</specifics>

<deferred>
## Deferred Ideas

- Cross-project backfill (other DB instances) — out of scope; only the
  primary dev DB is repaired. Production deployments would need their
  own runbook.
- Backfill of `__incomplete` stamping on pre-Phase-44 rows — would
  require a separate script that re-evaluates each node against
  `EXPECTED_PARAM_FIELDS_BY_TYPE`. Phase 44 prevents new empty-shells
  going forward; old shells keep their (correct) lack of stamping.
- Migration of the backfill approach into a maintained "data repair"
  framework — Phase 47 ships a one-off; future framework is a separate
  initiative.

</deferred>

---

*Phase: 47-historical-backfill-archival*
*Context gathered: 2026-07-16 via inline planning session*
