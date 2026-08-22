/**
 * SkillManifest Contract — TypeScript Interface
 *
 * CONTRACT-06 (descriptive only): This interface declares the SHAPE of a Skill
 * Manifest. It contains no methods, no functions, and no executable behavior.
 * Behavior lives platform-side (see src/skills/registry.ts in Phase 29+).
 *
 * This is the single source of truth for "what a Skill Manifest is." Every
 * downstream phase (29+) imports from this file:
 *   - Phase 29 (registry/loader) imports the type for its cache.
 *   - Phase 30 (REST API) imports the type for response shaping.
 *   - Phase 31 (callback refactor) imports PhaseDecl for phase-complete lookups.
 *   - Phase 33 (negative tests) imports ManifestValidationError.ruleId literals.
 *
 * Field naming convention: ALL fields use snake_case to match
 *   (a) Python skill-author conventions (kais-hermes-skills / OpenClaw skills),
 *   (b) the JSON wire format skills submit at registration time.
 *
 * Versioning semantics (per CONTEXT.md):
 *   - `version` is a `major.minor` string (no patch). Examples: "1.0", "2.5".
 *   - Platform runtime accepts any `1.x` manifest (major must match platform major).
 *   - Minor bump = strictly additive (only OPTIONAL fields with safe defaults).
 *   - Major bump = breaking change (required-field add/remove, type changes, enum narrowing).
 *
 * Source of truth for field shapes: research/ARCHITECTURE.md lines 142-185.
 * This file TRANSLATES that sketch into TypeScript; it does not redesign it.
 */

// ---------------------------------------------------------------------------
// Primitive type aliases
// ---------------------------------------------------------------------------

/**
 * Media types the platform reads today. Do not invent new media types — the
 * four values below are the union the platform's asset + engine layer actually
 * handles. Adding a new media type is a MAJOR contract bump.
 */
export type MediaType = "video" | "image" | "audio" | "3d";

/**
 * The five platform primitive renderers (ARCHITECTURE.md AP-4). Skills select
 * one of these via NodeTypeDecl.default_renderer. A literal `'custom'` value
 * is deliberately NOT included — custom HTTP renderers are deferred to v1.7+
 * (cross-bundle dynamic React loading is brittle; the 80% need is covered by
 * these five built-ins).
 */
export type BuiltinRenderer = "script" | "asset" | "storyboard" | "video" | "audio";

/**
 * Output categories a phase can route into the ingest pipeline. Populated from
 * the skill manifest's phase_taxonomy at registration time (e.g.,
 * "art-direction" → ["images"], "storyboard" → ["storyboard"], "scenario" →
 * []). The "none" sentinel replaces the empty array case so that the absence
 * of ingestion is itself a declared value (manifest is descriptive — see
 * Pitfalls A4).
 */
export type IngestOutput = "images" | "videos" | "storyboard" | "audio" | "none";

// ---------------------------------------------------------------------------
// Sub-type interfaces
// ---------------------------------------------------------------------------

/**
 * Declares a canvas node type that a skill contributes.
 *
 * The `type` field is the namespaced identifier `<skill_id>::<type>` (e.g.,
 * `'movie-v1::script'`). The validator enforces the format via a regex refine
 * (NODE_ID_NAMESPACING rule). The TypeScript type stays `string` for
 * forward-compat with future skill_id conventions; the contract is enforced at
 * validation time, not at type-compile time.
 *
 * `default_renderer` selects one of the five BuiltinRenderer primitives the
 * canvas bundle ships. There is no `'custom'` option in v1.6 (see BuiltinRenderer).
 *
 * Per ARCHITECTURE.md AP-4, custom_renderer_url is intentionally ABSENT from
 * this interface for v1.6 — custom HTTP renderers are a v1.7+ concern.
 */
export interface NodeTypeDecl {
  type: string;
  label: string;
  icon: string;
  color: string;
  data_schema_uri: string;
  default_renderer: BuiltinRenderer;
}

/**
 * Declares one phase in a skill's pipeline taxonomy. Populated from the skill
 * manifest's phase_taxonomy at registration time — `order`, `requires_review`,
 * and `ingest_outputs` are the per-phase fields the platform reads to react to
 * phase events.
 *
 * The platform uses this as DESCRIPTIVE METADATA to react to phase events
 * (e.g., "for phase X of skill Y, is review required?"). The platform does
 * NOT drive phase progression — the skill orchestrator decides which phase
 * runs next (see ARCHITECTURE.md Q4).
 */
export interface PhaseDecl {
  id: string;
  order: number;
  label: string;
  requires_review: boolean;
  /**
   * Real review-gate id for phases that gate on human review, in the platform
   * gate-catalog derivedGateId form (e.g. `'p03-gate'` — see
   * src/lib/gateCatalog.ts, Phase 54). Empty string or absent for gate-less
   * phases. Machine-readable (Phase 57 D-15): the value is aligned with the
   * platform gate snapshot, not hand-written by skill authors. OPTIONAL so
   * pre-57 manifests without the key still load (Research Pitfall 10).
   */
  review_gate?: string;
  ingest_outputs: IngestOutput[];
}

