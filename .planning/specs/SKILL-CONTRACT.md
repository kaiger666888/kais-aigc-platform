# Skill Manifest Contract

This document is the **human-readable single source of truth** for the Skill
Manifest contract introduced in v1.6. It is the companion to two code files
that together encode the contract mechanically:

- `src/skills/contract.ts` — the TypeScript interface (`SkillManifest` plus its
  sub-interfaces) consumed by the platform's type system.
- `src/skills/validator.ts` — the zod v4 schema and the `validateManifest()`
  function that parses a manifest blob and returns a structured result.

A Skill Manifest is a **declarative data document** that an external skill
orchestrator (for example `kais-movie-agent` running in OpenClaw) submits to the
platform once at registration time. The platform reads the manifest as
metadata to dispatch canvas node types, pipeline phases, asset categories, and
review thresholds. The manifest never carries behavior — see Invariant 1.

This spec is **hand-written** (not auto-generated from zod) so it preserves
explanatory prose for skill authors. A field-equality drift test
(`src/skills/__tests__/contract.test.ts`) mechanically asserts that this doc
and the zod schema agree field-for-field, so the two cannot silently diverge
(Pitfalls C1).

> The spec is English-first so it is portable to external skill authors
> (kais-movie-agent and any future OpenClaw skill). Phase 34 documentation may
> ship bilingual variants; this file is the canonical schema reference.

---

## Contract Invariants

These invariants are the load-bearing rules of the contract. Changing any of
them is a major-version bump. They are enforced by a mix of the validator
(ruleId emission) and the runtime platform loader (version-major gating).

- **Invariant 1 — Descriptive only.** A Skill Manifest declares data shape
  only. It contains no functions, no methods, no executable code, no React
  component URLs, no hooks. Behavior lives platform-side and is dispatched by
  `phase_id` and `node_type`. Each phase id declared by a skill must map to
  existing platform behavior (e.g., storyboard ingest); a new phase requiring
  new behavior is a platform code change, not a manifest change. References
  CONTRACT-06 and Pitfalls A4.

- **Invariant 2 — Version is `major.minor`.** The `version` string uses exactly
  two numeric segments separated by a dot (e.g., `1.0`, `1.1`, `2.5`). No patch
  segment, no leading `v`, no pre-release suffix. The regex enforced by the
  validator is `^\d+\.\d+$`. References CONTRACT-04.

- **Invariant 3 — Minor versions are strictly additive; major versions may
  break.** A minor bump may add OPTIONAL fields with safe defaults ONLY. No new
  required fields, no field removals, no enum narrowing, no type changes. A
  major bump may do any of those. References CONTRACT-04 and Pitfalls A2.

- **Invariant 4 — Platform accepts any `1.x` manifest at runtime.** The
  platform's runtime major version must match the manifest's major. Any minor
  version within the same major is accepted. Refusing a manifest requires a
  major-version mismatch — minor drift is never a registration failure.
  References CONTRACT-04 and Pitfalls A2.

- **Invariant 5 — Node type IDs are namespaced `<skill_id>::<type>`.** Bare IDs
  such as `script` are rejected by the validator. Namespacing prevents
  collisions when multiple skills coexist (multi-skill projects are v1.7+
  scope, but the namespacing rule is locked in now). The format regex is
  `^[a-z0-9-]+::[a-z0-9-]+$` — lowercase ASCII letters, digits, and hyphens on
  each side, separated by a double colon. References CONTRACT-05 and Pitfalls
  A3.

> The ROADMAP refers to "four contract invariants" but the versioning rule
> genuinely splits into three statements (format, additive semantics,
> accept-policy). This spec numbers them 1–5; the drift test asserts section
> presence and key phrases, not a specific count.

---

## Versioning

The `version` field uses the `major.minor` format enforced by the
`MANIFEST_VERSION_FORMAT` validation rule:

- **Format:** `^\d+\.\d+$` — exactly two dot-separated numeric segments. Valid
  examples: `1.0`, `2.5`, `10.3`. Invalid examples: `1.0.0` (patch present),
  `v1` (leading `v`, single segment), `1` (single segment), `1.0-beta`
  (pre-release suffix).

