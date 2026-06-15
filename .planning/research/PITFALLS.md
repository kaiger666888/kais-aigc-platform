# Pitfalls: Workflow Skill Contract Abstraction (v1.6)

**Domain:** Adding a pluggable plugin/skill system to an existing working platform
**Researched:** 2026-06-15 (inline — gsd-project-researcher agent hit 3× consecutive 529 from upstream model gateway)
**Confidence:** HIGH for v1.x-lesson-derived pitfalls (sourced from RETROSPECTIVE.md, MILESTONES.md); MEDIUM for plugin-system-generic pitfalls (industry observation, not codebase-verified)

---

## Relationship to ARCHITECTURE.md

ARCHITECTURE.md already covers **codebase-specific** anti-patterns:
- AP-1: "Pluggable" registry that secretly assumes movie-v1 shape
- AP-2: Putting `skill_id` on `o_assets` only (forgetting `kv_pipelineRun`)
- AP-3: Reusing `o_skillList` (legacy markdown prompt library) as the skill registry
- AP-4: Custom React component dynamic loading over HTTP in v1.6
- Plus 5 phase-specific warnings (Phases 28-33) in §"Phase-Specific Warnings"

This file **complements** that with:
1. **Plugin-system-generic pitfalls** (industry-observed, not codebase-derived)
2. **Process / execution / deployment pitfalls** (testing, rollout, DX)
3. **Schema evolution / contract drift pitfalls**
4. **v1.1–v1.5 lessons applied to v1.6** (sourced from RETROSPECTIVE.md)

When the same pitfall is in both files, ARCHITECTURE.md is authoritative (it has line numbers).

---

## Category A: Plugin-System-Generic Pitfalls

### A1. Manifest Schema Bloat (premature generalization)

**Symptom:** Manifest spec grows to 30+ fields in Phase 28 because "we might need this for podcast-v1 / interactive-v1 / ads-v1". By Phase 34, half the fields are unused, the other half have wrong defaults, and the skill author doc reads like a tax form.

**Root cause:** Designing for hypothetical skills that haven't shipped. Architecture calls this out for Phase 28 — "Only include fields the platform actually reads today."

**Prevention (specific to v1.6):**
- Phase 28 manifest spec is **frozen** at the minimal fields Architecture listed: `skill_id`, `node_types[].{type,label,icon,color,default_renderer}`, `phase_taxonomy[].{id,order,label,requires_review,ingest_outputs}`, `runtime.type`.
- Any field that isn't read by Phase 31's refactored callback code gets cut from spec.
- Add a `## Reserved for future` section in the spec doc that names what's deferred (custom_renderers, capability_negotiation, permission_matrix). This signals intent without bloating the contract.

**Phase:** 28 (contract spec) + 34 (skill-author doc)

### A2. Version Negotiation Theater

**Symptom:** Manifest has `contract_version: "1.0.0"`. Platform has `SUPPORTED_CONTRACT_VERSIONS = ["1.0.0"]`. Six months later, platform adds an optional field, bumps to `1.1.0`, and rejects all skills with `1.0.0` — breaking every deployed skill for one minor field.

**Root cause:** Treating semver as a gatekeeping mechanism rather than a compatibility descriptor. Plugin ecosystems (VS Code, Obsidian) survive by being liberal in what they accept.

**Prevention:**
- `contract_version` uses **major.minor**, no patch.
- Platform accepts any `1.x` manifest at runtime; refuses only `2.x+` (explicit breaking).
- Phase 28 spec doc says "minor version = additive fields; major version = breaking change".
- Validator uses **structural** checks (required fields present, types match), not version-string equality.

**Phase:** 28

### A3. The "Two Skills, Same Node Type" Conflict

**Symptom:** Future `kais-podcast-agent` registers `node_type: { type: 'script', ... }`. Future `kais-ads-agent` also registers `node_type: { type: 'script', ... }`. Both try to install on one platform. Platform silently picks one; the other skill's UI breaks.

**Root cause:** Node type IDs are global, but no ecosystem articulates a namespacing convention until collision happens.

**Prevention:**
- v1.6 enforces **namespaced IDs**: `<skill_id>::<type>` internally (e.g., `movie-v1::script`, `podcast-v1::script`). The user-facing label can be just "Script".
- Validator rejects bare `script` IDs at registration time.
- Canvas persists namespaced IDs in node data; future-proof for multi-skill projects.

