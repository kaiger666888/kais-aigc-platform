---
phase: 28-skill-contract-spec-ts-interface
verified: 2026-06-15T17:30:00Z
status: passed
score: 6/6 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: N/A
  gaps_closed: []
  gaps_remaining: []
  regressions: []
---

# Phase 28: Skill Contract Spec + TS Interface Verification Report

**Phase Goal:** Any party can read a single source of truth (spec + zod schema + TS types) describing what a workflow Skill Manifest must contain, what versioning rules apply, and that manifests carry descriptive data only — no executable behavior
**Verified:** 2026-06-15T17:30:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A developer reading `.planning/specs/SKILL-CONTRACT.md` can enumerate every required and optional manifest field without opening any other file | ✓ VERIFIED | `.planning/specs/SKILL-CONTRACT.md` contains a complete Field Reference section (lines 107–196) with one root table (11 rows) + 5 sub-interface tables (NodeTypeDecl 6, PhaseDecl 5, AssetCategoryDecl 2, ReviewCriteriaDecl 2, SkillRuntimeDecl 4). Every row uses literal `\| yes \|` or `\| no \|` Required tokens (27 yes, 3 no tokens total). Single Chinese codepoint in body is `"剧本"` used as an i18n example value, not body prose. |
| 2 | Feeding a malformed manifest (missing required field, wrong type, bare node type ID like `script` instead of `movie-v1::script`) to `validateManifest()` returns a structured rejection naming the violated rule | ✓ VERIFIED | `npx tsx scripts/verify-phase-28.ts` exit 0 — 12/12 assertions pass. Negative tests confirm all 5 ruleIds fire: empty object → MANIFEST_REQUIRED_FIELD, `skill_id:123` → MANIFEST_TYPE_MISMATCH, `version:'1.0.0'` → MANIFEST_VERSION_FORMAT, `node_types[0].type:'script'` → NODE_ID_NAMESPACING, top-level `foobar:1` → MANIFEST_UNKNOWN_FIELD. Bonus behavioral spot-checks: uppercase `Movie-V1::Script` also rejected with NODE_ID_NAMESPACING; unknown nested key in `review_criteria` rejected with MANIFEST_UNKNOWN_FIELD (strict mode on nested objects works). |
| 3 | The spec doc cannot silently drift from the validator — either the doc is generated from the zod schema, or a field-equality test fails CI when they diverge | ✓ VERIFIED | Drift test at `src/skills/__tests__/contract.test.ts` (lines 220–336) walks `manifestSchema.shape` for root + each nested `.element.shape` / `.shape`, compares field-name sets bidirectionally AND required-flags. **Mechanically proven**: injected a fake `__drift_test_fake_field` into `manifestSchema` and re-ran the test → it failed with the exact CONTEXT.md-specified message `"Field '__drift_test_fake_field' present in zod but missing in spec"`. validator.ts restored post-test (git status confirms no leftover diff). |
| 4 | The spec explicitly states the four "contract invariants": manifest is descriptive only, version is `major.minor` (additive minor), platform accepts any `1.x`, node type IDs are `<skill_id>::<type>` | ✓ VERIFIED | `## Contract Invariants` section (lines 30–72) enumerates five numbered invariants covering all four SC requirements. ROADMAP says "four" but versioning splits into format+additive+accept (3 statements) — the spec notes this explicitly (lines 68–71). Versioning section (lines 75–104) re-expands: regex `^\d+\.\d+$` stated 3× (lines 47, 80, 247), minor-additive rule stated, major-breaking permission stated, platform-accepts-any-1.x stated, only-current-major-supported (Pitfalls C3) stated. |

