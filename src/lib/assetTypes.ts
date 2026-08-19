/**
 * assetTypes.ts — o_assets.type 词汇单一真值源 (single truth source).
 *
 * Phase 48 INGEST-03 (decisions D-06/D-07):
 *   - Canonical vocabulary = the assets-registry enum
 *     (src/routes/v1/assets-registry/index.ts createSchema `type`),
 *     copied value-for-value into CANONICAL_ASSET_TYPES below.
 *   - Legacy ingest vocabulary (src/routes/v1/pipeline/ingest/images.ts
 *     inline enum) is mapped read-side: alias keys normalize onto canonical
 *     targets; new writes are always canonical.
 *   - Existing DB rows are NOT rewritten here — the Phase 50 backfill script
 *     handles legacy rows; registry queries use expandTypesForQuery() for
 *     legacy-compatible matching.
 *
 * CONSUMERS: assets-registry/index.ts and pipeline/ingest/images.ts must
 * import from this module instead of declaring inline enums, so the
 * vocabulary can never drift again (v1.6 pattern: truth source = the one
 * copy, no wrappers).
 *
 * Pure module: no zod, no DB, no fs — only data + functions.
 */

// ─── Canonical vocabulary (assets-registry enum, value-for-value) ──────────

export const CANONICAL_ASSET_TYPES = [
  "character",
  "scene",
  "prop",
  "clip",
  "voice",
  "video",
  "storyboard",
  "script_phase",
  "outline",
  "topic",
  "delivery",
] as const;

export type CanonicalAssetType = (typeof CANONICAL_ASSET_TYPES)[number];

// ─── Legacy ingest vocabulary (read-side aliases, D-06) ────────────────────

/**
 * Legacy ingest words → canonical targets.
 * Kept ONLY so old inputs/rows keep resolving; nothing new should ever be
 * written with a key of this map.
 */
export const LEGACY_ASSET_TYPE_ALIASES: Record<string, CanonicalAssetType> = {
  role: "character",
  tool: "prop",
};

/**
 * Accepted ingest input vocabulary = canonical values + legacy alias keys
 * (13 total). Plan 48-02 uses this tuple as the zod enum source for the
 * rewritten ingest route: input accepts old words, output is always canonical.
 */
export const INGEST_INPUT_ASSET_TYPES = [
  ...CANONICAL_ASSET_TYPES,
  ...(Object.keys(LEGACY_ASSET_TYPE_ALIASES) as (keyof typeof LEGACY_ASSET_TYPE_ALIASES)[]),
] as readonly string[];

// ─── Functions ─────────────────────────────────────────────────────────────

/**
 * Normalize any assetType token to its canonical value.
 * - canonical input → identity
 * - legacy alias key → its canonical target
 * - anything else → null (unknown is UNKNOWN, never silently passed through
 *   on the write path)
 * Never throws.
 */
export function normalizeAssetType(input: string): CanonicalAssetType | null {
  if (typeof input !== "string") return null;
  if ((CANONICAL_ASSET_TYPES as readonly string[]).includes(input)) {
    return input as CanonicalAssetType;
  }
  const mapped = LEGACY_ASSET_TYPE_ALIASES[input];
  return mapped ?? null;
}

/**
 * Expand a canonical type into every DB value that should match it,
 * so registry search still finds legacy-vocabulary rows (D-07 read-side
 * compat). Callers can use the result unconditionally in a whereIn:
 * - canonical with aliases → [canonical, ...aliasKeys]
 * - canonical without aliases → [canonical]
 * - non-canonical input → passthrough [input] (no crash)
 */
export function expandTypesForQuery(canonical: string): string[] {
  const out = [canonical];
  for (const [alias, target] of Object.entries(LEGACY_ASSET_TYPE_ALIASES)) {
    if (target === canonical && alias !== canonical) out.push(alias);
  }
  return out;
}