**Phase:** 28 (spec rule) + 29 (validator enforcement) + 33 (compliance test must verify kais-movie-agent uses `movie-v1::*` IDs)

### A4. Skill-As-Data vs Skill-As-Code Boundary Drift

**Symptom:** Phase 28 declares "phases are data" (manifest lists `[requirement, art-character, script-voice, ...]`). Phase 32 implements phase-complete handler. Phase 33 wants per-phase custom ingestion logic. Phase 34 ends up adding `phase_hooks` field to manifest with executable JS strings.

**Root cause:** Workflow phases have real behavior (ingest into different tables, trigger different review flows). Pure data manifests can't express this without becoming a Turing-complete config language.

**Prevention:**
- v1.6 establishes the rule: **manifest is descriptive; behavior is platform-side and dispatched by `phase_id`**.
- Each `phase_id` in movie-v1's manifest must map to existing platform behavior (e.g., `'storyboard'` → existing storyboard ingest). No new behavior emerges from manifest declaration.
- If a future skill needs new behavior (e.g., podcast-v1 needs RSS feed generation), that requires a **platform code change**, not a manifest change. Document this as a v1.7+ concern.
- This is the single most important principle to write into Phase 28's spec.

**Phase:** 28 (spec doc must state this explicitly) + 34 (skill-author guide must state this)

---

## Category B: Process / Execution / Deployment Pitfalls

### B1. Breaking the Live Pipeline (regression risk)

**Symptom:** Phase 31 refactors `phase-complete.ts` to use registry lookup. Existing kais-movie-agent pipelines in flight fail because the manifest doesn't exactly match the old constants (e.g., `requires_review: true` vs old `REVIEW_REQUIRED_PHASES.includes('storyboard') === true`). Existing pipelines go to wrong state.

**Root cause:** Translation drift between hardcoded constants and manifest. Architecture flags this in §Phase-Specific Warnings (Phase 31).

**Prevention:**
- Phase 31 has a **pre-flight equivalence test**: for every constant in `REVIEW_REQUIRED_PHASES`, `PHASE_INGEST_MAP`, `PHASE_ORDER`, assert that `manifest.phaseById(id)` returns matching values.
- movie-v1 manifest is **generated** from existing constants in Phase 30 via a one-shot migration script, not hand-written. Treats constants as source of truth, manifest as derived.
- Phase 33 compliance test runs existing pipeline end-to-end before declaring "no regression".

**Phase:** 30 (script that derives manifest) + 31 (equivalence tests) + 33 (E2E test)

### B2. OpenClaw Lockstep Upgrade Trap

**Symptom:** Platform v1.6 ships new contract. OpenClaw-side kais-movie-agent skill still on v1.5 protocol. Calls fail at runtime. User blames platform.

**Root cause:** User said "breaking change OK" but didn't account for: (a) the OpenClaw workspace's kais-movie-agent also needs to publish a new `skill.manifest.json` to register; (b) deployed OpenClaw instances need the new manifest; (c) rollback requires reverting both sides simultaneously.

**Prevention:**
- v1.6 Phase 33 produces a **side-artifact**: a copy of the movie-v1 manifest file at `docs/skill-author-guide/movie-v1.manifest.json` that gets manually installed into the OpenClaw workspace as part of deployment.
- README has a "deploy order" section: platform first → register manifest via API → upgrade OpenClaw skill.
- Document the **rollback path**: if v1.6 is reverted, the OpenClaw-side manifest is no-op (platform falls back to constants via `defaultSkill.ts` until first registration).

**Phase:** 33 (compliance + deploy artifacts) + 34 (skill-author guide includes deploy order)

### B3. No Project Test Framework (from v1.5 retrospective)

**Symptom:** Phase 29 writes a DB migration but there's no jest/vitest to validate it. Phase 33 wants to write compliance tests but ends up writing standalone `tsx scripts/verify-phase-*.ts` files again, which work locally but aren't integrated into CI.

**Root cause:** v1.5 retrospective explicitly notes "Project lacks jest/vitest/mocha." This is pre-existing tech debt.

**Prevention:**
- **Either** (a) Phase 28 or 29 spends 0.5 phase budget to introduce vitest as the test runner (small, fast, works with ESM/TypeScript). Tests added incrementally across phases.
- **Or** (b) v1.6 stays with the `verify-phase-*.ts` pattern but adds them to `package.json scripts` so they're discoverable (e.g., `yarn verify:phase-29`).
- Recommendation: option (b) for v1.6 (introducing a test framework is its own milestone). But document the friction in retrospective to motivate v1.7.

