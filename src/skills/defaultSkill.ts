/**
 * Default Skill Seed — MOVIE_V1_MANIFEST + seedDefaultIfEmpty(knex)
 *
 * Why this file exists (two concerns):
 *
 * 1. API-06 (zero-config upgrade) — on empty-DB boot, the platform self-seeds
 *    `movie-v1` into `o_skillRegistry` and the in-memory registry. No operator
 *    action required. The platform ships with one reference skill.
 *
 * 2. Phase 31 source-of-truth transition — the manifest's `phase_taxonomy[]`
 *    is now a LITERAL inline array. As of Phase 31, this file is the single
 *    source of truth for movie-v1's phase declarations. The pre-refactor
 *    pipeline callback constants (now deleted) previously carried this data;
 *    Phase 31 inlined their translated values here so the manifest stands on
 *    its own with no imports from the pipeline callback layer.
 *
 * Threat model (T-30-01, T-30-02): the manifest is hardcoded descriptive
 * metadata (no credentials, no PII). A module-load-time validateManifest()
 * self-check throws on any field drift before boot proceeds — the manifest
 * is a code constant, so a validation failure is a code bug, not a data bug.
 */
import type { Knex } from "knex";
import { registry } from "./registry";
import { validateManifest } from "./validator";
import type { SkillManifest } from "./contract";

// ---------------------------------------------------------------------------
// MOVIE_V1_MANIFEST — the literal source of truth as of Phase 31
// ---------------------------------------------------------------------------

// WR-05 fix: runtime endpoint + healthcheck path are overridable via env vars
// so containerized/remote deployments don't need to POST /register to correct
// a hardcoded localhost:8001. The default :8001 is a historical artifact from
// the retired kais-movie-agent service (260702 retirement) — production must
// set SKILL_MOVIE_V1_ENDPOINT explicitly. Read once at module load.
const SKILL_ENDPOINT = process.env.SKILL_MOVIE_V1_ENDPOINT || "http://localhost:8001";
const SKILL_HEALTHCHECK_PATH = process.env.SKILL_MOVIE_V1_HEALTHCHECK_PATH || "/health";

/**
 * The movie-v1 SkillManifest — a literal constant as of Phase 31.
 *
 * The `phase_taxonomy[]` array below is inlined verbatim (12 PhaseDecl entries,
 * order 0 through 11). The descriptive fields (node_types, asset_categories,
 * review_criteria, runtime) are minimal sensible values per CONTEXT.md
 * "Claude's Discretion" — refined in v1.7+. node_types uses the five
 * BuiltinRenderer primitives the platform ships today; each `type` is
 * namespaced `movie-v1::<bare>` (validator enforces NODE_ID_NAMESPACING).
 *
 * Six phases carry `requires_review: true` (storyboard, character, scene,
 * camera-preview, camera-final, quality-gate). Six phases carry
 * `ingest_outputs: ["none"]` (requirement, scenario, voice, post-production,
 * quality-gate, delivery) — the explicit "no ingest" sentinel replaces the
 * empty-array representation the pre-refactor code used.
 */
export const MOVIE_V1_MANIFEST: SkillManifest = {
  skill_id: "movie-v1",
  // Validator enforces ^\d+.\d+$ (major.minor, no patch, no leading 'v').
  version: "1.0",
  display_name: "Movie v1",
  description:
    "Reference workflow skill for movie/short-video production — script→assets→storyboard→video.",
  media_types: ["video", "image", "audio"],

  // Five platform-primitive node types, each namespaced movie-v1::<bare>.
  // icon/color are declarative defaults — refined in v1.7+.
  node_types: [
    {
      type: "movie-v1::script",
      label: "Script",
      icon: "page",
      color: "#4A90E2",
      data_schema_uri: "",
      default_renderer: "script",
    },
    {
      type: "movie-v1::asset",
      label: "Asset",
      icon: "image",
      color: "#7ED321",
      data_schema_uri: "",
      default_renderer: "asset",
    },
    {
      type: "movie-v1::storyboard",
      label: "Storyboard",
      icon: "film",
      color: "#F5A623",
      data_schema_uri: "",
      default_renderer: "storyboard",
    },
    {
      type: "movie-v1::video",
      label: "Video",
      icon: "video",
      color: "#D0021B",
      data_schema_uri: "",
      default_renderer: "video",
    },
    {
      type: "movie-v1::audio",
      label: "Audio",
      icon: "audio",
      color: "#9013FE",
      data_schema_uri: "",
      default_renderer: "audio",
    },
  ],

  // Inline literal phase_taxonomy — single source of truth as of Phase 31.
  // 12 phases, order 0..11. Labels match ids (Phase 33 may refine).
  phase_taxonomy: [
    { id: "requirement", order: 0, label: "requirement", requires_review: false, ingest_outputs: ["none"] },
    { id: "art-direction", order: 1, label: "art-direction", requires_review: false, ingest_outputs: ["images"] },
    { id: "character", order: 2, label: "character", requires_review: true, ingest_outputs: ["images"] },
    { id: "scenario", order: 3, label: "scenario", requires_review: false, ingest_outputs: ["none"] },
    { id: "voice", order: 4, label: "voice", requires_review: false, ingest_outputs: ["none"] },
    { id: "storyboard", order: 5, label: "storyboard", requires_review: true, ingest_outputs: ["storyboard"] },
    { id: "scene", order: 6, label: "scene", requires_review: true, ingest_outputs: ["images"] },
    { id: "camera-preview", order: 7, label: "camera-preview", requires_review: true, ingest_outputs: ["videos"] },
    { id: "camera-final", order: 8, label: "camera-final", requires_review: true, ingest_outputs: ["videos"] },
    { id: "post-production", order: 9, label: "post-production", requires_review: false, ingest_outputs: ["none"] },
    { id: "quality-gate", order: 10, label: "quality-gate", requires_review: true, ingest_outputs: ["none"] },
    { id: "delivery", order: 11, label: "delivery", requires_review: false, ingest_outputs: ["none"] },
  ],

  // Descriptive asset categories (minimal — refined in v1.7+).
  asset_categories: [
    { id: "character-image", label: "Character Image" },
    { id: "scene-image", label: "Scene Image" },
    { id: "voice-sample", label: "Voice Sample" },
  ],

  // Sensible review thresholds (matches verify-phase-29 fixture defaults).
  review_criteria: {
    auto_threshold: 0.8,
    human_threshold: 0.6,
  },

  // Subset of gold-team TaskType vocabulary (kept as string[] — TaskType enum
  // lives in another repo, so the contract stays loose per ARCHITECTURE.md).
  engine_task_types: ["IMAGE_DRAW", "IMAGE_REFINE", "VIDEO_GEN", "TTS", "MUSIC_GEN"],

  // Runtime block — endpoint/healthcheck overridable via env vars (WR-05):
  //   SKILL_MOVIE_V1_ENDPOINT            (default http://localhost:8001, historical)
  //   SKILL_MOVIE_V1_HEALTHCHECK_PATH    (default /health)
  // Default :8001 points at nothing since kais-movie-agent retirement (260702).
  runtime: {
    type: "external-http",
    endpoint: SKILL_ENDPOINT,
    healthcheck_path: SKILL_HEALTHCHECK_PATH,
  },
};

