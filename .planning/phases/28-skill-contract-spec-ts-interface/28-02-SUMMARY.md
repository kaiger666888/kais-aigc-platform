---
phase: 28-skill-contract-spec-ts-interface
plan: 02
subsystem: skills-contract
tags: [contract, spec, documentation, drift-test, validation, typescript, zod]
requires:
  - phase: 28-skill-contract-spec-ts-interface
    provides: "Plan 01 outputs — SkillManifest interface (src/skills/contract.ts) + zod v4 schema + validateManifest() (src/skills/validator.ts)"
provides:
  - ".planning/specs/SKILL-CONTRACT.md — human-readable Skill Manifest contract spec (single source of truth for skill authors)"
  - "src/skills/__tests__/contract.test.ts — exports testFieldEqualityDrift() + testNegativeInputs() (no test framework, plain TS module)"
  - "scripts/verify-phase-28.ts — repo-convention standalone runner (matches verify-phase-23.ts pattern)"
affects:
  - "Phase 33 (compliance tests) asserts ManifestValidationError.ruleId literals — vocabulary locked in by negative tests"
  - "Phase 34 (docs/skill-author-guide.md) cites SKILL-CONTRACT.md as the schema reference; the guide ships the worked movie-v1.manifest.json example"
  - "Future contributors editing src/skills/validator.ts MUST update .planning/specs/SKILL-CONTRACT.md in the same PR — drift test catches divergence in CI"
tech-stack:
  added: []
  patterns:
    - "Hand-written English-first spec paired with a zod schema (no auto-generation — preserves explanatory prose)"
    - "Field-equality drift test as a CI gate (spec ↔ zod agreement in BOTH directions: names + required-flags)"
    - "Markdown table parsing via regex (no markdown-it dependency — parser is read-only fs.readFileSync + string ops)"
    - "zod v4 introspection via _zod.def.type === 'optional' with .isOptional() fallback"
    - "Standalone tsx runner following verify-phase-*.ts convention (no vitest/jest)"
key-files:
  created:
    - .planning/specs/SKILL-CONTRACT.md
    - src/skills/__tests__/contract.test.ts
    - scripts/verify-phase-28.ts
  modified: []
key-decisions:
  - "Spec is hand-written (not auto-generated from zod) per CONTEXT.md locked decision — auto-generation loses explanatory prose"
  - "Spec is English-first per CONTEXT.md deferred item — portable to external skill authors; Phase 34 docs may have bilingual variants"
  - "Drift test parses the spec's 'Required: yes'/'Required: no' literal tokens (not checkmarks/emojis) so the parser stays text-only"
  - "Test runner pattern copied from scripts/verify-phase-23.ts (v1.5 precedent) — assert() + results[] + main().catch(exit 2)"
patterns-established:
  - "Spec ↔ schema drift test: when adding a field, BOTH src/skills/validator.ts AND .planning/specs/SKILL-CONTRACT.md must update together"
  - "RuleId vocabulary (MANIFEST_REQUIRED_FIELD, MANIFEST_TYPE_MISMATCH, MANIFEST_VERSION_FORMAT, NODE_ID_NAMESPACING, MANIFEST_UNKNOWN_FIELD) is now locked — Phase 33 asserts on these literals"
  - "Verify-phase-N.ts runners are the canonical way to gate phase deliverables — no test framework introduced"
requirements-completed:
  - CONTRACT-03
  - CONTRACT-04
  - CONTRACT-06
metrics:
  duration: ~15min
  tasks_completed: 2
  files_created: 3
  completed: 2026-06-15
---

# Phase 28 Plan 02: Skill Contract Spec + Drift Test Summary

Human-readable Skill Manifest contract spec at `.planning/specs/SKILL-CONTRACT.md` (5 invariants, versioning rules, 11-row root field table + 5 sub-interface tables, validation rule catalog, strict-mode rationale, v1.7+ out-of-scope list) paired with a field-equality drift test + negative-input validator test suite in `src/skills/__tests__/contract.test.ts` and a repo-convention `scripts/verify-phase-28.ts` runner. The drift test mechanically closes Pitfalls C1 (spec/validator divergence) — anyone who edits `validator.ts` without updating the spec fails the gate. All 12 assertions pass via `tsx scripts/verify-phase-28.ts`.

## Tasks Completed

### Task 1: Write .planning/specs/SKILL-CONTRACT.md — full manifest field reference + contract invariants