- **Minor bump = strictly additive.** A minor bump may add OPTIONAL fields
  whose absence carries a safe platform-side default. New required fields, field
  removals, enum value narrowing, and type changes are all BREAKING and require
  a major bump. Example: bumping `1.0` → `1.1` to add an optional
  `runtime.healthcheck_path` is a minor change; bumping to add a new required
  `category` field is NOT — that requires `2.0`.

- **Major bump = breaking change permitted.** Adding required fields, removing
  fields, changing types, or narrowing enum values all require a major bump.

- **Platform accepts any `1.x` manifest at runtime.** Only the major segment is
  gated. A platform on major version `1` accepts every `1.0`, `1.1`, `1.2`, …
  manifest. Registration is refused only on a major-version mismatch.

- **Only the current major is supported.** v1.x → v2.x migration is the skill
  author's problem, not the platform's. If you registered a v1 manifest and the
  platform ships v2, your registration is invalidated on the next platform
  upgrade — re-register. This avoids accumulating multi-version compatibility
  shims (Pitfalls C3).

---

## Field Reference

The tables below are the **source-of-truth field list** that the field-equality
drift test parses. Every root field of `SkillManifest` appears in the root
table; every field of each sub-interface appears in its sub-section table. The
"Required" column uses the literal tokens `yes` or `no` (never checkmarks or
emojis — the drift test greps text).

### Root table — `SkillManifest`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| skill_id | string | yes | Unique registry key, e.g. `movie-v1`. Used as primary lookup in `o_skillRegistry`. |
| version | string (major.minor) | yes | Manifest version. Two numeric segments, e.g. `1.0`. Enforced by `MANIFEST_VERSION_FORMAT`. |
| display_name | string | yes | Human-readable skill name shown in the UI. |
| description | string | yes | One-paragraph skill description shown in tooltips and docs. |
| media_types | MediaType[] | yes | Output media types this skill produces. Subset of `{video, image, audio, 3d}`. |
| node_types | NodeTypeDecl[] | yes | Canvas node types this skill contributes. At least one entry; see sub-table below. |
| phase_taxonomy | PhaseDecl[] | yes | Ordered pipeline phases this skill runs through. Replaces `PHASE_ORDER`. |
| asset_categories | AssetCategoryDecl[] | yes | Asset kinds this skill owns. At least one entry; see sub-table below. |
| review_criteria | ReviewCriteriaDecl | yes | Auto/human thresholds for review scoring. See sub-table below. |
| engine_task_types | string[] | yes | Subset of the gold-team `TaskType` enum this skill uses. Kept as `string[]` because the enum lives in another repo. |
| runtime | SkillRuntimeDecl | yes | How the platform talks to the skill orchestrator. Informational. See sub-table below. |

### Sub-interface: `NodeTypeDecl`

Declares a canvas node type the skill contributes. The `type` field is the
namespaced identifier enforced by `NODE_ID_NAMESPACING`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| type | string | yes | Namespaced node id `<skill_id>::<type>`, e.g. `movie-v1::script`. Lowercase. |
| label | string | yes | UI label for the node (i18n string, e.g. "剧本"). |
| icon | string | yes | Icon identifier or URL for canvas rendering. |
| color | string | yes | Hex color for canvas rendering. |
| data_schema_uri | string | yes | JSON Schema URI describing the `node.data` shape. |
| default_renderer | BuiltinRenderer | yes | One of the five built-in renderers: `script`, `asset`, `storyboard`, `video`, `audio`. No `custom` in v1.6 (deferred to v1.7+). |

### Sub-interface: `PhaseDecl`

