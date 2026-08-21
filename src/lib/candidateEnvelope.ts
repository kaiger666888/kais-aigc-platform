/**
 * candidateEnvelope.ts — kmc 候选/变体统一信封契约 (Phase 53 VAR-01 kap 半部, D-02).
 *
 * One envelope for five candidate sources (p01 hook / p03 N-best / p11a0
 * conditional frames / p11a preview variants / p11b take-log), and ONE entry
 * point (`parseCandidateEnvelope`) that accepts BOTH generations of wire
 * shape:
 *   - today's flat node-data shapes → `normalizeLegacyCandidateData` lifts
 *     them into the envelope (score may be absent — the field is genuinely
 *     dropped at the khs call site today; we never fabricate a 0);
 *   - Wave B structured envelopes (khs canvas_sync/_manifest mapping, gated
 *     on khs2 v2.4 Phase 25 acceptance) → `candidateEnvelopeSchema`
 *     passthrough parse.
 *
 * groupKey vocabulary is byte-identical to Phase 48 candidateGrouping.ts
 * (L16-20): `shot:{shot_id}:first` / `shot:{shot_id}:last` (first and last
 * frames of one shot are TWO groups) and `name:{parentDir}/{base}`. The
 * legacy a-flf nodes carry the short-hyphen form `{shot_id}_{first|last}` —
 * normalizeLegacyCandidateData maps it onto the canonical vocabulary.
 *
 * G15 attribution taxonomy (DR-6): 9-value enum. `take_verdict_*` is a
 * prefix family (keep/fix_in_post/edit/re_roll/rewrite) — zod enums cannot
 * hold patterns, so the enum carries the literal placeholder
 * "take_verdict_*" and `takeVerdictCategory()` maps each concrete verdict.
 *
 * NOT part of canvasAssetSchema.assetDataSchemas: that registry is the
 * per-node-type baseline; this module is a per-source discriminated
 * envelope — mixing the two validation semantics is an anti-pattern
 * (53-RESEARCH DR-2). canvasAssetSchema.ts is untouched by this module.
 *
 * extras is unknown-typed passthrough: consumers must only render it as
 * strings — never eval / innerHTML / dangerouslySetInnerHTML.
 *
 * Pure module: no DB, no fs, no network — data in, envelopes out.
 */

import { z } from "zod";

// ─── Types (schema-first; every consumer imports from here) ────────────────

/** The five candidate sources that flow kmc → kap (53-CONTEXT VAR-01). */
export const candidateSourceSchema = z.enum([
  "p01_hook",
  "p03_nbest",
  "p11a0_flf",
  "p11a_preview",
  "p11b_take",
]);
export type CandidateSource = z.infer<typeof candidateSourceSchema>;

/**
 * Score envelope. `scale` declares the producer's unit so the wall can
 * normalize for display without guessing: "unit" = 0..1, "percent" = 0..100
 * (the p11a0 iframe-qc slots score 0..100 ints today).
 */
export const candidateScoreSchema = z.object({
  overall: z.number().min(0).max(1),
  dimensions: z.record(z.string(), z.number()).optional(),
  scale: z.enum(["unit", "percent"]).default("unit"),
});
export type CandidateScore = z.infer<typeof candidateScoreSchema>;

/**
 * The unified candidate envelope. looseObject: unknown keys are tolerated
 * (and preserved) so Wave B can add fields without kap 400s — today's shapes
 * must never be rejected (53-01 T-53-01-01).
 */
export const candidateEnvelopeSchema = z.looseObject({
  source: candidateSourceSchema,
  groupKey: z.string().min(1),
  variantId: z.string(),
  shotId: z.string().optional(),
  frameSlot: z.enum(["first", "last"]).optional(),
  selected: z.boolean().default(false),
  score: candidateScoreSchema.optional(),
  durationSec: z.number().min(0).optional(),
  prompt: z.string().optional(),
  seed: z.number().int().optional(),
  filePath: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  extras: z.record(z.string(), z.unknown()).default({}),
});
export type CandidateEnvelope = z.infer<typeof candidateEnvelopeSchema>;

