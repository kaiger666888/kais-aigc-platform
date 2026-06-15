# Phase 31: Pipeline Callback Refactor - Context

**Gathered:** 2026-06-15
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous mode)

<domain>
## Phase Boundary

Phase 31 refactors the pipeline callback hot path so phase decisions are made by **asking the registry**, not by reading hardcoded constants. The refactor must provably preserve current movie-v1 behavior — verified by an equivalence test checked into the repo.

**In scope:**

1. `src/routes/v1/pipeline/callback/phase-complete.ts` — replace `REVIEW_REQUIRED_PHASES` constant lookup with `registry.phaseById(skill_id, phase).requires_review`.
2. `src/routes/v1/pipeline/resume.ts` — replace `PHASE_ORDER` constant lookup with `registry.phaseById(skill_id, phase).order`.
3. `src/routes/v1/pipeline/submit-to-review.ts` — replace the closed `z.enum(...)` with a runtime `registry.phaseById` lookup that rejects unknown phases with 4xx.
4. `src/skills/defaultSkill.ts` — inline the constant values directly into the movie-v1 manifest constant (it was previously deriving from the constants; Phase 31 deletes them, so the manifest must become the literal source).
5. New `scripts/verify-phase-31.ts` — equivalence test asserting the new registry-driven lookups produce identical results to the old constants for movie-v1.

**Out of scope:**

- **Phase 32** owns canvas node-type registry integration.
- **Phase 33** owns full E2E validation (manifest registers, pipeline runs through refactored callbacks, negative cases fail safe).
- **Phase 34** owns skill-author documentation.
- **PHASE_INGEST_MAP** is *descriptive metadata* — currently exported but not consulted at runtime in `phase-complete.ts` (the actual ingest decisions branch on `outputs[].type === "image" | "video" | "storyboard"`). The equivalence test still asserts the manifest's `phase_taxonomy[].ingest_outputs` matches the old map values to lock the descriptive contract; the runtime ingest branching logic itself is **not** refactored in this phase.

**Success criteria** (from ROADMAP — must all be true):

1. Every phase that used to live in `REVIEW_REQUIRED_PHASES` produces the same `awaiting-review` vs `running` state transition — verifiable by equivalence test.
2. Phase-complete callback's ingest routing matches the old `PHASE_INGEST_MAP` behavior for every key that used to exist — verifiable by equivalence test (descriptive field equality, since runtime ingest is type-driven not map-driven).
3. `POST /submit-to-review` accepts any phase string in the active skill's manifest, rejects (4xx) any phase string not in it.
4. Constants `REVIEW_REQUIRED_PHASES`, `PHASE_INGEST_MAP`, `PHASE_ORDER`, and the closed phase enum are deleted (no fallback layer — registry is single source of truth).
5. Equivalence test is checked into the repo and runs in the verify harness.

</domain>

<decisions>
## Implementation Decisions

### Active Skill Resolution

- **Source of skill ID:** Callbacks (`phase-complete`, `resume`, `submit-to-review`) read `skill_id` from the `kv_pipelineRun` row (column already exists in `src/types/database.d.ts` as nullable string). This future-proofs for multi-skill without requiring new fields or body parameters.
- **Null / empty `skill_id` (pre-Phase-30 pipeline rows):** Fall back to `"movie-v1"` with a `console.warn` log identifying the pipeline. Preserves behavior for any in-flight run created before Phase 30's seed populated `skill_id`.
- **Skill ID set but not in registry:** 500 with `error("skill '<id>' not registered")`. Per registry contract (no silent fallback); signals operator action needed (skill row dropped, race with boot, etc.).
- **submit-to-review's skill source:** If body has `pipelineId`, look up `skill_id` from that pipeline row. If no `pipelineId` (direct curl call), default to `"movie-v1"`. No new `skillId` body field — preserves current callers.

### Equivalence Test Location & Shape