**Score:** 6/6 truths verified (4 ROADMAP SCs + 2 supporting must-haves confirmed in artifact section below)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/skills/contract.ts` | SkillManifest interface + 5 sub-interfaces + MediaType/BuiltinRenderer/IngestOutput type aliases + ManifestValidationError + ManifestValidationResult + ManifestValidationRuleId. Zero executable code. | ✓ VERIFIED | 240 lines, 12 `export` statements (MediaType, BuiltinRenderer, IngestOutput, NodeTypeDecl, PhaseDecl, AssetCategoryDecl, ReviewCriteriaDecl, SkillRuntimeDecl, SkillManifest, ManifestValidationRuleId, ManifestValidationError, ManifestValidationResult). `grep -c "^export interface\|^export type"` returns 12 (≥9 required). `grep -cE "^(function\|class\|=>)"` returns 0 — CONTRACT-06 descriptive-only invariant enforced structurally. `SkillRuntimeDecl.type` is literal union `"external-http" \| "in-process"`. `BuiltinRenderer` is exactly 5 literals (no `'custom'`). `ManifestValidationError.ruleId` typed as literal union of exactly 5 SCREAMING_SNAKE values. All fields snake_case. |
| `src/skills/validator.ts` | manifestSchema (zod v4 with `.strict()` on root + every nested object) + validateManifest() (discriminated union, never throws, emits all 5 ruleIds). | ✓ VERIFIED | 275 lines. `grep -c "\.strict()"` returns **11** (≥6 required — root + 5 nested objects, defense-in-depth satisfied). Exports `manifestSchema` (zod object) + `validateManifest` (function). Imports types from `./contract` (1 import) and zod (1 import). Two `.superRefine()` rules encode MANIFEST_VERSION_FORMAT (`^\d+\.\d+$`) + NODE_ID_NAMESPACING (`^[a-z0-9-]+::[a-z0-9-]+$`). Three ruleIds produced by remapping zod built-in error codes: MANIFEST_REQUIRED_FIELD (invalid_type+received undefined, includes zod v4 message-text fallback per SUMMARY deviation note), MANIFEST_TYPE_MISMATCH (invalid_type otherwise), MANIFEST_UNKNOWN_FIELD (unrecognized_keys from .strict()). `validateManifest(input: unknown): ManifestValidationResult` returns discriminated union, NEVER throws. |
| `.planning/specs/SKILL-CONTRACT.md` | 6 required sections (Contract Invariants, Versioning, Field Reference, Validation Rules, Strict Mode, Out of Scope) + 5 invariants + literal `yes`/`no` Required tokens. | ✓ VERIFIED | 354 lines. All 6 required `##` sections present: `## Contract Invariants` (line 30), `## Versioning` (line 75), `## Field Reference` (line 107), `## Validation Rules` (line 199), `## Strict Mode` (line 308), `## Out of Scope (v1.7+)` (line 324). 5 numbered invariants (lines 36, 44, 49, 54, 60). 27 `\| yes \|` + 3 `\| no \|` literal tokens (no checkmarks/emojis). English-first body. |
| `src/skills/__tests__/contract.test.ts` | Exports testFieldEqualityDrift() + testNegativeInputs(). No test framework. | ✓ VERIFIED | 431 lines. Exports `testFieldEqualityDrift(): Promise<TestSummary>` and `testNegativeInputs(): Promise<TestSummary>`. No vitest/jest/mocha import — uses `fs.readFileSync` + plain TS. Imports from both `../validator` (manifestSchema, validateManifest) and `../contract` (SkillManifest type). Defines module-local `VALID_BASE` constant. `grep -E '"vitest"\|"jest"\|"mocha"' package.json` returns empty. |
| `scripts/verify-phase-28.ts` | `#!/usr/bin/env tsx` shebang, follows verify-phase-23.ts pattern. | ✓ VERIFIED | 94 lines. Shebang on line 1. Imports both test functions from `../src/skills/__tests__/contract.test`. Local `assert()` helper pushes to `results[]`. `main()` async sums pass/fail, `main().catch(err => process.exit(2))`, `process.exit(1)` on failure. Pattern matches `scripts/verify-phase-23.ts` (v1.5 precedent verified to exist). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `src/skills/validator.ts` | `src/skills/contract.ts` | type import | ✓ WIRED | Line 36–41: `import type { SkillManifest, ManifestValidationError, ManifestValidationResult, ManifestValidationRuleId } from "./contract";` |
| `src/skills/validator.ts` | `zod` | schema definition | ✓ WIRED | Line 35: `import { z } from "zod";`. Used in 11 schema definitions + 2 `.superRefine()` rules. |
| `src/skills/__tests__/contract.test.ts` | `src/skills/validator.ts` | `import { validateManifest, manifestSchema }` | ✓ WIRED | Line 25: `import { manifestSchema, validateManifest } from "../validator";` |
| `src/skills/__tests__/contract.test.ts` | `.planning/specs/SKILL-CONTRACT.md` | fs.readFileSync + markdown parse | ✓ WIRED | Line 101: `const SPEC_PATH = resolve(process.cwd(), ".planning", "specs", "SKILL-CONTRACT.md");`. `readFileSync(SPEC_PATH, "utf8")` at line 233. Pipe-table regex parser (lines 121–170). |
| `scripts/verify-phase-28.ts` | `src/skills/__tests__/contract.test.ts` | import test functions | ✓ WIRED | Line 29: `import { testFieldEqualityDrift, testNegativeInputs } from "../src/skills/__tests__/contract.test";` Both functions invoked in `main()`. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `scripts/verify-phase-28.ts` | `driftSummary`, `negSummary` | `testFieldEqualityDrift()`, `testNegativeInputs()` | Yes — each returns `{ passed, failed, failures }` from real assertion execution | ✓ FLOWING |
| `src/skills/__tests__/contract.test.ts` (drift) | `zodRoot`, `specRoot` | `manifestSchema.shape` (zod v4 introspection), `parseFieldTable(spec, ...)` | Yes — zod introspection returns the actual 11 root fields + 5 nested shapes; markdown parser returns real field rows | ✓ FLOWING |
| `src/skills/__tests__/contract.test.ts` (negative) | `result` | `validateManifest(input)` | Yes — invokes real zod schema parse path, returns real `ManifestValidationError[]` with populated `ruleId`, `field`, `message`, `raw` | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Phase 28 runner all-pass | `npx tsx scripts/verify-phase-28.ts` | exit 0, 12 passed / 0 failed / 0 gate assertions | ✓ PASS |
| Validator rejects bare `'script'` with NODE_ID_NAMESPACING | `npx tsx -e "..."` (inline test) | ok:false, errors contain NODE_ID_NAMESPACING | ✓ PASS |
| Validator rejects unknown nested key with MANIFEST_UNKNOWN_FIELD | inline test injecting `review_criteria.mysterious` | ok:false, errors contain MANIFEST_UNKNOWN_FIELD (proves `.strict()` on nested objects) | ✓ PASS |
| Validator rejects version `'v1'` | inline test | ok:false, errors contain MANIFEST_VERSION_FORMAT | ✓ PASS |
| Validator rejects uppercase `'Movie-V1::Script'` | inline test (regex case-sensitivity check) | ok:false, errors contain NODE_ID_NAMESPACING | ✓ PASS |
| Drift test mechanically catches zod→spec divergence | Injected `__drift_test_fake_field: z.string()` into `manifestSchema`, ran drift test, restored file | failure with exact message `"Field '__drift_test_fake_field' present in zod but missing in spec"` | ✓ PASS |
| TypeScript type-checks clean | `npx tsc --noEmit \| grep src/skills/` | no errors in src/skills/ | ✓ PASS |

### Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| `scripts/verify-phase-28.ts` | `npx tsx scripts/verify-phase-28.ts` | exit 0, `=== SUMMARY: 12 passed, 0 failed (0 gate assertions) ===` | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| CONTRACT-01 | 28-01 | SkillManifest TypeScript interface exists with all required fields | ✓ SATISFIED | `src/skills/contract.ts` line 177: `export interface SkillManifest` declares skill_id, version, display_name, description, media_types, node_types, phase_taxonomy, asset_categories, review_criteria, engine_task_types, runtime (all 11 root fields) |
| CONTRACT-02 | 28-01 | validateManifest() parses well-formed + rejects malformed with structured errors | ✓ SATISFIED | `src/skills/validator.ts` line 268: `export function validateManifest(input: unknown): ManifestValidationResult`. Returns `{ ok: true, value }` on valid input, `{ ok: false, errors }` on malformed. Never throws. Verified by 6 negative + 1 positive test. |
| CONTRACT-03 | 28-02 | Spec doc + drift test mechanically link spec to validator | ✓ SATISFIED | Spec at `.planning/specs/SKILL-CONTRACT.md` (354 lines). Drift test at `src/skills/__tests__/contract.test.ts` walks zod `.shape` and compares field-for-field in both directions + required-flags. Mechanically proven to catch divergence. |
| CONTRACT-04 | 28-02 | Spec states versioning rules (major.minor, additive minor, accept any 1.x) | ✓ SATISFIED | `## Versioning` section lines 75–104 states: regex `^\d+\.\d+$` (3 occurrences), minor=strictly-additive, major=breaking-permitted, platform accepts any `1.x` at runtime, only-current-major-supported (Pitfalls C3). |
| CONTRACT-05 | 28-01 | Validator rejects bare node IDs (e.g., `'script'`) with NODE_ID_NAMESPACING | ✓ SATISFIED | `src/skills/validator.ts` line 124: `const namespacedRe = /^[a-z0-9-]+::[a-z0-9-]+$/;` rejects bare `'script'` and uppercase variants. Negative test confirms NODE_ID_NAMESPACING fires for `'script'`. |
| CONTRACT-06 | 28-01 + 28-02 | SkillManifest interface + spec declare zero executable code | ✓ SATISFIED | Structural: `contract.ts` has zero `function`, `class`, or `=>` exports — only `interface` and `type` declarations. Prose: spec `## Contract Invariants` Invariant 1 explicitly states "A Skill Manifest declares data shape only. It contains no functions, no methods, no executable code, no React component URLs, no hooks." (lines 36–42) |