/** p11b take-log five-verdict triage (khs p11b_final_render.py L1103-1115). */
export const takeVerdictSchema = z.enum([
  "keep",
  "fix_in_post",
  "edit",
  "re_roll",
  "rewrite",
]);
export type TakeVerdict = z.infer<typeof takeVerdictSchema>;

export const takeLogEntrySchema = z.object({
  take_n: z.number().int().optional(),
  shot_id: z.string(),
  changed_variable: z.string().optional(),
  seed: z.number().int().optional(),
  verdict: takeVerdictSchema,
  evidence: z.string().optional(),
  timestamp: z.string().optional(),
});
export type TakeLogEntry = z.infer<typeof takeLogEntrySchema>;

/** G15 failed-shots slot shape (khs p11c_video_qc.py L52-55). */
export const failedShotEntrySchema = z.object({
  shot_id: z.string(),
  error: z.string(),
  timestamp: z.string().optional(),
  run_id: z.string().optional(),
});
export type FailedShotEntry = z.infer<typeof failedShotEntrySchema>;

/**
 * G15 attribution taxonomy (DR-6, 9 values). `take_verdict_*` is the literal
 * placeholder for the five-verdict prefix family — use
 * `takeVerdictCategory(verdict)` for the concrete value.
 */
export const g15ErrorCategorySchema = z.enum([
  "qc_vision_fail",
  "engine_render_error",
  "bgm_trigger",
  "delegate_timeout",
  "delegate_parse",
  "schema_validation",
  "needs_regenerate",
  "take_verdict_*",
  "unknown",
]);
export type G15ErrorCategory = z.infer<typeof g15ErrorCategorySchema>;

// ─── G15 classification helpers ─────────────────────────────────────────────

/** Map a concrete take verdict onto its take_verdict_* category. */
export function takeVerdictCategory(verdict: TakeVerdict): G15ErrorCategory {
  return `take_verdict_${verdict}` as G15ErrorCategory;
}

/**
 * Pure string-feature classification (no IO). Priority order (DR-6):
 * verdict → needsRegenerate → timeout → parse → schema → bgm → render →
 * vision/qc → unknown.
 */
export function classifyG15Error(raw: {
  error?: string;
  verdict?: string;
  needsRegenerate?: boolean;
}): G15ErrorCategory {
  if (raw.verdict != null) {
    const parsed = takeVerdictSchema.safeParse(raw.verdict);
    if (parsed.success) return takeVerdictCategory(parsed.data);
  }
  if (raw.needsRegenerate === true) return "needs_regenerate";
  const e = (raw.error ?? "").toLowerCase();
  if (e.includes("timeout") || e.includes("timed out")) return "delegate_timeout";
  if (e.includes("parse")) return "delegate_parse";
  if (e.includes("schema") || e.includes("validation")) return "schema_validation";
  if (e.includes("bgm") || e.includes("music") || e.includes("音乐")) return "bgm_trigger";
  if (
    e.includes("render") || e.includes("cuda") || e.includes("oom") ||
    e.includes("渲染") || e.includes("engine")
  ) {
    return "engine_render_error";
  }
  if (e.includes("vision") || e.includes("qc") || e.includes("构图") || e.includes("画面")) {
    return "qc_vision_fail";
  }
  return "unknown";
}

// ─── Legacy (today's flat) shape normalization ──────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;

/** `{shot_id}_{first|last}` legacy groupKey → canonical `shot:{sid}:{slot}`. */
function canonicalFlfGroupKey(
  shotId: string | undefined,
  groupKey: string | undefined,
): { groupKey: string; slot: "first" | "last" } | null {
  const m = /^([A-Za-z0-9_-]+)_(first|last)$/.exec(groupKey ?? "");
  if (m) return { groupKey: `shot:${m[1]}:${m[2]}`, slot: m[2] as "first" | "last" };
  // frame_type present but groupKey missing/short → derive from shot_id + slot.
  return null;
}

/**
 * Lift today's flat node data into a CandidateEnvelope.
 *
 * Returns null for shapes we cannot identify — never guess (a wrong envelope
 * is worse than none; mirrors reviewBridge CR-01 fail-closed philosophy).
 *
 * NOTE: the returned object is constructed DIRECTLY, not re-validated
 * through candidateEnvelopeSchema — the c-* p01 shape has no group signal,
 * so its groupKey is the EMPTY STRING (schema's min(1) would reject it).
 * Empty groupKey means "derivable: false": 53-03 group derivation skips
 * these until Wave B ships structured groupKeys. All other shapes produce
 * schema-valid envelopes.
 */
