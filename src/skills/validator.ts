/**
 * SkillManifest Validator — zod v4 schema + validateManifest()
 *
 * This module mirrors src/skills/contract.ts field-for-field in a zod schema
 * and exposes validateManifest(), which returns a discriminated union:
 *   - { ok: true,  value: SkillManifest }
 *   - { ok: false, errors: ManifestValidationError[] }
 *
 * Design decisions (locked in CONTEXT.md):
 *
 * 1. STRICT MODE on root + every nested object (.strict()) — unknown keys are
 *    rejected at any depth. This catches typos and undocumented experimental
 *    fields. Maps to ruleId MANIFEST_UNKNOWN_FIELD.
 *
 * 2. Two custom invariants encoded as .superRefine() rules:
 *    - MANIFEST_VERSION_FORMAT: version must match ^\d+\.\d+$ (major.minor,
 *      no patch, no leading 'v'). Examples: '1.0' ok, '2.5' ok, '1.0.0' bad,
 *      'v1' bad.
 *    - NODE_ID_NAMESPACING: every node_types[i].type must match
 *      ^[a-z0-9-]+::[a-z0-9-]+$ (lowercase, hyphens, double-colon separator).
 *      Rejects bare IDs like 'script' (Pitfalls A3).
 *
 * 3. Three ruleIds are produced by REMAPPING zod's built-in error codes to our
 *    SCREAMING_SNAKE vocabulary (NOT by .refine — let zod detect, then translate):
 *    - MANIFEST_REQUIRED_FIELD  ← zod 'invalid_type' issue where input was undefined
 *    - MANIFEST_TYPE_MISMATCH   ← zod 'invalid_type' issue where input was present but wrong type
 *    - MANIFEST_UNKNOWN_FIELD   ← zod 'unrecognized_keys' issue (.strict)
 *
 * 4. validateManifest() NEVER throws — it always returns one branch of the
 *    ManifestValidationResult union. Callers (Phase 30 REST API) branch on .ok.
 *
 * This file imports ONLY types from ./contract (no runtime dependency on
 * contract.ts — it's a pure data-shape module with zero runtime code).
 */
import { z } from "zod";
import type {
  SkillManifest,
  ManifestValidationError,
  ManifestValidationResult,
  ManifestValidationRuleId,
} from "./contract";

// ---------------------------------------------------------------------------
// Sub-schemas (mirror contract.ts sub-interfaces; .strict() on every object)
// ---------------------------------------------------------------------------

const mediaTypeSchema = z.enum(["video", "image", "audio", "3d"]);

const nodeTypeDeclSchema = z
  .object({
    type: z.string().min(1),
    label: z.string(),
    icon: z.string(),
    color: z.string(),
    data_schema_uri: z.string(),
    default_renderer: z.enum(["script", "asset", "storyboard", "video", "audio"]),
  })
  .strict();

const phaseDeclSchema = z
  .object({
    id: z.string().min(1),
    order: z.number().int().min(0),
    label: z.string(),
    requires_review: z.boolean(),
    // Phase 57-07 (D-15): real review-gate id (gateCatalog derivedGateId form,
    // e.g. 'p03-gate'); empty/absent for gate-less phases. Optional so pre-57
    // manifests without the key still load (Pitfall 10). .strict() below now
    // whitelists this key.
    review_gate: z.string().optional(),
    ingest_outputs: z.array(z.enum(["images", "videos", "storyboard", "audio", "none"])),
  })
  .strict();

const assetCategoryDeclSchema = z
  .object({
    id: z.string(),
    label: z.string(),
  })
  .strict();

const reviewCriteriaDeclSchema = z
  .object({
    auto_threshold: z.number(),
    human_threshold: z.number(),
  })
  .strict();

const skillRuntimeDeclSchema = z
  .object({
    type: z.enum(["external-http", "in-process"]),
    endpoint: z.string().optional(),
    healthcheck_path: z.string().optional(),
    callback_url_template: z.string().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Root schema (.strict() — unknown top-level keys rejected)
// ---------------------------------------------------------------------------

export const manifestSchema = z
  .object({
    skill_id: z.string().min(1),
    version: z.string().min(1),
    display_name: z.string(),
    description: z.string(),
    media_types: z.array(mediaTypeSchema),
    node_types: z.array(nodeTypeDeclSchema),
    phase_taxonomy: z.array(phaseDeclSchema),
    asset_categories: z.array(assetCategoryDeclSchema),
    review_criteria: reviewCriteriaDeclSchema,
    engine_task_types: z.array(z.string()),
    runtime: skillRuntimeDeclSchema,
  })
  .strict()
  .superRefine((manifest, ctx) => {
    // INVARIANT 1: version format ^\d+\.\d+$ (major.minor, no patch, no 'v' prefix)
    if (!/^\d+\.\d+$/.test(manifest.version)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["version"],
        message: `Version '${manifest.version}' must be in major.minor format (e.g. '1.0'). No patch segment, no leading 'v'.`,
        params: { ruleId: "MANIFEST_VERSION_FORMAT" as ManifestValidationRuleId },
      });
    }

    // INVARIANT 2: every node type id is namespaced <skill_id>::<type>
    const namespacedRe = /^[a-z0-9-]+::[a-z0-9-]+$/;
    manifest.node_types.forEach((nt, i) => {
      if (!namespacedRe.test(nt.type)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["node_types", i, "type"],
          message: `Node type '${nt.type}' is missing the required '<skill_id>::<type>' namespace prefix (lowercase, hyphens, double-colon separator).`,
          params: { ruleId: "NODE_ID_NAMESPACING" as ManifestValidationRuleId },
        });
      }
    });
  });

