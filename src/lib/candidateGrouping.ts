/**
 * candidateGrouping.ts — kmc 候选感知建组纯函数 (candidate grouping engine).
 *
 * Phase 48 INGEST-01/02 + PHASE-01 (decisions D-02/D-03/D-04/D-05/D-08).
 * Shared by the online ingest route (Plan 48-02) and the Phase 50 backfill
 * script, so both paths produce byte-identical group shapes.
 *
 * Group identification — two channels, manifest first (D-02/D-03):
 *   1. manifest channel: kmc `iframe-manifest.json` all_first_frames[] /
 *      all_last_frames[] + selected_first_variant / selected_last_variant
 *      (P11 conditional frames; the manifest is ground truth).
 *   2. naming channel: `*_v{N}` suffix + canonical no-suffix file
 *      (P04 turnaround sheets etc.).
 *   3. no group → standalone, 维持现状, never an error (D-03).
 *
 * groupKey formats: `shot:{shot_id}:first` / `shot:{shot_id}:last` (first and
 * last frames of one shot are TWO different groups — mirrors getGroupKey's
 * keyframe split in AssetLibrary.tsx) and `name:{base}`.
 *
 * State policy (D-05): ingest writes state='active' only — elimination /
 * archiving is a human action in the asset center. That policy is enforced at
 * the DB-writing service layer (Plan 48-02 ingestAssets.ts), NOT here.
 *
 * Pure module: no DB, no fs, no network — data in, plans out.
 */

// ─── Types ─────────────────────────────────────────────────────────────────

/** One image in an ingest batch (the rewritten route's zod shape, Plan 48-02). */
export interface IngestImageInput {
  filePath: string;
  assetName: string;
  assetType?: string;
  prompt?: string;
  description?: string;
  characterId?: string;
  viewAngle?: string;
  subtype?: string;
  meta?: Record<string, unknown>;
}

/**
 * One kmc iframe-manifest entry. Paths are workdir-RELATIVE
 * (e.g. assets/P11/iframes_S01_B01/first_frame_v1.png).
 * `selected_*_variant` is ABSENT on unselected shots (gen_iframes.py never
 * emits it; only p11a0_iframe_qc writes it back) — absent and null both mean
 * "no selection" and take the fallback, hence optional + nullable.
 * When set it is a 1-based index into all_*_frames.
 */
export interface ManifestFrameEntry {
  shot_id: string;
  all_first_frames?: string[];
  all_last_frames?: string[];
  selected_first_variant?: number | null;
  selected_last_variant?: number | null;
  first_frame_prompt?: string;
  last_frame_prompt?: string;
}

/** One planned candidate group. The service layer maps this onto o_assets
 *  rows: members get assetsId → primary's id; primary is isPrimaryView=true. */
export interface AssetGroupPlan {
  groupKey: string;
  primaryFilePath: string;
  memberFilePaths: string[];
  characterId?: string;
  metaSubtype?: string;
  source: "manifest" | "naming";
}

