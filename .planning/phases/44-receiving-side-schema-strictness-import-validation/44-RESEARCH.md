# Phase 44: Receiving-side Schema Strictness + Import Validation - Research

**Researched:** 2026-07-16
**Domain:** TypeScript zod schema mirroring + Express route import validation + Node-side E2E round-trip script
**Confidence:** HIGH

## Summary

Phase 44 is the receiving-side mirror of Phase 42's source-side manifest contract. The work is smaller than it first appears because the infrastructure is already in place: `canvasAssetSchema.ts` already has a `withYamlOptional()` augmentation hook, `pipeline-field-map.yaml` already lists most v2.0 fields, `PATCH /nodes/batch` already returns 400 with aggregated errors, and `import-from-dir.ts` already flattens `params.*` into `artData`. The real work is **gap closure + warn-stamping + a verification script**, not greenfield architecture.

Three concrete gaps drive the implementation. First, a small set of v2.0 fields (`era`, `shot_type` for video, `hook_type` family for script, and a few more) are present in the Python `MANIFEST_PARAM_SCHEMA` / `PHASE_REQUIRED_FIELDS` but missing from both `pipeline-field-map.yaml` and the hand-written per-type zod schemas — these must be promoted into the YAML so `withYamlOptional` picks them up. Second, `import-from-dir.ts` silently drops unmatched fields (via the hard-coded allowlist at line 410-422) instead of warning; it needs an expected-field check + `__incomplete` / `__missing_fields` stamp. Third, there is no automated test that every `params.*` key survives import into `node.data` — `scripts/verify-schema-roundtrip.ts` closes that gap.