**Phase:** 29 onwards (consistency in test pattern)

### B4. E2E Tests Skip Silently Without Docker (from v1.1 retrospective)

**Symptom:** Phase 33 compliance test passes in CI but skips the actual movie-agent invocation because no Docker runtime. Reviewer sees green checkmark. v1.6 ships. First real invocation fails.

**Root cause:** Tests auto-skip when environment unavailable (v1.1 retrospective explicitly notes this).

**Prevention:**
- Phase 33 test distinguishes **"skipped"** (yellow) from **"passed"** (green) from **"failed"** (red) in the report.
- VERIFICATION.md must explicitly state which tests ran vs skipped.
- Reviewer sign-off requires at least one test path that actually exercised the registry (memory-mode acceptable if Docker unavailable).

**Phase:** 33

### B5. TypeScript ESM/CJS Interop Friction (from v1.5 retrospective)

**Symptom:** Phase 30 tries to write a `registerSkill.ts` CLI to invoke the registry from a script. Hit `import()` returning `{ default: object }` instead of the function. Wasted an hour debugging.

**Root cause:** Project uses TypeScript ESM but Node's CommonJS-interop rules are subtle. v1.5 retrospective explicitly notes this friction for `core.ts`'s `generateRouter`.

**Prevention:**
- Phase 30 CLI scripts use the **standalone script** pattern (separate `.ts` file with explicit `tsx path/to/script.ts` invocation), not `tsx -e "import(...)"`.
- If you must use dynamic import, do `const mod = await import('...'); const fn = mod.default ?? mod;`.

**Phase:** 30

---

## Category C: Schema / Contract Drift Pitfalls

### C1. Spec Doc vs Code Validator Divergence

**Symptom:** Six months later, someone wants to add `priority` field to phase declarations. They update the validator in `src/skills/validator.ts` but forget to update `.planning/specs/SKILL-CONTRACT.md`. New skill authors follow the doc, get rejected by validator.

**Root cause:** Spec is markdown; validator is zod schema. No mechanical linkage.

**Prevention:**
- Phase 28 introduces a **single source of truth**: the zod schema in `src/skills/validator.ts` IS the spec. The markdown doc is generated from it via a script (e.g., `zod-to-md`).
- Alternatively: write spec by hand but add a Phase 33 test that does `assert.deepStrictEqual(Object.keys(zodSchema.shape), DOC_LISTED_FIELDS)`.

**Phase:** 28 + 33

### C2. Backfilling Orphaned Assets (from v1.5 audit pattern)

**Symptom:** Phase 29 adds `skill_id` column to `o_assets`. Backfill query is `UPDATE o_assets SET skill_id = 'movie-v1' WHERE projectId IN (SELECT id FROM o_project)`. Rows with deleted `projectId` (orphan assets) stay NULL. Asset queries later return inconsistent results.

**Root cause:** Architecture flags the correct fix: `WHERE skill_id IS NULL`. But the natural instinct is to scope by project.

**Prevention:**
- Phase 29 migration script uses unconditional `UPDATE o_assets SET skill_id = 'movie-v1' WHERE skill_id IS NULL`.
- Architecture's exact recommendation; included here so the planner doesn't second-guess.

**Phase:** 29

### C3. Manifest Lifecycle Deprecation Never Happens

**Symptom:** v1.7 ships new manifest format. v1.6 manifests still registered. Platform silently accepts both. Code branches grow: `if (manifest.version < 2) oldPath() else newPath()`. By v1.9, 5 versions coexist.

**Root cause:** No deprecation cycle. Plugin systems that don't enforce sunset dates accumulate support debt.

**Prevention:**
- v1.6 introduces the convention (documented in spec): **only the current major version is supported**. v1.x → v2.x migration is the skill author's problem, not the platform's.
- Spec doc states: "if you registered a v1.0 manifest and we shipped v2.0, your registration is invalidated on next platform upgrade. Re-register."
- Phase 33 includes a test that demonstrates this (register a "0.9" manifest → expect rejection).

**Phase:** 28 + 33

---

## Category D: v1.x Lessons Applied to v1.6