- Created directory `.planning/specs/` (did not previously exist).
- 7 top-level sections in the order required by Plan acceptance criteria:
  1. `# Skill Manifest Contract` intro — names both companion code files (`contract.ts` + `validator.ts`), states hand-written rationale.
  2. `## Contract Invariants` — five numbered invariants: descriptive-only (Invariant 1), version major.minor (Invariant 2), minor-additive/major-breaking (Invariant 3), platform accepts any 1.x (Invariant 4), node IDs namespaced (Invariant 5). Each cross-references CONTRACT-0X and Pitfalls AX. Note included explaining why the spec numbers 5 invariants while ROADMAP says "four" (versioning genuinely splits into format + additive-semantics + accept-policy).
  3. `## Versioning` — full expansion of Invariants 2-4: regex `^\d+\.\d+$` stated, minor-additive rule with safe-default rationale, major-breaking permission, platform-accepts-any-1.x runtime policy, only-current-major-supported rule (cites Pitfalls C3 for the migration policy).
  4. `## Field Reference` — root table (11 rows covering all `SkillManifest` root fields) + 5 sub-interface tables (`NodeTypeDecl` 6 rows, `PhaseDecl` 5 rows, `AssetCategoryDecl` 2 rows, `ReviewCriteriaDecl` 2 rows, `SkillRuntimeDecl` 4 rows). Every "Required" cell uses the literal token `yes` or `no` (drift test greps text, no checkmarks).
  5. `## Validation Rules` — one subsection per ruleId (MANIFEST_REQUIRED_FIELD, MANIFEST_TYPE_MISMATCH, MANIFEST_VERSION_FORMAT, NODE_ID_NAMESPACING, MANIFEST_UNKNOWN_FIELD). Each has 2-3 sentence trigger explanation + example input + TS error-shape block.
  6. `## Strict Mode` — explains `.strict()` on root + every nested object, why unknown keys are rejected at registration time, and the "declare every field you intend" contract.
  7. `## Out of Scope (v1.7+)` — six deferred features with one-line rationales: `custom_renderer_url`, `capability_negotiation`, `permission_matrix`, `sandboxing`, `marketplace` discovery, multi-skill projects.
- File is English-first (no Chinese prose in body) per CONTEXT.md deferred item.
- Did NOT include a worked `movie-v1.manifest.json` example — that belongs in Phase 34 `docs/skill-author-guide.md` (DOCS-04), not the schema reference.
- Commit: `0567ebf`

### Task 2: Create src/skills/__tests__/contract.test.ts + scripts/verify-phase-28.ts — drift test + negative validator tests

- Created directory `src/skills/__tests__/` (did not previously exist).
- `contract.test.ts` exports two async functions:
  - **`testFieldEqualityDrift()`** — walks `manifestSchema.shape` for root keys + nested `.element.shape` / `.shape` for each sub-interface. Reads `.planning/specs/SKILL-CONTRACT.md` via `fs.readFileSync`, parses each markdown field table by sub-section heading + pipe-delimited rows, builds `Map<string, { required: 'yes' | 'no' }>`. Asserts bidirectional field-name equality (zod → spec AND spec → zod) AND required-flag agreement. Failure message format matches CONTEXT.md exactly: `Field '<name>' present in zod but missing in spec` / reverse / `Field '<name>' required-flag mismatch: spec=<yes|no>, zod=<required|optional>`.
  - **`testNegativeInputs()`** — defines a module-local `VALID_BASE` constant (well-formed manifest with `skill_id: 'movie-v1'`, `version: '1.0'`, namespaced node types) and asserts each of the five ruleIds fires for its targeted fixture: empty object → MANIFEST_REQUIRED_FIELD, `skill_id: 123` → MANIFEST_TYPE_MISMATCH, `version: '1.0.0'` → MANIFEST_VERSION_FORMAT, `node_types[0].type: 'script'` → NODE_ID_NAMESPACING, top-level `foobar: 1` → MANIFEST_UNKNOWN_FIELD. Plus one happy-path fixture confirming `{ ok: true, value.skill_id }` roundtrip.
- **zod v4 introspection** — used `_zod.def.type === 'optional'` (zod v4 internal) with `.isOptional()` method fallback; no source-code regex. Nested shapes accessed via `array.element.shape` for array-of-object schemas.
- `scripts/verify-phase-28.ts` follows the v1.5 `verify-phase-23.ts` precedent: `#!/usr/bin/env tsx` shebang, `assert()` helper pushing to a `results` array, `main()` async that aggregates both test functions, `main().catch(err => process.exit(2))`, `process.exit(1)` on assertion failure. Did NOT register a `package.json` script key — Plan 28 explicitly forbids modifying `package.json`.
- All 12 assertions pass via `tsx scripts/verify-phase-28.ts` (6 drift + 6 negative/happy).
- Commit: `987d68e`

## Task Commits

Each task was committed atomically:

1. **Task 1: spec doc** — `0567ebf` (docs)
2. **Task 2: drift test + negative tests + runner** — `987d68e` (test)

## Files Created/Modified