- **File path:** `scripts/verify-phase-31.ts` — matches `verify-phase-28/29/30.ts` pattern. Runs in the existing verify harness (whatever invokes the `verify-phase-*.ts` scripts).
- **Old-constant snapshots:** Hardcoded at the top of `verify-phase-31.ts` as `OLD_REVIEW_REQUIRED_PHASES`, `OLD_PHASE_INGEST_MAP`, `OLD_PHASE_ORDER`. Labeled with a comment: *"Pre-refactor snapshots — DO NOT edit. These document what the constants were before Phase 31 deleted them."*
- **Assertions (per phase in movie-v1 manifest's `phase_taxonomy`):**
  - `phaseDecl.requires_review === OLD_REVIEW_REQUIRED_PHASES.includes(phaseDecl.id)`
  - `phaseDecl.order === OLD_PHASE_ORDER[phaseDecl.id]`
  - `phaseDecl.ingest_outputs` deeply equals `OLD_PHASE_INGEST_MAP[phaseDecl.id] ?? []` (manifest may use `IngestOutput[]` enum strings; the test maps `["images"]` → matching IngestOutput value via a fixed translation table)
- **Exit code:** 0 on full match, non-zero with a printed diff on any drift. Same shape as other verify-phase scripts.
- **Test scope:** Registry lookups only (verifies new source of truth matches old constants). The callback's *use* of the registry is exercised in Phase 33's E2E — no overlap.

### submit-to-review Phase Enum Reconciliation

- **Drop `z.enum(...)`:** Replace with `phase: z.string().min(1)`. After zod parses, the handler does `const phaseDecl = registry.phaseById(activeSkillId, phase); if (!phaseDecl) return res.status(400).send(error(\`phase '<phase>' not declared by skill '<skill>'\`));`.
- **Old enum IDs (`image`, `video`, `audio`, `compose`) not in manifest:** No backwards-compat shim. These were never valid phase IDs — the old enum silently accepted strings that downstream code couldn't actually handle. Documented as a **behavior fix** in the migration notes (CHANGELOG / Phase 31 SUMMARY). Old clients sending these now get 400 with a clear message instead of silently passing validation and failing mysteriously later.
- **Error response shape:** `{ ok: false, error: "phase '<phase>' not declared by skill '<skill>'" }` — uses the existing `error()` helper from `@/lib/responseFormat`. Stays consistent with the rest of `/api/v1/*`.
- **Distinguish skill-not-registered from phase-not-declared:** Yes. `skill_id` not in registry → 500 `"skill '<id>' not registered"`. Skill registered but phase not in its taxonomy → 400 `"phase '<phase>' not declared by skill '<id>'"`. Helps operators vs. callers debug.

### Deprecation Marker Style

- **Delete exports:** `REVIEW_REQUIRED_PHASES`, `PHASE_INGEST_MAP`, `PHASE_ORDER` are removed from `phase-complete.ts` and `resume.ts`. The closed `z.enum(...)` is removed from `submit-to-review.ts`. No `@deprecated` re-exports kept around.
- **The equivalence test's `OLD_` snapshots ARE the deprecation marker** — they document what the constants were. Source stays clean.
- **Pre-flight grep before deletion:** Run `grep -rE "REVIEW_REQUIRED_PHASES|PHASE_INGEST_MAP|PHASE_ORDER" src/ --include="*.ts"`. Allowed matches: `verify-phase-31.ts` (the test), `defaultSkill.ts` (which Phase 31 rewrites to inline values). Anything else is a blocker — fail the plan with the offending file paths.
- **`defaultSkill.ts` migration:** Phase 30 derived the manifest from the constants via imports. Phase 31 inlines the constant values directly into the manifest constant literal — no more imports from `phase-complete.ts` / `resume.ts`. The manifest becomes the literal single source of truth (this completes what Phase 30 started).
- **No `// DEPRECATED:` comment blocks** in source — the git history and the equivalence test serve that role.

### Claude's Discretion

- Exact wording of the new error messages (suggested text in decisions above is non-binding — adjust for clarity if a better phrasing emerges during implementation).
- Whether to add a structured log line on every callback invocation recording `skill_id` + `phase` + `phaseDecl` lookup result (suggested: yes, helps debug — but optional).
- The IngestOutput → string translation table used by the equivalence test to compare old `["images"]` against new `IngestOutput[]` enum values — pick whichever representation the manifest's `phase_taxonomy[].ingest_outputs` actually uses (Phase 28's contract decides this).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`src/skills/registry.ts`** (Phase 29) — `registry.get(skillId)`, `registry.phaseById(skillId, phaseId)`, `registry.nodeTypeById(skillId, typeId)`. All synchronous Map lookups, O(1), no SQL.
- **`src/skills/contract.ts`** (Phase 28) — `PhaseDecl { id, order, label, requires_review, ingest_outputs }`, `SkillManifest`, `IngestOutput` enum. All snake_case to match Python skill-author conventions.
- **`src/skills/defaultSkill.ts`** (Phase 30) — currently imports the three constants to derive the manifest; Phase 31 will replace those imports with inline values.
- **`src/lib/responseFormat.ts`** — `success(data)` / `error(msg)` helpers (existing pattern for 4xx/5xx).
- **`src/types/database.d.ts`** — `kv_pipelineRun.skill_id` is already declared (`string | null`). No schema migration needed for Phase 31.
- **`scripts/verify-phase-30.ts`** — closest analog for the equivalence test structure (init registry → assert properties → exit code).

### Source Constants Being Deleted