export function normalizeLegacyCandidateData(
  data: Record<string, unknown>,
): CandidateEnvelope | null {
  // ── Source 3: p11a0 conditional frames (a-flf-* nodes) ──
  const frameType = str(data.frame_type);
  const rawGroupKey = str(data.groupKey);
  const frameSlot: "first" | "last" | undefined =
    frameType === "first" || frameType === "last" ? frameType : undefined;
  const flf =
    frameSlot != null
      ? { slot: frameSlot, key: canonicalFlfGroupKey(str(data.shot_id), rawGroupKey) }
      : null;
  const flfByKey = !flf && rawGroupKey
    ? canonicalFlfGroupKey(str(data.shot_id), rawGroupKey)
    : null;

  if (flf || flfByKey) {
    const slot = flf ? flf.slot : flfByKey!.slot;
    const shotId = str(data.shot_id);
    const groupKey =
      (flf ? flf.key?.groupKey : undefined) ??
      flfByKey?.groupKey ??
      (shotId != null ? `shot:${shotId}:${slot}` : undefined);
    if (groupKey == null) return null; // neither shot_id nor a mappable groupKey — don't guess
    const tags = Array.isArray(data.tags) ? data.tags.filter((t) => typeof t === "string") : [];
    const selected =
      data.isPrimaryView === true || tags.includes("★ 选定");
    const extras: Record<string, unknown> = {};
    if (data.description != null) extras.description = data.description;
    if (data.curationState != null) extras.curationState = data.curationState;
    if (data.state != null) extras.state = data.state;
    if (tags.length > 0) extras.tags = tags;
    return {
      source: "p11a0_flf",
      groupKey,
      variantId: str(data.variant) ?? "",
      shotId,
      frameSlot: slot,
      selected,
      score: undefined, // today's flf nodes carry no score — never fabricate one
      prompt: str(data.generation_prompt),
      filePath: str(data.filePath),
      thumbnailUrl: str(data.thumbnailUrl),
      extras,
    };
  }

  // ── Source 1: p01 hook candidates (c-* variant nodes) ──
  // Shape: {id:"variant-{vid}", label, selected, description, score?, data:{…}}
  // No frame_type, no groupKey. label+selected present with a description.
  const hasLabelOrId = str(data.label) != null || str(data.id) != null;
  const hasSelectedFlag = typeof data.selected === "boolean";
  if (hasLabelOrId && hasSelectedFlag && !frameType) {
    const extras: Record<string, unknown> = {};
    if (isRecord(data.data)) extras.data = data.data; // scalar passthrough + frame_breakdown_3sec preview
    return {
      source: "p01_hook",
      groupKey: "", // no group signal today — derivable:false, 53-03 skips (see NOTE above)
      variantId: str(data.label) ?? str(data.id) ?? "",
      selected: data.selected === true,
      score: undefined, // score exists on disk but is dropped at the khs call site today
      prompt: str(data.description),
      thumbnailUrl: str(data.thumbnailUrl),
      filePath: str(data.filePath),
      extras,
    };
  }

  return null;
}

// ─── Single entry point: both generations, one parse ────────────────────────

/**
 * Parse candidate data of either generation:
 *   1. `candidateEnvelopeSchema.safeParse` — Wave B structured envelopes
 *      pass through (unknown keys tolerated via looseObject);
 *   2. fallback `normalizeLegacyCandidateData` — today's flat shapes.
 * Returns null when neither path applies. Never throws.
 */
export function parseCandidateEnvelope(data: unknown): CandidateEnvelope | null {
  if (!isRecord(data)) return null;
  const parsed = candidateEnvelopeSchema.safeParse(data);
  if (parsed.success) {
    const env = parsed.data;
    // Envelope-schema product of a legacy dict that happens to validate:
    // groupKey must be non-empty here by schema. Use as-is.
    return env;
  }
  return normalizeLegacyCandidateData(data);
}
