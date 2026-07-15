---
phase: 44-receiving-side-schema-strictness-import-validation
plan: 02
wave: 2
requirements: [SCHEMA-02]
status: complete
commits:
  - "0ece762c feat(44-02): warn + stamp __incomplete on missing expected params"
key-files:
  modified:
    - src/routes/canvas/v2/import-from-dir.ts
---

# 44-02 — Import Stamping + Flatten Helper Extraction

## What was built

Three edits to `src/routes/canvas/v2/import-from-dir.ts`:

1. **Import** `EXPECTED_PARAM_FIELDS_BY_TYPE` from `@/lib/canvasAssetSchema`
   (uses the `@/lib/...` alias style matching `nodes.ts:15`).
2. **Extract** the inline `params.*` flatten block (~line 437) into an
   exported `flattenParamsToNodeData(params, extra)` helper at module scope.
   Pure refactor — byte-for-byte identical behavior — exported so Plan 03's
   verifier can import the production flatten code (closes Blocker 3).
3. **Insert** a completeness-check block in the `buildPhaseTree` artifact
   loop immediately after `ENUM_NORMALIZERS`. For each artifact: if
   `EXPECTED_PARAM_FIELDS_BY_TYPE[canvasType]` is non-empty, compute the
   missing subset and stamp `artData.__incomplete = true` +
   `artData.__missing_fields = [...]` with a `[v2/import]` console.warn.
   The node is still created — no `return`, no `throw`, no `try/catch`
   (CONTEXT.md hard rule + RESEARCH anti-pattern).

## Notable decisions

- **Baseline-only check** — does NOT include `PHASE_REQUIRED_FIELDS`
  phase-specific adds (e.g. `archetype`/`role` for p04). This honors
  Pitfall 3: the 689 historical rows that pre-date the v2.0 contract
  are NOT flagged `__incomplete`.
- **Pure-refactor extraction** — `flattenParamsToNodeData` has identical
  logic to the original inline block. Only the wrapper (export, function
  signature) is new.

## Verification

- `EXPECTED_PARAM_FIELDS_BY_TYPE` appears 2× in `import-from-dir.ts`
  (import + usage).
- `__incomplete` / `__missing_fields` both present.
- `[v2/import]` warn prefix present.
- `export function flattenParamsToNodeData` exported exactly once.
- No `return` / `throw` / `continue` / `try {` in the inserted block.
- `npx tsc --noEmit` — zero new errors.

## Forward enables

- Plan 03 imports `flattenParamsToNodeData` so SCHEMA-03 is non-tautological.
- Phase 45 UI can render `__incomplete` / `__missing_fields` as a flag on
  nodes that fail the receiver-side completeness check.