- **`src/routes/v1/pipeline/callback/phase-complete.ts` line 12** — `export const REVIEW_REQUIRED_PHASES = ["storyboard", "character", "scene", "camera-preview", "camera-final", "quality-gate"]`
- **`src/routes/v1/pipeline/callback/phase-complete.ts` lines 17-29** — `export const PHASE_INGEST_MAP: Record<string, string[]>` (11 keys: art-direction, character, scenario, voice, storyboard, scene, camera-preview, camera-final, post-production, quality-gate, delivery)
- **`src/routes/v1/pipeline/resume.ts` lines 14-27** — `export const PHASE_ORDER: Record<string, number>` (12 keys including `requirement: 0`)
- **`src/routes/v1/pipeline/submit-to-review.ts` line 34** — `phase: z.enum(["storyboard", "character", "image", "video", "audio", "compose"])`

### Established Patterns

- **Route file shape:** Express Router, default-export the `router.<method>("/", ...handlers, asyncHandler)` call.
- **Body validation:** `validateFields(zodSchema)` middleware. Phase 31 keeps this for non-phase fields in submit-to-review; only the `phase` field's enum is replaced with a string + handler-side registry lookup.
- **DB access:** `import u from "@/utils"; const row = await u.db("kv_pipelineRun").where({ id }).first();`
- **Verify-phase script shape:** `import { registry } from "@/skills/registry"; /* setup */ const errors = []; /* assertions */ if (errors.length) { console.error(errors); process.exit(1); } console.log("OK");`

### Integration Points

- **`src/routes/v1/pipeline/callback/phase-complete.ts`** — `REVIEW_REQUIRED_PHASES.includes(phase)` → `registry.phaseById(skillId, phase)?.requires_review ?? false`. Need to fetch `skillId` from the pipeline row first.
- **`src/routes/v1/pipeline/resume.ts`** — `PHASE_ORDER[phase] ?? pipeline.currentPhaseOrder ?? 0` → `registry.phaseById(skillId, phase)?.order ?? pipeline.currentPhaseOrder ?? 0`.
- **`src/routes/v1/pipeline/submit-to-review.ts`** — `phase: z.enum(...)` → `phase: z.string().min(1)` + handler-side registry check.
- **`src/skills/defaultSkill.ts`** — replace `REVIEW_REQUIRED_PHASES.includes(...)` and `PHASE_ORDER[...]` and `PHASE_INGEST_MAP[...]` import-based derivation with literal inline values in the manifest constant.
- **`scripts/verify-phase-31.ts`** — new file. May need to register the movie-v1 manifest into a fresh registry instance OR rely on the default seed having run. Recommend the latter (matches production boot path).

</code_context>

<specifics>
## Specific Ideas

- The pre-flight grep before deletion is non-negotiable. If any file outside `verify-phase-31.ts` and `defaultSkill.ts` still imports the constants when Phase 31 lands, the constants cannot be safely deleted — the plan must include updating those callers as part of Phase 31 or escalate as a blocker.
- The `kv_pipelineRun.skill_id` column may be `null` on existing rows (created before Phase 30). The fallback to `"movie-v1"` with a `console.warn` is the only backwards-compat shim Phase 31 includes. New rows going forward should have `skill_id` populated by the pipeline initiator (Phase 33's compliance work covers this for kais-movie-agent).
- The behavior fix for submit-to-review's old invalid enum IDs (`image`, `video`, `audio`, `compose`) should be called out in the Phase 31 SUMMARY.md and any CHANGELOG entry. It's a small breaking change but in the right direction — surfaces bad data early instead of letting it fail downstream.
- The equivalence test must run as part of the existing verify harness (whatever currently invokes `scripts/verify-phase-*.ts`). If the project's verify harness isn't auto-discovering new verify-phase scripts, the plan includes wiring it in explicitly.

</specifics>

<deferred>
## Deferred Ideas

- **`PHASE_INGEST_MAP` runtime refactoring** — currently the map is exported but not consulted by `phase-complete.ts` (ingest routing branches on `outputs[].type` directly). Refactoring the runtime ingest branching to consult `phaseDecl.ingest_outputs` is a behavior change, not a refactor — out of scope for Phase 31 (preserves behavior). The map's values are still locked in via the equivalence test for descriptive purposes.
- **Removing `phaseOrder` from the phase-complete request body** — the callback currently accepts an optional `phaseOrder` in the body (`z.number().optional()`). Post-refactor, this could be derived from the registry lookup. But removing it is a client-facing API change — defer to a future client-compat phase.
- **Auth on submit-to-review** — necessary before opening the API to untrusted clients; v1.6 assumes trusted internal network (same as Phase 30).
- **Structured logging for callback decisions** — the suggested "log skill_id + phase + phaseDecl" line is optional. If the project doesn't have a structured logger yet, skip; if it does (e.g., pino), add. Decide during planning based on what `src/lib/` already exposes.
- **Multi-skill pipeline runs** — Phase 31 supports the plumbing (reads skill_id from row, looks up in registry) but doesn't yet exercise it. Phase 33's E2E stays on movie-v1. A future phase would need to test skill-switching mid-run, which raises ordering / state-transition questions Phase 31 doesn't tackle.

</deferred>