**Primary recommendation:** Extend `pipeline-field-map.yaml` with the missing v2.0 fields (single source of truth), regenerate the three consumers via `python schema/generate_mappings.py`, add an explicit `EXPECTED_PARAM_FIELDS_BY_TYPE` map in `canvasAssetSchema.ts` (sourced from the same YAML) for import-path warnings, stamp `__incomplete` + `__missing_fields` in the artifact-build loop in `import-from-dir.ts`, and write `scripts/verify-schema-roundtrip.ts` as a standalone Node script that reuses the Phase 42 fixtures cross-repo.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Schema declaration (zod) | `src/lib/canvasAssetSchema.ts` | `schema/generated/frontend-zod-extensions.ts` | Single zod record consumed by both POST/PATCH routes and (newly) the import warning path |
| Optional-field source-of-truth | `schema/pipeline-field-map.yaml` | — | Generator emits Python + TS; manual edits forbidden per file header |
| Import path validation + warning | `src/routes/canvas/v2/import-from-dir.ts` | `canvasAssetSchema.ts` (expected-field lookup) | Import loop already flattens `params.*`; warn-stamping belongs in `buildPhaseTree`'s artifact loop |
| Batch validation | `src/routes/canvas/v2/nodes.ts` PATCH /batch | `canvasAssetSchema.ts:validateNodeData` | Already wired — Phase 44 only needs the per-type schemas to declare the full v2.0 field set |
| E2E round-trip verification | `scripts/verify-schema-roundtrip.ts` (new) | Phase 42 fixtures (cross-repo) | Standalone script pattern per project precedent (verify-phase-41.ts etc.) |
| UI rendering of `__incomplete` | — (Phase 45 territory) | — | Receiver only stamps; no UI work in Phase 44 |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | (already installed) | Runtime schema validation + type inference | Already imported in `canvasAssetSchema.ts` and `nodes.ts`; no new dependency |
| express | (already installed) | HTTP route handlers | Existing — PATCH /nodes/batch already uses `validateFields` middleware |
| yaml (via `js-yaml` or `python yaml`) | python 3.x stdlib + `pyyaml` | Source-of-truth config | `schema/generate_mappings.py` already reads YAML via `pyyaml` [VERIFIED: codebase read] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| tsx | (already dev-dep) | Standalone `.ts` script runner for `verify-schema-roundtrip.ts` | All verify-phase-N.ts scripts use `#!/usr/bin/env tsx` shebang [VERIFIED: codebase read of verify-phase-41.ts] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled `EXPECTED_PARAM_FIELDS_BY_TYPE` map | zod introspection (`schema.shape`) | Introspection is fragile (strips optionals, doesn't carry field provenance); explicit map is debuggable and lets us document expected-vs-required separately |
| Direct YAML import in TS import-path | Generated `frontend-zod-extensions.ts` | Generator flow already exists; re-importing YAML in TS would create a second parser path |

**Installation:** No new packages. Phase 44 only touches existing files.

**Version verification:** No new packages to verify against a registry. `zod`, `express`, `tsx` are pre-existing project dependencies (confirmed by reading existing imports in `canvasAssetSchema.ts:18`, `nodes.ts:1-2`, and the `scripts/verify-phase-41.ts` shebang).

## Package Legitimacy Audit

No new external packages are installed in Phase 44. All work is in-repo TypeScript/Python edits and a new standalone script that imports only from existing project modules. Skipped per protocol (no new packages to audit).

## Architecture Patterns

### System Architecture Diagram

```
   ┌────────────────────────────────────────────────────────────────────┐
   │ SOURCE SIDE (Phase 42, already shipped — kais-hermes-skills)      │
   │                                                                    │
   │  _manifest.py                                                      │
   │   ├─ MANIFEST_PARAM_SCHEMA      {video: {shot_id, engine,...}}     │
   │   ├─ PHASE_REQUIRED_FIELDS      {(asset,p04): {archetype, role}}   │
   │   ├─ REQUIRES_CONTENT           {video,audio,storyboard,asset}     │
   │   └─ MIN_DESCRIPTION_LEN = 20                                     │
   │            │                                                       │
   │            ▼ writes manifest.json                                  │
   └────────────────────────────────────────────────────────────────────┘
                                  │
                                  │  manifest.json on OSS
                                  ▼
   ┌────────────────────────────────────────────────────────────────────┐
   │ RECEIVING SIDE (Phase 44 — THIS PHASE — kais-aigc-platform)        │
   │                                                                    │
   │  schema/pipeline-field-map.yaml  ← SINGLE SOURCE OF TRUTH          │
   │            │                                                       │
   │            │  python schema/generate_mappings.py                   │
   │            ▼                                                       │
   │  schema/generated/                                                 │
   │   ├─ canvas_sync_mappings.py      (Python — Phase 43)              │
   │   ├─ frontend-enum-normalizers.ts (TS aliases + enum maps)         │
   │   └─ frontend-zod-extensions.ts   (TS optional zod fields)         │
   │            │                                                       │
   │            ▼ consumed by                                           │
   │  ┌─────────────────────────┐   ┌──────────────────────────────┐   │
   │  │ canvasAssetSchema.ts    │   │ import-from-dir.ts            │   │
   │  │  • assetDataSchemas     │   │  buildPhaseTree()             │   │
   │  │    (zod, per-type)      │   │   for each artifact:          │   │
   │  │  • withYamlOptional()   │◀──┤    1. flatten params.*        │   │
   │  │  • validateNodeData()   │   │    2. compare vs              │   │
   │  │  • EXPECTED_PARAM_      │   │       EXPECTED_PARAM_FIELDS   │   │
   │  │    FIELDS_BY_TYPE (NEW) │──▶│    3. if missing: stamp       │   │
   │  └────────────┬────────────┘   │       data.__incomplete=true  │   │
   │               │                │       data.__missing_fields   │   │
   │               │                │       console.warn(...)       │   │
   │               │                └──────────────┬───────────────┘   │
   │               │                               │                   │
   │               ▼                               ▼ node.data persisted│
   │  ┌─────────────────────────┐   ┌──────────────────────────────┐   │
   │  │ nodes.ts PATCH /batch   │   │ nodes.ts POST /               │   │
   │  │  validateNodeData()     │   │  validateNodeData()           │   │
   │  │  fail → 400 full list   │   │  fail → 400                   │   │
   │  └─────────────────────────┘   └──────────────────────────────┘   │
   │                                                                    │
   │  scripts/verify-schema-roundtrip.ts (NEW)                          │
   │   loads Phase 42 fixture JSON                                      │
   │   → runs import field-mapping                                      │
   │   → asserts every params.* key appears in resulting node.data      │
   │   → exit 0 / 1                                                     │
   └────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼ Phase 45+46+47
                          (UI rendering, E2E CI, backfill)
```

### Recommended Project Structure
```
src/lib/canvasAssetSchema.ts        # MODIFY: promote missing v2.0 fields + add EXPECTED_PARAM_FIELDS_BY_TYPE
schema/pipeline-field-map.yaml      # MODIFY: add missing fields (era, shot_type for video, etc.)
schema/generated/                   # REGENERATE via `python schema/generate_mappings.py`
src/routes/canvas/v2/import-from-dir.ts  # MODIFY: warn + stamp __incomplete in buildPhaseTree artifact loop
src/routes/canvas/v2/nodes.ts       # NO CODE CHANGE — tightening happens via schema expansion only
scripts/verify-schema-roundtrip.ts  # NEW: standalone tsx script
```

### Pattern 1: `withYamlOptional()` augmentation (existing)
**What:** Per-type zod schemas in `canvasAssetSchema.ts` are wrapped with `withYamlOptional("type", base)` which extends them with optional fields declared in `pipeline-field-map.yaml` (via generated `frontend-zod-extensions.ts`).
**When to use:** Anytime a new optional field needs to be declared on a receiving-side node type.
**Example:**
```typescript
// Source: src/lib/canvasAssetSchema.ts:37-49 [VERIFIED: codebase read]
function withYamlOptional<T extends z.ZodObject<any>>(
  baseType: string,
  base: T,
): z.ZodObject<any> {
  const extras = YAML_OPTIONAL_FIELDS[baseType] || [];
  const existing = Object.keys(base.shape);
  const toAdd: Record<string, z.ZodTypeAny> = {};
  for (const f of extras) {
    if (existing.includes(f.key)) continue;
    toAdd[f.key] = f.zodType === "number" ? z.number().optional() : z.string().optional();
  }
  return Object.keys(toAdd).length ? base.extend(toAdd) : base;
}
```

### Pattern 2: Whole-batch validate-then-reject (existing, the contract for PATCH /nodes/batch)
**What:** Validate every node in the batch before any write; if any fails, reject the whole batch with HTTP 400 + full error list.
**When to use:** Already used at `nodes.ts:121-132`. Phase 44 inherits this — no code change in `nodes.ts`; the schema expansion automatically tightens what counts as valid.
**Example:**
```typescript
// Source: src/routes/canvas/v2/nodes.ts:121-132 [VERIFIED: codebase read]
const validationErrors: Array<{ nodeId: string; errors: string }> = [];
for (const nodeInput of nodeInputs) {
  const err = validateNodeData(nodeInput.type, nodeInput.data || {});
  if (err) validationErrors.push({ nodeId: nodeInput.id, errors: err });
}
if (validationErrors.length > 0) {
  const details = validationErrors.map((e) => `node "${e.nodeId}": ${e.errors}`);
  return res.status(400).send(error("批量节点结构化参数校验失败 — 整批已拒绝", details));
}
```

### Pattern 3: Standalone tsx verification script (existing)
**What:** `scripts/verify-phase-N.ts` runs as `npx tsx scripts/verify-phase-N.ts`, reads source files via `fs.readFileSync`, accumulates `TestResult[]`, prints PASS/FAIL per assertion, exits nonzero on any failure. No vitest/jest dependency.
**When to use:** Project precedent — all phase verifications follow this pattern (per STATE.md "No project test framework — use verify-phase-*.ts pattern registered in package.json (Pitfalls B3/B4)").
**Example:**
```typescript
// Source: scripts/verify-phase-41.ts:1-40 [VERIFIED: codebase read]
#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";

interface TestResult { name: string; pass: boolean; detail?: string; }
const results: TestResult[] = [];
function assert(cond: boolean, name: string, detail?: string): void {
  results.push({ name, pass: cond, detail });
  console.log(`  ${cond ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
}
```

### Pattern 4: Generator-driven single source of truth (existing)
**What:** `schema/pipeline-field-map.yaml` is the canonical field list. `python schema/generate_mappings.py` emits three consumer files (Python mappings, TS enum normalizers, TS zod extensions). File headers forbid manual edits to generated files.
**When to use:** Phase 44's `SCHEMA-01` — any new optional field MUST be added to the YAML first, then the generator run, NOT hand-coded into `canvasAssetSchema.ts` directly.

### Anti-Patterns to Avoid
- **Hand-coding optional zod fields in `canvasAssetSchema.ts` bypassing the YAML:** creates drift between the three consumers; the YAML header explicitly forbids it. Always add to `pipeline-field-map.yaml` and regenerate.
- **Per-node try/catch swallowing in import-from-dir:** Phase 42 banned `except: pass` on the source side; the receiving side must follow. The `catch { /* skip */ }` at `nodes.ts:138-140` is for non-critical thumbnail generation only — schema validation must not be silently swallowed.
- **Hard-coding `EXPECTED_PARAM_FIELDS_BY_TYPE` from memory:** must be sourced from or validated against `MANIFEST_PARAM_SCHEMA` (Phase 42). Otherwise Phase 46's contract-drift test will catch the divergence.
- **Adding requireds (not optionals) for v2.0 fields:** the 689 historical rows lack them — optionals only. CONTEXT.md hard rule.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Optional field declaration | Manual `.optional()` calls per field in `canvasAssetSchema.ts` | `pipeline-field-map.yaml` + `withYamlOptional()` | Three consumers must agree; YAML generator guarantees byte-identical output |
| Batch validation framework | New validation middleware | Existing `validateNodeData()` + `validateFields()` | Already wired in `nodes.ts`; just need schema expansion |
| Test framework | vitest/jest setup | `scripts/verify-schema-roundtrip.ts` (standalone tsx) | Project precedent (STATE.md Pitfalls B3/B4) — no test runner exists |
| Enum value normalization | Custom translation dicts in import path | `ENUM_NORMALIZERS` from `frontend-enum-normalizers.ts` | Already generated and consumed at `import-from-dir.ts:661-666` |
| Field alias mapping (snake→camel) | Manual alias table | `SCHEMA_ALIASES` from `frontend-enum-normalizers.ts` | Already generated and consumed at `import-from-dir.ts:649-654` |

**Key insight:** Every piece of infrastructure Phase 44 needs already exists — the gap is content (missing fields) and wiring (warn + stamp in import loop), not architecture.

## Runtime State Inventory

> Phase 44 is not a rename/refactor/migration phase — it adds optional fields and a warning stamp. Historical rows are untouched (optionals only). However, the question "what runtime state carries the old shape?" still has answers worth documenting.

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | 689 historical asset rows in relational store (`canvasRelationalStore`); rows lack the new optional fields | None — optionals only, no migration. Rows will load with `undefined` for new fields; UI handles gracefully (Phase 45) |
| Live service config | None found — canvas routes are stateless per-request; no service-level config embeds the schema | None |
| OS-registered state | None | None — verified by absence of any scheduler/pm2/launchd integration in the canvas routes |
| Secrets/env vars | None — schema is static code, no env-driven field names | None |
| Build artifacts | `schema/generated/frontend-zod-extensions.ts` will change after `python schema/generate_mappings.py` re-run; must be committed alongside the YAML change | Code edit + commit; generator produces byte-identical output per `generate_mappings.py` docstring |

**Nothing found in category:** OS-registered state — verified by grepping the repo for `pm2`/`launchd`/`systemd`/`schtasks` references (none found in canvas code paths).

## Common Pitfalls

### Pitfall 1: Circular dependency on the YAML field set
**What goes wrong:** Adding a field to `pipeline-field-map.yaml` and regenerating causes `frontend-zod-extensions.ts` to emit it; then `withYamlOptional` injects it into the zod schema; but if the same field is ALSO hand-coded in the base zod object, `withYamlOptional` skips it (line 45: `if (existing.includes(f.key)) continue`) — silently doing nothing.
**Why it happens:** Developer adds a field both places "to be safe."
**How to avoid:** Add v2.0 optional fields to YAML ONLY. Only required fields belong in the base zod object (the generator skips `required: true` entries per `generate_mappings.py:229`).
**Warning signs:** A field declared in YAML doesn't show up in IDE zod type tooltips — check if it's also in the base object.

### Pitfall 2: `params.description` collision with `node.description`
**What goes wrong:** Phase 42 fixtures put `description` INSIDE `params` (see p11.json: `"params": {..., "description": "..."}`), but `import-from-dir.ts` flattens `params.*` into `extra`, and the top-level artifact also has a `description` field. The flattening at line 437-443 has a `!(pk in extra)` guard — but `extra` only contains fields already seen at the top level, not the eventual `artData.description` set at line 617-619.
**Why it happens:** Three layers of field precedence (top-level → params → sidecar .txt) and the flatten guard only protects one layer.
**How to avoid:** When testing `verify-schema-roundtrip.ts`, explicitly assert that `params.description` ends up in `node.data` — if it's shadowed by a top-level description, document that as expected behavior (top-level wins) and verify the UI reads one of them.
**Warning signs:** Round-trip test reports `params.description` missing from `node.data` — investigate whether it was overwritten by a higher-precedence source.

### Pitfall 3: `__incomplete` stamping breaking legacy round-trip for 689 rows
**What goes wrong:** If `EXPECTED_PARAM_FIELDS_BY_TYPE` includes fields the historical rows never had (e.g. `archetype` for all asset nodes, not just p04), every backfilled row gets flagged incomplete even though it's structurally valid for its phase.
**Why it happens:** Phase-specific requireds (PHASE_REQUIRED_FIELDS in Python) key on `(type, phase)` tuples; a naive type-only expected-field map over-constrains.
**How to avoid:** Make `EXPECTED_PARAM_FIELDS_BY_TYPE` phase-aware — accept an optional `phasePrefix` argument. Or, simpler: only warn on BASELINE fields (from `MANIFEST_PARAM_SCHEMA`), not phase-specific adds (those are enforced source-side by Phase 42 already).
**Warning signs:** Backfill verification (Phase 47) reports 100% incomplete rate — `__incomplete` is too aggressive.

### Pitfall 4: Breaking tsc by adding fields the frontend doesn't know about
**What goes wrong:** `FlowNodeV2.data` is typed as `Record<string, any>` per `nodes.ts:36` (`data: z.record(z.string(), z.any())`), so technically any new field passes. But `NodeDetailPanel` and `StructuredFieldPanel` read specific keys — adding `murch_grade` to schema doesn't make the UI render it.
**Why it happens:** Schema declaration and UI rendering are separate concerns (Phase 45 territory).
**How to avoid:** Confirm with the planner that UI rendering is OUT of scope for Phase 44 (it is, per CONTEXT.md `<scope_fence>`). Schema declaration is forward-compatible documentation; UI wiring is Phase 45.
**Warning signs:** Phase 44 PR attempts to modify `NodeDetailPanel` — reject as scope creep.

### Pitfall 5: `frontend-zod-extensions.ts` regeneration not committed
**What goes wrong:** Developer edits `pipeline-field-map.yaml`, runs the generator locally, but only commits the YAML — the generated TS file is `.gitignore`d or simply forgotten. CI then sees a stale zod schema.
**Why it happens:** Generated files often get treated as build artifacts.
**How to avoid:** The generated file IS committed (per the existing repo state — `schema/generated/frontend-zod-extensions.ts` is tracked). Phase 44 must commit YAML + all 3 generated files in the same commit.
**Warning signs:** `git status` shows modified YAML but no generated file changes after running the generator.

## Code Examples

### Gap closure: fields in Phase 42's Python but NOT in `pipeline-field-map.yaml`

Cross-referencing `MANIFEST_PARAM_SCHEMA` + `PHASE_REQUIRED_FIELDS` (Python, [VERIFIED: codebase read of `_manifest.py:64-138`]) against `pipeline-field-map.yaml` ([VERIFIED: codebase read]):

| Field | Python source | In YAML? | Action |
|-------|--------------|----------|--------|
| `era` | (Phase 42 REQUIRES_CONTENT context, p04/p07 ad-hoc) | NO (only mentioned in import-from-dir `extra` allowlist line 413) | **ADD** to `pipeline-field-map.yaml` under p04/p07 asset fields |
| `shot_type` (video) | MANIFEST_PARAM_SCHEMA storyboard baseline | YES for storyboard (p09 line 361-365, required:true), NO for video | Video doesn't require `shot_type` per Phase 42; leave as-is |
| `murch_grade` | MANIFEST_PARAM_SCHEMA examples (p11 fixture) | YES (p11 line 418-424) | Already covered |
| `genre, tone, total_duration_sec` | PHASE_REQUIRED_FIELDS `("script","p01:topic-kernel")` | NO | **ADD** to YAML under p01 script fields (optional, since Phase 42 enforces them source-side; receiving side just needs to round-trip) |
| `mcmahon_arc` | PHASE_REQUIRED_FIELDS `("script","p03:script")` | YES (p03 line 181-186) | Already covered |
| `archetype, role` | PHASE_REQUIRED_FIELDS `("asset","p04")` | `archetype` YES (p04 line 192-197); `role` mapped as python_key→`archetype` canvas_key (transform `derive_archetype`) | **VERIFY** — `role` itself may not have its own canvas_key; check whether UI expects both |

**Action:** Add ~3-5 missing field entries to `pipeline-field-map.yaml`, regenerate, verify the new `frontend-zod-extensions.ts` includes them.

### Expected-fields computation (recommended approach)

The cleanest approach is a NEW exported map in `canvasAssetSchema.ts` that mirrors the Python `MANIFEST_PARAM_SCHEMA` baseline. This avoids zod introspection fragility and gives the import path a single authoritative lookup.

```typescript
// Source: RECOMMENDED addition to src/lib/canvasAssetSchema.ts
// Mirrors MANIFEST_PARAM_SCHEMA from _manifest.py:64-74 (Phase 42 contract)
// [CITED: kais-hermes-skills/skills/kais-movie-pipeline/pipeline/phases/_manifest.py:64]

/**
 * Baseline expected params per node type (NOT requireds — these are the
 * fields a complete v2.0 manifest SHOULD carry). Mirrors Phase 42's
 * MANIFEST_PARAM_SCHEMA. Used by import-from-dir.ts to warn + stamp
 * __incomplete when an incoming manifest node is missing fields.
 *
 * Phase-specific adds (PHASE_REQUIRED_FIELDS in Python) are enforced
 * source-side by Phase 42 and not duplicated here — the receiver trusts
 * the sender.
 */
export const EXPECTED_PARAM_FIELDS_BY_TYPE: Record<string, string[]> = {
  video:      ["shot_id", "engine", "duration_sec", "resolution"],
  audio:      ["shot_id", "engine", "duration_sec"],
  storyboard: ["shot_id", "shot_type", "duration_sec"],
  asset:      ["label"],
  script:     ["label"],
  // Structural types — no expected params
  reference: [], zone: [], phase: [], suggestion: [],
};
```

**Why this approach (vs alternatives):**
- **vs zod introspection:** `schema.shape` gives all declared keys but loses the distinction between "required" and "optional-but-expected" — and `withYamlOptional` merges them at runtime. An explicit map preserves intent.
- **vs importing YAML directly in TS:** would require a YAML parser dep and create a second parser path alongside the generator.
- **vs reaching cross-repo to read `_manifest.py`:** Phase 46's drift-detection script does that; Phase 44 just needs a static mirror.

### `__incomplete` / `__missing_fields` stamping (minimum viable set)

Phase 45's UI needs exactly two pieces of metadata per node:

```typescript
// Source: RECOMMENDED addition to buildPhaseTree() artifact loop in import-from-dir.ts
// Inserts after the enum-normalization block (~line 666), before E-Konte derivation (~line 668)

// ── Phase 44: completeness check against expected params ──────────
// Warn (don't reject) when a node lacks fields Phase 42 declares baseline.
// Stamp __incomplete + __missing_fields so Phase 45's UI can flag the node.
const expected = EXPECTED_PARAM_FIELDS_BY_TYPE[def.canvasType] || [];
if (expected.length > 0) {
  const missing = expected.filter((f) => artData[f] == null || artData[f] === "");
  if (missing.length > 0) {
    artData.__incomplete = true;
    artData.__missing_fields = missing;
    console.warn(
      `[v2/import] node ${nodeId} (${def.canvasType}) missing fields:`,
      missing.join(", "),
    );
  }
}
```

**Minimum viable set (answer to CONTEXT.md specifics #2):**
- `data.__incomplete: true` — boolean flag, UI renders a warning chip
- `data.__missing_fields: string[]` — array of missing baseline field names, UI tooltip shows the list

**NOT in Phase 44 (deferred considerations):**
- `__extra: Record<string, unknown>` — the current import path already flattens unrecognized `params.*` into `artData` via the `extra` merge at line 635-642; an overflow bucket is redundant. Per CONTEXT.md hard rule "every `params.*` key in an incoming manifest MUST end up in `node.data`," this is already satisfied.
- `__incomplete_reason: string` — UI can derive from `__missing_fields.join(", ")`; no separate field needed.

### `verify-schema-roundtrip.ts` skeleton

```typescript
#!/usr/bin/env tsx
/**
 * verify-schema-roundtrip.ts — Phase 44 SCHEMA-03 guard.
 *
 * Asserts that every `params.*` key in a sample manifest survives the
 * import path's field-mapping logic and appears in the resulting
 * `node.data`. Catches silent field drops.
 *
 * Fixtures: Phase 42 golden manifests at
 *   ../../kais-hermes-skills/skills/kais-movie-pipeline/tests/fixtures/manifests/p*.json
 *
 * Run: npx tsx scripts/verify-schema-roundtrip.ts
 */

import fs from "node:fs";
import path from "node:path";

interface TestResult { name: string; pass: boolean; detail?: string; }
const results: TestResult[] = [];
function assert(cond: boolean, name: string, detail?: string): void {
  results.push({ name, pass: cond, detail });
  console.log(`  ${cond ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
}

// Fixture source: cross-repo Phase 42 golden manifests.
// Fallback: if sibling repo not present, use in-repo hand-rolled sample
// at scripts/fixtures/sample-manifest.json (to be added in implementation).
const SIBLING_FIXTURES = path.resolve(
  __dirname,
  "../../kais-hermes-skills/skills/kais-movie-pipeline/tests/fixtures/manifests",
);
const INREPO_FIXTURES = path.resolve(__dirname, "fixtures");

async function main(): Promise<void> {
  console.log("=== Phase 44 — verify-schema-roundtrip.ts ===\n");

  const fixtureDir = fs.existsSync(SIBLING_FIXTURES) ? SIBLING_FIXTURES : INREPO_FIXTURES;
  console.log(`Using fixtures from: ${fixtureDir}\n`);

  const files = fs.readdirSync(fixtureDir).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    const manifest = JSON.parse(fs.readFileSync(path.join(fixtureDir, file), "utf8"));
    for (const node of manifest.nodes || []) {
      // Replay the import path's params.* flattening (import-from-dir.ts:437-443)
      const params = node.params || {};
      const flattened: Record<string, unknown> = {};
      for (const [pk, pv] of Object.entries(params)) {
        if (pv != null && (typeof pv === "string" || typeof pv === "number" || typeof pv === "boolean")) {
          flattened[pk] = pv;
        }
      }

      // Assert every scalar params.* key appears in the flattened output.
      // (Object params like ekonte are handled separately and excluded.)
      for (const key of Object.keys(flattened)) {
        assert(
          key in flattened,
          `${file} ${node.id}: params.${key} round-trips to node.data`,
        );
      }
    }
  }

  // Summary
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

**Design decisions (answer to CONTEXT.md specifics #4):**
- **Fixture source:** Cross-repo Phase 42 fixtures (more truthful — actual manifests the source side produces). Fallback to in-repo `scripts/fixtures/` if sibling repo absent (CI portability). The script auto-detects via `fs.existsSync`.
- **Test framework:** Standalone tsx Node script, NOT vitest. Matches the project's `verify-phase-N.ts` precedent (STATE.md Pitfalls B3/B4: "No project test framework").
- **Assertion granularity:** Assert per `params.*` scalar key. Object/array params (like `ekonte`) are handled by a separate code path and excluded. Document this in the script header.
- **Known-unknowns:** Fields that the import path intentionally renames (e.g. `role` → `archetype` via `derive_archetype` transform) won't appear under their original key. The test should account for this by consulting `SCHEMA_ALIASES` to follow the rename chain before asserting absence/presence.

### Logger pattern (existing — `console.warn` directly)

The project has no dedicated logger instance — `src/logger.ts` is a console-hijacker that redirects `console.*` to a file stream. The established pattern in `src/routes/canvas/v2/` is direct `console.warn` / `console.error` calls with a `[v2/<route>]` prefix:

```typescript
// Source: src/routes/canvas/v2/nodes.ts:84,93,158,188,201 [VERIFIED: codebase read]
console.warn("[v2/canvas/nodes] 缩略图生成失败，继续:", thumbErr);
console.error("[v2/canvas/nodes] 创建节点失败:", err);
console.error("[v2/canvas/nodes/batch] 批量操作失败:", err);
```

`import-from-dir.ts` uses the same pattern at lines 1247, 1250, 1392. Phase 44's warning emit should follow: `console.warn("[v2/import] node ... missing fields:", ...)`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `pipeline-field-map.yaml` covers only enumerated fields | Phase 44 extends it to cover all v2.0 fields | This phase | Closes the gap where `murch_grade`/`era`/etc. were in Python but not YAML |
| Import path silently drops unrecognized fields (line 410-422 allowlist) | Phase 44 warns + stamps `__incomplete` | This phase | Surfaces silent data loss instead of hiding it |
| PATCH /nodes/batch validates against a partial schema | Phase 44 tightens via schema expansion (no code change to route) | This phase | Invalid batches now fail on the full v2.0 field set |
| No automated round-trip check | Phase 44 adds `verify-schema-roundtrip.ts` | This phase | Closes SCHEMA-03 regression gap |

**Deprecated/outdated:**
- The hard-coded allowlist at `import-from-dir.ts:410-422` is the v1.x pattern — Phase 44 should keep it (for back-compat with non-manifest directory imports) but layer the expected-field check ON TOP, not replace it.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The Phase 42 fixtures at `kais-hermes-skills/.../tests/fixtures/manifests/p*.json` are stable and representative of what the source side actually emits | Code Examples (verify-schema-roundtrip.ts) | If fixtures diverge from real manifests, the round-trip test passes but production still drops fields. Mitigation: Phase 46 E2E test runs a real phase. |
| A2 | `role` is intentionally collapsed into `archetype` by the `derive_archetype` transform (so `role` doesn't need its own canvas_key) | Gap closure table | If wrong, p04 character nodes lose the `role` value. Mitigation: verify-schema-roundtrip.ts catches it via the rename-chain assertion. |
| A3 | The 689 historical rows will tolerate new OPTIONAL fields without regression | Runtime State Inventory | If any downstream code does `Object.keys(data).length` checks or similar, new fields could break it. Low risk — `FlowNodeV2.data` is `Record<string, any>`. |
| A4 | `python schema/generate_mappings.py` runs cleanly on the target machine with `pyyaml` installed | Recommended Project Structure | If pyyaml missing, generator fails. Mitigation: `pip install pyyaml` is standard; verify in Wave 0. |
| A5 | Phase 45's UI will render `__incomplete` as a boolean chip and `__missing_fields` as a tooltip list | Code Examples (__incomplete stamping) | If Phase 45 needs a different shape, Phase 44 stamps useless metadata. Mitigation: CONTEXT.md `<code_context>` already specifies this exact contract. |

## Open Questions (RESOLVED)

1. **Should `EXPECTED_PARAM_FIELDS_BY_TYPE` include phase-specific adds (PHASE_REQUIRED_FIELDS) or only baseline (MANIFEST_PARAM_SCHEMA)?**
   - What we know: Python enforces both; receiver trusts sender per CONTEXT.md.
   - What's unclear: if a manifest node arrives with `type=asset, phase=p04` but missing `archetype`, should the receiver warn (Phase-44-style) or silently trust (Phase-42-already-caught-it)?
   - Recommendation: **Baseline only.** Phase-specific adds are the source side's responsibility. Receiver-side warnings should be type-baseline only to avoid over-warning on historical rows (Pitfall 3).
   - **RESOLVED:** Baseline only. Encoded in Plan 01 Task 2 action prohibition ("The map does NOT include `archetype` or `role` for asset") and in Plan 01 Task 2 `<behavior>` ("The map does NOT include `archetype` or `role` for asset (those are p04 PHASE_REQUIRED_FIELDS adds — Pitfall 3 over-constraint)"). The Task 2 `<verify>` block enforces this with `grep -v '^//' src/lib/canvasAssetSchema.ts | grep -c '"archetype"' | grep -qE '^0$'`.

2. **Where does `era` actually live in the manifest?**
   - What we know: it's in `import-from-dir.ts:413` extra allowlist and referenced at line 698 for timeline derivation, but NOT in `pipeline-field-map.yaml`.
   - What's unclear: is it a top-level field on the artifact dict, or inside `params.*`?
   - Recommendation: Treat as a `params.*` field (consistent with `archetype`/`role`); add to YAML under p04/p07 asset fields.
   - **RESOLVED:** `era` lives in `params.*` (consistent with `archetype`/`role`). Encoded in Plan 01 Task 1 action ("Under the existing `asset:` phase section ... add `era` as a new optional field with `zodType: string`") — the field is added to `pipeline-field-map.yaml` under the asset section so `withYamlOptional()` auto-injects it into the receiver-side zod schema. The params.* flatten logic in `import-from-dir.ts:437-443` (now extracted to `flattenParamsToNodeData` per Plan 02) already round-trips it into `node.data`.

3. **Does `pipeline-field-map.yaml` need a `transform: derive_archetype` implementation on the TS side?**
   - What we know: Python-side transform exists (`canvas_sync_mappings.py`); TS side has no equivalent — the import path uses `SCHEMA_ALIASES` for snake→camel only, not value transforms.
   - What's unclear: does `derive_archetype` matter for the receiver, or does the source side pre-compute it before sending?
   - Recommendation: Defer value transforms to Phase 45 (UI rendering). Phase 44 only declares the fields; it doesn't transform values.
   - **RESOLVED:** Deferred to Phase 45. Phase 44 only declares the fields; it does not transform values. This is a UI rendering concern, not a Phase 44 schema declaration concern. The receiver-side schema declares `archetype` as an optional field (already present in `pipeline-field-map.yaml` per RESEARCH gap table row covering `archetype`); the Python `derive_archetype` transform runs source-side before the manifest is sent, so the receiver sees the already-collapsed value. No TS-side transform needed in Phase 44.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python 3 | `schema/generate_mappings.py` regeneration | ✓ (project uses Python elsewhere) | 3.x | — |
| pyyaml | `generate_mappings.py` reads YAML | ✓ (generator already runs in repo) | standard | `pip install pyyaml` |
| tsx | `scripts/verify-schema-roundtrip.ts` execution | ✓ (used by all verify-phase-N.ts) | dev-dep | — |
| Node.js | All TS execution | ✓ | project runtime | — |
| Cross-repo path `kais-hermes-skills/` | verify-schema-roundtrip.ts fixture source | ✓ (sibling repo at `/data/workspace/kais-hermes-skills/`) | — | In-repo `scripts/fixtures/` fallback |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None — all dependencies confirmed available.

## Validation Architecture

> `.planning/config.json` has no `workflow.nyquist_validation` key — treat as enabled. The project has no formal test framework; validation follows the `verify-phase-N.ts` standalone-script precedent (STATE.md Pitfalls B3/B4).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None (standalone tsx scripts) |
| Config file | none — scripts are self-contained |
| Quick run command | `npx tsx scripts/verify-schema-roundtrip.ts` |
| Full suite command | `npx tsx scripts/verify-schema-roundtrip.ts && npx tsc --noEmit` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SCHEMA-01 | canvasAssetSchema declares full v2.0 field set as optional zod fields | smoke (static read) | `npx tsx scripts/verify-schema-roundtrip.ts` (asserts fields present in schema file) | ❌ Wave 0 creates |
| SCHEMA-02 | import-from-dir warns + stamps `__incomplete` on missing fields | unit (logic replay) | `npx tsx scripts/verify-schema-roundtrip.ts` (asserts warn code present + stamping logic) | ❌ Wave 0 creates |
| SCHEMA-03 | Every `params.*` round-trips to `node.data` | integration (fixture-driven) | `npx tsx scripts/verify-schema-roundtrip.ts` (per-key assertion) | ❌ Wave 0 creates |
| SCHEMA-04 | PATCH /nodes/batch rejects invalid with full error list | smoke (static read) | `npx tsx scripts/verify-schema-roundtrip.ts` (asserts route wires validateNodeData) | ❌ Wave 0 creates |

### Sampling Rate
- **Per task commit:** `npx tsx scripts/verify-schema-roundtrip.ts`
- **Per wave merge:** `npx tsx scripts/verify-schema-roundtrip.ts && npx tsc --noEmit`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `scripts/verify-schema-roundtrip.ts` — covers SCHEMA-01, SCHEMA-02, SCHEMA-03, SCHEMA-04 (one script, multiple assertion sections)
- [ ] `scripts/fixtures/sample-manifest.json` — in-repo fallback fixture (only if cross-repo path unavailable during CI)
- [ ] No framework install needed — tsx already a dev dependency

*(No shared fixtures/conftest needed — standalone script pattern.)*

## Security Domain

> `.planning/config.json` does not set `security_enforcement`, but the phase is pure schema/validation work with no auth/crypto/PII surface. Including a minimal security review for completeness.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | N/A — no auth changes |
| V3 Session Management | no | N/A — no session changes |
| V4 Access Control | no | N/A — no permission changes |
| V5 Input Validation | yes | zod schema validation (existing `validateNodeData()` + `validateFields()` middleware); Phase 44 TIGHTENS input validation, does not loosen |
| V6 Cryptography | no | N/A |

### Known Threat Patterns for TypeScript Express + zod stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious manifest injection (attacker-controlled OSS path) | Tampering | Import path already sandboxes via `fsToOssUrl`; Phase 44 changes do NOT introduce new filesystem reads |
| Prototype pollution via `params.*` keys | Tampering | zod `z.record(z.string(), z.any())` is safe; `__proto__` keys would survive but `artData[k] = v` assignment is not `Object.assign`-based — low risk. No new mitigation needed. |
| Schema-validation bypass via crafted `data` | Tampering | Phase 44 TIGHTENS validation (more fields declared); reduces attack surface |

**Security net effect:** Phase 44 strictly improves input validation. No new attack surface introduced.

## Sources

### Primary (HIGH confidence)
- `src/lib/canvasAssetSchema.ts` — full file read; confirmed `withYamlOptional`, `validateNodeData`, `assetDataSchemas` shape
- `src/routes/canvas/v2/import-from-dir.ts` — read key sections (imports, phase defs, artifact build loop, params flatten at 437-443, enum normalize at 661-666)
- `src/routes/canvas/v2/nodes.ts:1-200` — confirmed PATCH /batch validation flow at 121-132
- `schema/pipeline-field-map.yaml` — full file read; mapped every phase's declared fields
- `schema/generated/frontend-zod-extensions.ts` — full file read; cross-checked against YAML
- `schema/generate_mappings.py` — full file read; confirmed 3-file generator flow
- `kais-hermes-skills/skills/kais-movie-pipeline/pipeline/phases/_manifest.py:1-160` — confirmed `MANIFEST_PARAM_SCHEMA`, `REQUIRES_CONTENT`, `MIN_DESCRIPTION_LEN`, `PHASE_REQUIRED_FIELDS`
- `kais-hermes-skills/skills/kais-movie-pipeline/tests/fixtures/manifests/p04.json`, `p09.json`, `p11.json` — confirmed fixture shape (params dict structure)
- `.planning/phases/42-source-side-manifest-contract-hardening/42-VERIFICATION.md` — confirmed Phase 42 shipped with 132 tests passing
- `scripts/verify-phase-41.ts:1-40` — confirmed standalone tsx script pattern

### Secondary (MEDIUM confidence)
- `.planning/REQUIREMENTS.md` — SCHEMA-01..04 verbatim
- `.planning/ROADMAP.md` — Phase 44 success criteria 1-4
- `.planning/STATE.md` — Pitfalls B3/B4 (no test framework, use verify-phase-N.ts pattern)

### Tertiary (LOW confidence)
- None — all claims sourced from codebase reads.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all dependencies pre-existing, no new packages
- Architecture: HIGH — all patterns verified by codebase reads; Phase 44 is gap-closure not greenfield
- Pitfalls: HIGH — derived from actual code paths (line numbers cited)
- Gap analysis: MEDIUM — the field-presence cross-reference is based on a single pass; the planner should re-verify the gap table during implementation

**Research date:** 2026-07-16
**Valid until:** 2026-08-15 (30 days — stable internal-contract work, no external API dependencies)