export interface GroupPlanResult {
  groups: AssetGroupPlan[];
  /** Standalone images — no group, current flat behavior, no error (D-03). */
  ungroupedFilePaths: string[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Final path segment, query string stripped. Never throws. */
function basename(p: string): string {
  const seg = p.split("?")[0].split("/").pop();
  return seg ?? "";
}

/** Basename minus its final extension (dot must not be the first char). */
function stem(p: string): string {
  const bn = basename(p);
  const dot = bn.lastIndexOf(".");
  return dot > 0 ? bn.slice(0, dot) : bn;
}

// ─── parseVariantName ──────────────────────────────────────────────────────

const VARIANT_RE = /^(.*)_v(\d+)$/;

/**
 * Parse a `*_v{N}` variant filename.
 * - "…/base_turnaround_chengyu_v2.png" → { base: "base_turnaround_chengyu", variant: 2 }
 * - "…/base_turnaround_chengyu.png" (canonical, no suffix) → null
 * - "…/base_turnaround_guhongyuan.1.png" (legacy oddity) → null (standalone)
 */
export function parseVariantName(filePath: string): { base: string; variant: number } | null {
  if (typeof filePath !== "string") return null;
  const m = VARIANT_RE.exec(stem(filePath));
  if (!m) return null;
  const variant = parseInt(m[2], 10);
  if (!Number.isFinite(variant) || variant < 0) return null;
  return { base: m[1], variant };
}

// ─── planGroups ────────────────────────────────────────────────────────────

/**
 * Plan candidate groups for an ingest batch.
 *
 * Priority (D-03): manifest hits > naming-convention inference > no group.
 * An image claimed by a manifest group is never re-claimed by the naming
 * channel.
 *
 * Primary resolution (D-04): selected_*_variant (1-based index into
 * all_*_frames) when it is an integer in range AND that path is present in
 * the batch; otherwise the first present member in list order (yields v1 on
 * unselected shots), or the canonical no-suffix file in the naming channel
 * (falling back to the lowest variant number).
 *
 * Deterministic output: groups sorted by groupKey; memberFilePaths keep
 * their natural list (manifest) / canonical-then-variant-ascending (naming)
 * order.
 */
export function planGroups(
  images: IngestImageInput[],
  manifests?: ManifestFrameEntry[],
): GroupPlanResult {
  const groups: AssetGroupPlan[] = [];
  const claimed = new Set<string>();

  // basename → image, first occurrence wins. Manifest paths are
  // workdir-relative while ingest filePaths are OSS-style, so manifest↔batch
  // matching is by basename.
  const byBasename = new Map<string, IngestImageInput>();
  for (const img of images) {
    const bn = basename(img.filePath);
    if (bn && !byBasename.has(bn)) byBasename.set(bn, img);
  }

  // ─── Channel 1: manifest (claims first, D-03) ──────────────────────────
  if (manifests && Array.isArray(manifests)) {
    for (const entry of manifests) {
      if (!entry || typeof entry.shot_id !== "string") continue;
      const sides = [
        "first",
        "last",
      ] as const;
      for (const suffix of sides) {
        const list = suffix === "first" ? entry.all_first_frames : entry.all_last_frames;
        const selected = suffix === "first" ? entry.selected_first_variant : entry.selected_last_variant;
        if (!Array.isArray(list) || list.length === 0) continue;

        // members = list paths whose basename is present in the batch
        const members: IngestImageInput[] = [];
        for (const p of list) {
          if (typeof p !== "string") continue;
          const img = byBasename.get(basename(p));
          if (img && !claimed.has(img.filePath)) members.push(img);
        }
        if (members.length < 1) continue;

        // Primary per D-04: selected index (1-based, in range, present in
        // batch) else first present member in list order.
        let primary = members[0];
        if (typeof selected === "number" && Number.isInteger(selected) && selected >= 1 && selected <= list.length) {
          const selBasename = basename(list[selected - 1]);
          const selMember = members.find((m) => basename(m.filePath) === selBasename);
          if (selMember) primary = selMember;
        }

        for (const m of members) claimed.add(m.filePath);
        const characterId = members
          .map((m) => m.characterId)
          .find((c) => typeof c === "string" && c.length > 0);
        const metaSubtype = members
          .map((m) => m.subtype)
          .find((s) => typeof s === "string" && s.length > 0);
        const groupKey = suffix === "first"
          ? `shot:${entry.shot_id}:first`
          : `shot:${entry.shot_id}:last`;
        groups.push({
          groupKey,
          primaryFilePath: primary.filePath,
          memberFilePaths: members.map((m) => m.filePath),
          ...(characterId ? { characterId } : {}),
          ...(metaSubtype ? { metaSubtype } : {}),
          source: "manifest",
        });
      }
    }
  }

  // ─── Channel 2: naming convention, only for unclaimed images ───────────
  const unclaimed = images.filter((img) => !claimed.has(img.filePath));

  // Canonical (no-suffix) candidates among unclaimed images, by stem.
  const canonicalByStem = new Map<string, IngestImageInput>();
  for (const img of unclaimed) {
    if (parseVariantName(img.filePath)) continue; // variants are not canonical
    const s = stem(img.filePath);
    if (s && !canonicalByStem.has(s)) canonicalByStem.set(s, img);
  }

  // Variant members grouped by base.
  const variantsByBase = new Map<string, IngestImageInput[]>();
  for (const img of unclaimed) {
    const pv = parseVariantName(img.filePath);
    if (!pv) continue;
    const arr = variantsByBase.get(pv.base);
    if (arr) arr.push(img);
    else variantsByBase.set(pv.base, [img]);
  }

  for (const [base, members] of variantsByBase) {
    const sorted = [...members].sort((a, b) => {
      const va = parseVariantName(a.filePath)?.variant ?? 0;
      const vb = parseVariantName(b.filePath)?.variant ?? 0;
      return va - vb;
    });
    const canonical = canonicalByStem.get(base);
    const primary = canonical ?? sorted[0];
    const ordered = canonical ? [canonical, ...sorted] : sorted;
    for (const m of ordered) claimed.add(m.filePath);

    // characterId: any member's input characterId wins over name-derived.
    let characterId = sorted
      .map((m) => m.characterId)
      .find((c) => typeof c === "string" && c.length > 0);
    let metaSubtype: string | undefined = sorted
      .map((m) => m.subtype)
      .find((s) => typeof s === "string" && s.length > 0);
    // Turnaround sheets: base like base_turnaround_chengyu / final_turnaround_x
    // → characterId from the trailing token, meta.subtype=turnaround_sheet
    // (mirrors register_turnaround_b2.py's meta shape).
    const trMatch = /turnaround_([a-z0-9]+)$/.exec(base);
    if (trMatch) {
      if (!characterId) characterId = trMatch[1];
      if (!metaSubtype) metaSubtype = "turnaround_sheet";
    }
    groups.push({
      groupKey: `name:${base}`,
      primaryFilePath: primary.filePath,
      memberFilePaths: ordered.map((m) => m.filePath),
      ...(characterId ? { characterId } : {}),
      ...(metaSubtype ? { metaSubtype } : {}),
      source: "naming",
    });
  }

  // ─── Everything else: standalone passthrough (D-03) ────────────────────
  const ungroupedFilePaths = images
    .filter((img) => !claimed.has(img.filePath))
    .map((img) => img.filePath);

  groups.sort((a, b) => (a.groupKey < b.groupKey ? -1 : a.groupKey > b.groupKey ? 1 : 0));
  return { groups, ungroupedFilePaths };
}

// ─── deriveWorkflowPhase ───────────────────────────────────────────────────

const PHASE_STRING_RE = /\bp(\d{1,2})(?!\d)/i;
const PHASE_SEGMENT_RE = /^p(\d{1,2})$/i;

function normalizePhase(digits: string): string {
  return "p" + digits.padStart(2, "0");
}

/**
 * Derive the o_assets.workflow_phase value ("p04", "p11", …) — NEVER guesses
 * (D-08): returns null when underivable.
 *
 * Sources, in order:
 * 1. the explicit phase string — `p` + 1-2 digits at a word boundary,
 *    case-insensitive ("p11", "P04", "p04_turnaround" → 11 / 04 / 04);
 *    strings without the p prefix ("4", "pipeline") never match.
 * 2. any path segment that is EXACTLY p{1-2 digits}, case-insensitive —
 *    catches both OSS-style `/oss/{project}/p04/…` and kmc-relative
 *    `assets/P11/…`.
 *
 * Normalized to lowercase `p` + zero-padded 2 digits.
 *
 * Callers (Plan 48-02 ingest service) own the null policy: allow NULL in the
 * DB write and logger.warn — do not invent a value.
 */
export function deriveWorkflowPhase(phase: string | undefined, filePath: string): string | null {
  if (typeof phase === "string" && phase.length > 0) {
    const m = PHASE_STRING_RE.exec(phase);
    if (m) return normalizePhase(m[1]);
  }
  if (typeof filePath === "string") {
    for (const rawSeg of filePath.split("/")) {
      const m = PHASE_SEGMENT_RE.exec(rawSeg.split("?")[0]);
      if (m) return normalizePhase(m[1]);
    }
  }
  return null;
}