**No orphaned requirements.** REQUIREMENTS.md traceability table (lines 115–120) maps all 6 CONTRACT-* requirements to Phase 28; both PLANs (28-01 + 28-02) `requirements:` frontmatter covers all 6 (28-01: CONTRACT-01/02/05/06; 28-02: CONTRACT-03/04 + claims CONTRACT-06 prose layer). All accounted for.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | — | — | No TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER markers found in any Phase 28 file. No empty `return null` / `return {}` stubs. No hardcoded empty data. No console.log-only handlers. |

### Human Verification Required

**None.** Phase 28 is purely a types + validation + documentation artifact — no UI rendering, no runtime behavior to eyeball, no external service integration, no visual flows. All success criteria are mechanically testable, and the 12/12 runner pass + 6/6 behavioral spot-checks + mechanical drift-test proof cover the entire goal surface.

### Gaps Summary

No gaps. All four ROADMAP success criteria are satisfied with codebase evidence:

1. ✓ Spec doc enumerates every required and optional field — verified by reading the file and counting 11 root + 5 sub-interface table rows with literal yes/no tokens.
2. ✓ `validateManifest()` returns structured rejections for all five malformed-input classes — verified by running `npx tsx scripts/verify-phase-28.ts` (12/12 pass) plus 4 additional behavioral spot-checks.
3. ✓ Drift prevention is mechanical — verified by injecting a fake field into the zod schema and observing the drift test fail with the exact CONTEXT.md-specified message format.
4. ✓ All four contract invariants stated explicitly in spec — verified by reading the `## Contract Invariants` section (5 numbered invariants covering all 4 SC requirements) and the dedicated `## Versioning` section with the regex stated 3×.

All 6 CONTRACT-* requirements satisfied. Zero scope creep (no `registry.ts`, `loader.ts`, `defaultSkill.ts`, `index.ts`, `contract.schema.json` — all confirmed absent). Zero anti-patterns. Zero human-verification items. TypeScript type-checks clean.

---

_Verified: 2026-06-15T17:30:00Z_
_Verifier: Claude (gsd-verifier)_
