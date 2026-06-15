/**
 * Skill Registry Boot Loader — hydrates the in-memory registry from
 * `o_skillRegistry` once at platform boot.
 *
 * Phase 29 Plan 02 (REGISTRY-06). The loader runs inside the boot IIFE in
 * `src/utils/db.ts`, AFTER `fixDB(db)` (which adds columns + backfills) and
 * BEFORE the process considers itself booted. After loadAllFromDB resolves,
 * every subsequent `registry.get()` / `phaseById()` / `nodeTypeById()` call
 * is a pure in-memory Map lookup with zero SQL.
 *
 * Threat model (T-29-04, T-29-05):
 *
 * - DB rows are UNTRUSTED. Each row's `manifest_json` blob is parsed via
 *   `JSON.parse` then validated via `validateManifest()` (Phase 28 zod
 *   strict mode). Invalid rows are logged + skipped — they never reach
 *   `registry.register()`.
 *
 * - `register()` ALSO re-validates as a defensive double-check (Pitfalls
 *   A5). If register throws (e.g., the loader passed through a value the
 *   validator accepted but register's second check somehow rejects), the
 *   per-row catch logs the skill_id and continues — boot does not crash.
 *
 * - One bad row does NOT abort the load. Every per-row operation
 *   (JSON.parse, validateManifest, register) is wrapped in try/catch.
 *
 * Empty-table behavior (Success Criterion #3): SELECT returns zero rows,
 * the loop never executes, the function resolves with 0. `registry.list()`
 * then returns `[]`. Default seeding is Phase 30's responsibility.
 */
import type { Knex } from "knex";
import { registry } from "./registry";
import { validateManifest } from "./validator";

/**
 * Hydrate the registry from every active row in `o_skillRegistry`.
 *
 * Selects only `skill_id` and `manifest_json` (the only columns the loader
 * needs). `where("active", 1)` matches the default value set in initDB.ts
 * (Plan 29-01 Task 1); inactive rows are skipped without being read.
 *
 * @param knex - the Knex instance to query against. At boot this is the
 *   singleton `db`; in `verify-phase-29.ts` it is a transient `:memory:`
 *   instance.
 * @returns the count of successfully registered skills. Invalid rows are
 *   logged via `console.warn` (with skill_id + ruleId) and do not increment
 *   the count.
 */
export async function loadAllFromDB(knex: Knex): Promise<number> {
  const rows = await knex("o_skillRegistry")
    .where("active", 1)
    .select("skill_id", "manifest_json");

  let registered = 0;

  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.manifest_json);
      const result = validateManifest(parsed);
      if (result.ok === true) {
        registry.register(result.value);
        registered++;
      } else {
        const firstError = result.errors[0];
        console.warn(
          "[skills/loader] skipping invalid manifest for skill_id=" +
            row.skill_id +
            " — " +
            (firstError?.ruleId ?? "UNKNOWN") +
            ": " +
            (firstError?.message ?? ""),
        );
      }
    } catch (err) {
      // Covers JSON.parse failure AND any unexpected throw from register()
      // (register re-validates; if it throws, the row is bad — skip + continue).
      console.warn(
        "[skills/loader] skipping unparseable manifest for skill_id=" +
          row.skill_id +
          " — " +
          (err as Error).message,
      );
    }
  }

  return registered;
}