Sourced from `RETROSPECTIVE.md` + `MILESTONES.md`:

### D1. "Root cause or it didn't happen" (v1.5 lesson)

v1.5 Phase 27 fixed `src/core.ts` (the router auto-generator) instead of patching `router.ts` (the output). v1.4 had repeatedly tried patching the output.

**Applied to v1.6:** If Phase 31 reveals that refactoring callbacks creates new bugs, suspect the **manifest shape** (source) is wrong, not the **callback code** (output). Don't add per-phase special-case handling to callbacks — fix the manifest.

### D2. Vendored project isolation (v1.5 lesson)

v1.5 added vendored dirs to tsconfig.json exclude to stop 12k TS errors from polluting main build.

**Applied to v1.6:** If future skills ship as in-repo packages (e.g., `skills/movie-v1/`), they need their own tsconfig. The skill's manifest is data; the skill's TypeScript code (if any) is build-isolated.

### D3. Migration via alias, not breakage (v1.5 lesson)

v1.5 `paths.ts` accepted legacy env vars as overrides — zero breaking changes for existing deployments.

**Applied to v1.6:** User explicitly said "breaking change OK" for v1.6. **But** — apply the aliasing pattern anyway for the **constants layer**: keep `REVIEW_REQUIRED_PHASES` defined but unused as a deprecation marker, with a comment "moved to manifest, see src/skills/contract.ts". This helps anyone reading old code understand where the data went.

### D4. E2E tests skip silently (v1.1 lesson) → see B4

### D5. Hardcoded skill list avoids glob fragility (v1.1 lesson)

v1.1 hardcoded 14-skill migration list rather than using dynamic glob.

**Applied to v1.6:** Phase 30 ships a hardcoded `movie-v1` manifest in `defaultSkill.ts` (not dynamically discovered from filesystem). Filesystem skill discovery is v1.7+ scope. Architecture already specifies this.

### D6. EWMA-style confidence scoring is reusable (v1.1 pattern)

Not a direct pitfall, but a positive pattern: hermes-agent's EWMA confidence scoring could be reused for **skill health tracking** in v1.7+ (track success/fail rate per skill, prefer healthy skills).

**Not v1.6 scope** — flagged for v1.7 planning.

---

## Pitfall → Phase Mapping (for gsd-roadmapper)

| # | Pitfall | Phase | Severity |
|---|---------|-------|----------|
| A1 | Manifest schema bloat | 28 | HIGH |
| A2 | Version negotiation theater | 28 | MEDIUM |
| A3 | Node type ID collision | 28, 29, 33 | HIGH |
| A4 | Skill-as-data vs code drift | 28, 34 | CRITICAL |
| B1 | Breaking live pipeline | 30, 31, 33 | CRITICAL |
| B2 | OpenClaw lockstep upgrade | 33, 34 | HIGH |
| B3 | No test framework | 29+ | LOW (process) |
| B4 | E2E tests skip silently | 33 | MEDIUM |
| B5 | TS ESM/CJS friction | 30 | LOW |
| C1 | Spec vs validator divergence | 28, 33 | HIGH |
| C2 | Backfilling orphaned assets | 29 | MEDIUM |
| C3 | Manifest deprecation cycle | 28, 33 | LOW |

---

## Open Questions for Plan-Phase

These should be resolved during `/gsd:plan-phase` for the relevant phases, not during milestone-level roadmap:

- **Phase 28**: zod schema as source-of-truth for spec doc — confirm `zod-to-md` generator vs hand-written doc with field-equality test (C1)
- **Phase 29**: actual DB migration runner mechanism — Architecture flagged this as unverified
- **Phase 30**: how does the OpenClaw workspace's `skill.manifest.json` get installed? Manual copy, script, or HTTP registration on platform boot?
- **Phase 32**: how does the updated canvas bundle reach running Electron instances? Architecture flagged this as unverified

---

## Sources

- `RETROSPECTIVE.md` — v1.1 and v1.5 lessons
- `MILESTONES.md` — v1.0–v1.5 archive with deferred items
- `.planning/research/ARCHITECTURE.md` — primary technical reference (anti-patterns AP-1 through AP-4, phase-specific warnings)
- `.planning/PROJECT.md` — v1.6 architecture decisions (esp. #3 breaking changes OK, #4 highly generic)
- Industry observation: VS Code / Obsidian / n8n / ComfyUI plugin ecosystem behavior
