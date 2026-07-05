/**
 * canvasAssetSchema.ts — Mandatory structured params per asset node type.
 *
 * Each asset-producing phase MUST emit these params. The save-v2 and nodes
 * routes validate against these schemas and REJECT (HTTP 400) any asset
 * node that is missing required fields.
 *
 * This enforces the "structured params are mandatory, not optional" contract.
 *
 * Schema keys mirror the manifest params written by pipeline phases
 * (see _manifest.py → write_manifest → params dict).
 */

import { z } from "zod";

// ─── Universal required fields (all media-bearing nodes) ──────────

const universalRequired = {
  filePath: z.string().min(1, "filePath is required for media nodes"),
};

// ─── Per-type param schemas ───────────────────────────────────────
//
// These are the STRUCTURED PARAMS stored in node.data (not columns).
// The pipeline MUST fill them. Missing → HTTP 400.

export const assetDataSchemas: Record<string, z.ZodSchema> = {
  // ── Audio nodes (P10 voice, P10b bgm/sfx, P12 audio_stems) ──
  audio: z.object({
    ...universalRequired,
    shot_id: z.string().min(1, "audio node requires shot_id"),
    engine: z.string().min(1, "audio node requires engine (e.g. ChatTTS)"),
    duration_sec: z.number().positive("audio node requires duration_sec > 0"),
    // Optional but expected:
    emotion: z.string().optional(),
    speaker: z.string().optional(),
    text: z.string().optional(),
    clip_type: z.string().optional(),
  }),

  // ── Video nodes (P11 video_render, P12 master, P13 delivery) ──
  video: z.object({
    ...universalRequired,
    shot_id: z.string().min(1, "video node requires shot_id"),
    engine: z.string().min(1, "video node requires engine (e.g. ltx)"),
    duration_sec: z.number().positive("video node requires duration_sec > 0"),
    resolution: z.string().min(1, "video node requires resolution (e.g. 1280x704)"),
    // Optional but expected:
    codec: z.string().optional(),
    murch_grade: z.string().optional(),
    thumbnailUrl: z.string().optional(),
  }),

  // ── Asset nodes (P04 character, P07 scene) ──
  asset: z.object({
    ...universalRequired,
    // P04 character turnaround
    // P07 scene image
    label: z.string().min(1, "asset node requires label"),
    // At least one of these must identify what kind of asset it is
    assetType: z.string().min(1, "asset node requires assetType (character|scene|prop)"),
    // Optional structured params:
    scene_id: z.string().optional(),
    views: z.array(z.string()).optional(),
    style_vector: z.string().optional(),
    turnaround_path: z.string().optional(),
  }),

  // ── Storyboard nodes (P09 shot_breakdown) ──
  storyboard: z.object({
    label: z.string().min(1, "storyboard node requires label"),
    shot_id: z.string().min(1, "storyboard node requires shot_id"),
    shot_type: z.string().min(1, "storyboard requires shot_type (e.g. WS, CU)"),
    duration_sec: z.number().positive("storyboard requires duration_sec > 0"),
    // The storyboard may not have a rendered image yet (pre-production)
    filePath: z.string().optional(),
    // Optional but expected structured params:
    axis_line: z.string().optional(),
    camera_movement: z.string().optional(),
    emotion: z.string().optional(),
    ltx_prompt: z.string().optional(),
    scene_ref: z.string().optional(),
  }),

  // ── Script nodes (P01-P06, P13 delivery) ──
  // Script nodes carry text content, not media. They require a description.
  script: z.object({
    label: z.string().min(1, "script node requires label"),
    description: z.string().min(1, "script node requires description"),
    // Optional:
    assetType: z.string().optional(),
    filePath: z.string().optional(),
    score: z.any().optional(),
    content: z.string().optional(),
  }),
};

// Types that are structural (zones, phases) — no required params
const structuralTypes = new Set(["zone", "phase", "suggestion", "reference"]);

// Types that are optional metadata — no required params
const optionalTypes = new Set(["3d", "variant", "upscale", "face_restore"]);

/**
 * Validate a node's data against its type-specific schema.
 *
 * Returns null if valid, or an error message string if invalid.
 * Structural types (zone, phase) and optional types always pass.
 */
export function validateNodeData(
  nodeType: string,
  data: Record<string, any>,
): string | null {
  // Structural nodes — no validation needed
  if (structuralTypes.has(nodeType) || optionalTypes.has(nodeType)) {
    return null;
  }

  const schema = assetDataSchemas[nodeType];
  if (!schema) {
    // Unknown type — allow but warn
    return null;
  }

  const result = schema.safeParse(data);
  if (result.success) {
    return null;
  }

  // Format errors
  const messages = result.error.issues.map(
    (issue: any) => `${issue.path.join(".")}: ${issue.message}`,
  );
  return messages.join("; ");
}

/**
 * Validate all nodes in a graph. Returns array of errors (empty if all valid).
 * Only validates nodes that have a type-specific schema.
 */
export function validateGraphNodes(
  nodes: Array<{ type: string; id: string; data: Record<string, any> }>,
): Array<{ nodeId: string; errors: string }> {
  const errors: Array<{ nodeId: string; errors: string }> = [];

  for (const node of nodes) {
    const err = validateNodeData(node.type, node.data || {});
    if (err) {
      errors.push({ nodeId: node.id, errors: err });
    }
  }

  return errors;
}