// ---------------------------------------------------------------------------
// Module-load-time self-check (T-30-01 mitigation)
// ---------------------------------------------------------------------------

/**
 * Boot-time guard: validate the manifest immediately after building it.
 * If the constant drifts out of contract compliance (a future code edit breaks
 * a field), this throws BEFORE boot proceeds past module load — surfacing the
 * bug at the earliest possible point with a clear cause, rather than letting
 * a corrupt manifest silently propagate into the registry.
 *
 * No try/catch — let it throw. A validation failure here is unambiguously a
 * code bug (the manifest is a hardcoded constant), so failing boot is the
 * correct signal.
 */
const _selfCheck = validateManifest(MOVIE_V1_MANIFEST);
if (_selfCheck.ok === false) {
  const first = _selfCheck.errors[0];
  throw new Error(
    "[skills/defaultSkill] MOVIE_V1_MANIFEST failed module-load-time validation — " +
      (first?.ruleId ?? "UNKNOWN") +
      " at " +
      (first?.field ?? "<root>") +
      ": " +
      (first?.message ?? "no detail"),
  );
}

// ---------------------------------------------------------------------------
// seedDefaultIfEmpty — the idempotent boot-time seed
// ---------------------------------------------------------------------------

/**
 * Seed the default `movie-v1` skill into `o_skillRegistry` and the in-memory
 * registry, but ONLY if the table is empty (zero-config upgrade path).
 *
 * Decision (CONTEXT.md "Default Seed Trigger"):
 *   1. SELECT COUNT(*) FROM o_skillRegistry — if > 0, return false (no-op).
 *   2. If 0: re-validate the manifest (defensive — the module-load-time
 *      self-check already ran, but registry.register()'s contract requires
 *      a valid manifest and this guards against future code drift), then
 *      INSERT one row and call registry.register() to hydrate the cache.
 *   3. Return true.
 *
 * Validation failure throws (CONTEXT.md: "boot fails with clear error"). The
 * manifest is a code constant — a validation failure is a code bug, not a
 * data bug.
 *
 * @param knex - the Knex instance (boot singleton or transient test instance)
 * @returns true if a row was inserted (empty-DB case); false if the table
 *   was already populated (idempotent no-op)
 */
export async function seedDefaultIfEmpty(knex: Knex): Promise<boolean> {
  // 1. Row-count check — single row, single column.
  const row = await knex("o_skillRegistry").count("* as c").first();

  // 2. Idempotent no-op on populated DBs.
  if (Number(row?.c ?? 0) > 0) return false;

  // 3. Defensive re-validation before INSERT (the module-load-time self-check
  //    already ran, but registry.register() also re-validates — keep the
  //    invariant explicit here so a future code edit cannot silently break it).
  const result = validateManifest(MOVIE_V1_MANIFEST);
  if (!result.ok) {
    throw new Error(
      "[skills/defaultSkill] movie-v1 manifest failed validation: " +
        (result.errors[0]?.ruleId ?? "UNKNOWN") +
        " at " +
        (result.errors[0]?.field ?? "<root>"),
    );
  }

  // 4. INSERT one row. Column names match initDB.ts schema verbatim.
  await knex("o_skillRegistry").insert({
    skill_id: "movie-v1",
    manifest_json: JSON.stringify(MOVIE_V1_MANIFEST),
    version: MOVIE_V1_MANIFEST.version,
    active: 1,
    registered_at: Date.now(),
  });

  // 5. Hydrate the in-memory cache so the just-seeded skill is immediately
  //    lookup-able via registry.get()/phaseById()/nodeTypeById() without a
  //    restart.
  registry.register(MOVIE_V1_MANIFEST);

  return true;
}
