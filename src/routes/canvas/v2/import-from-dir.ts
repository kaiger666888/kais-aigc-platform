import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { readdir, readFile, stat } from "fs/promises";
import { join, extname, basename } from "path";
import type { FlowGraphV2, FlowNodeV2, FlowLinkV2, FlowBranchV2 } from "@/types/flowgraph-v2";
import {
  ensureBootstrap,
  getLastEventId,
  listEvents,
} from "@/lib/canvasEventStore";
import { appendAndSync } from "@/lib/canvasEventStore";
import { upsertNode, upsertLink, upsertBranch } from "@/lib/canvasRelationalStore";
import { db } from "@/utils/db";
import { broadcastToProject } from "@/utils/ws";
import u from "@/utils";
import { SCHEMA_ALIASES, ENUM_NORMALIZERS } from "../../../../schema/generated/frontend-enum-normalizers";
import { EXPECTED_PARAM_FIELDS_BY_TYPE } from "@/lib/canvasAssetSchema";

const router = express.Router();

/**
 * Flatten scalar `params.*` entries from a pipeline manifest item into the
 * `extra` accumulator, never overwriting keys already present (top-level
 * item values win).
 *
 * Exported for scripts/canvas/verify-schema-roundtrip.ts (Phase 44 SCHEMA-03) so
 * the verify script can replay the EXACT production flatten logic instead
 * of hand-mirroring it (closes the replay-drift loophole flagged in
 * 44-03-PLAN.md Blocker 3).
 */
