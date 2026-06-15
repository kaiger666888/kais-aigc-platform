/**
 * Skill Registry — in-memory singleton cache for registered SkillManifest rows.
 *
 * Phase 29 Plan 02 (REGISTRY-05). The registry is the single synchronous lookup
 * surface that Phase 30 (REST API), Phase 31 (callback refactor), and Phase 32
 * (canvas) consume. No SQL is executed on any lookup method — the loader
 * (`src/skills/loader.ts`) hydrates the maps once at boot, after which every
 * `get()` / `phaseById()` / `nodeTypeById()` is a pure Map lookup.
 *
 * Design decisions (locked in CONTEXT.md "Registry / Loader Architecture"):
 *
 * 1. Frozen object literal (preferred over a class + DI — no DI container in
 *    this codebase, and a frozen object reads cleanly at call sites).
 *
 * 2. Three module-scoped Maps (closure-private). Only `register()` mutates
 *    them. Callers cannot reach the Maps directly — they go through the five
 *    frozen methods.
 *
 * 3. Secondary indexes (`phaseIndex`, `nodeTypeIndex`) are BUILT INSIDE
 *    `register()`, not lazily on first lookup. This is non-negotiable for
 *    Success Criterion #4 ("no silent fallback to movie-v1") — if the index
 *    is missing, the lookup MUST return undefined, never scan-and-guess.
 *
 * 4. `register()` re-validates via `validateManifest()` as a defensive
 *    double-check (Pitfalls A5). Even though the loader validates first,
 *    register is also called by Phase 30's POST /api/v1/skills/register,
 *    which a future bug could call without validating. On failure, register
 *    throws — it does NOT silently ignore. Every call site is controlled
 *    (loader catches + logs; REST handler catches + returns 4xx).
 */
import type { SkillManifest, PhaseDecl, NodeTypeDecl } from "./contract";
import { validateManifest } from "./validator";

// ---------------------------------------------------------------------------
// Module-scoped state (closure-private — not exported, not on the registry)
// ---------------------------------------------------------------------------

/**
 * Primary index: skill_id → full SkillManifest.
 */
const manifests = new Map<string, SkillManifest>();

/**
 * Secondary index: skill_id → (phase_id → PhaseDecl).
 *
 * The inner Map is built inside `register()` by iterating
 * `manifest.phase_taxonomy`. Lookups via `phaseById()` are O(1) — no scan.
 */
const phaseIndex = new Map<string, Map<string, PhaseDecl>>();

/**
 * Secondary index: skill_id → (node_type_id → NodeTypeDecl).
 *
 * The inner Map is built inside `register()` by iterating
 * `manifest.node_types`. The key is the full namespaced `type` string
 * (e.g. `"movie-v1::script"`), matching what the validator enforces.
 */
const nodeTypeIndex = new Map<string, Map<string, NodeTypeDecl>>();

// ---------------------------------------------------------------------------
// Public API (frozen singleton)
// ---------------------------------------------------------------------------

/**
 * The Skill Registry singleton. Import as `import { registry } from "@/skills/registry"`.
 *
 * Methods:
 * - `register(manifest)` — store a manifest + build its secondary indexes.
 *   Throws on invalid input (defensive double-check, Pitfalls A5).
 * - `get(skillId)` — primary lookup. Returns `undefined` for unknown ids.
 * - `list()` — snapshot array of every registered manifest. `[]` when empty.
 * - `phaseById(skillId, phaseId)` — O(1) phase lookup. `undefined` for unknown.
 * - `nodeTypeById(skillId, typeId)` — O(1) node-type lookup. `undefined` for unknown.
 * - `delete(skillId)` — remove a skill from all three indexes. Returns `true`
 *   if removed, `false` if not present (idempotent). Phase 31 hot-reload / DELETE use.
 *
 * The object is frozen — callers cannot add or replace methods.
 */