Declares one phase in a skill's pipeline taxonomy. Replaces the four hardcoded
phase constants in `src/routes/v1/pipeline/`: `PHASE_ORDER` (→ `order`),
`REVIEW_REQUIRED_PHASES` (→ `requires_review`), `PHASE_INGEST_MAP` (→
`ingest_outputs`).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | yes | Phase identifier, e.g. `requirement`, `storyboard`. Free string (the platform looks it up, not the closed enum). |
| order | number | yes | Execution ordinal (0, 1, 2, …). Replaces `PHASE_ORDER` map values. |
| label | string | yes | UI label for the phase. |
| requires_review | boolean | yes | Whether the phase gates on the review callback. Replaces `REVIEW_REQUIRED_PHASES.includes(id)`. |
| ingest_outputs | IngestOutput[] | yes | Asset categories the phase routes into the ingest pipeline. Values: `images`, `videos`, `storyboard`, `audio`, `none`. Replaces `PHASE_INGEST_MAP[id]`. |

### Sub-interface: `AssetCategoryDecl`

Declares an asset category a skill owns (e.g., `character-image`,
`voice-sample`). Kept minimal for v1.6.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | yes | Category identifier, e.g. `character-image`. |
| label | string | yes | UI label for the category. |

### Sub-interface: `ReviewCriteriaDecl`

Declares the review-scoring policy a skill uses. The platform's review-result
callback reads `auto_threshold` and `human_threshold` to gate auto-accept vs.
human-queue routing.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| auto_threshold | number | yes | Score at or above which the phase output auto-accepts. |
| human_threshold | number | yes | Score below which the phase output routes to the human review queue. |

### Sub-interface: `SkillRuntimeDecl`

Describes how the platform talks to the live skill orchestrator. Per
ARCHITECTURE.md Q6, this field is **informational** — the platform does NOT
dispatch to skills via this config. It exists so the UI can display the skill's
endpoint and so the platform can perform an optional healthcheck. The actual
skill → platform communication path is the existing callback protocol
(`POST /api/v1/pipeline/callback/*`).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| type | "external-http" \| "in-process" | yes | Orchestrator type. Literal union, not `string`. The boot loader branches on this to decide whether a healthcheck is meaningful. |
| endpoint | string | no | For `external-http`: base URL of the skill orchestrator (e.g. `http://kais-movie-agent:8001`). |
| healthcheck_path | string | no | GET path appended to `endpoint` for optional healthcheck probes. |
| callback_url_template | string | no | Platform's callback URL pattern the skill should use when POSTing phase-complete callbacks. |

---

## Validation Rules

`validateManifest()` returns a discriminated union: `{ ok: true, value }` on
success, or `{ ok: false, errors }` on failure, where each error carries a
stable `ruleId` from a SCREAMING_SNAKE vocabulary. Phase 33's compliance tests
assert on these ruleIds literally. The five ruleIds are:

### `MANIFEST_REQUIRED_FIELD`

Fires when a required field is absent from the input. Zod detects this as an
`invalid_type` issue where the received value is `undefined`; the validator
remaps it to this ruleId. Triggered by every missing root or nested required
field.

Example input: `validateManifest({})` — every root field is missing.

Error shape:

```ts
{
  ruleId: "MANIFEST_REQUIRED_FIELD",
  field: "skill_id",
  message: "Invalid input: expected string, received undefined",
  raw: <zod issue>,
}
```

### `MANIFEST_TYPE_MISMATCH`

Fires when a field has the wrong runtime type (field is present but its value
is not the declared type). Zod detects this as an `invalid_type` issue where
the received value is not `undefined`; the validator remaps it.

Example input: `{ ...validBase, skill_id: 123 }` — `skill_id` is a number.

Error shape:

```ts
{
  ruleId: "MANIFEST_TYPE_MISMATCH",
  field: "skill_id",
  message: "Invalid input: expected string, received number",
  raw: <zod issue>,
}
```

### `MANIFEST_VERSION_FORMAT`

Fires when the `version` field does not match `^\d+\.\d+$`. Enforced by a zod
`.superRefine()` rule — the ruleId is carried in the issue's `params.ruleId`
and surfaced directly.

Example inputs that trip it: `"1.0.0"` (patch present), `"v1"` (leading `v`),
`"1"` (single segment), `"1.0-beta"` (suffix).