/**
 * Declares an asset category a skill owns (e.g., "character-image",
 * "voice-sample"). Kept minimal for v1.6 — ARCHITECTURE.md lists
 * `asset_categories[]` as a manifest field but does not fully specify its
 * inner shape, so CONTEXT.md "Claude's Discretion" applies. The id+label
 * pair is the minimal useful shape; additional fields are v1.7+.
 */
export interface AssetCategoryDecl {
  id: string;
  label: string;
}

/**
 * Declares the review-scoring policy a skill uses. ARCHITECTURE.md line 154
 * mentions "scoring dimensions + auto/human thresholds"; this is the minimal
 * shape that carries the two numbers the platform's review-result callback
 * needs to gate auto-accept vs human-queue routing. Additional dimensions
 * are v1.7+.
 */
export interface ReviewCriteriaDecl {
  auto_threshold: number;
  human_threshold: number;
}

/**
 * Describes how the platform talks to the live skill orchestrator.
 *
 * Per ARCHITECTURE.md Q6, this field is INFORMATIONAL — the platform does not
 * dispatch to skills via this config. It exists so the UI can display the
 * skill's endpoint and so the platform can perform an optional healthcheck.
 * The actual skill→platform communication path is the existing callback
 * protocol (POST /api/v1/pipeline/callback/*), which is unaffected by this
 * declaration.
 *
 * The `type` field is a literal union, not `string` — the platform's boot
 * loader branches on this to decide whether a healthcheck is meaningful.
 */
export interface SkillRuntimeDecl {
  type: "external-http" | "in-process";
  endpoint?: string;
  healthcheck_path?: string;
  callback_url_template?: string;
}

// ---------------------------------------------------------------------------
// Root manifest interface
// ---------------------------------------------------------------------------

/**
 * The root Skill Manifest contract surface (CONTRACT-01).
 *
 * Every field below is a value the platform ACTUALLY READS today (Phase 28
 * Pitfall A1 — manifest schema bloat). No hypothetical fields. Reserved
 * future-use fields belong in a separate "Reserved" section of the spec doc,
 * not in this interface.
 *
 * Field-by-field provenance:
 *   - skill_id:        registry primary lookup key (Phase 29 o_skillRegistry)
 *   - version:         major.minor format — validator enforces (MANIFEST_VERSION_FORMAT)
 *   - display_name:    UI label
 *   - description:     UI tooltip / docs
 *   - media_types:     what this skill produces (subset of MediaType)
 *   - node_types:      canvas node types this skill contributes (Phase 32)
 *   - phase_taxonomy:  ordered pipeline phases (Phase 31 callback refactor)
 *   - asset_categories:what kinds of assets this skill owns (Phase 29 schema)
 *   - review_criteria: auto/human thresholds (review-result callback)
 *   - engine_task_types: subset of gold-team TaskType enum this skill uses
 *                        (kept as string[] because TaskType lives in another repo)
 *   - runtime:         how the platform talks to the orchestrator (informational)
 */
export interface SkillManifest {
  skill_id: string;
  version: string;
  display_name: string;
  description: string;
  media_types: MediaType[];
  node_types: NodeTypeDecl[];
  phase_taxonomy: PhaseDecl[];
  asset_categories: AssetCategoryDecl[];
  review_criteria: ReviewCriteriaDecl;
  engine_task_types: string[];
  runtime: SkillRuntimeDecl;
}

// ---------------------------------------------------------------------------
// Validation error contract (lives HERE, not in validator.ts, so downstream
// phases and Phase 33 negative tests import from one canonical place)
// ---------------------------------------------------------------------------

/**
 * The SCREAMING_SNAKE rule IDs the validator emits. These are stable strings
 * that Phase 33's negative tests assert against (e.g.,
 * `expect(error.ruleId).toBe('NODE_ID_NAMESPACING')`). Adding a new ruleId
 * is a minor contract bump (additive); CHANGING an existing ruleId is a
 * major contract bump.
 */
export type ManifestValidationRuleId =
  | "MANIFEST_REQUIRED_FIELD"
  | "MANIFEST_TYPE_MISMATCH"
  | "MANIFEST_VERSION_FORMAT"
  | "NODE_ID_NAMESPACING"
  | "MANIFEST_UNKNOWN_FIELD";

/**
 * A single structured validation error. Produced by validateManifest() in
 * validator.ts and consumed by:
 *   - Phase 30 REST API (formatted into the HTTP error response)
 *   - Phase 33 negative tests (asserted via ruleId)
 *
 * `raw` carries the underlying zod issue object. It is typed as `unknown`
 * here so contract.ts does NOT need to import zod — contract.ts is a pure
 * data-shape module (CONTRACT-06). validator.ts populates `raw` with the
 * actual zod issue; consumers treat it as opaque.
 */
export interface ManifestValidationError {
  ruleId: ManifestValidationRuleId;
  field: string;
  message: string;
  raw: unknown;
}

/**
 * The discriminated union returned by validateManifest(). Callers branch on
 * `.ok`:
 *   - `ok: true`  → `.value` is the parsed SkillManifest
 *   - `ok: false` → `.errors` is the ManifestValidationError[] array
 *
 * validateManifest() NEVER throws — it always returns one branch of this
 * union (see validator.ts).
 */
export type ManifestValidationResult =
  | { ok: true; value: SkillManifest }
  | { ok: false; errors: ManifestValidationError[] };
