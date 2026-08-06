import { db } from "@/utils/db";
import seedEntries from "../seed-data.json";

/**
 * Cinema Decision Knowledge Base — SQLite layer.
 *
 * Two tables (created lazily on first request, idempotent):
 *   - cinema_knowledge      多维摄影决策知识条目（情绪×运镜×景别×风格×构图×时长）
 *   - cinema_usage_stats    agent 实际选择记录（为未来闭环反馈预留）
 *
 * Uses the existing knex+better-sqlite3 connection (see @/utils/db). Tables are
 * NOT declared in src/lib/initDB.ts on purpose — this module owns its schema so
 * the feature stays self-contained and does not touch shared boot code.
 */

export type CinemaCategory =
  // cinematography (original 5)
  | "emotion_camera"
  | "camera_motion"
  | "shot_grammar"
  | "duration"
  | "framing"
  // video-engine-adapter
  | "engine_constant"
  | "duration_frame_lut"
  | "engine_field_spec"
  | "engine_capability_matrix"
  | "engine_selection_rule"
  | "audio_mode_mapping"
  // compliance_gate
  | "viral_hook"
  | "platform_rule"
  | "content_taboo"
  | "aigc_label_spec"
  // style_genome (Wave 1b — 5D hub)
  | "director_dna"
  | "genre_dna"
  | "scamper_recipe"
  | "auteur_tier_rule"
  | "cross_cultural_transform"
  | "cn_director_supplement"
  // colorist (Wave 1b)
  | "emotion_color"
  | "platform_color_ceiling"
  | "culture_color"
  | "color_pipeline_param"
  | "color_space_primaries"
  | "genre_color_temp"
  // editor (Wave 1b)
  | "editing_rhythm"
  | "murch_dimension"
  | "cut_density_window"
  | "montage_method"
  | "axis_compliance"
  | "editing_failure_mode"
  // hook_retention (Wave 1b)
  | "hook_pattern"
  | "paywall_strength_tier"
  | "escalation_rung"
  | "vertical_pacing_dimension"
  | "completion_rate_rule"
  | "share_trigger"
  // audio_pipeline (Wave 2)
  | "tts_provider"
  | "tts_emotion_signature"
  | "foley_sfx_category"
  | "lufs_standard"
  | "frequency_band_owner"
  | "lip_sync_benchmark"
  | "bgm_strategy"
  | "spatial_audio_pattern"
  | "sfx_prompt_pattern"
  | "character_voice_protocol"
  // screenplay (Wave 2)
  | "beat_sheet"
  | "time_budget_segment"
  | "emotion_arc"
  | "scene_value_pair"
  | "dialogue_density"
  | "platform_register"
  | "comedy_formula"
  | "cn_drama_structure";

export type CinemaKeyType =
  // cinematography
  | "emotion"
  | "camera_move"
  | "shot_scale"
  | "duration_category"
  | "framing_rule"
  // video-engine-adapter
  | "engine_constant"
  | "duration_mapping"
  | "api_field"
  | "capability"
  | "selection_rule"
  | "audio_strategy"
  // compliance_gate
  | "viral_element"
  | "platform_policy"
  | "taboo"
  | "label_spec"
  // style_genome (Wave 1b)
  | "director"
  | "signature_token"
  | "genre"
  | "scamper"
  | "auteur_tier"
  | "culture_transform"
  | "cn_profile"
  // colorist (Wave 1b)
  | "color_ceiling"
  | "culture_color"
  | "pipeline_param"
  | "color_space"
  | "color_temp"
  // editor (Wave 1b)
  | "rhythm_rule"
  | "murch_dimension"
  | "density_window"
  | "montage_method"
  | "axis_rule"
  | "failure_mode"
  // hook_retention (Wave 1b)
  | "hook_type"
  | "hook_example"
  | "paywall_tier"
  | "escalation_rung"
  | "pacing_dimension"
  | "completion_rule"
  | "share_trigger"
  // audio_pipeline (Wave 2)
  | "tts_provider"
  | "tts_emotion"
  | "sfx_category"
  | "lufs"
  | "frequency_band"
  | "lip_sync_metric"
  | "bgm"
  | "spatial"
  | "sfx_prompt"
  | "voice_protocol"
  // screenplay (Wave 2)
  | "beat"
  | "time_budget"
  | "emotion_curve"
  | "scene_value"
  | "dialogue_metric"
  | "platform_register"
  | "comedy"
  | "cn_drama";

