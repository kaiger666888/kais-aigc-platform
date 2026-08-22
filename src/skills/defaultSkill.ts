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
 * The `phase_taxonomy[]` array below is inlined verbatim (22 PhaseDecl entries,
 * order 0 through 21). The descriptive fields (node_types, asset_categories,
 * review_criteria, runtime) are minimal sensible values per CONTEXT.md
 * "Claude's Discretion" — refined in v1.7+. node_types uses the five
 * BuiltinRenderer primitives the platform ships today; each `type` is
 * namespaced `movie-v1::<bare>` (validator enforces NODE_ID_NAMESPACING).
 *
 * Phase 57-07 (PORTAL-04, D-13/D-16): the taxonomy was rewritten from the
 * legacy 12-entry list to the 22-phase pipeline vocabulary — id = PHASE_REGISTRY
 * khsPrefix (packages/infinite-canvas/src/constants/phaseRegistry.ts, the
 * 55-D04 single registry), order = sortKey ascending sequence, label = registry
 * name. Thirteen phases carry `requires_review: true` + a real `review_gate`
 * (gateCatalog derivedGateId form, e.g. 'p03-gate'); nine gate-less phases
 * carry `review_gate: ''`. The three p13 redline sub-gates are
 * platformInvisible and do NOT occupy taxonomy entries (54 U-06).
 * ingest_outputs follows the canvasType mapping (video→['videos'],
 * audio→['audio'], asset→['images'], storyboard→['storyboard'],
 * script→['none'] — the explicit "no ingest" sentinel). verify-phase-57
 * asserts this literal stays three-way consistent with PHASE_REGISTRY,
 * GATE_CATALOG, and the khs gates.yaml.
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

  // Inline literal phase_taxonomy — single source of truth as of Phase 31,
  // realigned to the 22-phase registry vocabulary in Phase 57-07 (D-13/D-16).
  // 22 phases, order 0..21 (sortKey ascending). id = PHASE_REGISTRY khsPrefix
  // (p035 / p11a0 token forms — same vocabulary as the zone deep-link param and
  // the phase-complete.ts lookup chain); label = registry name.
  // 13 gated phases carry review_gate '<khsPrefix>-gate'; 9 gate-less phases ''.
  phase_taxonomy: [
    { id: "p01", order: 0, label: "选题/钩子", requires_review: true, review_gate: "p01-gate", ingest_outputs: ["none"] },
    { id: "p02", order: 1, label: "大纲", requires_review: true, review_gate: "p02-gate", ingest_outputs: ["none"] },
    { id: "p03", order: 2, label: "剧本审计", requires_review: true, review_gate: "p03-gate", ingest_outputs: ["none"] },
    { id: "p035", order: 3, label: "戏剧事件打磨", requires_review: false, review_gate: "", ingest_outputs: ["none"] },
    { id: "p04", order: 4, label: "角色设计", requires_review: true, review_gate: "p04-gate", ingest_outputs: ["images"] },
    { id: "p06", order: 5, label: "时空剧本", requires_review: true, review_gate: "p06-gate", ingest_outputs: ["none"] },
    { id: "p07", order: 6, label: "场景图生成", requires_review: true, review_gate: "p07-gate", ingest_outputs: ["images"] },
    { id: "p08", order: 7, label: "场景选择", requires_review: false, review_gate: "", ingest_outputs: ["images"] },
    { id: "p09", order: 8, label: "分镜拆解", requires_review: false, review_gate: "", ingest_outputs: ["storyboard"] },
    { id: "p09b", order: 9, label: "镜头审计", requires_review: false, review_gate: "", ingest_outputs: ["storyboard"] },
    { id: "p09c", order: 10, label: "分镜故事板", requires_review: true, review_gate: "p09c-gate", ingest_outputs: ["storyboard"] },
    { id: "p10", order: 11, label: "语音合成", requires_review: false, review_gate: "", ingest_outputs: ["audio"] },
    { id: "p10c", order: 12, label: "语音审计", requires_review: true, review_gate: "p10c-gate", ingest_outputs: ["audio"] },
    { id: "p11a", order: 13, label: "片段预览", requires_review: true, review_gate: "p11a-gate", ingest_outputs: ["videos"] },
    { id: "p11a0", order: 14, label: "条件帧审核", requires_review: true, review_gate: "p11a0-gate", ingest_outputs: ["videos"] },
    { id: "p11b", order: 15, label: "片段生成", requires_review: true, review_gate: "p11b-gate", ingest_outputs: ["videos"] },
    { id: "p11c", order: 16, label: "视频质检", requires_review: true, review_gate: "p11c-gate", ingest_outputs: ["videos"] },
    { id: "p12a", order: 17, label: "时间线合成", requires_review: false, review_gate: "", ingest_outputs: ["videos"] },
    { id: "p12b", order: 18, label: "音频合成", requires_review: false, review_gate: "", ingest_outputs: ["audio"] },
    { id: "p13", order: 19, label: "交付", requires_review: true, review_gate: "p13-gate", ingest_outputs: ["videos"] },
    { id: "p14", order: 20, label: "质量审计", requires_review: false, review_gate: "", ingest_outputs: ["none"] },
    { id: "p15", order: 21, label: "反馈", requires_review: false, review_gate: "", ingest_outputs: ["none"] },
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

// ---------------------------------------------------------------------------
// upgradeDefaultSkillRow — Phase 57-07 idempotent row upgrade (PORTAL-04, Q2)
// ---------------------------------------------------------------------------

/** Taxonomy size the movie-v1 row must carry after the 57-07 realignment. */
export const MOVIE_V1_TAXONOMY_SIZE = MOVIE_V1_MANIFEST.phase_taxonomy.length; // 22

/**
 * Idempotent boot-time upgrade for the movie-v1 row (Phase 57-07).
 *
 * seedDefaultIfEmpty only runs on an EMPTY table, so a DB seeded with the
 * pre-57 12-phase manifest would keep serving the stale taxonomy forever.
 * This upgrades the row in place whenever its phase_taxonomy size differs
 * from the current constant, then replays registry.register() so the
 * in-memory cache matches without a second restart.
 *
 * Threat model (T-57-07a): the UPDATE is scoped to skill_id='movie-v1' only,
 * guarded by the taxonomy-size condition (idempotent — re-running on an
 * already-upgraded row is a no-op returning false), inside a transaction,
 * with a one-line audit log before the write. Other skills' rows are never
 * touched. NULL / unparseable manifest_json is treated as stale (upgraded).
 *
 * @param knex - the Knex instance (boot singleton or transient test instance)
 * @returns true if the row was upgraded; false when it already carries the
 *   current taxonomy size (idempotent no-op)
 */
export async function upgradeDefaultSkillRow(knex: Knex): Promise<boolean> {
  const row = await knex("o_skillRegistry").where({ skill_id: "movie-v1" }).first();
  if (row == null) return false; // nothing seeded yet — seedDefaultIfEmpty owns that path

  let stale = true;
  if (row.manifest_json != null) {
    try {
      const parsed = JSON.parse(row.manifest_json);
      const size = Array.isArray(parsed?.phase_taxonomy) ? parsed.phase_taxonomy.length : -1;
      stale = size !== MOVIE_V1_TAXONOMY_SIZE;
    } catch {
      stale = true; // unparseable blob — upgrade to the known-good constant
    }
  }
  if (!stale) return false;

  console.log(
    `[skills/defaultSkill] upgrading movie-v1 row: taxonomy ${MOVIE_V1_TAXONOMY_SIZE} entries (was seeded with a different size) — Phase 57-07 idempotent row upgrade`,
  );

  await knex.transaction(async (trx) => {
    await trx("o_skillRegistry")
      .where({ skill_id: "movie-v1" })
      .update({
        manifest_json: JSON.stringify(MOVIE_V1_MANIFEST),
        version: MOVIE_V1_MANIFEST.version,
        active: 1,
      });
  });

  // Re-hydrate the in-memory cache so phaseById() serves the new vocabulary
  // immediately (register re-validates — the constant already passed the
  // module-load self-check).
  registry.register(MOVIE_V1_MANIFEST);
  return true;
}
