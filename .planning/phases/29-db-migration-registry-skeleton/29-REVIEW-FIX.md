---
phase: 29-db-migration-registry-skeleton
fixed_at: 2026-06-15T00:00:00Z
review_path: .planning/phases/29-db-migration-registry-skeleton/29-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 29: Code Review Fix Report

**Fixed at:** 2026-06-15
**Source review:** `.planning/phases/29-db-migration-registry-skeleton/29-REVIEW.md`
**Iteration:** 1
**Fix scope:** `critical_warning` (Critical + Warning; Info findings out of scope by default)

**Summary:**
- Findings in scope: 5 (all 5 Warnings; 0 Critical)
- Fixed: 5
- Skipped: 0
- Status: all_fixed

## Fixed Issues

### WR-01: Backfill UPDATE is unconditional on every boot — no migration marker

**Files modified:** `src/lib/fixDB.ts`
**Commit:** `2469906`
**Applied fix:** Gate the backfill UPDATE on a SELECT count of NULL skill_id rows first. When count is 0 (already-migrated DB), the UPDATE is skipped entirely, making the operation a natural no-op and surfacing the migration state in boot logs. Added a comment block documenting that the WHERE clause is the only guard and that NULL is treated as a legacy sentinel value.

### WR-02: `(err as Error).message` will throw TypeError on non-Error throws

**Files modified:** `src/skills/loader.ts`
**Commit:** `3bbfed3`
**Applied fix:** Replaced `(err as Error).message` with `err instanceof Error ? err.message : String(err)` in the per-row catch handler. The defensive extraction ensures the log always carries useful diagnostic text regardless of what was thrown (string, null, undefined, non-Error object).

### WR-03: `JSON.parse(row.manifest_json)` receives a `string | null` value

**Files modified:** `src/skills/loader.ts`
**Commit:** `18ab570`
**Applied fix:** Added an explicit null check before `JSON.parse` that logs a distinct "skipping row with NULL manifest_json" message and `continue`s the loop. This distinguishes a NULL blob (no manifest at all) from a malformed JSON blob (unparseable manifest) in the boot logs, addressing the operator-misleading concern.

### WR-04: `register()` throws an error message with ruleId only — no field or message

**Files modified:** `src/skills/registry.ts`
**Commit:** `747ef20`
**Applied fix:** `register()`'s thrown Error now includes the full first-error triple: `ruleId at field: message`. The validator's structured errors are no longer discarded; Phase 30 REST consumers and operators will see WHICH node type or phase failed and WHY. Verified safe — verify-phase-29.ts Test 5 only asserts the throw occurs, not the message content.

### WR-05: Registry has no `delete()` / `unregister()` — Phase 31 hot-reload will be awkward

**Files modified:** `src/skills/registry.ts`, `scripts/verify-phase-29.ts`
**Commit:** `29f1f30`
**Applied fix:** Added `delete(skillId: string): boolean` method to the frozen registry singleton. Returns `true` if the skill was present and removed, `false` if not found (idempotent — deleting an unknown skill is a no-op, not an error). Clears all three indexes (manifests, phaseIndex, nodeTypeIndex) together so post-delete lookups via `get` / `phaseById` / `nodeTypeById` consistently return `undefined`. Updated the top-of-file JSDoc methods roster. Added Test 6 to verify-phase-29.ts (5 new assertions) exercising `delete()` across all three lookup surfaces plus idempotent re-delete and list() shrink verification.

## Skipped Issues

None — all 5 in-scope findings were fixed.

## Verification

Final state: `npx tsx scripts/verify-phase-29.ts` exits 0 with **29 passed, 0 failed**.

- Baseline: 24 assertions (before any fixes)
- After WR-05: 29 assertions (24 baseline + 5 new Test 6 assertions)

Test 5's error output now visibly includes the full ruleId + field + message triple (WR-04 confirmation visible in runner output):

```
registry.register: manifest failed validation — NODE_ID_NAMESPACING at node_types[0].type: Node type 'script' is missing the required '<skill_id>::<type>' namespace prefix (lowercase, hyphens, double-colon separator).
```

Tier 2 (TypeScript syntax check) was run on each modified file via `npx tsc --noEmit --skipLibCheck {file}`. All errors reported were pre-existing project-config issues (path aliases, esModuleInterop, resolveJsonModule) — no errors introduced by the fixes. The authoritative signal is the verify runner, which compiles and executes the files end-to-end via tsx.

REVIEW.md frontmatter `status:` updated from `issues_found` to `clean`, with a Fix Log section appended documenting per-finding resolutions and commit hashes.

## Commits (in order)

| Hash | Message |
|------|---------|
| `2469906` | `fix(29-01): WR-01 gate backfill on NULL count for boot visibility` |
| `18ab570` | `fix(29-03): WR-03 null-guard manifest_json before JSON.parse` |
| `3bbfed3` | `fix(29-02): WR-02 defensive extraction in loader catch block` |
| `747ef20` | `fix(29-04): WR-04 include field + message in register() thrown error` |
| `29f1f30` | `fix(29-05): WR-05 add registry.delete() for Phase 31 hot-reload` |
| `30c26fd` | `docs(29): mark REVIEW.md clean after fix iteration 1` |

---

_Fixed: 2026-06-15_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