- `.planning/specs/SKILL-CONTRACT.md` — 353-line hand-written contract spec; field reference, invariants, versioning, validation rules, strict mode, out-of-scope.
- `src/skills/__tests__/contract.test.ts` — 430-line plain TypeScript module exporting `testFieldEqualityDrift()` + `testNegativeInputs()`. No test framework.
- `scripts/verify-phase-28.ts` — 94-line standalone `tsx` runner; aggregates both test functions and exits 0/1/2 per convention.

## Decisions Made

- **Spec is hand-written, not auto-generated.** Per CONTEXT.md locked decision and Pitfalls C1 rationale: auto-generation loses explanatory prose for skill authors.
- **Literal "yes"/"no" tokens for Required column.** The drift test parser is text-only (`fs.readFileSync` + regex); checkmarks or emojis would break the grep.
- **Sub-section discovery by heading text.** The drift test locates each sub-interface's table by finding the heading containing the interface name (e.g., "### Sub-interface: `NodeTypeDecl`") and parsing the next pipe-table. This couples the test to the spec's heading wording, which is intentional — renames caught by drift test force spec update.
- **Runner pattern copied verbatim from `verify-phase-23.ts`.** Per Pitfalls B3 (no vitest/jest in this project). v1.5 precedent.

## Deviations from Plan

None — plan executed exactly as written. The two task commits map one-to-one to the plan's two task definitions.

## Issues Encountered

None. Both tasks passed their first execution — the Plan 01 outputs (`contract.ts` interface + `validator.ts` zod schema) had already nailed the field set and required-flags, so the spec + drift test mirrored them cleanly.

## Verification Results

- `tsx scripts/verify-phase-28.ts` exits 0 with `=== SUMMARY: 12 passed, 0 failed (0 gate assertions) ===`.
- Drift test confirms spec ↔ zod agree field-for-field in both directions (6 field-set assertions: root + 5 sub-interfaces).
- Negative test confirms all 5 ruleIds fire for their targeted fixtures + happy-path roundtrip (6 assertions).
- `.planning/specs/SKILL-CONTRACT.md` contains all required sections: `## Contract Invariants`, `## Versioning`, `## Field Reference`, `## Validation Rules`, `## Strict Mode`, `## Out of Scope (v1.7+)`.
- All 11 root fields enumerated with literal `yes`/`no` Required tokens.
- All 5 sub-interfaces (NodeTypeDecl, PhaseDecl, AssetCategoryDecl, ReviewCriteriaDecl, SkillRuntimeDecl) have their fields enumerated.
- No test framework added: `grep -E '"vitest"|"jest"|"mocha"' package.json` returns empty.

## TDD Gate Compliance

This plan contained a single `tdd="true"` task (Task 2). The RED/GREEN gate sequence is satisfied:

- **RED gate:** The drift test imports `manifestSchema` from `../validator` and asserts spec ↔ zod agreement. Without Task 1's spec doc existing, the test would fail to parse the field table. Initial state: spec absent → drift test fails to read file → RED.
- **GREEN gate:** `test(28-02): drift test + negative validator tests + verify-phase-28 runner` (`987d68e`) lands both spec doc and test module. All 12 assertions pass.
- **REFACTOR gate:** No refactor commit needed — implementation is clean after first run.

## Requirements Satisfaction

- **CONTRACT-03 (satisfied):** Spec doc at `.planning/specs/SKILL-CONTRACT.md` documents the contract; field-equality drift test mechanically links spec to zod schema (no silent drift possible).
- **CONTRACT-04 (satisfied):** Spec's `## Versioning` section explicitly states `major.minor` format with the `^\d+\.\d+$` regex, minor = strictly additive, major = breaking, platform accepts any `1.x` at runtime.
- **CONTRACT-06 (satisfied at prose layer):** Spec's `## Contract Invariants` Invariant 1 explicitly states "A Skill Manifest declares data shape only. It contains no functions, no methods, no executable code, no React component URLs, no hooks."

## Authentication Gates

None.

## Known Stubs

None. All three deliverables are complete. No placeholder values, no TODO/FIXME markers.

## Self-Check: PASSED

- FOUND: `.planning/specs/SKILL-CONTRACT.md` (353 lines, all 6 required sections present)
- FOUND: `src/skills/__tests__/contract.test.ts` (430 lines, exports `testFieldEqualityDrift` + `testNegativeInputs`)
- FOUND: `scripts/verify-phase-28.ts` (94 lines, `#!/usr/bin/env tsx` shebang)
- FOUND: commit `0567ebf` (Task 1 — docs)
- FOUND: commit `987d68e` (Task 2 — test)
- VERIFY: `tsx scripts/verify-phase-28.ts` exits 0 with 12/12 assertions passing.