export const registry = Object.freeze({
  /**
   * Register a SkillManifest and build its secondary indexes.
   *
   * The manifest is re-validated via `validateManifest()` as a defensive
   * double-check (Pitfalls A5 — even if the loader already validated, a
   * future caller could bypass it). On validation failure, throws an Error
   * whose message names the first ruleId. Callers are responsible for
   * try/catch (the loader logs + skips; the Phase 30 REST handler returns 4xx).
   *
   * On success, sets the primary entry and builds the two inner index maps.
   * Re-registering the same skill_id overwrites the previous entry and its
   * indexes (the maps are replaced, not merged).
   */
  register: (manifest: SkillManifest): void => {
    const result = validateManifest(manifest);
    if (result.ok === false) {
      // WR-04: include field + message alongside ruleId. The validator
      // produces structured errors ({ruleId, field, message}); discarding
      // field and message left Phase 30 REST consumers with a context-free
      // ruleId like "NODE_ID_NAMESPACING" and no way to see WHICH node type
      // or WHY. The full first-error triple is now in the thrown message.
      const first = result.errors[0];
      throw new Error(
        "registry.register: manifest failed validation — " +
          (first?.ruleId ?? "UNKNOWN") +
          " at " +
          (first?.field ?? "<root>") +
          ": " +
          (first?.message ?? "no detail"),
      );
    }
    // Primary index.
    manifests.set(manifest.skill_id, manifest);

    // Secondary index: phases. Build a fresh inner map (overwrite on re-register).
    const phases = new Map<string, PhaseDecl>();
    for (const phase of manifest.phase_taxonomy) {
      phases.set(phase.id, phase);
    }
    phaseIndex.set(manifest.skill_id, phases);

    // Secondary index: node types. Key is the full namespaced type string.
    const nodeTypes = new Map<string, NodeTypeDecl>();
    for (const nt of manifest.node_types) {
      nodeTypes.set(nt.type, nt);
    }
    nodeTypeIndex.set(manifest.skill_id, nodeTypes);
  },

  /**
   * Primary lookup. Returns the stored SkillManifest for a known skill id,
   * or `undefined` for an unknown id. No fallback, no scan.
   */
  get: (skillId: string): SkillManifest | undefined => manifests.get(skillId),

  /**
   * Return every registered SkillManifest as an array. Returns `[]` when the
   * registry is empty. No SQL is executed.
   */
  list: (): SkillManifest[] => Array.from(manifests.values()),

  /**
   * O(1) phase lookup. Returns the declared PhaseDecl for a known
   * (skillId, phaseId) pair, or `undefined` for unknown skill or unknown
   * phase. No fallback to movie-v1, no scan.
   */
  phaseById: (skillId: string, phaseId: string): PhaseDecl | undefined =>
    phaseIndex.get(skillId)?.get(phaseId),

  /**
   * O(1) node-type lookup. Returns the declared NodeTypeDecl for a known
   * (skillId, typeId) pair, or `undefined` for unknown skill or unknown
   * type. The typeId is the full namespaced string (e.g. "movie-v1::script").
   * No fallback, no scan.
   */
  nodeTypeById: (skillId: string, typeId: string): NodeTypeDecl | undefined =>
    nodeTypeIndex.get(skillId)?.get(typeId),

  /**
   * Remove a skill from the registry. Returns `true` if the skill was
   * present and removed, `false` if it was not present (idempotent —
   * deleting an unknown skill is a no-op, not an error).
   *
   * WR-05: Phase 31 will need this when callbacks swap a skill out at
   * runtime (e.g. a `DELETE /api/v1/skills/:id` REST handler, or a
   * hot-reload that wants to evict before re-registering). All three
   * indexes (manifests, phaseIndex, nodeTypeIndex) are cleared together
   * so post-delete lookups via `get` / `phaseById` / `nodeTypeById`
   * consistently return `undefined` for the removed skill.
   */
  delete: (skillId: string): boolean => {
    const had = manifests.has(skillId);
    manifests.delete(skillId);
    phaseIndex.delete(skillId);
    nodeTypeIndex.delete(skillId);
    return had;
  },
});
