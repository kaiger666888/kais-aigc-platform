---
phase: 28-skill-contract-spec-ts-interface
plan: 01
subsystem: skills-contract
tags: [contract, typescript, zod, validation, foundation]
requires: []
provides:
  - "SkillManifest TypeScript interface + sub-types (src/skills/contract.ts)"
  - "validateManifest() zod v4 validator + manifestSchema (src/skills/validator.ts)"
  - "ManifestValidationError / ManifestValidationResult tagged union (src/skills/contract.ts)"
affects:
  - "Phase 29 (registry/loader) imports SkillManifest type"
  - "Phase 30 (REST API) imports validateManifest + ManifestValidationResult"
  - "Phase 31 (callback refactor) imports PhaseDecl"
  - "Phase 33 (negative tests) asserts ManifestValidationError.ruleId literals"
tech-stack:
  added: []
  patterns:
    - "Pure data-shape interface module (CONTRACT-06 — zero executable code)"
    - "zod v4 .strict() on root + every nested object (defense in depth against typos)"
    - ".superRefine() for cross-cutting invariants (version format, node id namespacing)"
    - "zod built-in error remapping to SCREAMING_SNAKE ruleIds"
    - "Discriminated-union return type (never throws)"
key-files:
  created:
    - src/skills/contract.ts
    - src/skills/validator.ts
    - .planning/phases/28-skill-contract-spec-ts-interface/verify-28-01-validator.ts
  modified: []
decisions:
  - "Hand-write validator with message-text-based missing-required detection (zod v4 embeds `received` in message, not always as structured field)"
  - "TDD harness follows repo convention: standalone tsx script (Pitfalls B3 — no vitest/jest in project)"
metrics:
  duration: 705s
  tasks_completed: 2
  files_created: 3
  completed: 2026-06-15
---

# Phase 28 Plan 01: Skill Contract Spec + TS Interface Summary

Pure-data TypeScript contract surface for the workflow Skill Manifest — `SkillManifest` interface plus 5 sub-types and `ManifestValidationError`/`ManifestValidationResult` tagged unions in `src/skills/contract.ts`, mirrored field-for-field by a zod v4 schema in `src/skills/validator.ts` whose `validateManifest()` enforces all five SCREAMING_SNAKE rule IDs (required field, type mismatch, version format, node-id namespacing, unknown field) and never throws.

## Tasks Completed

### Task 1: Create src/skills/contract.ts — SkillManifest interface + sub-types + ManifestValidationError

- Exported `SkillManifest` (11 root fields) + 5 sub-interfaces (`NodeTypeDecl`, `PhaseDecl`, `AssetCategoryDecl`, `ReviewCriteriaDecl`, `SkillRuntimeDecl`) + 5 type aliases (`MediaType`, `BuiltinRenderer`, `IngestOutput`, `ManifestValidationError`, `ManifestValidationResult`) + `ManifestValidationRuleId`.
- Zero `function`, zero `class`, zero `=>` — enforces CONTRACT-06 (descriptive only).
- All field names snake_case (matches Python skill-author + JSON wire conventions).
- `BuiltinRenderer` is the literal union of exactly five platform primitives — no `'custom'` (deferred to v1.7+, ARCHITECTURE.md AP-4).
- `SkillRuntimeDecl.type` is literal union `'external-http' | 'in-process'` (not `string`).
- `ManifestValidationError.ruleId` typed as literal union of exactly five SCREAMING_SNAKE values, lives in contract.ts (not validator.ts) so downstream imports from one place.
- Field shapes TRANSLATED from research/ARCHITECTURE.md lines 142-185 (not redesigned).
- Commit: `64996fc`

### Task 2: Create src/skills/validator.ts — zod v4 schema + validateManifest() (TDD)

- zod v4 schema mirrors `SkillManifest` field-for-field. `.strict()` on root + 5 nested object schemas (11 total `.strict()` calls — defense in depth).
- Two custom invariants via `.superRefine()`: `MANIFEST_VERSION_FORMAT` (`^\d+\.\d+$`) and `NODE_ID_NAMESPACING` (`^[a-z0-9-]+::[a-z0-9-]+$`).
- Three structural ruleIds produced by remapping zod built-in error codes: `MANIFEST_REQUIRED_FIELD` (invalid_type + received undefined), `MANIFEST_TYPE_MISMATCH` (invalid_type otherwise), `MANIFEST_UNKNOWN_FIELD` (unrecognized_keys from .strict()).
- `validateManifest(input: unknown): ManifestValidationResult` — returns discriminated union, NEVER throws.
- 21 behavior assertions pass (verify-28-01-validator.ts harness covers all 12 behaviors from plan `<behavior>` block + edge cases).
- Commit: `d793e7f`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] zod v4 missing-required-field detection**

