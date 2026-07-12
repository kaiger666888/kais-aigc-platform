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
import { broadcastToProject } from "@/utils/ws";
import u from "@/utils";
import { SCHEMA_ALIASES, ENUM_NORMALIZERS } from "../../../../schema/generated/frontend-enum-normalizers";

const router = express.Router();

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
// Ordered list: (prefix, label, canvasType, assetType, phaseGroup)

interface PhaseDef {
  prefix: string;
  label: string;
  canvasType: string;   // "script" | "asset" | "storyboard" | "audio" | "video"
  assetType: string;    // "topic" | "outline" | "character" | "scene" | etc.
  phaseGroup: string;   // "research" | "story" | "production" | "post"
}

const PHASE_DEFS: PhaseDef[] = [
  { prefix: "p01", label: "P01 · 选题+钩子",      canvasType: "script",     assetType: "topic",          phaseGroup: "research" },
  { prefix: "p02", label: "P02 · 大纲",            canvasType: "script",     assetType: "outline",        phaseGroup: "research" },
  { prefix: "p03", label: "P03 · 剧本+审计",       canvasType: "script",     assetType: "script_phase",   phaseGroup: "story" },
  { prefix: "p04", label: "P04 · 角色设计",        canvasType: "asset",      assetType: "character",      phaseGroup: "story" },
  { prefix: "p05", label: "P05 · 痛点发现",        canvasType: "script",     assetType: "script_phase",   phaseGroup: "story" },
  { prefix: "p06", label: "P06 · 运镜+终审",       canvasType: "script",     assetType: "script_phase",   phaseGroup: "production" },
  { prefix: "p07", label: "P07 · 视觉+风格化",     canvasType: "asset",      assetType: "scene",          phaseGroup: "production" },
  { prefix: "p08", label: "P08 · 场景选择",        canvasType: "asset",      assetType: "scene",          phaseGroup: "production" },
  { prefix: "p09", label: "P09 · 分镜拆解",        canvasType: "storyboard", assetType: "storyboard",     phaseGroup: "production" },
  { prefix: "p10", label: "P10 · 语音",            canvasType: "audio",      assetType: "voice",          phaseGroup: "post" },
  { prefix: "p11", label: "P11 · 视频渲染",        canvasType: "video",      assetType: "video",          phaseGroup: "post" },
  { prefix: "p12", label: "P12 · 合成",            canvasType: "video",      assetType: "clip",           phaseGroup: "post" },
  { prefix: "p13", label: "P13 · 交付",            canvasType: "video",      assetType: "delivery",       phaseGroup: "post" },
];

// Quick lookup: prefix → PhaseDef
const PHASE_DEF_MAP: Record<string, PhaseDef> = Object.fromEntries(
  PHASE_DEFS.map((p) => [p.prefix, p])
);

// ─── File → Phase mapping ──────────────────────────────────────────────
// Maps JSON filename prefix → phase prefix.
// Uses longest-prefix match so "p06_input_shots" maps to "p06".

const FILE_TO_PHASE: Array<{ filePrefix: string; phasePrefix: string }> = [
  { filePrefix: "p01", phasePrefix: "p01" },
  { filePrefix: "p02", phasePrefix: "p02" },
  { filePrefix: "p03", phasePrefix: "p03" },
  { filePrefix: "p04", phasePrefix: "p04" },
  { filePrefix: "p05", phasePrefix: "p05" },
  { filePrefix: "p06", phasePrefix: "p06" },
  { filePrefix: "p07", phasePrefix: "p07" },
  { filePrefix: "p08", phasePrefix: "p08" },
  { filePrefix: "p09", phasePrefix: "p09" },
  { filePrefix: "p10_voice", phasePrefix: "p10" },
  { filePrefix: "p10", phasePrefix: "p10" },
  { filePrefix: "p11_video", phasePrefix: "p11" },
  { filePrefix: "p11_prompt", phasePrefix: "p11" },
  { filePrefix: "p11", phasePrefix: "p11" },
  { filePrefix: "p12", phasePrefix: "p12" },
  { filePrefix: "p13", phasePrefix: "p13" },
];

// ─── Asset directory → Phase mapping ───────────────────────────────────

const ASSET_DIR_TO_PHASE: Array<{ dirPrefix: string; phasePrefix: string }> = [
  { dirPrefix: "scene_images", phasePrefix: "p07" },
  { dirPrefix: "S07",          phasePrefix: "p07" },
  { dirPrefix: "ref_images",   phasePrefix: "p07" },
  { dirPrefix: "video_clips",  phasePrefix: "p11" },
  { dirPrefix: "P11",          phasePrefix: "p11" },
  { dirPrefix: "narration",    phasePrefix: "p10" },
  { dirPrefix: "audio",        phasePrefix: "p10" },
  { dirPrefix: "voice",        phasePrefix: "p10" },
  { dirPrefix: "P12_composite",phasePrefix: "p12" },
  { dirPrefix: "output",       phasePrefix: "p12" },
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
  if (item.params && typeof item.params === "object" && !Array.isArray(item.params)) {
    for (const [pk, pv] of Object.entries(item.params as Record<string, unknown>)) {
      if (pv == null) continue;
      if (typeof pv === "string" || typeof pv === "number" || typeof pv === "boolean") {
        if (!(pk in extra)) extra[pk] = pv;
      }
    }
  }

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
        const trimmed = raw.trim().slice(0, 500);
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

  // Determine the lane index (0-based) from PHASE_DEFS order
  const laneIndex = PHASE_DEFS.findIndex((p) => p.prefix === phasePrefix);
  const baseX = laneIndex * ZONE_X_STEP;

  const nodes: FlowNodeV2[] = [];
  const links: FlowLinkV2[] = [];

  // ── 1. Zone node ─────────────────────────────────────────────
  const zoneNode: FlowNodeV2 = {
    id: phasePrefix,
    type: "zone" as any,  // "zone" is valid in schema but not in TS NodeType union
    branchId: "main",
    phaseIndex: laneIndex + 1,
    phaseName: def.label,
    position: { x: baseX, y: 0 },
    size: { width: ZONE_WIDTH, height: ZONE_HEIGHT },
    state: "success",
    data: {
      label: def.label,
      phase: def.phaseGroup,
      state: "success",
    },
  };
  nodes.push(zoneNode);

  // ── 2. Summary node ──────────────────────────────────────────
  const summaryNode: FlowNodeV2 = {
    id: `sum-${phasePrefix}`,
    type: def.canvasType as any,
    branchId: "main",
    phaseIndex: laneIndex + 1,
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
      type: def.canvasType as any,
      branchId: "main",
      phaseIndex: laneIndex + 1,
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
  for (const def of PHASE_DEFS) {
    const artifacts = phaseArtifacts.get(def.prefix);
    if (!artifacts || artifacts.length === 0) continue;

    activePhases.push(def.prefix);
    const tree = buildPhaseTree(def.prefix, artifacts);

    allNodes.push(tree.zoneNode, tree.summaryNode);
    allNodes.push(...tree.artifactNodes);
    allLinks.push(...tree.links);
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