Error shape:

```ts
{
  ruleId: "MANIFEST_VERSION_FORMAT",
  field: "version",
  message: "Version '1.0.0' must be in major.minor format (e.g. '1.0'). No patch segment, no leading 'v'.",
  raw: <zod issue>,
}
```

### `NODE_ID_NAMESPACING`

Fires when any `node_types[i].type` does not match
`^[a-z0-9-]+::[a-z0-9-]+$`. Enforced by a `.superRefine()` rule that iterates
the `node_types` array. Bare IDs like `script`, mixed-case IDs like
`Movie-V1::Script`, and IDs missing the double-colon separator are all
rejected.

Example input: `{ ...validBase, node_types: [{ ...validNodeType, type: "script" }] }`.

Error shape:

```ts
{
  ruleId: "NODE_ID_NAMESPACING",
  field: "node_types[0].type",
  message: "Node type 'script' is missing the required '<skill_id>::<type>' namespace prefix (lowercase, hyphens, double-colon separator).",
  raw: <zod issue>,
}
```

### `MANIFEST_UNKNOWN_FIELD`

Fires when strict mode rejects an unrecognized key at the root or any nested
object. The zod root schema and every nested object schema use `.strict()`, so
typos at any depth are caught.

Example input: `{ ...validBase, foobar: 1 }` — `foobar` is not a declared root
field.

Error shape:

```ts
{
  ruleId: "MANIFEST_UNKNOWN_FIELD",
  field: "root",
  message: "Unknown field(s): foobar. Manifest uses strict mode — declare every field.",
  raw: <zod issue>,
}
```

---

## Strict Mode

The zod root schema and every nested object schema use `.strict()`. Unknown
keys at any level — root, `node_types` element, `phase_taxonomy` element,
`asset_categories` element, `review_criteria`, or `runtime` — are rejected and
emit a `MANIFEST_UNKNOWN_FIELD` error. This forces manifest authors to declare
every field they intend to use and catches typos and undocumented experimental
fields at registration time rather than at runtime.

Strict mode is intentional. The platform's boot loader reads the manifest as a
unit and indexes it; undeclared keys would silently leak through and break that
invariant. If you need a new field, declare it in this spec and in the zod
schema together — the drift test will fail until both sides agree.

---

## Out of Scope (v1.7+)

The following features are deliberately absent from v1.6 so skill authors know
what NOT to expect from the current contract. Each is listed with a one-line
rationale; design for these belongs in v1.7+ planning, not in a v1.6 manifest
patch.

- **`custom_renderer_url` (custom React components over HTTP).** Cross-bundle
  dynamic React component loading across the Electron boundary is brittle (CSP,
  bundler chunk boundaries, version skew). The five built-in renderers cover
  the 80% case (movie, podcast, ads); custom renderers are a separate v1.7+
  design. (Architecture AP-4.)
- **`capability_negotiation`.** A protocol where the manifest declares
  capabilities and the platform negotiates which ones to enable. Not needed
  while there is exactly one skill (movie-v1) and the platform reads every
  field. Defer until a second skill exists.
- **`permission_matrix`.** Per-skill permission scoping (e.g., "this skill may
  write to the audio ingest but not the video ingest"). Out of scope while
  there is no multi-tenant or multi-skill isolation requirement.
- **`sandboxing`.** Resource isolation (CPU, memory, network egress) per skill
  orchestrator. v1.6 assumes the skill orchestrator is a trusted peer (OpenClaw
  or an in-process Node module); sandboxing is a deployment concern, not a
  manifest concern.
- **`marketplace` discovery.** A registry of public skills that platform
  operators can browse and install. v1.6 ships exactly one skill (movie-v1)
  baked into `defaultSkill.ts`; marketplace dynamics are premature.
- **Multi-skill projects.** A single project bound to multiple skills at once.
  The contract already namespacing node type IDs (`<skill_id>::<type>`) is
  forward-compatible with this, but the platform's project model is
  single-skill in v1.6.