export function flattenParamsToNodeData(
  params: unknown,
  extra: Record<string, any>,
): void {
  if (params && typeof params === "object" && !Array.isArray(params)) {
    for (const [pk, pv] of Object.entries(params as Record<string, unknown>)) {
      if (pv == null) continue;
      if (typeof pv === "string" || typeof pv === "number" || typeof pv === "boolean") {
        if (!(pk in extra)) extra[pk] = pv;
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// CANVAS TREE BUILDER — replicates canvas_sync.py's Zone → Summary → Artifact
// 3-level tree structure (project 9999 format).
//
// This module replaces the old flat-file node approach with a structured
// tree that matches what runner.py's Phase 37 auto-sync produces.
//
// Tree structure per phase:
//   Zone (ellipse):  {id: "p0X", type: "zone", position: {x, y:0}, ...}
//     └→ Summary:    {id: "sum-p0X", type: <phaseType>, position: {x, y:80}, ...}
//           └→ Artifacts: {id: "a-p0X-art{N}", type: <phaseType>, position: {x, y:200+}, ...}
//
// All three levels are linked via explicit canvas links.
// ═══════════════════════════════════════════════════════════════════════

// ─── Layout constants (match canvas_graph.py) ──────────────────────────

const ZONE_X_STEP = 1300;      // X spacing between consecutive zone lanes
const ZONE_HEIGHT = 80;        // Zone node height
const SUMMARY_Y = 80;          // Summary nodes sit just below zone
const SUMMARY_HEIGHT = 120;    // Summary node height
const ART_BASE_Y = 200;        // First row of artifacts starts here
const ART_COL_SPACING = 270;   // X spacing between artifact columns
const ART_ROW_SPACING = 290;   // Y spacing between artifact rows (260 height + 30 gap)
const ART_WIDTH = 240;         // Artifact node width
const ART_HEIGHT = 260;        // Artifact node height
const SUMMARY_WIDTH = 260;     // Summary node width
const ZONE_WIDTH = 1200;       // Zone node width
const MAX_COLS = 4;            // Max artifacts per row before wrapping

// ─── Phase definitions (match ZONE_PHASES + _PHASE_TYPE_MAP) ───────────
// ─── Phase 词汇表(55-03 D-04:消费 22-phase 单一注册表,旧 13 条表已删) ──
// 真值源 = packages/infinite-canvas/src/constants/phaseRegistry(khs 三真相源
// 契约守护 by verify:phase-55;零外部 import 故双 tsconfig 均可编译)。
import { PHASE_REGISTRY, type PipelinePhaseDef } from "../../../../packages/infinite-canvas/src/constants/phaseRegistry";

type PhaseDef = PipelinePhaseDef;

/** lane 布局序(sortKey 升序;条目 13 → 22,坐标系不变)。 */
const PHASE_LANE_ORDER: readonly PhaseDef[] = [...PHASE_REGISTRY].sort((a, b) => a.sortKey - b.sortKey);

// Quick lookup: lane/目录前缀 → 注册表条目(p11a0 经 prefix='p11a' 折叠,
// 与 khs _PHASE_PREFIX_RE 语义一致;p05/p10b/p11/p12 注销不在此表)。
const PHASE_DEF_MAP: Record<string, PhaseDef> = Object.fromEntries(
  PHASE_REGISTRY.map((p) => [p.prefix, p]),
);

// ─── File → Phase mapping ──────────────────────────────────────────────
// Maps JSON filename prefix → phase prefix.
// Uses longest-prefix match so "p06_input_shots" maps to "p06".

const FILE_TO_PHASE: Array<{ filePrefix: string; phasePrefix: string }> = [
  // 既有具体条目保留在前部(最长前缀匹配);注销单体(p05/p10b/p11/p12)
  // 不再映射——未命中走忽略路径。legacy 单体文件名重定向:
  // p11(视频渲染)→ p11b 最终渲染;p12(合成)→ p12a 时间线合成。
  { filePrefix: "p10_voice", phasePrefix: "p10" },
  { filePrefix: "p11_video", phasePrefix: "p11b" },
  { filePrefix: "p11_prompt", phasePrefix: "p11a" },
  { filePrefix: "p11a0", phasePrefix: "p11a" },
  { filePrefix: "p01", phasePrefix: "p01" },
  { filePrefix: "p02", phasePrefix: "p02" },
  { filePrefix: "p03", phasePrefix: "p03" },
  { filePrefix: "p035", phasePrefix: "p035" },
  { filePrefix: "p04", phasePrefix: "p04" },
  { filePrefix: "p06", phasePrefix: "p06" },
  { filePrefix: "p07", phasePrefix: "p07" },
  { filePrefix: "p08", phasePrefix: "p08" },
  { filePrefix: "p09", phasePrefix: "p09" },
  { filePrefix: "p09b", phasePrefix: "p09b" },
  { filePrefix: "p09c", phasePrefix: "p09c" },
  { filePrefix: "p10", phasePrefix: "p10" },
  { filePrefix: "p10c", phasePrefix: "p10c" },
  { filePrefix: "p11", phasePrefix: "p11b" },
  { filePrefix: "p11a", phasePrefix: "p11a" },
  { filePrefix: "p11b", phasePrefix: "p11b" },
  { filePrefix: "p11c", phasePrefix: "p11c" },
  { filePrefix: "p12", phasePrefix: "p12a" },
  { filePrefix: "p12a", phasePrefix: "p12a" },
  { filePrefix: "p12b", phasePrefix: "p12b" },
  { filePrefix: "p13", phasePrefix: "p13" },
  { filePrefix: "p14", phasePrefix: "p14" },
  { filePrefix: "p15", phasePrefix: "p15" },
];

// ─── Asset directory → Phase mapping ───────────────────────────────────

const ASSET_DIR_TO_PHASE: Array<{ dirPrefix: string; phasePrefix: string }> = [
  // 55-03:P12 拆分——合成产物(composite/output)归 p12a(时间线合成承接);
  // narration/audio/voice 保持 p10(语音域,不误路由 p12b);mix/bgm → p12b。
  { dirPrefix: "scene_images", phasePrefix: "p07" },
  { dirPrefix: "S07",          phasePrefix: "p07" },
  { dirPrefix: "ref_images",   phasePrefix: "p07" },
  { dirPrefix: "video_clips",  phasePrefix: "p11b" },
  { dirPrefix: "P11",          phasePrefix: "p11b" },
  { dirPrefix: "narration",    phasePrefix: "p10" },
  { dirPrefix: "audio",        phasePrefix: "p10" },
  { dirPrefix: "voice",        phasePrefix: "p10" },
  { dirPrefix: "P12_composite",phasePrefix: "p12a" },
  { dirPrefix: "output",       phasePrefix: "p12a" },
  { dirPrefix: "mix",          phasePrefix: "p12b" },
  { dirPrefix: "bgm",          phasePrefix: "p12b" },
];

// ─── Media extensions ──────────────────────────────────────────────────

const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".tif"];
const VIDEO_EXTS = [".mp4", ".webm", ".mov", ".avi", ".mkv"];
const AUDIO_EXTS = [".wav", ".mp3", ".ogg", ".flac", ".aac", ".m4a"];
const ALL_MEDIA_EXTS = [...IMAGE_EXTS, ...VIDEO_EXTS, ...AUDIO_EXTS];

// ─── Keys to skip when expanding dict outputs (metadata, not content) ──

const SKIP_KEYS = new Set([
  "expert", "episode", "created_at", "skill_version",
  "skill_versions", "methodology_note", "type", "version",
  "format_note", "metadata", "generation_notes",
  "tts_engine", "voice_quality_targets",
  "downstream_consumers", "film_title", "film_brand",
  "timeline_structure", "snyder_validation",
  "car_as_character", "style",
  "engine", "comfyui_url", "resolution", "total_shots",
  "total_duration_sec", "default_duration_sec",
]);

// ═══════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════

/** Global workdir → oss prefix mapping, set per-request. */
let _workdirToOss: { workdir: string; ossPrefix: string } | null = null;

/**
 * Set the global workdir→oss mapping. Production sets this inside
 * scanAndBuildTree at request scope. Exported for test harnesses
 * (scripts/verify-canvas-shot-timeline.ts) that call
 * extractShotTimelineArtifacts directly without going through
 * scanAndBuildTree — without this, fsToOssUrl falls through every
 * branch and derived filePath values differ from production
 * (WR-07).
 */
export function setWorkdirToOss(
  mapping: { workdir: string; ossPrefix: string } | null,
): void {
  _workdirToOss = mapping;
}

/** Convert a filesystem path to a /oss/ URL if possible. */
function fsToOssUrl(fsPath: string): string | null {
  if (!fsPath || typeof fsPath !== "string") return null;
  // Check if already an /oss/ URL
  if (fsPath.startsWith("/oss/")) return fsPath;
  // Check if it's an absolute path under the OSS dir
  const ossDir = "/data/workspace/kais-aigc-platform/data/oss";
  if (fsPath.startsWith(ossDir + "/")) {
    return "/oss/" + fsPath.substring(ossDir.length + 1);
  }
  // Check if it's under the current workdir (mapped to /oss/{projectSlug}/ via symlink)
  if (_workdirToOss && fsPath.startsWith(_workdirToOss.workdir)) {
    const relPath = fsPath.substring(_workdirToOss.workdir.length);
    return _workdirToOss.ossPrefix + relPath;
  }
  // Check if it's an http URL
  if (fsPath.startsWith("http://") || fsPath.startsWith("https://")) return fsPath;
  // Not convertible
  return null;
}

/** Determine node type from file extension. */
function nodeTypeFromExt(ext: string): string {
  const lower = ext.toLowerCase();
  if (VIDEO_EXTS.includes(lower)) return "video";
  if (AUDIO_EXTS.includes(lower)) return "audio";
  if (IMAGE_EXTS.includes(lower)) return "asset";
  return "asset";
}

/** Try to read and parse a JSON file. Returns null on failure. */
async function tryReadJSON(filePath: string): Promise<any | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Find phase prefix from a filename using longest-prefix match. */
function findPhaseFromFile(filename: string): string | null {
  const baseName = filename.replace(/\.json$/, "");
  // Sort by filePrefix length descending for longest match
  const sorted = [...FILE_TO_PHASE].sort((a, b) => b.filePrefix.length - a.filePrefix.length);
  for (const { filePrefix, phasePrefix } of sorted) {
    if (baseName.startsWith(filePrefix)) return phasePrefix;
  }
  return null;
}

/** Find phase prefix from a directory name. */
function findPhaseFromDir(dirname: string): string | null {
  const sorted = [...ASSET_DIR_TO_PHASE].sort((a, b) => b.dirPrefix.length - a.dirPrefix.length);
  for (const { dirPrefix, phasePrefix } of sorted) {
    if (dirname === dirPrefix || dirname.startsWith(dirPrefix)) return phasePrefix;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// ARTIFACT EXTRACTION — the core algorithm
// ═══════════════════════════════════════════════════════════════════════

interface RawArtifact {
  /** Display label for this artifact */
  label: string;
  /** The output_key this artifact came from */
  output_key: string;
  /** Optional name (more descriptive than label sometimes) */
  name?: string;
  /** Optional description */
  description?: string;
  /** Optional generation prompt (shown in detail panel; falls back to description) */
  prompt?: string;
  /** Optional media thumbnail URL */
  thumbnailUrl?: string;
  /** Optional media file path */
  filePath?: string;
  /** Optional extra data fields from the source item */
  extra?: Record<string, any>;
  /**
   * Phase 3: per-artifact canvasType 覆盖;不设则用 phase 默认.
   *
   * Additive opt-in —— 既有 13 phase 调用者都不设此字段,
   * buildPhaseTree 走 `?? def.canvasType` fallback,行为零变化.
   * ShotTimelineAsset helper 通过此字段在一个 zone 下混合
   * storyboard/audio/video 三种异构子节点(CANVAS-02 锁定「ONE zone」).
   */
  canvasType?: "script" | "asset" | "storyboard" | "audio" | "video";
}

/**
 * Extract artifacts from a parsed JSON value.
 *
 * This implements the same flattening logic as canvas_sync.py's
 * _extract_artifacts: iterate over top-level keys, and for each key
 * whose value is a list, create one artifact per list item tagged
 * with that key as output_key.
 *
 * For dict values, recurse one level: if a sub-key contains a list,
 * flatten those items with the sub-key as output_key.
 *
 * @param data The parsed JSON data (dict, list, or scalar)
 * @returns Array of RawArtifact objects
 */
function extractArtifactsFromJSON(data: any): RawArtifact[] {
  const artifacts: RawArtifact[] = [];

  if (data == null) return artifacts;

  // Top-level list: each element becomes an artifact with output_key = "items"
  if (Array.isArray(data)) {
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      const art = itemToArtifact(item, "items");
      if (art) artifacts.push(art);
    }
    return artifacts;
  }

  if (typeof data !== "object") return artifacts;

  // Top-level dict: iterate keys
  for (const [key, val] of Object.entries(data)) {
    if (SKIP_KEYS.has(key)) continue;

    if (Array.isArray(val)) {
      // List value: each element becomes an artifact tagged with this key
      for (const item of val) {
        const art = itemToArtifact(item, key);
        if (art) artifacts.push(art);
      }
    } else if (val !== null && typeof val === "object") {
      // Dict value: recurse one level into its sub-keys
      for (const [subKey, subVal] of Object.entries(val)) {
        if (SKIP_KEYS.has(subKey)) continue;
        if (Array.isArray(subVal)) {
          for (const item of subVal) {
            const art = itemToArtifact(item, subKey);
            if (art) artifacts.push(art);
          }
        } else if (typeof subVal === "string" && subVal.length > 5) {
          // Scalar string content → single artifact
          artifacts.push({
            label: `${key} · ${subKey}`,
            output_key: subKey,
            description: subVal.slice(0, 200),
          });
        }
      }
    } else if (typeof val === "string" && val.length > 5) {
      // Scalar string at top level
      artifacts.push({
        label: key,
        output_key: key,
        description: val.slice(0, 200),
      });
    }
    // Skip numbers, booleans, null
  }

  return artifacts;
}

/**
 * Convert a single JSON item (from a list) into a RawArtifact.
 *
 * Handles strings, numbers, and dict objects. For dicts, extracts
 * a label from common fields (name, label, title, shot_id, id),
 * and copies media fields (filePath, thumbnailUrl, etc.).
 *
 * @param item The list element
 * @param outputKey The key under which this list was found
 * @returns RawArtifact or null if item is not representable
 */
function itemToArtifact(item: any, outputKey: string): RawArtifact | null {
  if (item == null) return null;

  if (typeof item === "string") {
    if (item.length < 2) return null;
    return {
      label: item.slice(0, 100),
      output_key: outputKey,
      name: item.slice(0, 100),
    };
  }

  if (typeof item === "number" || typeof item === "boolean") {
    return {
      label: String(item),
      output_key: outputKey,
    };
  }

  if (typeof item !== "object") return null;

  // Dict item: extract label and media fields
  // Try label fields in priority order
  const label =
    item.shot_id || item.name || item.label || item.title ||
    item.scene_id || item.id || `${outputKey} item`;

  const art: RawArtifact = {
    label: String(label).slice(0, 100),
    output_key: outputKey,
    name: String(item.name || item.label || item.title || label).slice(0, 100),
  };

  // Description
  const desc = item.description || item.narrator || item.narrator_text ||
    item.visual_description || item.logline || item.synopsis;
  if (desc && typeof desc === "string") {
    art.description = desc.slice(0, 200);
  }

  // Media fields — normalize various aliases
  // scene_ref_image is used by p09 shot_list to reference scene images
  const filePath = item.filePath || item.filepath || item.path ||
    item.audio_path || item.file_path || item.video_path || item.image_path ||
    item.scene_ref_image || item.scene_image || item.ref_image;
  if (filePath && typeof filePath === "string") {
    // Handle relative paths: prepend workdir if available
    let absPath = filePath;
    if (!filePath.startsWith("/") && !filePath.startsWith("http") && _workdirToOss) {
      absPath = join(_workdirToOss.workdir, filePath);
    }
    const ossUrl = fsToOssUrl(absPath);
    art.filePath = ossUrl || absPath;
  }

  // Thumbnail: check views/crops dict first
  if (!item.thumbnailUrl && !item.thumbnailurl) {
    for (const dictKey of ["views", "crops"]) {
      const views = item[dictKey];
      if (views && typeof views === "object" && !Array.isArray(views)) {
        for (const viewKey of ["front", "side", "side_left", "zoom", "top", "rear", "three_quarter", "back"]) {
          const vpath = views[viewKey];
          if (vpath && typeof vpath === "string") {
            const ossUrl = fsToOssUrl(vpath);
            art.thumbnailUrl = ossUrl || vpath;
            break;
          }
        }
        if (art.thumbnailUrl) break;
      }
    }
  } else {
    const thumb = item.thumbnailUrl || item.thumbnailurl;
    if (thumb && typeof thumb === "string") {
      const ossUrl = fsToOssUrl(thumb);
      art.thumbnailUrl = ossUrl || thumb;
    }
  }

  // If no thumbnail but has filePath that's an image or video, use filePath as thumbnail
  // Videos: front-end uses the file itself for preview (first frame / inline play)
  if (!art.thumbnailUrl && art.filePath) {
    const ext = extname(art.filePath).toLowerCase();
    if (IMAGE_EXTS.includes(ext) || VIDEO_EXTS.includes(ext)) {
      art.thumbnailUrl = art.filePath;
    }
  }

  // Collect extra scalar fields that may be useful for display
  const extra: Record<string, any> = {};
  for (const [k, v] of Object.entries(item)) {
    if (v == null) continue;
    // Accept scalars plus ekonte (nested object for E-Konte 5-layer data)
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      // Copy specific useful fields
      if ([
        "duration_sec", "duration", "scene_number", "scene_id", "shot_id",
        "character_id", "characterId", "character", "view", "viewAngle",
        "prompt", "score", "selected", "era", "location", "mood",
        "camera_movement", "shot_type", "color_palette", "sfx_notes",
        "ltx_prompt", "filename", "size", "dimensions",
        "avg_brightness", "black_pct", "size_kb", "source_filename",
        "level", "strata", "pain", "role", "age_range",
        "appearance", "personality", "arc", "anchor_4d",
        "visual_description", "narrator_text", "starting_image",
        "negative_prompt", "aspect", "scene_ref_image",
        "selected_variant", "is_selected", "framing",
      ].includes(k)) {
        extra[k] = v;
      }
    } else if (k === "ekonte" && typeof v === "object") {
      extra[k] = v;
    }
  }

  // ── Flatten `params.*` from pipeline manifest into extra ────────────
  // Python phase manifests (sibling repo kais-movie-agent) carry structured
  // fields under a nested `params` dict — archetype/role/era/prompt/etc.
  // Without flattening, this data is silently dropped and the resulting
  // asset node shows nothing but a label in the canvas detail panel.
  // Strategy: copy every scalar value from params into extra, BUT never
  // overwrite a field already set above (top-level item values win).
  flattenParamsToNodeData(item.params, extra);

  if (Object.keys(extra).length > 0) {
    art.extra = extra;
  }

  return art;
}

/**
 * Create artifacts from media files in a directory.
 * Each media file becomes one artifact.
 *
 * For each media file, also probes for a sidecar `.txt` with the same basename
 * (e.g. `foo.png` → `foo.txt`). If found, the first ~500 chars become the
 * artifact's description and prompt — without this, pure-media directories
 * produce asset nodes with only a label, leaving the detail panel blank.
 */
async function artifactsFromMediaFiles(
  dirPath: string,
  filenames: string[],
  outputKey: string,
): Promise<RawArtifact[]> {
  const artifacts: RawArtifact[] = [];
  // Build a set of available filenames for O(1) sidecar lookup.
  const filenameSet = new Set(filenames);

  for (const fname of filenames) {
    const ext = extname(fname).toLowerCase();
    if (!ALL_MEDIA_EXTS.includes(ext)) continue;

    const fullPath = join(dirPath, fname);
    const ossUrl = fsToOssUrl(fullPath) || fullPath;
    const label = basename(fname, ext).replace(/_/g, " ");

    const art: RawArtifact = {
      label,
      output_key: outputKey,
      filePath: ossUrl,
    };

    if (IMAGE_EXTS.includes(ext) || VIDEO_EXTS.includes(ext)) {
      art.thumbnailUrl = ossUrl;
    }

    // Sidecar .txt probe: same basename, .txt extension.
    const sidecarName = basename(fname, ext) + ".txt";
    if (filenameSet.has(sidecarName)) {
      try {
        const raw = await readFile(join(dirPath, sidecarName), "utf8");
        // 10K char cap — large enough for full short-form scripts (Phase 45 D1),
        // small enough to keep node.data payloads sane in the relational store.
        const trimmed = raw.trim().slice(0, 10000);
        if (trimmed) {
          art.description = trimmed;
          // UI's AssetDetail reads `prompt` first; mirror the text so detail
          // panels show content even before the description-fallback lands.
          art.prompt = trimmed;
        }
      } catch {
        // Sidecar read failed (permissions race, etc.) — silently skip.
      }
    }

    artifacts.push(art);
  }
  return artifacts;
}

/**
 * Standalone .txt files → script artifacts. Dedupes against files already
 * consumed as media sidecars via `consumedBaselineSet`. Phase 45 D2/D3
 * (TEXT-01) — closes the orphan-.txt loophole where .txt outputs existed
 * on OSS but produced no canvas node.
 *
 * Each .txt becomes a script artifact with description = file content
 * (10K char cap). The existing manifest-description precedence
 * (`!(pk in extra)` guard in flattenParamsToNodeData) ensures any
 * JSON-manifest description wins over the .txt content if both exist.
 */
async function artifactsFromScriptTextFiles(
  dirPath: string,
  filenames: string[],
  consumedBaselineSet: Set<string>,
  outputKey: string,
): Promise<RawArtifact[]> {
  const artifacts: RawArtifact[] = [];
  for (const fname of filenames) {
    if (extname(fname).toLowerCase() !== ".txt") continue;
    if (consumedBaselineSet.has(fname)) continue;
    try {
      const raw = await readFile(join(dirPath, fname), "utf8");
      const trimmed = raw.trim().slice(0, 10000);
      if (!trimmed) continue;
      const label = basename(fname, ".txt").replace(/_/g, " ");
      const filePath = fsToOssUrl(join(dirPath, fname));
      const art: RawArtifact = {
        label,
        output_key: outputKey,
        description: trimmed,
        prompt: trimmed,
        ...(filePath ? { filePath } : {}),
      };
      artifacts.push(art);
    } catch (err) {
      console.warn("[v2/import] failed to read script .txt:", fname, (err as Error).message);
    }
  }
  return artifacts;
}

// ═══════════════════════════════════════════════════════════════════════
// TREE BUILDER — constructs Zone → Summary → Artifact nodes + links
// ═══════════════════════════════════════════════════════════════════════

interface PhaseTree {
  phasePrefix: string;
  zoneNode: FlowNodeV2;
  summaryNode: FlowNodeV2;
  artifactNodes: FlowNodeV2[];
  links: FlowLinkV2[];
}

/**
 * Build the complete 3-level tree for a single phase.
 *
 * @param phasePrefix  e.g. "p04"
 * @param artifacts    Array of RawArtifact extracted from JSON
 * @returns PhaseTree with all nodes and links
 */
function buildPhaseTree(
  phasePrefix: string,
  artifacts: RawArtifact[],
): PhaseTree {
  const def = PHASE_DEF_MAP[phasePrefix];
  if (!def) {
    throw new Error(`Unknown phase prefix: ${phasePrefix}`);
  }

  // Lane index(0-based)仅用于 baseX 布局;phaseIndex 一律取 def.phaseIndex。
  const laneIndex = PHASE_LANE_ORDER.findIndex((p) => p.prefix === phasePrefix);
  const baseX = laneIndex * ZONE_X_STEP;

  const nodes: FlowNodeV2[] = [];
  const links: FlowLinkV2[] = [];

  // ── 1. Zone node ─────────────────────────────────────────────
  const zoneNode: FlowNodeV2 = {
    id: phasePrefix,
    type: "zone" as any,  // "zone" is valid in schema but not in TS NodeType union
    branchId: "main",
    // 55-03 binding 8:phaseIndex 取注册表 khs 编号(绝非 laneIndex+1 下标推导)
    phaseIndex: def.phaseIndex,
    phaseName: def.label,
    position: { x: baseX, y: 0 },
    size: { width: ZONE_WIDTH, height: ZONE_HEIGHT },
    state: "success",
    data: {
      label: def.label,
      phase: def.group,
      state: "success",
    },
  };
  nodes.push(zoneNode);

  // ── 2. Summary node ──────────────────────────────────────────
  const summaryNode: FlowNodeV2 = {
    id: `sum-${phasePrefix}`,
    type: def.canvasType as any,
    branchId: "main",
    phaseIndex: def.phaseIndex,
    phaseName: def.label,
    position: { x: baseX, y: SUMMARY_Y },
    size: { width: SUMMARY_WIDTH, height: SUMMARY_HEIGHT },
    state: "success",
    data: {
      label: def.label,
      description: `${artifacts.length} artifacts`,
      assetType: def.assetType,
      state: "success",
      tags: ["phase"],
    },
  };
  nodes.push(summaryNode);

  // Link: zone → summary
  links.push({
    id: `zl2-${phasePrefix}-sum-${phasePrefix}`,
    source: phasePrefix,
    target: `sum-${phasePrefix}`,
    branchId: "main",
    dataType: "output",
  });

  // ── 3. Artifact nodes ────────────────────────────────────────
  for (let i = 0; i < artifacts.length; i++) {
    const art = artifacts[i];
    const artId = `${phasePrefix}-art${i}`;
    const nodeId = `a-${artId}`;

    const col = i % MAX_COLS;
    const row = Math.floor(i / MAX_COLS);

    // Build data object
    const artData: Record<string, any> = {
      label: art.label,
      state: "success",
      assetType: def.assetType,
      tags: [],
      output_key: art.output_key,
    };

    // Add name if present
    if (art.name) {
      artData.name = art.name;
    }

    // Add description if present
    if (art.description) {
      artData.description = art.description;
    }

    // Add prompt if present (sidecar .txt or manifest field)
    if (art.prompt) {
      artData.prompt = art.prompt;
    }

    // Add media fields
    if (art.thumbnailUrl) {
      artData.thumbnailUrl = art.thumbnailUrl;
    }
    if (art.filePath) {
      artData.filePath = art.filePath;
    }

    // Merge extra fields
    if (art.extra) {
      for (const [k, v] of Object.entries(art.extra)) {
        // Don't overwrite explicit fields
        if (!(k in artData)) {
          artData[k] = v;
        }
      }
    }

    // ── Schema compatibility: map snake_case → camelCase ──────
    // The frontend NodeDetailPanel's StructuredFieldPanel reads fields
    // by camelCase keys defined in NODE_SCHEMA (constants.ts).
    // Our data uses snake_case from JSON artifacts, so we add aliases.
    // Aliases are generated from schema/pipeline-field-map.yaml.
    const aliases = SCHEMA_ALIASES[def.canvasType] || {};
    for (const [snakeKey, camelKey] of Object.entries(aliases)) {
      if (artData[snakeKey] != null && artData[camelKey] == null) {
        artData[camelKey] = artData[snakeKey];
      }
    }

    // ── Normalize Chinese enum values → English enum keys ──────
    // Pipeline P09 now generates Chinese values (e.g. "缓慢推进") but the
    // frontend MetadataEditor expects English enum keys (e.g. "zoom_in").
    // Map them so the select dropdowns match correctly.
    // Normalizers are generated from schema/pipeline-field-map.yaml.
    for (const [field, mapping] of Object.entries(ENUM_NORMALIZERS)) {
      const val = artData[field];
      if (typeof val === "string" && mapping[val] && val !== mapping[val]) {
        artData[field] = mapping[val];
      }
    }

    // ── Phase 44: completeness check against expected params ──────────
    // Defense-in-depth: Phase 42 enforces the actual contract source-side;
    // this receiver check surfaces drift loudly (warn) rather than silently
    // (drop), and stamps structured metadata so Phase 45's UI can flag the
    // node. Baseline only — phase-specific adds are NOT included so the
    // 689 historical rows (which pre-date the v2.0 contract) are not
    // flagged incomplete (Pitfall 3 in 44-RESEARCH.md).
    //
    // Phase 3: respect per-artifact canvasType override (Hook 2) — using
    // def.canvasType here would false-positive warn on ShotTimelineAsset's
    // storyboard/audio children (whose effective type differs from p13's
    // default 'video'). Existing 13 phase callers never set art.canvasType,
    // so `art.canvasType ?? def.canvasType === def.canvasType` for them.
    const effectiveType = art.canvasType ?? def.canvasType;
    const expected = EXPECTED_PARAM_FIELDS_BY_TYPE[effectiveType] || [];
    if (expected.length > 0) {
      const missing = expected.filter((f) => artData[f] == null || artData[f] === "");
      if (missing.length > 0) {
        artData.__incomplete = true;
        artData.__missing_fields = missing;
        console.warn(
          `[v2/import] node ${nodeId} (${def.canvasType}) missing fields:`,
          missing.join(", "),
        );
      }
    }

    // ── Derive missing structured fields from E-Konte + other data ──
    // Source data (p09 shot_list.json) has ekonte 5-layer structure and
    // other fields that can fill in composition/pacing/timeline/axisLine.
    if (def.canvasType === "storyboard") {
      const eko = artData.ekonte as Record<string, any> | undefined;

      // composition: from ekonte.L1_composition
      if (artData.composition == null && eko?.L1_composition) {
        const comp = eko.L1_composition;
        const fp = String(comp.framing || comp.subject_position || "");
        if (fp.includes("center") || fp.includes("居中")) artData.composition = "centered";
        else if (fp.includes("third")) artData.composition = "rule_of_thirds";
        else if (fp.includes("golden") || fp.includes("黄金")) artData.composition = "golden_ratio";
        else if (fp.includes("symmet") || fp.includes("对称")) artData.composition = "symmetrical";
        else artData.composition = fp || undefined;
      }

      // pacing: from ekonte.L2_camera.speed or ekonte.L3_action.speed_perception
      if (artData.pacing == null) {
        const camSpeed = eko?.L2_camera?.speed as string | undefined;
        const actSpeed = eko?.L3_action?.speed_perception as string | undefined;
        const raw = (camSpeed || actSpeed || "").toLowerCase();
        if (raw.includes("slow") || raw.includes("慢") || raw.includes("contemplat")) artData.pacing = "slow";
        else if (raw.includes("fast") || raw.includes("快") || raw.includes("rapid")) artData.pacing = "fast";
        else if (raw.includes("medium") || raw.includes("中")) artData.pacing = "medium";
        else if (raw.includes("montage") || raw.includes("蒙")) artData.pacing = "montage";
        else if (raw) artData.pacing = raw;
      }

      // timeline: from era field (e.g. "1960s黄昏" → "1975")
      if (artData.timeline == null && artData.era) {
        const eraStr = String(artData.era);
        const yr = parseInt(eraStr);
        if (yr >= 1970 || (eraStr.includes("60") && yr < 2000)) artData.timeline = "1975";
        else if (yr >= 1990 && yr < 2010) artData.timeline = "2000";
        else if (yr >= 2020 || eraStr.includes("现代") || eraStr.includes("现在")) artData.timeline = "2025";
        else if (eraStr.includes("梦") || eraStr.includes("dream")) artData.timeline = "dream";
        else if (eraStr.includes("闪") || eraStr.includes("flash")) artData.timeline = "flashback";
        else artData.timeline = eraStr;
      }

      // axisLine: from ekonte.L2_camera.movement direction
      if (artData.axisLine == null && eko?.L2_camera?.movement) {
        const mv = String(eko.L2_camera.movement);
        if (mv.includes("左") || mv.toLowerCase().includes("l2r") || mv.includes("右→左")) artData.axisLine = "R2L";
        else if (mv.includes("右") || mv.toLowerCase().includes("r2l") || mv.includes("左→右")) artData.axisLine = "L2R";
        else if (mv.includes("上升") || mv.includes("拉高") || mv.toLowerCase().includes("up")) artData.axisLine = "Up";
        else if (mv.includes("下降") || mv.toLowerCase().includes("down")) artData.axisLine = "Down";
        else artData.axisLine = "neutral";
      }
    }

    const artNode: FlowNodeV2 = {
      id: nodeId,
      // Phase 3: per-artifact canvasType override —— ShotTimelineAsset 用此在
      // 一个 zone 下混合 storyboard/audio/video 子节点. 既有 13 phase 调用者
      // 不设 art.canvasType → ?? 落回 def.canvasType,行为零变化.
      type: (art.canvasType ?? def.canvasType) as any,
      branchId: "main",
      phaseIndex: def.phaseIndex,
      phaseName: def.label,
      position: {
        x: baseX + col * ART_COL_SPACING,
        y: ART_BASE_Y + row * ART_ROW_SPACING,
      },
      size: { width: ART_WIDTH, height: ART_HEIGHT },
      state: "success",
      data: artData,
    };
    nodes.push(artNode);

    // Link: zone → artifact (zone-to-child pattern)
    links.push({
      id: `zc-${phasePrefix}-${nodeId}`,
      source: phasePrefix,
      target: nodeId,
      branchId: "main",
      dataType: "output",
    });
  }

  return {
    phasePrefix,
    zoneNode,
    summaryNode,
    artifactNodes: nodes.filter((n) => n.id.startsWith("a-")),
    links,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Phase 3 — ShotTimelineAsset consumer (CANVAS-01 / CANVAS-02 / CANVAS-03)
//
// extractShotTimelineArtifacts 把一份 ShotTimelineAsset 目录(asset.json +
// 5 数据 JSON + video.mp4 + 3 stems)折叠成画布上的一个 collection:
//   1 zone 父节点 + 1 summary + N storyboard + 3 audio + 1 video,
// 在 storyboard 子节点之间按 shot_id 升序 emit sequence edges.
//
// 复用既有 buildPhaseTree (Zone→Summary→Artifact 三级结构) + fsToOssUrl
// (媒体 URL 归一化). 异构子节点通过 RawArtifact.canvasType 覆盖 phase 默认
// canvasType 实现(Solution A,additive opt-in,既有 13 phase 调用者零行为变化).
//
// 所有合成字段(engine="shot-timeline" / shot_type="scene" / shot_id sentinel
// / resolution via ffprobe)满足 per-type Zod required 列表而 *不* 放宽任何
// schema(CANVAS-03 「不 bump contract」字面要求).
// ═══════════════════════════════════════════════════════════════════════

/** Sentinel key — scanWorkdirForArtifacts 命中 asset.json 时用此 key 标记. */
const SHOT_TIMELINE_SENTINEL_KEY = "__shot_timeline_asset__";

/**
 * Phase 3: ShotTimelineAsset schema_version 已知集合.
 *
 * SPEC §4 mandate: consumer 遇未知/更新版本时 graceful-degrade —— warn 后
 * 渲染已知字段,不 reject. Phase 9 (PRESENT-04) 起新增 "1.1" 支持
 * (character/prop registry_snapshot + data.characters/props);未知/future 版本
 * 仍走 graceful-degrade warn 分支.
 *
 * Phase 17 (CONSUMER-01): 新增 "1.2" 支持 —— per-shot dialogue/music/sfx
 * type:"asset" 子节点经 §7 buildPhaseTree 后处理 emit (gated on
 * KNOWN_VERSIONS.has("1.2"));audio_semantic.json + speakers.json sidecar
 * 读取. 仍是 graceful-degrade: 无 1.2 entry 的旧 consumer 静默跳过音频子节点
 * emission (SPEC §4 兼容契约). MUS-04 instruments 永不 emit (deferred v1.3).
 */
const SHOT_TIMELINE_KNOWN_VERSIONS = new Set(["1", "1.1", "1.2"]);

/**
 * 探测 video.mp4 分辨率,合成 video 子节点 `resolution` 字段.
 *
 * 用 ffprobe 子进程(无 shell,execFile 数组传参),失败 fallback "0x0".
 * Zod `z.string().min(1)` 仍通过;frontend VIDEO_METADATA_LABELS.resolution
 * 没有 "0x0" 标签但会 fallback 显示原值.
 *
 * 不写 mp4 box parser (RESEARCH Don't Hand-Roll). -v quiet 丢弃 stderr
 * 抑制 internals 信息泄露 (T-03-04).
 */
async function probeResolution(videoPath: string): Promise<string> {
  try {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileP = promisify(execFile);
    const { stdout } = await execFileP("ffprobe", [
      "-v", "quiet",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "csv=p=0:s=x",
      videoPath,
    ]);
    return stdout.trim() || "0x0";
  } catch {
    return "0x0";
  }
}

/**
 * 把一份 ShotTimelineAsset 目录(asset.json + 5 数据 JSON + video.mp4 +
 * 3 stems)折叠成画布 collection 子图:
 *   - 1 zone + 1 summary (via buildPhaseTree("p13", ...))
 *   - N storyboard 子节点(每镜一个,来自 shots.json)
 *   - 3 audio 子节点(vocals/drums/other)
 *   - 1 video 子节点(master)
 *   - (N+4) 条 zone→child `dataType:"output"` 边 (via buildPhaseTree)
 *   - (N-1) 条 storyboard 之间 `linkType:"sequence"` 边(按 shot_id 升序)
 *
 * @param manifest     已 parse 的 asset.json
 * @param workdir      ShotTimelineAsset 目录根(绝对路径)
 * @param manifestPath asset.json 绝对路径(溯源用)
 * @returns { nodes, links } 准备好合并进 FlowGraphV2
 */
export async function extractShotTimelineArtifacts(
  manifest: any,
  workdir: string,
  manifestPath: string,
): Promise<{ nodes: FlowNodeV2[]; links: FlowLinkV2[] }> {
  // ── (a) schema_version graceful-degrade (SPEC §4) ───────────
  // 未知版本只 warn,不 throw / return. schema 本身仍 additionalProperties:false
  // (不放宽);graceful-degrade 是 runtime consumer behavior.
  const version = String(manifest?.schema_version ?? "");
  if (!SHOT_TIMELINE_KNOWN_VERSIONS.has(version)) {
    console.warn(
      `[v2/import] ShotTimelineAsset schema_version="${manifest?.schema_version}" not in known set ` +
      `[${[...SHOT_TIMELINE_KNOWN_VERSIONS].join("/")}] — graceful-degrade ` +
      `(SPEC §4): rendering known fields only. (manifest: ${manifestPath})`,
    );
  }

  // ── (b) 5 数据 JSON 并行读 (任一缺失 → null,helper 继续用可用数据) ──
  const dataPaths = manifest?.data ?? {};
  const [shots, audioAnalysis, transcript, frames, prompts] = await Promise.all([
    tryReadJSON(join(workdir, dataPaths.shots ?? "shots.json")),
    tryReadJSON(join(workdir, dataPaths.audio_analysis ?? "audio_analysis.json")),
    tryReadJSON(join(workdir, dataPaths.transcript ?? "transcript.json")),
    tryReadJSON(join(workdir, dataPaths.frames ?? "frames.json")),
    tryReadJSON(join(workdir, dataPaths.prompts ?? "prompts.json")),
  ]);

  // ── (c) ffprobe video.mp4 → resolution ──────────────────────
  const media = manifest?.media ?? {};
  const videoPath = join(workdir, media.video ?? "video.mp4");
  const resolution = await probeResolution(videoPath);
  const sourceDuration = Number(manifest?.source?.duration_sec ?? 0) || 0;
  const videoFilename = manifest?.source?.video_filename ?? "video.mp4";

  // WR-03: malformed manifest (source.duration_sec missing / 0 / non-numeric)
  // would produce audio+video children with duration_sec=0, which violates the
  // per-type Zod `z.number().positive()` (canvasAssetSchema.ts:57,68). The
  // import itself succeeds (no per-type Zod runs here), but the next save-v2
  // HTTP call rejects every audio+video child with HTTP 400 — user sees an
  // apparently-working canvas that fails on save with no upstream signal.
  // Fail loud at import time with an actionable warn so operators know the
  // producer manifest needs fixing. We don't throw (graceful-degrade per
  // SPEC §4) — the storyboard children still render; only audio+video are
  // Zod-doomed.
  if (!(sourceDuration > 0)) {
    console.warn(
      `[v2/import] ShotTimelineAsset manifest missing/invalid source.duration_sec ` +
      `(${manifestPath}); audio/video children will fail Zod validation on save-v2.`,
    );
  }

  // ── (d) 构造 RawArtifact[] —— 异构 canvasType(Solution A 关键) ──
  // phasePrefix = "p13" (P13 · 交付): master video 是已交付的 artifact,
  // lane label 语义最贴(RESEARCH Open Question 2 推荐). 低风险可逆.
  const phasePrefix = "p13";
  const artifacts: RawArtifact[] = [];

  // frames.json id-indexed lookup (frames[].id === shot.id)
  const framesById = new Map<number, any>();
  for (const f of (frames ?? []) as any[]) {
    if (f && typeof f.id === "number") framesById.set(f.id, f);
  }

  // storyboard × N (每镜一个)
  const shotsArr: any[] = Array.isArray(shots) ? shots : [];
  for (const shot of shotsArr) {
    if (!shot || shot.id == null) continue;
    const shotId = String(shot.id);
    const thumb = framesById.get(shot.id)?.first_frame;
    const synthFields: string[] = ["shot_type"];
    // shot_type: 默认 "scene" (CONTEXT 锁定; Zod 不限枚举;
    // frontend NODE_SCHEMA.storyboard 没有 shot_type 字段,任何非空字符串都渲染).
    // 未来可选: prompts.json 关键词推断,本 phase 用默认值保持简单.
    const art: RawArtifact = {
      label: `Shot ${shotId}`,
      output_key: "storyboard",
      canvasType: "storyboard",
      extra: {
        shot_id: shotId,
        shot_type: "scene",
        duration_sec: Number(shot.duration) || 0.1,
        __synthetic_fields: synthFields,
      },
    };
    if (thumb && typeof thumb === "string") {
      // frames.json first_frame 是 base64 data URI —— 直接内联,不经 fsToOssUrl.
      // StoryboardNode.tsx:74-75 直接 <img src={thumbnailUrl}> 接受 data URI.
      art.thumbnailUrl = thumb;
    }
    artifacts.push(art);
  }

  // audio × 3 (vocals/drums/other)
  const stems = (media.stems ?? {}) as Record<string, string>;
  for (const stem of ["vocals", "drums", "other"] as const) {
    const rel = stems[stem] ?? `stems/${stem}.wav`;
    const stemAbs = join(workdir, rel);
    const stemOss = fsToOssUrl(stemAbs);
    artifacts.push({
      label: `${stem} stem`,
      output_key: "audio",
      canvasType: "audio",
      filePath: stemOss ?? stemAbs,
      extra: {
        shot_id: "collection",  // CONTEXT: audio/video 用集合级 sentinel
        engine: "shot-timeline",  // provenance 标识
        duration_sec: sourceDuration,
        __synthetic_fields: ["shot_id", "engine"],
      },
    });
  }

  // video × 1 (master)
  const videoOss = fsToOssUrl(videoPath);
  artifacts.push({
    label: videoFilename,
    output_key: "video",
    canvasType: "video",
    filePath: videoOss ?? videoPath,
    extra: {
      shot_id: "collection",
      engine: "shot-timeline",
      duration_sec: sourceDuration,
      resolution,
      __synthetic_fields: ["shot_id", "engine", "resolution"],
    },
  });

  // ── (d.1) Phase 9 (PRESENT-04): character/prop registry → asset 子节点 ──
  // v1.1 ShotTimelineAsset 的 cross-shot 角色/道具 registry. 数据源优先级
  // (D-PRESENT-04-Q4): generator.registry_snapshot 内嵌 (export-time 真相) →
  // data.characters / data.props 外部文件 (tryReadJSON fallback, 镜像 :962-968).
  // snapshot 已 confirmed-only (Phase 8 export 时过滤); 外部文件 fallback 额外
  // filter review_state==="confirmed" 作 defense-in-depth (proposed 条目在
  // apply 前可能仍躺在外部文件里). 门控 (D-PRESENT-04-Q3): 两者皆缺/空 →
  // 不 emit 任何 character/prop 节点 (v1.0 ep01 无 registry → 零角色/道具节点).
  //
  // §7 caveat (D-PRESENT-04-Q2, load-bearing): canvasType:"asset" 让 buildPhaseTree
  // 把节点 type 设为 "asset" (:838). 但 assetType 不能经 extra 传 —— buildPhaseTree
  // 在 :692 用 def.assetType ("delivery" for p13) seed artData.assetType, :724 的
  // extra-merge guard `if (!(k in artData))` 会静默 drop extra.assetType. 因此必须
  // (1) 在 buildPhaseTree 之前 push RawArtifact (本块), (2) 在 buildPhaseTree 之后
  // post-process tree.artifactNodes 覆盖 data.assetType (见 (e.2) 块). 缺一不可.
  const snapshot = manifest?.generator?.registry_snapshot;
  type RegistryEntry = {
    output_key: string;
    kind: "character" | "prop";
    name: string;
    representative_image?: string;
  };
  const registryEntries: RegistryEntry[] = [];
  // WR-04: defense-in-depth — producer guarantees disjoint ID formats
  // (characters.schema.json ^char_[0-9]{3}$ / props.schema.json ^prop_[0-9]{3}$),
  // 但 consumer 信任 any-typed registry_snapshot. 跨 list 重复 ID 会让下面的
  // registryById Map last-write-wins, 静默把 character 节点的 assetType 覆盖成
  // prop (或反之). 在收集阶段 detect + warn, 把不可达的 mis-classify 显性化.
  const seenRegistryIds = new Set<string>();

  const collectRegistryEntries = (
    list: any,
    kind: "character" | "prop",
    filterConfirmed: boolean,
  ): void => {
    if (!Array.isArray(list)) return;
    for (const entry of list) {
      if (!entry || entry.id == null) continue;
      if (filterConfirmed && entry.review_state !== "confirmed") continue;
      const idStr = String(entry.id);
      // IN-01: producer enforces minLength:1 on name (characters/props.schema.json),
      // 但 consumer 信任 any-typed manifest. 空/缺失 name 会让 label="" 直接违反
      // asset schema label min(1) (Zod-failing). coerce 到稳定 registry id 兜底,
      // 保证 label 永远非空. (entry.id == null 上面已 skip, 故 idStr 必非空.)
      const rawName =
        entry.name == null || String(entry.name).trim() === ""
          ? idStr
          : String(entry.name);
      if (seenRegistryIds.has(idStr)) {
        console.warn(
          `[v2/import] registry id collision: ${idStr} already emitted (now kind=${kind}); registryById is last-write-wins and may mis-classify assetType`,
        );
      }
      seenRegistryIds.add(idStr);
      const shots: unknown = entry.appearance_shots;
      const shotCount = Array.isArray(shots) ? shots.length : 0;
      registryEntries.push({
        output_key: idStr,
        kind,
        name: rawName,
        representative_image:
          typeof entry.representative_image === "string"
            ? entry.representative_image
            : undefined,
      });
      // §7 caveat 「前半段」: push BEFORE buildPhaseTree. output_key 是后续
      // post-process 的 join key. 故意不设 extra.assetType (会被 :724 drop).
      artifacts.push({
        label: rawName,
        output_key: idStr,
        canvasType: "asset",
        name: rawName,
        description: `${kind}: ${shotCount} shot${shotCount === 1 ? "" : "s"}`,
      });
    }
  };

  if (snapshot && (Array.isArray(snapshot.characters) || Array.isArray(snapshot.props))) {
    // registry_snapshot 内嵌 (自包含, export-time 已 confirmed-only)——无需再 filter.
    collectRegistryEntries(snapshot.characters, "character", false);
    collectRegistryEntries(snapshot.props, "prop", false);
  } else {
    // fallback: 外部 data.characters / data.props 文件 (defense-in-depth filter).
    const charFile = await tryReadJSON(join(workdir, dataPaths.characters ?? "characters.json"));
    const propFile = await tryReadJSON(join(workdir, dataPaths.props ?? "props.json"));
    collectRegistryEntries(charFile, "character", true);
    collectRegistryEntries(propFile, "prop", true);
  }

  // ── (d.2) Phase 17 (CONSUMER-01): v1.2 audio semantic → per-shot asset 子节点 ──
  // v1.2 ShotTimelineAsset 的 per-shot 三模态音频语义 (dialogue/music/sfx).
  // 数据源: data.audio_semantic 外部 JSON (tryReadJSON, mirror :962-968 +
  // :1161-1164). 门控 (T-17-01 graceful-degrade): 仅当 KNOWN_VERSIONS.has(version)
  // 时 emit —— 旧 consumer (无 "1.2" entry) 静默跳过, 保持 SPEC §4 兼容契约.
  // 缺席/空 audio_semantic → 不 emit 任何音频子节点 (mirror v1.0 ep01 graceful).
  //
  // Modalities emitted (per shot, gated on non-null modality):
  //   - dialogue child  ← shot.dialogue (text/events/spk_id 任一非空)
  //   - music child     ← shot.reproduction.music_gen (text 非空)
  //   - sfx child       ← shot.sfx (description/events 任一非空)
  //
  // NOTE (MUS-04 LOCKED — T-17-02): music modality sub-object is OMITTED in
  // v1.2 audio_semantic.schema.json (only reproduction.music_gen NL prompt
  // is the music signal). Tempo/mood/key/VA fields DO NOT EXIST in v1.2.
  // The music child surfaces ONLY reproduction.music_gen.{text,confidence,
  // fidelity_disclaimer}. NO instruments field is EVER emitted (case-insensitive
  // grep `\\binstruments?\\b` on this file MUST return 0 matches; MUS-04
  // deferred v1.3 per PROJECT.md Key Decisions Row 4).
  //
  // §7 caveat (mirror D-PRESENT-04-Q2): canvasType:"asset" → buildPhaseTree sets
  // type:"asset" (:838). But assetType CANNOT pass via extra —— buildPhaseTree
  // seeds artData.assetType = def.assetType ("delivery" for p13) at :692, and
  // the extra-merge guard at :724 (`if (!(k in artData))`) silently drops
  // extra.assetType. So (1) push RawArtifact BEFORE buildPhaseTree (本块),
  // (2) post-process tree.artifactNodes AFTER buildPhaseTree to override
  // data.assetType to "dialogue"/"music"/"sfx" (见 (e.3) 块). 缺一不可.
  //
  // filePath for audio children (CR-01 mirror): asset schema (canvasAssetSchema
  // .ts:23-25,77-83) marks filePath as universalRequired. Audio semantic
  // children have NO dedicated media file (the actual stems are the existing
  // vocals/drums/other nodes at :1042-1054). The truthful non-empty filePath
  // is the master video —— all audio semantic info is derived from analyzing
  // its audio track. thumbnailUrl deliberately undefined → AssetNode.tsx :127
  // falls back to typeIcons emoji (💬/🎵/🔊), no broken image preview.
  type AudioChildEntry = {
    output_key: string;
    kind: "dialogue" | "music" | "sfx";
  };
  const audioChildEntries: AudioChildEntry[] = [];

  // T-17-01 graceful-degrade gate: emit audio children only when the consumer
  // recognizes schema_version "1.2". Older consumers (without the 1.2 entry in
  // SHOT_TIMELINE_KNOWN_VERSIONS) skip emission entirely via this gate — SPEC §4
  // graceful-degrade contract. `version` is read at :952 above.
  if (SHOT_TIMELINE_KNOWN_VERSIONS.has(version) && version === "1.2") {
    const audioSemantic = await tryReadJSON(
      join(workdir, dataPaths.audio_semantic ?? "audio_semantic.json"),
    );
    const audioShots: any[] = Array.isArray(audioSemantic?.shots) ? audioSemantic.shots : [];
    for (const audioShot of audioShots) {
      if (!audioShot || audioShot.shot_id == null) continue;
      const sid = String(audioShot.shot_id);

      // ── dialogue child (when dialogue non-null + has signal) ──
      const dialogue = audioShot.dialogue;
      const dialogueHasSignal =
        dialogue != null &&
        (typeof dialogue.text === "string" && dialogue.text.length > 0 ||
          (Array.isArray(dialogue.events) && dialogue.events.length > 0) ||
          (typeof dialogue.spk_id === "string" && dialogue.spk_id.length > 0));
      if (dialogueHasSignal) {
        const dlgText = typeof dialogue.text === "string" ? dialogue.text.slice(0, 200) : "";
        audioChildEntries.push({ output_key: `audio_dia_${sid}`, kind: "dialogue" });
        artifacts.push({
          label: `Shot ${sid} · dialogue`,
          output_key: `audio_dia_${sid}`,
          canvasType: "asset",
          filePath: videoOss ?? videoPath,  // CR-01: universalRequired for asset type
          description: dlgText || `dialogue (spk: ${dialogue.spk_id ?? "?"})`,
          extra: {
            shot_id: sid,
            modality: "dialogue",
            emotion: dialogue.emotion ?? null,
            spk_id: dialogue.spk_id ?? null,
            dialogue_events: Array.isArray(dialogue.events) ? dialogue.events : [],
          },
        });
      }

      // ── music child (when reproduction.music_gen.text non-empty) ──
      // v1.2 LOCKED: music modality sub-object OMITTED in schema; only the
      // reproduction.music_gen NL prompt is the music signal. NO instruments
      // field (MUS-04 deferred v1.3 — T-17-02 mitigation).
      const musicGen = audioShot.reproduction?.music_gen;
      const musicHasSignal =
        musicGen != null &&
        typeof musicGen.text === "string" &&
        musicGen.text.length > 0;
      if (musicHasSignal) {
        const musText = musicGen.text.slice(0, 200);
        audioChildEntries.push({ output_key: `audio_mus_${sid}`, kind: "music" });
        artifacts.push({
          label: `Shot ${sid} · music`,
          output_key: `audio_mus_${sid}`,
          canvasType: "asset",
          filePath: videoOss ?? videoPath,
          description: musText,
          extra: {
            shot_id: sid,
            modality: "music",
            music_gen_confidence: typeof musicGen.confidence === "number" ? musicGen.confidence : null,
            music_gen_fidelity: typeof musicGen.fidelity_disclaimer === "string" ? musicGen.fidelity_disclaimer : null,
          },
        });
      }

      // ── sfx child (when sfx.description non-empty OR sfx.events non-empty) ──
      const sfx = audioShot.sfx;
      const sfxHasSignal =
        sfx != null &&
        ((typeof sfx.description === "string" && sfx.description.length > 0) ||
          (Array.isArray(sfx.events) && sfx.events.length > 0));
      if (sfxHasSignal) {
        const sfxDesc = typeof sfx.description === "string" ? sfx.description.slice(0, 200) : "";
        audioChildEntries.push({ output_key: `audio_sfx_${sid}`, kind: "sfx" });
        artifacts.push({
          label: `Shot ${sid} · sfx`,
          output_key: `audio_sfx_${sid}`,
          canvasType: "asset",
          filePath: videoOss ?? videoPath,
          description: sfxDesc || `sfx events: ${(Array.isArray(sfx.events) ? sfx.events : []).join(", ")}`,
          extra: {
            shot_id: sid,
            modality: "sfx",
            sfx_events: Array.isArray(sfx.events) ? sfx.events : [],
          },
        });
      }
    }
  }

  // ── (e) 调用扩展后的 buildPhaseTree (产出 zone + summary + artifact 三级) ──
  // buildPhaseTree 内部循环会读 art.canvasType 覆盖 (Hook 2),继承所有
  // receiver-side 兼容 shim (extra-merge, SCHEMA_ALIASES, ENUM_NORMALIZERS,
  // EXPECTED_PARAM_FIELDS warn, E-Konte derive).
  const tree = buildPhaseTree(phasePrefix, artifacts);

  // ── (e.1) Post-process: zone label ← manifest.source.video_filename ──
  // CONTEXT 锁定「zone.data.label = source.video_filename」(RESEARCH Field
  // Mapping R2 + plan Assert F). buildPhaseTree 默认用 def.label (如 "P13 ·
  // 交付"),适合 13 phase 的 lane label,但 ShotTimelineAsset 的 zone 需要标识
  // 这是哪一支成片. Additive:仅 ShotTimelineAsset 路径走此覆盖.
  if (tree.zoneNode.data) {
    tree.zoneNode.data.label = videoFilename;
  }

  // ── (e.2) Post-process §7 caveat「后半段」: character/prop assetType 覆盖 ──
  // buildPhaseTree 对所有 p13 artifact 用 def.assetType="delivery" seed
  // artData.assetType (:692), extra-merge guard (:724) 静默 drop extra.assetType.
  // 因此 character/prop 节点的 assetType 必须在 buildPhaseTree 返回后用
  // data.output_key 作 join key 覆盖为 "character"/"prop" (D-PRESENT-04-Q2).
  // 同时挂 thumbnailUrl (representative_image → fsToOssUrl 合成 /oss/... URL,
  // 镜像 audio filePath 合成模式 :1040-1045). 缺此 post-process → 角色/道具节点
  // 错误渲染 assetType="delivery", AssetNode 退化到 📦 fallback icon (WRONG).
  // registryEntries 为空时 (v1.0 ep01 无 registry) 此块 no-op, 零行为变化.
  if (registryEntries.length > 0) {
    const registryById = new Map(registryEntries.map((e) => [e.output_key, e]));
    for (const node of tree.artifactNodes) {
      const data = (node.data ?? {}) as Record<string, any>;
      const entry = registryById.get(String(data.output_key));
      if (!entry) continue;
      data.assetType = entry.kind;  // 覆盖 "delivery" → "character" / "prop"
      if (entry.representative_image) {
        // WR-05: defense-in-depth — producer enforces ^(?!.*\.\.) on
        // representative_image (characters.schema.json / props.schema.json),
        // 但 consumer 信任 any-typed registry_snapshot. 消费侧再校验: 拒绝含
        // `..` 或绝对路径的值, 再 join+fsToOssUrl (probe P7 用
        // "../../etc/passwd" 曾把逃逸绝对路径泄进 thumbnailUrl/filePath).
        if (
          entry.representative_image.includes("..") ||
          entry.representative_image.startsWith("/")
        ) {
          console.warn(
            `[v2/import] refusing suspicious representative_image (path traversal): ${entry.representative_image}`,
          );
        } else {
          const imgAbs = join(workdir, entry.representative_image);
          const imgOss = fsToOssUrl(imgAbs);
          const url = imgOss ?? imgAbs;
          data.thumbnailUrl = url;
          // CR-01: asset schema (canvasAssetSchema.ts:23-25) 把 filePath 标为
          // universalRequired —— 所有 media-bearing 节点必填. character/prop 节点
          // 本质就是 asset 节点, representative_image 即媒体 PNG. 镜像 audio/video
          // filePath 合成模式 (:1040-1061) 同步写 filePath, 否则 import 路径
          // (appendAndSync 绕过 Zod) 表面成功, 但下一次 save-v2 HTTP roundtrip
          // 会对每个 character/prop 节点返回 400 (WR-03 反模式重现).
          data.filePath = url;
        }
      }
    }
  }

  // ── (e.3) Post-process §7 caveat「后半段」for v1.2 audio children ──────
  // Mirror (e.2) pattern for character/prop. buildPhaseTree seeds ALL p13
  // artifact assetType="delivery" (:692); the extra-merge guard (:724) silently
  // drops extra.assetType, so audio children's assetType MUST be overridden
  // here using output_key as the join key. Without this override, dialogue/
  // music/sfx children would render with assetType="delivery" → AssetNode.tsx
  // falls back to 📦 icon (WRONG — should be 💬/🎵/🔊 via typeIcons).
  // audioChildEntries is empty when (a) older consumer (no 1.2 gate), (b) v1.0/
  // v1.1 asset (no audio_semantic.json), or (c) all modalities null → no-op.
  if (audioChildEntries.length > 0) {
    const audioChildById = new Map(audioChildEntries.map((e) => [e.output_key, e]));
    for (const node of tree.artifactNodes) {
      const data = (node.data ?? {}) as Record<string, any>;
      const entry = audioChildById.get(String(data.output_key));
      if (!entry) continue;
      data.assetType = entry.kind;  // 覆盖 "delivery" → "dialogue"/"music"/"sfx"
    }
  }

  // ── (f) sequence edges: storyboard 按 shot_id 升序 emit N-1 条 ──────
  // 形状意图匹配 flowDataMapper.ts:163-172 (frontend precedent) 的渲染语义:
  // CanvasEdge.tsx:60 通过 `data?.linkType === "sequence"` 识别并渲染蓝色实线 +
  // 箭头. 两边都把 linkType 嵌在 data 下,backend 渲染结果与 frontend precedent
  // 等价.
  //
  // WR-05: 形状 NOT 字面 byte-match flowDataMapper.ts:163-172 —— 三处差异:
  //   1. backend 顶层有 branchId:"main";frontend precedent 省略 (前端默认隐含).
  //   2. backend dataType:"data" 在顶层;frontend precedent 嵌在 data.dataType.
  //   3. backend data 只装 {linkType};frontend precedent data 装 {dataType,linkType}.
  // 渲染仍 work 因 CanvasEdge.tsx:33 只读 data?.linkType. 未来若新增读 data.dataType
  // 或假设 frontend precedent 形状的代码,需注意此差异.
  //
  // WR-06: FlowLinkV2 (flowgraph-v2.ts:45-53) 不声明 data 字段. 既有 `as FlowLinkV2`
  // cast 是 type-level manifestation of WR-01 (producer emits a field not in the
  // interface). Phase 3 不动 shared schema (CANVAS-03 + 跨 phase 影响范围超本 phase
  // scope),改为本地 typed extension 让 TS 看见 data 字段,消除 cast —— 一旦未来
  // FlowLinkV2 加 data 字段 (WR-01 fix),只需删此 local type alias.
  //
  // 注意 (WR-01 caveat): 即便此处 emit 了 data 字段,save-v2 的 FlowLinkV2Schema
  // (flowgraph-v2-schema.ts:53-61) 默认 strip unknown keys,full save 时 data 会被
  // 丢弃 —— import-from-dir 路径 (appendAndSync → event store) 不经 Zod parse,
  // 所以本路径上 sequence edge 正常工作;latent bug 限于 save-v2 HTTP roundtrip.
  type SequenceLink = FlowLinkV2 & { data?: Record<string, unknown> };
  const sequenceLinks: SequenceLink[] = [];
  const sbNodes = tree.artifactNodes
    .filter((n) => n.type === "storyboard")
    .sort((a, b) => {
      const ai = Number((a.data as any)?.shot_id);
      const bi = Number((b.data as any)?.shot_id);
      return (Number.isFinite(ai) ? ai : 0) - (Number.isFinite(bi) ? bi : 0);
    });
  for (let i = 1; i < sbNodes.length; i++) {
    const link: SequenceLink = {
      id: `seq-${sbNodes[i - 1].id}-${sbNodes[i].id}`,
      source: sbNodes[i - 1].id,
      target: sbNodes[i].id,
      branchId: "main",
      dataType: "data",
      data: { linkType: "sequence" },
    };
    sequenceLinks.push(link);
  }

  // ── (g) return ─────────────────────────────────────────────
  // 注: transcript/prompts 作为 sidecar description 附挂的细粒度映射
  // (RESEARCH Open Question 4) 本 phase 显式延后 —— CANVAS-01/02/03 SC
  // 不要求,且 prompts/transcript 仍保留在 fixture 的 asset.json data 引用里
  // 供后续 phase 或画布详情面板消费.
  void audioAnalysis;  void transcript;  void prompts;  // reserved for future sidecar attach
  return {
    nodes: [tree.zoneNode, tree.summaryNode, ...tree.artifactNodes],
    links: [...tree.links, ...sequenceLinks],
  };
}

/**
 * Create zone-to-zone chain links between consecutive phases.
 */
function buildZoneChainLinks(orderedPhases: string[]): FlowLinkV2[] {
  const links: FlowLinkV2[] = [];
  for (let i = 0; i < orderedPhases.length - 1; i++) {
    const src = orderedPhases[i];
    const tgt = orderedPhases[i + 1];
    links.push({
      id: `zl-${src}-${tgt}`,
      source: src,
      target: tgt,
      branchId: "main",
      dataType: "output",
    });
  }
  return links;
}

/**
 * Build cross-reference links between artifacts across phases.
 *
 * Mimics canvas_sync.py's _build_cross_reference_links():
 * - P09 storyboard shots reference P07 scene images (by scene_id → scene ref)
 * - P11 video clips reference P09 storyboard shots (by shot_id)
 * - P10 audio clips reference P09 storyboard shots (by scene_id)
 * - P04 character assets reference P07 visual assets (by name/character_id)
 *
 * Each link uses dataType="reference" matching the 9999 pattern.
 */
function buildCrossReferenceLinks(
  nodes: FlowNodeV2[],
): FlowLinkV2[] {
  const links: FlowLinkV2[] = [];
  const seen = new Set<string>();

  // Index artifact nodes by phase + key fields
  const byPhase: Record<string, FlowNodeV2[]> = {};
  for (const n of nodes) {
    if (!n.id.startsWith("a-")) continue;
    const phase = n.id.split("-")[1]; // e.g. "p09"
    if (!byPhase[phase]) byPhase[phase] = [];
    byPhase[phase].push(n);
  }

  // Helper to create a reference link with dedup
  function refLink(srcId: string, tgtId: string): FlowLinkV2 | null {
    const linkId = `xref-${srcId}-${tgtId}`;
    if (seen.has(linkId)) return null;
    seen.add(linkId);
    return {
      id: linkId,
      source: srcId,
      target: tgtId,
      branchId: "main",
      dataType: "reference",
    };
  }

  // --- P09 → P07: storyboard shots reference scene images ---
  const p09Shots = byPhase["p09"] || [];
  const p07Assets = byPhase["p07"] || [];

  // Build scene_id → P07 node map
  const sceneToP07: Record<string, FlowNodeV2> = {};
  for (const a of p07Assets) {
    const d = a.data || {};
    // Scene images may have scene_number or be labeled S1, S2 etc
    const sceneId = d.scene_id || d.scene_number?.toString() || d.label?.match(/S(\d+)/)?.[0];
    if (sceneId) {
      if (!sceneToP07[sceneId]) sceneToP07[sceneId] = a;
    }
    // Also map by filename pattern
    if (d.filePath || d.thumbnailUrl) {
      const fname = (d.filePath || d.thumbnailUrl || "").match(/S(\d+)/);
      if (fname) {
        const sid = `S${fname[1]}`;
        if (!sceneToP07[sid]) sceneToP07[sid] = a;
      }
    }
  }

  for (const shot of p09Shots) {
    const d = shot.data || {};
    const sceneId = d.scene_id || d.label?.match(/S(\d+)/)?.[0];
    if (sceneId && sceneToP07[sceneId]) {
      const lk = refLink(shot.id, sceneToP07[sceneId].id);
      if (lk) links.push(lk);
    }
  }

  // --- P11 → P09: video clips reference storyboard shots ---
  const p11Videos = byPhase["p11"] || [];
  const shotIdToP09: Record<string, FlowNodeV2> = {};
  for (const s of p09Shots) {
    const sid = s.data?.shot_id || s.data?.label;
    if (sid) shotIdToP09[sid] = s;
  }

  for (const video of p11Videos) {
    const d = video.data || {};
    const shotId = d.shot_id || d.label?.match(/(S\d+-shot\d+)/)?.[0];
    if (shotId && shotIdToP09[shotId]) {
      const lk = refLink(video.id, shotIdToP09[shotId].id);
      if (lk) links.push(lk);
    }
  }

  // --- P10 → P09: audio clips reference storyboard shots (by scene) ---
  const p10Audios = byPhase["p10"] || [];
  for (const audio of p10Audios) {
    const d = audio.data || {};
    const sceneId = d.scene_id || d.label?.match(/S(\d+)/)?.[0];
    if (sceneId) {
      // Link to first shot of that scene in P09
      for (const shot of p09Shots) {
        const shotScene = shot.data?.scene_id || shot.data?.label?.match(/S(\d+)/)?.[0];
        if (shotScene === sceneId) {
          const lk = refLink(audio.id, shot.id);
          if (lk) links.push(lk);
          break;
        }
      }
    }
  }

  // --- P06 → P09: camera scripts reference storyboard shots ---
  const p06Shots = byPhase["p06"] || [];
  for (const cam of p06Shots) {
    const d = cam.data || {};
    const shotId = d.shot_id || d.label?.match(/(S\d+-shot\d+|S\d+-\d+)/)?.[0];
    if (shotId && shotIdToP09[shotId]) {
      const lk = refLink(cam.id, shotIdToP09[shotId].id);
      if (lk) links.push(lk);
    }
  }

  return links;
}

// ═══════════════════════════════════════════════════════════════════════

interface PhaseArtifacts {
  phasePrefix: string;
  artifacts: RawArtifact[];
}

/**
 * Scan a workdir for JSON files and asset directories, extracting artifacts
 * for each phase.
 *
 * Scans:
 * 1. Root-level JSON files matching p0X_*.json or p1X_*.json patterns
 * 2. assets/ subdirectories containing media files
 * 3. output/ directory for final video files
 *
 * @param workdir The project working directory
 * @returns Map of phasePrefix → RawArtifact[]
 */
async function scanWorkdirForArtifacts(workdir: string): Promise<Map<string, RawArtifact[]>> {
  const phaseArtifacts = new Map<string, RawArtifact[]>();
  const seenPhases = new Set<string>();

  /** Helper to add artifacts to a phase */
  function addArtifacts(phase: string, arts: RawArtifact[]) {
    if (arts.length === 0) return;
    if (!phaseArtifacts.has(phase)) {
      phaseArtifacts.set(phase, []);
    }
    phaseArtifacts.get(phase)!.push(...arts);
    seenPhases.add(phase);
  }

  // ── Phase 3 — ShotTimelineAsset 早期识别 (CANVAS-01) ─────────
  // workdir 根若有 asset.json 且 asset_type === "shottimeline",短路掉既有
  // 13-phase 扫描循环,通过 sentinel key `__shot_timeline_asset__` 把 manifest
  // 交给 scanAndBuildTree 中的 extractShotTimelineArtifacts helper. 短路避免
  // 把 ep01 的 shots.json/audio_analysis.json/transcript.json/prompts.json
  // 误当普通 phase manifest 处理. 父目录穿越已在 producer schema
  // (`^(?!.*\.\.)` pattern) 源头拒绝,consumer 侧 tryReadJSON + join 不跨 workdir.
  const assetManifestPath = join(workdir, "asset.json");
  const manifestProbe = await tryReadJSON(assetManifestPath);
  if (manifestProbe && manifestProbe.asset_type === "shottimeline") {
    // WR-02: short-circuit is unconditional — if the workdir also contains
    // conventional 13-phase files (p02_outline.json etc.), they are silently
    // dropped. Surface a warn so operators know what was ignored. Only scans
    // for files the normal file→phase scanner would have picked up
    // (findPhaseFromFile matches `p0X*` prefixes); ShotTimelineAsset-native
    // files (shots.json/audio_analysis.json/...) don't match, so they don't
    // produce false-positive warns.
    try {
      const collocated = (await readdir(workdir)).filter(
        (f) => f.endsWith(".json") && f !== "asset.json" && findPhaseFromFile(f),
      );
      if (collocated.length > 0) {
        console.warn(
          `[v2/import] ShotTimelineAsset detected at ${assetManifestPath}; ` +
          `ignoring ${collocated.length} co-located phase file(s): ${collocated.join(", ")}`,
        );
      }
    } catch {
      // readdir failure (e.g. permissions race) — non-fatal; the short-circuit still applies.
    }
    phaseArtifacts.set(SHOT_TIMELINE_SENTINEL_KEY, [{
      label: manifestProbe.source?.video_filename ?? "ShotTimelineAsset",
      output_key: SHOT_TIMELINE_SENTINEL_KEY,
      extra: {
        __manifest: manifestProbe,
        __manifest_path: assetManifestPath,
      },
    }]);
    return phaseArtifacts;
  }

  // ── 1. Scan root-level JSON files ────────────────────────────
  let rootFiles: string[] = [];
  try {
    rootFiles = await readdir(workdir);
  } catch {
    // workdir not readable
  }

  for (const file of rootFiles) {
    if (!file.endsWith(".json")) continue;
    const phasePrefix = findPhaseFromFile(file);
    if (!phasePrefix) continue;

    const filePath = join(workdir, file);
    const content = await tryReadJSON(filePath);
    if (content == null) continue;

    const artifacts = extractArtifactsFromJSON(content);
    addArtifacts(phasePrefix, artifacts);
  }

  // ── 1.5. Scan root-level .txt files for script phase dirs ────
  // Phase 45 (TEXT-01): standalone .txt outputs (script.txt / prompt.txt /
  // description.txt / scene_notes.txt) become script artifacts so they have
  // a home on the canvas. Gated on canvasType === "script" so media-typed
  // phases don't pick up stray .txt files. Dedupe set is empty at this
  // scope because root-level .txt files don't collide with asset-dir
  // sidecars (different directories).
  for (const file of rootFiles) {
    if (!file.endsWith(".txt")) continue;
    const phasePrefix = findPhaseFromFile(file);
    if (!phasePrefix) continue;
    const def = PHASE_DEF_MAP[phasePrefix];
    if (!def || def.canvasType !== "script") continue;
    const outputKey = phasePrefix.replace(/[^a-zA-Z0-9_]/g, "_");
    const artifacts = await artifactsFromScriptTextFiles(
      workdir,
      [file],
      new Set<string>(),
      outputKey,
    );
    addArtifacts(phasePrefix, artifacts);
  }

  // ── 2. Scan assets/ subdirectories ───────────────────────────
  const assetsDir = join(workdir, "assets");
  let assetSubDirs: string[] = [];
  try {
    assetSubDirs = await readdir(assetsDir);
  } catch {
    // no assets dir
  }

  for (const subDir of assetSubDirs) {
    const dirPath = join(assetsDir, subDir);
    try {
      const st = await stat(dirPath);
      if (!st.isDirectory()) continue;
    } catch {
      continue;
    }

    const phasePrefix = findPhaseFromDir(subDir);
    if (!phasePrefix) continue;

    let entries: string[] = [];
    try {
      entries = await readdir(dirPath);
    } catch {
      continue;
    }

    const mediaFiles = entries.filter((f) => ALL_MEDIA_EXTS.includes(extname(f).toLowerCase()));
    if (mediaFiles.length === 0) continue;

    // Determine output_key from directory name
    const outputKey = subDir.replace(/[^a-zA-Z0-9_]/g, "_");
    const artifacts = await artifactsFromMediaFiles(dirPath, mediaFiles, outputKey);
    addArtifacts(phasePrefix, artifacts);
  }

  // ── 2b. Scan standalone media directories (not under assets/) ─
  // Handle common patterns: ref_images/, video_clips/, voice/, etc.
  for (const dirName of ["ref_images", "scene_images", "video_clips", "voice", "narration", "audio"]) {
    const dirPath = join(workdir, dirName);
    try {
      const st = await stat(dirPath);
      if (!st.isDirectory()) continue;
    } catch {
      continue;
    }

    const phasePrefix = findPhaseFromDir(dirName);
    if (!phasePrefix) continue;

    let entries: string[] = [];
    try {
      entries = await readdir(dirPath);
    } catch {
      continue;
    }

    const mediaFiles = entries.filter((f) => ALL_MEDIA_EXTS.includes(extname(f).toLowerCase()));
    if (mediaFiles.length === 0) continue;

    const artifacts = await artifactsFromMediaFiles(dirPath, mediaFiles, dirName);
    addArtifacts(phasePrefix, artifacts);
  }

  // ── 3. Scan output/ directory for final videos ───────────────
  const outputDir = join(workdir, "output");
  let outputFiles: string[] = [];
  try {
    outputFiles = await readdir(outputDir);
  } catch {
    // no output dir
  }

  const videoOutputs = outputFiles.filter((f) => f.endsWith(".mp4"));
  if (videoOutputs.length > 0) {
    const artifacts = await artifactsFromMediaFiles(outputDir, videoOutputs, "final_video");
    addArtifacts("p12", artifacts);
  }

  return phaseArtifacts;
}

// ═══════════════════════════════════════════════════════════════════════
// CROSS-PHASE ENRICHMENT — merge JSON params into media-file artifacts
// ═══════════════════════════════════════════════════════════════════════

/**
 * Extract a shot_id from a media filename.
 * "S1-shot1.mp4" → "S1-shot1"
 * "S3_scene.png" → "S3" (scene-level)
 * "S9_narrator.mp3" → "S9"
 */
function shotIdFromFilename(filename: string): string | null {
  const base = basename(filename, extname(filename));
  // Match patterns like S1-shot1, S12-shot3
  const shotMatch = base.match(/^(S\d+-shot\d+)$/i);
  if (shotMatch) return shotMatch[1].toUpperCase();
  // Match patterns like S1_scene
  const sceneMatch = base.match(/^(S\d+)/i);
  if (sceneMatch) return sceneMatch[1].toUpperCase();
  return null;
}

/**
 * Enrich media-file artifacts with structured parameters from JSON artifacts.
 *
 * For example, p11 video clips (media files) get enriched with shot_type,
 * camera_movement, ltx_prompt, era, mood, etc. from p09 shot_list (JSON).
 *
 * Matching is done by shot_id extracted from the media filename.
 */
function enrichMediaArtifactsFromJSON(
  phaseArtifacts: Map<string, RawArtifact[]>,
): void {
  // Build lookup from JSON-derived artifacts (those with extra params)
  // Key sources: p09 (storyboard shot list)
  const shotParams = new Map<string, Record<string, any>>();

  for (const [phase, arts] of phaseArtifacts.entries()) {
    for (const art of arts) {
      // JSON artifacts have structured params in .extra
      if (!art.extra) continue;

      // Look for shot_id in extra
      const sid = art.extra.shot_id as string | undefined;
      if (sid) {
        shotParams.set(String(sid).toUpperCase(), { ...art.extra, phase });
      }
    }
  }

  if (shotParams.size === 0) return;

  // Now enrich media-file artifacts
  for (const [phase, arts] of phaseArtifacts.entries()) {
    for (const art of arts) {
      // Skip artifacts that already have rich data (from JSON)
      if (art.extra && Object.keys(art.extra).length > 2) continue;

      // Extract shot_id from the label (which is usually the filename without ext)
      const sid = shotIdFromFilename(art.label);
      if (!sid) continue;

      const params = shotParams.get(sid);
      if (!params) continue;

      // Merge params into this artifact's extra
      if (!art.extra) art.extra = {};
      for (const [k, v] of Object.entries(params)) {
        if (!(k in art.extra)) {
          art.extra[k] = v;
        }
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN SCAN + BUILD — orchestrates the full tree construction
// ═══════════════════════════════════════════════════════════════════════

/**
 * Scan workdir and build the complete canvas tree structure.
 *
 * This is the main entry point that replaces the old scanWorkdir().
 * It produces the 3-level Zone → Summary → Artifact tree matching
 * the 9999 project canvas format.
 *
 * @param workdir The project working directory
 * @returns { nodes, links } ready for FlowGraphV2
 */
async function scanAndBuildTree(
  workdir: string,
): Promise<{ nodes: FlowNodeV2[]; links: FlowLinkV2[] }> {
  const allNodes: FlowNodeV2[] = [];
  const allLinks: FlowLinkV2[] = [];

  // Set up workdir → /oss/ mapping for fsToOssUrl
  // We expect a symlink: data/oss/{slug} → workdir
  const workdirBase = basename(workdir.replace(/\/$/, ""));
  _workdirToOss = { workdir, ossPrefix: `/oss/${workdirBase}` };

  // Scan workdir for artifacts grouped by phase
  const phaseArtifacts = await scanWorkdirForArtifacts(workdir);

  if (phaseArtifacts.size === 0) {
    return { nodes: [], links: [] };
  }

  // ── Enrichment: cross-phase parameter merge ─────────────────
  // Media-file artifacts (from directory scanning) often lack the structured
  // parameters that JSON artifacts have. For example, p11 video files
  // (S1-shot1.mp4) should inherit shot_type, camera_movement, ltx_prompt, etc.
  // from the p09 shot list. We match by shot_id extracted from the filename.
  enrichMediaArtifactsFromJSON(phaseArtifacts);

  // Build tree for each phase, in PHASE_DEFS order
  const activePhases: string[] = [];
  for (const def of PHASE_LANE_ORDER) {
    const artifacts = phaseArtifacts.get(def.prefix);
    if (!artifacts || artifacts.length === 0) continue;

    activePhases.push(def.prefix);
    const tree = buildPhaseTree(def.prefix, artifacts);

    allNodes.push(tree.zoneNode, tree.summaryNode);
    allNodes.push(...tree.artifactNodes);
    allLinks.push(...tree.links);
  }

  // ── Phase 3 — ShotTimelineAsset 子图合并 (CANVAS-01/02) ──────
  // extractShotTimelineArtifacts 产出 1 zone + 1 summary + N storyboard
  // + 3 audio + 1 video + sequence edges,直接 push 进 all{Nodes,Links}.
  // 位置选在 PHASE_DEFS 循环之后、buildZoneChainLinks 之前,既保证
  // _workdirToOss 已就绪(fsToOssUrl 依赖),也让子图能参与随后的
  // buildCrossReferenceLinks (更连贯).
  if (phaseArtifacts.has(SHOT_TIMELINE_SENTINEL_KEY)) {
    const meta = phaseArtifacts.get(SHOT_TIMELINE_SENTINEL_KEY)![0].extra!;
    const sub = await extractShotTimelineArtifacts(
      meta.__manifest,
      workdir,
      meta.__manifest_path,
    );
    allNodes.push(...sub.nodes);
    allLinks.push(...sub.links);
  }

  // Build zone-to-zone chain links
  const chainLinks = buildZoneChainLinks(activePhases);
  allLinks.push(...chainLinks);

  // Build cross-reference links (artifact→artifact, dataType="reference")
  const xrefLinks = buildCrossReferenceLinks(allNodes);
  allLinks.push(...xrefLinks);

  return { nodes: allNodes, links: allLinks };
}

// ═══════════════════════════════════════════════════════════════════════
// EXPRESS ROUTE
// ═══════════════════════════════════════════════════════════════════════

/**
 * POST /api/canvas/v2/import-from-dir
 *
 * 从约定的 workdir 目录结构自动扫描项目资产，创建画布节点。
 *
 * Produces a 3-level tree structure matching canvas_sync.py's output:
 *   Zone (p0X) → Summary (sum-p0X) → Artifacts (a-p0X-art{N})
 *
 * 约定目录结构：
 *   workdir/
 *     p02_outline.json       → P02 phase artifacts
 *     p04_character_bible.json → P04 phase artifacts
 *     p06_*.json             → P06 phase artifacts
 *     p09_shot_list.json     → P09 phase artifacts
 *     p10_voice_manifest.json → P10 phase artifacts
 *     p11_video_manifest.json → P11 phase artifacts
 *     assets/scene_images/   → P07 scene image artifacts
 *     assets/video_clips/    → P11 video artifacts
 *     assets/narration/      → P10 audio artifacts
 *     output/*.mp4           → P12 final video artifacts
 *     ref_images/            → P07 reference images
 *     voice/                 → P10 voice clips
 *     video_clips/           → P11 video clips
 *
 * Body: { projectId, episodesId, workdir, projectName?, mode? }
 * mode: "merge" (默认，合并到已有画布) | "replace" (替换整个画布)
 */
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    episodesId: z.number(),
    workdir: z.string().min(1),
    projectName: z.string().optional(),
    mode: z.enum(["merge", "replace"]).optional(),
  }),
  async (req, res) => {
    const { projectId, episodesId, workdir, projectName, mode = "merge" } = req.body;

    try {
      // 安全检查：workdir 必须存在且是目录
      try {
        const st = await stat(workdir);
        if (!st.isDirectory()) {
          return res.status(400).send(error("workdir 不是有效目录"));
        }
      } catch {
        return res.status(400).send(error(`workdir 不存在: ${workdir}`));
      }

      // Auto-create oss symlink: data/oss/{basename} → workdir
      // so that thumbnailUrl/filePath resolve to web-accessible /oss/ paths
      const workdirBase = basename(workdir.replace(/\/$/, ""));
      const ossDir = "/data/workspace/kais-aigc-platform/data/oss";
      const ossLinkPath = join(ossDir, workdirBase);
      try {
        const { symlink, readlink } = require("fs/promises");
        // Check if already exists
        let exists = false;
        try {
          const existing = await readlink(ossLinkPath);
          if (existing === workdir || existing === workdir.replace(/\/$/, "")) {
            exists = true;
          } else {
            // Symlink exists but points elsewhere — recreate
            await require("fs/promises").unlink(ossLinkPath);
          }
        } catch {
          // No symlink exists
        }
        if (!exists) {
          await symlink(workdir, ossLinkPath, "dir");
          console.log(`[import-from-dir] Created oss symlink: ${ossLinkPath} → ${workdir}`);
        }
      } catch (symlinkErr) {
        console.warn(`[import-from-dir] Failed to create oss symlink (non-fatal):`, (symlinkErr as Error).message);
      }

      // 扫描 workdir 并构建树
      const { nodes: newNodes, links: newLinks } = await scanAndBuildTree(workdir);

      if (newNodes.length === 0) {
        return res.status(200).send(success({ imported: 0, message: "workdir 中未找到约定的资产文件" }));
      }

      await ensureBootstrap(projectId, episodesId);

      if (mode === "replace") {
        // 全量替换模式：构建完整 FlowGraphV2
        const now = Date.now();
        const mainBranch: FlowBranchV2 = {
          id: "main",
          label: "主线",
          status: "active",
          createdAt: now,
          updatedAt: now,
        };

        const graph: FlowGraphV2 = {
          meta: {
            version: "2",
            projectId,
            episodesId,
            createdAt: now,
            updatedAt: now,
          } as any,
          nodes: newNodes,
          links: newLinks,
          branches: [mainBranch],
          variantGroups: [],
        };

        const clientId = `import-from-dir:replace:${projectId}:${episodesId}:${now}`;
        await appendAndSync({
          projectId,
          episodesId,
          clientId,
          source: "import-from-dir",
          events: [
            {
              type: "bootstrap",
              nodeId: undefined,
              payload: { graph },
            },
          ],
        });
      } else {
        // 合并模式：加载已有画布，追加新节点
        const row = await u
          .db("o_agentWorkData")
          .where("projectId", String(projectId))
          .andWhere("episodesId", String(episodesId))
          .andWhere("key", "canvasGraph")
          .first();

        let existingNodes: FlowNodeV2[] = [];
        let existingLinks: FlowLinkV2[] = [];
        const now = Date.now();

        if (row?.data) {
          const parsed = JSON.parse(row.data);
          existingNodes = parsed.nodes || [];
          existingLinks = parsed.links || [];
        }

        // 去重：如果已有同 id 节点则替换（update in place）
        const existingMap = new Map(existingNodes.map((n) => [n.id, n]));
        for (const newNode of newNodes) {
          existingMap.set(newNode.id, newNode); // overwrite or add
        }
        const mergedNodes = Array.from(existingMap.values());

        // Merge links (dedupe by id)
        const existingLinkMap = new Map(existingLinks.map((l) => [l.id, l]));
        for (const newLink of newLinks) {
          existingLinkMap.set(newLink.id, newLink);
        }
        const mergedLinks = Array.from(existingLinkMap.values());

        const mainBranch: FlowBranchV2 = {
          id: "main",
          label: "主线",
          status: "active",
          createdAt: now,
          updatedAt: now,
        };

        // 确保 meta 存在
        const existingMeta = row?.data ? JSON.parse(row.data).meta : null;

        const graph: FlowGraphV2 = {
          meta: {
            version: "2",
            projectId,
            episodesId,
            createdAt: existingMeta?.createdAt || now,
            updatedAt: now,
          } as any,
          nodes: mergedNodes,
          links: mergedLinks,
          branches: [mainBranch],
          variantGroups: [],
        };

        const clientId = `import-from-dir:merge:${projectId}:${episodesId}:${now}`;
        await appendAndSync({
          projectId,
          episodesId,
          clientId,
          source: "import-from-dir",
          events: [
            {
              type: "bootstrap",
              nodeId: undefined,
              payload: { graph },
            },
          ],
        });
      }

      // ── Relational materialization ────────────────────────────────────
      // load-v2（画布 UI 读取路径）直接 SELECT canvas_nodes/canvas_links，
      // 不 replay kv_canvasEvent。缺这段时导入的图只落在 event store +
      // o_agentWorkData snapshot，画布渲染为空（写/读路径分家，2026-08-19
      // ep02 逆向事故根因）。replace 语义 = 先清 scope 再 upsert；merge 语义
      // = 仅 upsert 新节点（与上方 merge 去重口径一致）。失败非致命：
      // event store 仍是权威源，loud log。
      try {
        const scope = { projectId, episodesId };
        if (mode === "replace") {
          await db.raw("DELETE FROM canvas_nodes WHERE project_id = ? AND episodes_id = ?", [projectId, episodesId]);
          await db.raw("DELETE FROM canvas_links WHERE project_id = ? AND episodes_id = ?", [projectId, episodesId]);
        }
        for (const nd of newNodes) await upsertNode(scope, nd);
        for (const lk of newLinks) await upsertLink(scope, lk);
        await upsertBranch(scope, {
          id: "main",
          label: "主线",
          status: "active",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        console.log(`[import-from-dir] materialized ${newNodes.length} nodes / ${newLinks.length} links into canvas_nodes/canvas_links (mode=${mode})`);
      } catch (matErr) {
        console.error("[import-from-dir] relational materialization failed (non-fatal):", (matErr as Error).message);
      }

      broadcastToProject(projectId, "graph:saved", { projectId, episodesId, timestamp: Date.now(), source: "import-from-dir" });

      // Count artifacts (exclude zones and summaries)
      const artifactCount = newNodes.filter((n) => n.id.startsWith("a-")).length;
      const phaseCount = new Set(
        newNodes.filter((n) => n.id.startsWith("a-")).map((n) => n.id.split("-")[1])
      ).size;

      return res.status(200).send(success({
        imported: newNodes.length,
        links: newLinks.length,
        artifacts: artifactCount,
        phases: phaseCount,
        mode,
        workdir,
      }));
    } catch (err) {
      console.error("[v2/canvas/import-from-dir] 导入失败:", err);
      return res.status(500).send(error(`导入失败: ${(err as Error).message}`));
    }
  },
);