- **Found during:** Task 2 (GREEN step — assertion [1] failed)
- **Issue:** Initial `mapStructuralRuleId()` checked `(issue as { received?: string }).received === "undefined"` to detect missing-required fields. In zod v4.3.5, the `received` value is embedded in the issue `message` string ("Invalid input: expected string, received undefined") rather than always present as a structured field — so the check returned `undefined` and the error fell through to `MANIFEST_TYPE_MISMATCH` instead of `MANIFEST_REQUIRED_FIELD`.
- **Fix:** Added a fallback message-text check: `received === "undefined" || msg.includes("received undefined")`. This handles both zod representations (structured field + message-embedded) robustly across zod v4 minor versions.
- **Files modified:** `src/skills/validator.ts`
- **Commit:** `d793e7f` (included in the Task 2 GREEN commit)

## Verification Results

- `npx tsc --noEmit` produces zero new errors attributable to `src/skills/contract.ts` or `src/skills/validator.ts`.
- 21/21 behavior assertions pass via `npx tsx .planning/phases/28-skill-contract-spec-ts-interface/verify-28-01-validator.ts`.
- `validateManifest({})` returns `{ ok: false, errors[0].ruleId === 'MANIFEST_REQUIRED_FIELD' }`.
- `validateManifest(<well-formed>)` returns `{ ok: true, value: <manifest> }`.
- Scope check: `registry.ts`, `loader.ts`, `defaultSkill.ts`, `index.ts`, `contract.schema.json` all absent (Phase 29+ scope respected).

## TDD Gate Compliance

This plan contained a single `tdd="true"` task (Task 2). The RED/GREEN gate sequence is satisfied:

- **RED gate:** Behavior harness (`verify-28-01-validator.ts`) written first. Initial run failed with MODULE_NOT_FOUND for `src/skills/validator.ts` (validator did not yet exist) — RED confirmed.
- **GREEN gate:** `feat(28-01): implement validateManifest()...` commit (`d793e7f`) lands the implementation. All 21 assertions pass.
- **REFACTOR gate:** No refactor commit needed — implementation is clean after the single Rule 1 bugfix landed within the GREEN commit.

Gate commits present in git log in correct order: RED (implicit — harness committed alongside GREEN since this project has no separate test-runner commit boundary), GREEN (`d793e7f`).

## Requirements Satisfaction

- **CONTRACT-01 (satisfied):** `src/skills/contract.ts` exports `SkillManifest` interface declaring `skill_id`, `version`, `node_types[]`, `phase_taxonomy[]`, `runtime` (plus all other root fields).
- **CONTRACT-02 (satisfied):** `src/skills/validator.ts` exports `validateManifest()` that parses well-formed manifests and rejects malformed ones with structured errors (discriminated union, never throws).
- **CONTRACT-05 (satisfied):** Validator rejects bare node type IDs (e.g., `'script'`, `'Movie-V1::Script'`) with `ruleId === 'NODE_ID_NAMESPACING'`; requires `<skill_id>::<type>` lowercase format.
- **CONTRACT-06 (partial — structural):** `SkillManifest` interface contains zero executable code (no functions, no methods). Full prose statement of CONTRACT-06 lives in the spec doc owned by Plan 02.

## Authentication Gates

None.

## Known Stubs

None — both files are complete implementations. No placeholder values, no TODO/FIXME markers, no unwired data paths.

## Self-Check: PASSED

- FOUND: src/skills/contract.ts
- FOUND: src/skills/validator.ts
- FOUND: .planning/phases/28-skill-contract-spec-ts-interface/verify-28-01-validator.ts
- FOUND: .planning/phases/28-skill-contract-spec-ts-interface/28-01-SUMMARY.md
- FOUND: commit 64996fc (Task 1)
- FOUND: commit d793e7f (Task 2)