/** Loosely-typed seed/API entry (arrays + objects). Serialized to JSON columns. */
export interface CinemaEntry {
  category: CinemaCategory;
  key_name: string;
  key_type: CinemaKeyType;
  related_emotions?: string[];
  related_camera_moves?: string[];
  related_shot_scales?: string[];
  related_duration_min?: number;
  related_duration_max?: number;
  related_pacing?: string;
  related_composition?: string[];
  primary_recommendation?: string;
  alternative_recommendations?: string[];
  rationale?: string;
  speed_words?: string[];
  prompt_tokens?: Record<string, string>;
  /** Domain-specific structured fields, stored as JSON text. Each expert can stash
   * a different shape (colorist hues, engine field constraints, compliance risk…)
   * without adding a column every time. */
  extra_data?: Record<string, any>;
  source_file?: string;
  source_section?: string;
  tags?: string[];
  priority?: number;
}

export interface CinemaQueryInput {
  emotion?: string | null;
  shot_scale?: string | null;
  narrative_beat?: string | null;
  duration_category?: string | null;
  form_factor?: string | null;
  category?: string | null;
  key_name?: string | null;
  key_type?: string | null;
  /** Case-insensitive substring search over the extra_data JSON blob. Lets agents
   * filter by domain-specific fields (e.g. {"engine":"h3"}, {"platform":"douyin"}). */
  extra_data?: string | null;
  limit?: number;
}

const JSON_ARRAY_FIELDS = [
  "related_emotions",
  "related_camera_moves",
  "related_shot_scales",
  "related_composition",
  "alternative_recommendations",
  "speed_words",
  "tags",
] as const;

const JSON_OBJECT_FIELDS = ["prompt_tokens"] as const;

// ---------------------------------------------------------------------------
// table bootstrap
// ---------------------------------------------------------------------------

let _ready: Promise<void> | null = null;

export function ensureCinemaTables(): Promise<void> {
  if (!_ready) {
    _ready = (async () => {
      if (!(await db.schema.hasTable("cinema_knowledge"))) {
        await db.schema.createTable("cinema_knowledge", (t) => {
          t.increments("id").primary();
          t.text("category").notNullable();
          t.text("key_name").notNullable();
          t.text("key_type").notNullable();
          t.text("related_emotions");
          t.text("related_camera_moves");
          t.text("related_shot_scales");
          t.float("related_duration_min");
          t.float("related_duration_max");
          t.text("related_pacing");
          t.text("related_composition");
          t.text("primary_recommendation");
          t.text("alternative_recommendations");
          t.text("rationale");
          t.text("speed_words");
          t.text("prompt_tokens");
          t.text("extra_data");
          t.text("source_file");
          t.text("source_section");
          t.text("tags");
          t.integer("priority").defaultTo(50);
          t.text("created_at");
          t.text("updated_at");
          t.index(["category"], "idx_cinema_category");
          t.index(["key_type"], "idx_cinema_key_type");
          t.index(["key_name"], "idx_cinema_key_name");
        });
      }
      if (!(await db.schema.hasTable("cinema_usage_stats"))) {
        await db.schema.createTable("cinema_usage_stats", (t) => {
          t.increments("id").primary();
          t.integer("knowledge_id").notNullable();
          t.text("episode_id");
          t.text("shot_id");
          t.text("selected_field");
          t.text("selected_at");
        });
      }
      // Lightweight additive migration: older DBs created before Wave 1a lack
      // the extra_data column. Add it idempotently (ALTER TABLE … ADD COLUMN
      // fails if the column already exists, so check first).
      await migrateExtraDataColumn();
      await seedDefaultsIfEmpty();
    })().catch((err) => {
      // allow a retry on next request if bootstrap failed
      _ready = null;
      throw err;
    });
  }
  return _ready;
}

/**
 * Adds the extra_data column to a cinema_knowledge table that predates Wave 1a.
 * A no-op once the column already exists (knex.schema.hasColumn returns true).
 */
async function migrateExtraDataColumn(): Promise<void> {
  if (await db.schema.hasColumn("cinema_knowledge", "extra_data")) return;
  await db.raw("ALTER TABLE cinema_knowledge ADD COLUMN extra_data TEXT");
  console.log("[cinema] migrated cinema_knowledge: added extra_data column");
}

/** Auto-loads seed-data.json the first time the knowledge table is empty. */
async function seedDefaultsIfEmpty(): Promise<void> {
  const row = await db("cinema_knowledge").count("* as c").first();
  const count = (row as any)?.c ?? 0;
  if (count > 0) return;
  const entries = (seedEntries as unknown as CinemaEntry[]) ?? [];
  if (!Array.isArray(entries) || !entries.length) return;
  // Insert directly — tables are already created at this point and calling
  // insertEntries() here would re-enter ensureCinemaTables() (deadlock on _ready).
  const rows = entries
    .filter((e) => e && e.category && e.key_name)
    .map(serializeEntry);
  if (rows.length) await db("cinema_knowledge").insert(rows);
  console.log(`[cinema] seeded ${rows.length} default knowledge entries`);
}