// ---------------------------------------------------------------------------
// Error mapping (zod issues → ManifestValidationError[])
// ---------------------------------------------------------------------------

/**
 * Paths that have a custom .superRefine failure. Used to recover the
 * SCREAMING_SNAKE ruleId from the issue's `params.ruleId`. We key on the
 * zod issue path joined as a dotted string so a single lookup resolves it.
 */
function extractRefineRuleId(issue: z.ZodIssue): ManifestValidationRuleId | undefined {
  const params = (issue as { params?: { ruleId?: string } }).params;
  if (params && typeof params.ruleId === "string") {
    return params.ruleId as ManifestValidationRuleId;
  }
  return undefined;
}

/**
 * Convert a zod issue path (array of string|number|symbol) into a dotted
 * human-readable field path. e.g. ['node_types', 0, 'type'] → 'node_types[0].type'.
 * Root-level issues → 'root'.
 */
function formatPath(path: (string | number | symbol)[]): string {
  if (!path || path.length === 0) return "root";
  return path
    .map((seg, i) => {
      if (typeof seg === "number") return `[${seg}]`;
      return i === 0 ? String(seg) : `.${String(seg)}`;
    })
    .join("")
    .replace(/\.\[/g, "[");
}

/**
 * Map a zod built-in issue to one of the three structural ruleIds:
 *   - MANIFEST_REQUIRED_FIELD  — missing required field (undefined input)
 *   - MANIFEST_TYPE_MISMATCH   — wrong type (field present, value wrong type)
 *   - MANIFEST_UNKNOWN_FIELD   — .strict() rejected an unknown key
 *
 * Returns undefined if the issue is neither (e.g., it's a custom refine issue
 * handled separately by extractRefineRuleId).
 */
function mapStructuralRuleId(issue: z.ZodIssue): ManifestValidationRuleId | undefined {
  // zod v4 'unrecognized_keys' code (emitted by .strict())
  // In zod v4 the code constant is the string 'unrecognized_keys'.
  if (issue.code === "unrecognized_keys") {
    return "MANIFEST_UNKNOWN_FIELD";
  }

  // zod 'invalid_type' covers BOTH missing-required and wrong-type.
  // Distinguish using BOTH the structured `received` field (when present) AND
  // the message text: zod v4 phrases missing-required as
  // "Invalid input: expected <T>, received undefined" and embeds `received`
  // in the message string rather than always as a structured field.
  if (issue.code === "invalid_type") {
    const received = (issue as { received?: string }).received;
    const msg = (issue.message || "");
    if (received === "undefined" || msg.includes("received undefined")) {
      return "MANIFEST_REQUIRED_FIELD";
    }
    return "MANIFEST_TYPE_MISMATCH";
  }

  return undefined;
}

/**
 * Translate a zod error into the structured ManifestValidationError[] array.
 * Each zod issue becomes one error. Custom refine issues keep their SCREAMING_SNAKE
 * ruleId; structural issues get remapped.
 */
function mapZodError(zodError: z.ZodError): ManifestValidationError[] {
  return zodError.issues.map((issue): ManifestValidationError => {
    const field = formatPath(issue.path);

    // Custom refine rules carry their ruleId in params — check first.
    const refineRuleId = extractRefineRuleId(issue);
    if (refineRuleId) {
      return {
        ruleId: refineRuleId,
        field,
        message: issue.message,
        raw: issue as unknown,
      };
    }

    // Structural zod errors → remap to our vocabulary.
    const structuralRuleId = mapStructuralRuleId(issue);
    if (structuralRuleId) {
      // For unrecognized keys, zod puts the key names in issue.keys[]; surface them.
      let message = issue.message;
      if (structuralRuleId === "MANIFEST_UNKNOWN_FIELD") {
        const keys = (issue as { keys?: string[] }).keys;
        if (keys && keys.length > 0) {
          message = `Unknown field(s): ${keys.join(", ")}. Manifest uses strict mode — declare every field.`;
        }
      }
      return {
        ruleId: structuralRuleId,
        field,
        message,
        raw: issue as unknown,
      };
    }

    // Fallback for any other zod issue code we don't explicitly remap.
    // Default to TYPE_MISMATCH as the closest semantic match (the issue is
    // almost always a structural validation failure).
    return {
      ruleId: "MANIFEST_TYPE_MISMATCH",
      field,
      message: issue.message,
      raw: issue as unknown,
    };
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate an untrusted manifest blob against the SkillManifest contract.
 *
 * @param input - fully untrusted; typed as `unknown` (no `any` passthrough — T-28-01).
 * @returns discriminated union:
 *   - { ok: true,  value: SkillManifest } on success
 *   - { ok: false, errors: ManifestValidationError[] } on failure
 *
 * NEVER throws. Callers branch on `.ok`.
 */
export function validateManifest(input: unknown): ManifestValidationResult {
  const result = manifestSchema.safeParse(input);
  if (result.success) {
    return { ok: true, value: result.data as SkillManifest };
  }
  return { ok: false, errors: mapZodError(result.error) };
}
