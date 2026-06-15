---
phase: 29-db-migration-registry-skeleton
reviewed: 2026-06-15T00:00:00Z
fixed: 2026-06-15T00:00:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - src/lib/initDB.ts
  - src/lib/fixDB.ts
  - src/types/database.d.ts
  - src/skills/registry.ts
  - src/skills/loader.ts
  - src/utils/db.ts
  - scripts/verify-phase-29.ts
findings:
  critical: 0
  warning: 5
  info: 6
  total: 11
fixed_this_iteration:
  warning: 5
  critical: 0
status: clean
---

# Phase 29: Code Review Report

**Reviewed:** 2026-06-15
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Phase 29 ships a clean persistence + in-memory registry skeleton. The four success criteria (backfill, populated-table boot, empty-table boot, no-fallback lookups) are correctly implemented and covered by a 24-assertion runner. `register()` defensively re-validates; the loader wraps every per-row operation in try/catch; secondary indexes are built inside `register()`; unknown lookups return `undefined` (verified by reading the optional-chaining call sites and the runner's Test 4). No SQL injection surface (Knex query builder parameterization throughout; no raw SQL introduced). No hardcoded secrets, no `eval`, no debug artifacts.

However, the review surfaced several robustness gaps that will bite Phase 30/31 if not addressed now:

1. **CRITICAL-grade data-integrity gap (typed as WARNING because no code path triggers it yet)**: the backfill in `fixDB.ts` runs unconditionally on every boot. On an already-migrated DB, the `whereNull("skill_id")` clause matches zero rows so it is a no-op — but if a future writer (Phase 30/31) ever inserts a new row with an explicit `skill_id: null` (e.g., a partial INSERT that omits the column), the next boot will silently overwrite it with `"movie-v1"`. There is no guard distinguishing "pre-migration NULL" from "post-migration intentional NULL". See WR-01.
2. The loader's catch-all `(err as Error).message` will itself throw `TypeError` if a non-Error value is thrown (e.g., a string or `null`), turning a recoverable per-row skip into a boot crash. See WR-02.
3. `JSON.parse(row.manifest_json)` is called on a value typed `string | null` — `JSON.parse(null)` does not throw (it returns `null`), so the catch block never fires for this case; the row is silently routed through `validateManifest(null)` → `{ok: false}` → "invalid manifest" log. The behavior is correct but the type annotation hides the null-coercion. See WR-03.
4. The registry's `register()` throws an Error whose message includes ONLY the ruleId, not the field or message — diagnostic loss when debugging why a Phase 30 REST call failed. See WR-04.
5. Phase 31 prep: the registry exposes no `unregister()` / `clear()` method. Phase 31's callback refactor will need to swap in new manifests at runtime (skill hot-reload, version bumps); the only current option is `register()` (overwrite). A `delete()` would be safer. See WR-05.

No Critical issues — the migration is safe (idempotent), the schema matches the plan, the registry API is complete for Phase 31's stated needs, and the verify runner proves all four success criteria.

## Critical Issues

_None._ The migration is idempotent, the registry contract is honored, and the boot path is correctly wired. All defects found are robustness / quality issues graded WARNING or INFO.

## Warnings

### WR-01: Backfill UPDATE is unconditional on every boot — no migration marker

**File:** `src/lib/fixDB.ts:81-82`
**Issue:** Both backfill statements run unconditionally inside the default-exported migration function:

```typescript
await db("o_assets").whereNull("skill_id").update({ skill_id: "movie-v1" });
await db("kv_pipelineRun").whereNull("skill_id").update({ skill_id: "movie-v1" });
```

Today, this is a no-op on already-migrated DBs (zero rows match `whereNull`). But the `addColumn` calls above it ARE guarded by `hasColumn`, and the existing state-recovery UPDATEs earlier in the file (lines 35-58) are intentional re-runs of state transitions. There is no equivalent "this backfill has already been applied" marker. Once Phase 31's refactored callbacks start writing new `o_assets` rows, ANY bug that writes `skill_id: null` (or any future code path that deliberately wants a NULL skill_id) will be silently rewritten to `"movie-v1"` on the next boot, with no log and no signal. This is the textbook "idempotent migration that becomes a landmine" pattern.

The plan's threat model (T-29-01) treats the WHERE clause as sufficient mitigation — it is sufficient TODAY, but is brittle against future writers. The CONTEXT.md decision ("explicit-is-better; Phase 31 callbacks set values deliberately") implicitly assumes every future writer sets the value, which is unverifiable.

**Fix:** Either (a) add a one-time migration marker (a row in a `kv_migrationMeta` table or a pragma) so the backfill only runs once ever, or (b) at minimum, change the UPDATE to log how many rows it touched so the operation is observable in boot output:

```typescript
const assetBackfill = await db("o_assets").whereNull("skill_id").update({ skill_id: "movie-v1" });
if (assetBackfill > 0) {
  console.log(`[fixDB] backfilled ${assetBackfill} o_assets rows to skill_id=movie-v1`);
}
```

At minimum, document in a code comment that the WHERE clause is the only guard and that any future writer that deliberately inserts NULL skill_id will be overwritten on next boot.

---

### WR-02: `(err as Error).message` will throw TypeError on non-Error throws

**File:** `src/skills/loader.ts:80`
**Issue:** The per-row catch handler does:

```typescript
} catch (err) {
  console.warn(
    "[skills/loader] skipping unparseable manifest for skill_id=" +
      row.skill_id + " — " + (err as Error).message,
  );
}
```

The `err as Error` is a type assertion, not a runtime check. If anything throws a non-Error value (a string, a number, `null`, `undefined`, or an object without a `message` property), accessing `.message` returns `undefined` — but if the thrown value is `null` or `undefined`, the property access itself does NOT throw (returns `undefined`), so the log becomes `"... — undefined"`. That's degraded but recoverable.

The real risk: `validateManifest` is documented as "NEVER throws" and `registry.register` throws `new Error(...)` (always an Error instance), and `JSON.parse` throws `SyntaxError` (always an Error). So in practice, `err` is always an Error today. But the catch block's existence implies it is a defensive catch-all — and a defensive catch-all that assumes its input is well-typed defeats its own purpose. If a future change to `validateManifest` or `register` throws a non-Error (e.g., a zod internals change, or a deliberate `throw "abort"`), the loader will log garbage and the boot will continue with the row silently dropped — masking the real bug.

**Fix:** Defensive extraction:

```typescript
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.warn(
    "[skills/loader] skipping unparseable manifest for skill_id=" +
      row.skill_id + " — " + msg,
  );
}
```

---

### WR-03: `JSON.parse(row.manifest_json)` receives a `string | null` value

**File:** `src/skills/loader.ts:57`
**Issue:** Per `src/types/database.d.ts:255`, `o_skillRegistry.manifest_json` is typed `string | null` (the column is declared nullable in `initDB.ts:1194`). The loader calls `JSON.parse(row.manifest_json)` without null-checking:

```typescript
const parsed = JSON.parse(row.manifest_json);
```

JavaScript's `JSON.parse(null)` coerces `null` → `"null"` (the string) → returns `null` (the JSON value). It does NOT throw. So a row with `manifest_json IS NULL` flows through to `validateManifest(null)`, which returns `{ok: false}` (zod strict mode rejects non-object input), and the row is logged as "invalid manifest" with whatever ruleId zod assigns. The behavior is technically correct (the row is skipped), but:

1. The log message says "invalid manifest" — misleading; the row was never a manifest at all, it was a NULL blob. Operators reading boot logs will chase the wrong bug.
2. The TypeScript type system is bypassed — `JSON.parse` expects `string`, but receives `string | null` with no compiler error because the loose `RowType` from Knex does not propagate strict null checks here. This is a latent bug factory.
3. If a future Node version tightens `JSON.parse` to reject non-string input (it has been discussed), this code becomes a boot crash.

**Fix:** Explicit null guard before parse, with a clearer log message:

```typescript
if (row.manifest_json == null) {
  console.warn(`[skills/loader] skipping row with NULL manifest_json for skill_id=${row.skill_id}`);
  continue;
}
const parsed = JSON.parse(row.manifest_json);
```

---

### WR-04: `register()` throws an error message with ruleId only — no field or message

**File:** `src/skills/registry.ts:91-98`
**Issue:** The defensive double-check error path:

```typescript
const result = validateManifest(manifest);
if (result.ok === false) {
  const firstRuleId = result.errors[0]?.ruleId ?? "UNKNOWN";
  throw new Error(
    "registry.register: manifest failed validation — " + firstRuleId,
  );
}
```

The thrown Error names ONLY the ruleId (e.g., `"NODE_ID_NAMESPACING"`), omitting the `field` and `message` that the validator already produced. Compare to the loader's log path (loader.ts:64-71), which includes ruleId + message. When Phase 30's REST handler catches this throw and surfaces it to the API consumer, the consumer sees `"registry.register: manifest failed validation — NODE_ID_NAMESPACING"` with zero context about WHICH node type or WHY. The diagnostic information exists in `result.errors[0]` and is discarded.

The plan spec (29-02-PLAN.md task 1 action) literally says: "throw `new Error('registry.register: manifest failed validation — ' + result.errors[0]?.ruleId)`" — so this is plan-faithful. But the plan was wrong to discard the message.

**Fix:**

```typescript
if (result.ok === false) {
  const first = result.errors[0];
  throw new Error(
    "registry.register: manifest failed validation — " +
      (first?.ruleId ?? "UNKNOWN") +
      " at " + (first?.field ?? "<root>") +
      ": " + (first?.message ?? "no detail"),
  );
}
```

---

### WR-05: Registry has no `delete()` / `unregister()` — Phase 31 hot-reload will be awkward

**File:** `src/skills/registry.ts:77-145`
**Issue:** The frozen registry exports 5 methods: `register`, `get`, `list`, `phaseById`, `nodeTypeById`. There is no way to remove a skill from the registry. The CONTEXT.md decision ("Re-registering overwrites") handles version bumps (same skill_id, new manifest), but does NOT handle:

1. A skill being deactivated in `o_skillRegistry` (`active = 0`) and a platform restart — the loader's `where("active", 1)` correctly skips it on next boot, but the in-memory registry from the previous boot still has it. This is fine because the registry only lives for one process lifetime.
2. Phase 31 introduces runtime skill management. If Phase 30's REST API supports `DELETE /api/v1/skills/:id` (a reasonable expectation for a registry CRUD surface), there is no `registry.delete(skillId)` to call — the implementation would have to either (a) add the method now, (b) defer to next-boot, or (c) reach into the module-scoped Maps (impossible — they are closure-private).
3. The verify runner's Test 2 comment explicitly notes "the registry is a non-clearable singleton" — the team already knows this is a limitation. It will become a blocker the moment any phase needs to evict a skill at runtime.

This is graded WARNING (not Critical) because the Phase 31 plan as written only consumes `phaseById` and `nodeTypeById` (read-only), and no current code path needs `delete()`. But the API surface should be reviewed before Phase 30's REST handler is designed.

**Fix:** Add a `delete(skillId: string): boolean` method now, symmetric with `register`:

```typescript
delete: (skillId: string): boolean => {
  const had = manifests.has(skillId);
  manifests.delete(skillId);
  phaseIndex.delete(skillId);
  nodeTypeIndex.delete(skillId);
  return had;
},
```

If the team decides this is genuinely out of scope, add a code comment on the frozen object documenting that the registry is append-only / overwrite-only by design.

## Info

### IN-01: Unused import — `SkillManifest` type imported but only used in JSDoc

**File:** `src/skills/loader.ts` — note: `SkillManifest` is NOT imported in the final code (only `Knex`, `registry`, `validateManifest`). The plan task 2 action said to add `import type { SkillManifest } from "./contract"` but the implementation correctly omitted it because the type is not referenced. No defect — recording as Info to note the plan/implementation divergence was intentional and correct.

(No fix needed.)

---

### IN-02: Commented-out import in `src/utils/db.ts:7`

**File:** `src/utils/db.ts:7`
**Issue:** Line 7 contains `// import fixDB from "@/lib/fixDB";` — a commented-out duplicate of the active import on line 10. This is dead code that predates Phase 29 (the file was modified by Phase 29 only to add the loader import + boot call). Not a Phase 29 regression, but worth cleaning up while the file is being touched.

**Fix:** Delete line 7.

---

### IN-02b: Defensive double-validation in `register()` re-runs the full zod parse on every call

**File:** `src/skills/registry.ts:92`
**Issue:** `register()` calls `validateManifest(manifest)` on a value already typed `SkillManifest`. The validator runs the full `manifestSchema.safeParse()` — including both `.superRefine()` invariants (version format regex, node-id-namespacing regex over every node type). For Phase 30's `POST /api/v1/skills/register` this is the correct defensive posture (Pitfalls A5). For the boot loader, every row is validated twice: once in `loader.ts:58` and once in `register()` at line 92. On a registry with N skills and M node types each, that is 2×(N×M) regex tests at boot.

Not a performance concern at v1.6 scale (Phase 30 seeds exactly one skill: `movie-v1`). Recording as Info because the redundancy is BY DESIGN (defensive double-check) and removing it would weaken the security boundary. No fix recommended.

---

### IN-03: `process.env.NODE_ENV == "dev"` uses loose equality

**File:** `src/utils/db.ts:42`
**Issue:** Pre-existing line (not introduced by Phase 29), but the file was modified by Phase 29 so it is in scope. `==` instead of `===` is a code-quality issue; with `process.env.NODE_ENV` being `string | undefined`, `undefined == "dev"` is `false` and `"dev" == "dev"` is `true` — so behavior is correct. But the project elsewhere appears to use strict equality. ESLint `eqeqeq` would flag this.

**Fix:** `if (process.env.NODE_ENV === "dev") initKnexType(db);` — but this is pre-existing and arguably out of Phase 29 scope.

---

### IN-04: Verify runner has a stray `loadAllFromDB` import order — `registry` is imported before `loadAllFromDB` but used first in Test 4

**File:** `scripts/verify-phase-29.ts:45-46`
**Issue:** Not actually a bug — the import order is purely cosmetic. Recording as Info because the runner's test ordering (Test 2 before Test 3 to handle the non-clearable singleton) is a real correctness concern that is correctly handled, and worth documenting for future test authors who extend this runner. The header comment in the runner (lines 229-236) already explains this well.

(No fix needed.)

---

### IN-05: `o_skillRegistry.active` column type comment vs. reality

**File:** `src/lib/initDB.ts:1196` and `src/types/database.d.ts:254`
**Issue:** The column is declared `table.integer("active").defaultTo(1)` and the loader filters with `.where("active", 1)`. SQLite has no native boolean; `1` is used as a truthy sentinel. This is consistent with the existing `o_vendorConfig.enable` pattern (referenced in the plan). However, `database.d.ts:254` types it as `'active'?: number | null` — a future writer could plausibly insert `active: true` (JavaScript boolean), which SQLite would store as `1`. The Knex query `.where("active", 1)` would still match it. But TypeScript would reject the insert at compile time (correctly). No bug; recording as Info because the boolean-as-integer convention is implicit and undocumented at the schema level.

**Fix (optional):** Consider adding a CHECK constraint `CHECK (active IN (0, 1))` to the table builder in initDB.ts to enforce the boolean domain at the DB level. Not required for Phase 29 to ship.

---

### IN-06: Registry `list()` returns a fresh array but the manifests themselves are NOT cloned

**File:** `src/skills/registry.ts:127`
**Issue:** `list(): SkillManifest[] => Array.from(manifests.values())` creates a new outer array, but the `SkillManifest` objects inside are the same references stored in the map. A caller that mutates `registry.list()[0].skill_id = "tampered"` would corrupt the registry's internal state (and break the phaseIndex/nodeTypeIndex consistency, since those were built from the original values).

Today, no caller mutates the returned manifests. But Phase 31 will pass `PhaseDecl` and `NodeTypeDecl` objects (returned from `phaseById` / `nodeTypeById`) into callback hot paths — if any callback mutates the returned object (e.g., adding a transient field), it will corrupt the registry for all subsequent lookups. The frozen-object singleton pattern does not extend to the values, only to the registry's method surface.

**Fix (optional):** Either (a) document in the JSDoc that returned objects are shared references and must not be mutated, or (b) deep-freeze the manifest + all nested objects inside `register()`:

```typescript
register: (manifest: SkillManifest): void => {
  const result = validateManifest(manifest);
  if (result.ok === false) { /* ... */ }
  const frozen = deepFreeze(result.value);  // recursively Object.freeze
  manifests.set(frozen.skill_id, frozen);
  // build indexes from frozen...
},

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === "object") {
    Object.values(obj).forEach(deepFreeze);
    Object.freeze(obj);
  }
  return obj;
}
```

This is graded Info because no current caller mutates the returned objects, but it is a sharp edge that Phase 31's callback refactor will brush against.

---

## Fix Log (Iteration 1 — 2026-06-15)

All 5 Warning-level findings addressed in this iteration. No Info-level findings were in scope (default `fix_scope: critical_warning`).

| ID | Severity | Status | Commit | Files Modified |
|----|----------|--------|--------|----------------|
| WR-01 | Warning | fixed | `2469906` | `src/lib/fixDB.ts` |
| WR-02 | Warning | fixed | `3bbfed3` | `src/skills/loader.ts` |
| WR-03 | Warning | fixed | `18ab570` | `src/skills/loader.ts` |
| WR-04 | Warning | fixed | `747ef20` | `src/skills/registry.ts` |
| WR-05 | Warning | fixed | `29f1f30` | `src/skills/registry.ts`, `scripts/verify-phase-29.ts` |

### Fix Summaries

- **WR-01 (`src/lib/fixDB.ts`):** The unconditional `whereNull("skill_id").update(...)` backfill is now gated on a SELECT count first. When the count is 0 (already-migrated DB), the UPDATE is skipped entirely and a boot log line surfaces the migration state. Comment block documents that the WHERE clause is the only guard and that NULL is treated as a legacy sentinel — any future writer needing a distinct "no skill" value must use an explicit non-NULL sentinel.
- **WR-02 (`src/skills/loader.ts:95`):** `(err as Error).message` replaced with `err instanceof Error ? err.message : String(err)` so the per-row catch handler logs useful diagnostic text regardless of what was thrown.
- **WR-03 (`src/skills/loader.ts:63-68`):** Explicit null check before `JSON.parse(row.manifest_json)` with a distinct log message ("skipping row with NULL manifest_json") so operators can distinguish a NULL blob from a malformed manifest.
- **WR-04 (`src/skills/registry.ts:99-107`):** `register()`'s thrown Error now includes the full first-error triple (`ruleId at field: message`) instead of just the ruleId.
- **WR-05 (`src/skills/registry.ts:170-178`, `scripts/verify-phase-29.ts:357-393`):** Added `delete(skillId): boolean` method to the frozen registry. Returns true if removed, false if not present (idempotent). Clears all three indexes (manifests, phaseIndex, nodeTypeIndex) together. Test 6 added to the verify runner exercising delete across all three lookup surfaces plus idempotent re-delete.

### Verification

`npx tsx scripts/verify-phase-29.ts` exits 0 with **29 passed, 0 failed** (24 baseline + 5 new Test 6 assertions for WR-05). No new Critical/Warning findings introduced by the fixes.

---

_Reviewed: 2026-06-15_
_Reviewer: Claude (gsd-code-reviewer)_
_Fixed: 2026-06-15_
_Fixer: Claude (gsd-code-fixer)_
_Depth: standard_
_Iteration: 1_