// ---------------------------------------------------------------------------
// serialize / deserialize (entry arrays/objects <-> JSON columns)
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function toJson(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (Array.isArray(v) && v.length === 0) return null;
  if (typeof v === "object" && Object.keys(v as object).length === 0) return null;
  return JSON.stringify(v);
}

function fromJsonArray(v: unknown): string[] | null {
  if (!v) return null;
  try {
    const parsed = typeof v === "string" ? JSON.parse(v) : v;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function fromJsonObject(v: unknown): Record<string, string> | null {
  if (!v) return null;
  try {
    const parsed = typeof v === "string" ? JSON.parse(v) : v;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : null;
  } catch {
    return null;
  }
}

/** Like fromJsonObject but allows non-string values (extra_data holds numbers,
 * booleans, nested objects — e.g. {"default": 768, "required": true}). */
function fromJsonObjectAny(v: unknown): Record<string, any> | null {
  if (!v) return null;
  try {
    const parsed = typeof v === "string" ? JSON.parse(v) : v;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, any>)
      : null;
  } catch {
    return null;
  }
}

function serializeEntry(entry: CinemaEntry): Record<string, unknown> {
  return {
    category: entry.category,
    key_name: entry.key_name,
    key_type: entry.key_type,
    related_emotions: toJson(entry.related_emotions),
    related_camera_moves: toJson(entry.related_camera_moves),
    related_shot_scales: toJson(entry.related_shot_scales),
    related_duration_min: entry.related_duration_min ?? null,
    related_duration_max: entry.related_duration_max ?? null,
    related_pacing: entry.related_pacing ?? null,
    related_composition: toJson(entry.related_composition),
    primary_recommendation: entry.primary_recommendation ?? null,
    alternative_recommendations: toJson(entry.alternative_recommendations),
    rationale: entry.rationale ?? null,
    speed_words: toJson(entry.speed_words),
    prompt_tokens: toJson(entry.prompt_tokens),
    extra_data: toJson(entry.extra_data),
    source_file: entry.source_file ?? null,
    source_section: entry.source_section ?? null,
    tags: toJson(entry.tags),
    priority: entry.priority ?? 50,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
}

export function deserializeRow(row: any): any {
  if (!row) return null;
  const out: any = {
    id: row.id,
    category: row.category,
    key_name: row.key_name,
    key_type: row.key_type,
    primary_recommendation: row.primary_recommendation,
    rationale: row.rationale,
    related_pacing: row.related_pacing,
    related_duration_min: row.related_duration_min,
    related_duration_max: row.related_duration_max,
    source_file: row.source_file,
    source_section: row.source_section,
    priority: row.priority,
  };
  for (const f of JSON_ARRAY_FIELDS) {
    out[f] = fromJsonArray(row[f]) ?? [];
  }
  out.prompt_tokens = fromJsonObject(row.prompt_tokens) ?? {};
  out.extra_data = fromJsonObjectAny(row.extra_data) ?? {};
  return out;
}

// ---------------------------------------------------------------------------
// query — multi-dimensional progressive disclosure
// ---------------------------------------------------------------------------

function splitTokens(v: string | null | undefined): string[] {
  if (!v) return [];
  return v
    .toLowerCase()
    .split(/[\/,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function ciEq(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

function ciContains(hay: string | null | undefined, needle: string): boolean {
  return !!hay && hay.toLowerCase().includes(needle.toLowerCase());
}

function arrayContainsToken(arr: string[] | null | undefined, token: string): boolean {
  if (!arr) return false;
  const t = token.toLowerCase();
  return arr.some((el) => (el ?? "").toLowerCase().includes(t));
}

/** A row matches the emotion input if ANY of its slash/comma tokens hit. */
function emotionMatches(row: any, emotion: string): boolean {
  const tokens = splitTokens(emotion);
  if (tokens.length === 0) return true;
  const haystacks: string[] = [row.key_name, row.rationale].filter(Boolean) as string[];
  return tokens.some((token) => {
    if (row.key_type === "emotion" && ciContains(row.key_name, token)) return true;
    if (arrayContainsToken(row.related_emotions, token)) return true;
    if (arrayContainsToken(row.tags, token)) return true;
    return haystacks.some((h) => ciContains(h, token));
  });
}

function rowMatches(row: any, q: CinemaQueryInput): boolean {
  if (q.category && !ciEq(row.category, q.category)) return false;
  if (q.key_type && !ciEq(row.key_type, q.key_type)) return false;
  if (q.key_name && !ciEq(row.key_name, q.key_name) && !ciContains(row.key_name, q.key_name)) {
    return false;
  }
  // extra_data LIKE: case-insensitive substring match over the JSON blob, so an
  // agent can filter by domain-specific fields, e.g. extra_data="engine:h3" hits
  // {"engine":"h3",…} and extra_data="platform":"douyin" hits that platform's rules.
  if (q.extra_data && !ciContains(JSON.stringify(row.extra_data ?? {}), q.extra_data)) {
    return false;
  }
  if (q.emotion && !emotionMatches(row, q.emotion)) return false;

  if (q.shot_scale) {
    const token = q.shot_scale.toLowerCase();
    const byArray = arrayContainsToken(row.related_shot_scales, token);
    const byKey = row.key_type === "shot_scale" && ciContains(row.key_name, token);
    if (!byArray && !byKey) return false;
  }

  if (q.duration_category) {
    const token = q.duration_category.toLowerCase();
    const byKey = row.key_type === "duration_category" && ciContains(row.key_name, token);
    const byArray = arrayContainsToken(row.tags, token);
    if (!byKey && !byArray) return false;
  }

  if (q.narrative_beat) {
    const token = q.narrative_beat.toLowerCase();
    const hit =
      arrayContainsToken(row.tags, token) ||
      arrayContainsToken(row.related_emotions, token) ||
      ciContains(row.rationale, token) ||
      ciContains(row.primary_recommendation, token) ||
      ciContains(JSON.stringify(row.extra_data ?? {}), token);
    if (!hit) return false;
  }

  if (q.form_factor) {
    const ff = q.form_factor.toLowerCase();
    const portrait = ff === "portrait" || ff === "vertical" || ff === "9:16";
    const landscape = ff === "landscape" || ff === "horizontal" || ff === "16:9";
    if (portrait || landscape) {
      const tagged = arrayContainsToken(
        row.tags,
        portrait ? "portrait" : "landscape",
      ) || arrayContainsToken(row.tags, portrait ? "vertical" : "horizontal");
      // framing rules are form-factor specific; keep if tagged for this factor,
      // or if it is not a framing rule (don't over-filter other categories).
      if (row.category === "framing" && !tagged) return false;
    }
  }

  return true;
}

export async function queryCinema(
  q: CinemaQueryInput,
): Promise<{ results: any[]; total: number; query_applied: Record<string, unknown> }> {
  await ensureCinemaTables();

  const rows = await db("cinema_knowledge").orderBy("priority", "desc").select("*");
  let items = rows.map(deserializeRow);
  items = items.filter((r) => rowMatches(r, q));

  const total = items.length;
  const limit = q.limit && q.limit > 0 ? Math.min(q.limit, 200) : 5;
  const results = items.slice(0, limit);

  const query_applied: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== null && k !== "limit") query_applied[k] = v;
  }

  return { results, total, query_applied };
}

// ---------------------------------------------------------------------------
// categories / list / insert / usage
// ---------------------------------------------------------------------------

export async function listCategories(): Promise<{ category: string; count: number }[]> {
  await ensureCinemaTables();
  const rows = await db("cinema_knowledge")
    .select("category")
    .count("* as count")
    .groupBy("category")
    .orderBy("category");
  return rows.map((r: any) => ({ category: r.category, count: Number(r.count) }));
}

export async function listCinema(opts: {
  category?: string | null;
  key_type?: string | null;
}): Promise<any[]> {
  await ensureCinemaTables();
  let query = db("cinema_knowledge").orderBy("priority", "desc");
  if (opts.category) query = query.where("category", opts.category);
  if (opts.key_type) query = query.where("key_type", opts.key_type);
  const rows = await query.select("*");
  return rows.map(deserializeRow);
}

export async function insertEntries(
  entries: CinemaEntry[],
  replace: boolean,
): Promise<{ inserted: number; replaced: number }> {
  await ensureCinemaTables();
  let replaced = 0;
  if (replace) {
    for (const e of entries) {
      const del = await db("cinema_knowledge")
        .where({ category: e.category, key_name: e.key_name })
        .delete();
      replaced += Number(del) || 0;
    }
  }
  const rows = entries
    .filter((e) => e && e.category && e.key_name)
    .map(serializeEntry);
  if (rows.length) await db("cinema_knowledge").insert(rows);
  return { inserted: rows.length, replaced };
}

export async function recordUsage(input: {
  knowledge_id: number;
  episode_id?: string | null;
  shot_id?: string | null;
  selected_field?: string | null;
}): Promise<{ id: number }> {
  await ensureCinemaTables();
  const [id] = await db("cinema_usage_stats").insert({
    knowledge_id: input.knowledge_id,
    episode_id: input.episode_id ?? null,
    shot_id: input.shot_id ?? null,
    selected_field: input.selected_field ?? null,
    selected_at: nowIso(),
  });
  return { id };
}
