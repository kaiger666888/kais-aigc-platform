# Skill Author Guide

This guide shows third-party authors how to write a workflow skill manifest, register it against the KAIS AIGC platform, and ship it without talking to a platform maintainer.

**Audience:** developers integrating a new creative workflow (podcast, ads, interactive, future movie variants) into the platform via the published skill contract.

**You will learn:**
- What a skill manifest is and what each field means
- How to validate, register, and deploy a manifest
- What NOT to do (anti-features that will get your skill rejected or silently broken)

The platform is the source of truth for behavior; the manifest is descriptive. Read [`.planning/specs/SKILL-CONTRACT.md`](../.planning/specs/SKILL-CONTRACT.md) for the formal contract; this guide is the operator's manual.

---

## 1. What is a Skill?

A **skill** is a self-contained description of a creative workflow. It declares:

- **Node types** — the kinds of objects the workflow produces (script, asset, storyboard, video, audio, …)
- **Phase taxonomy** — the ordered pipeline phases the workflow moves through
- **Runtime** — how the platform reaches the skill's orchestrator (HTTP endpoint today; future transports out of scope for v1.6)

The platform reads the manifest to drive its callback hot path (phase-complete → review-gate decision), REST API (`/api/v1/skills/...`), and infinite-canvas rendering. The manifest does NOT contain executable code — see §5.

The reference skill is `movie-v1`. Its manifest lives at [`docs/skill-author-guide/movie-v1.manifest.json`](./skill-author-guide/movie-v1.manifest.json) and is the canonical example.

---

## 2. Manifest Field Reference

```typescript
interface SkillManifest {
  skill_id: string;            // unique, kebab-case (e.g., "movie-v1", "podcast-v2")
  version: string;             // "major.minor" — see §3
  display_name: string;        // human-readable
  description: string;         // 1-2 sentence summary
  media_types: MediaType[];    // "video" | "image" | "audio" | "text"
  node_types: NodeTypeDecl[];  // §2.1
  phase_taxonomy: PhaseDecl[]; // §2.2
  asset_categories: AssetCategoryDecl[];
  review_criteria: ReviewCriteriaDecl;
  engine_task_types: string[]; // subset of gold-team TaskType enum
  runtime: SkillRuntimeDecl;   // §2.3
}
```

All field names use **snake_case** to match Python conventions on the skill-author side.

### 2.1 `node_types`

```typescript
interface NodeTypeDecl {
  type: string;               // MUST be "<skill_id>::<bare>" (e.g., "movie-v1::script")
  label: string;              // UI label
  icon: string;               // icon name from the platform's icon library
  color: string;              // hex color, e.g., "#4A90E2"
  data_schema_uri: string;    // URI to a JSON schema describing node data; empty string allowed in v1.6
  default_renderer: string;   // one of the platform's built-in renderers (see §4)
}
```

**Namespacing rule:** the validator rejects bare IDs. Every `type` MUST start with `<skill_id>::`. This prevents collisions between skills and lets the platform look up a node type via `registry.nodeTypeById(skillId, typeId)` in O(1) without scanning.

### 2.2 `phase_taxonomy`

```typescript
interface PhaseDecl {
  id: string;                 // phase identifier (e.g., "storyboard", "voice")
  order: number;              // 0-based position in the pipeline
  label: string;              // UI label
  requires_review: boolean;   // does completing this phase pause the pipeline for human review?
  ingest_outputs: IngestOutput[];  // "images" | "videos" | "storyboard" | "audio" | "none"
}
```

Phases are **descriptive metadata**. The platform consults `requires_review` to decide whether a phase-completion callback transitions the pipeline to `awaiting-review` vs `running`. It consults `order` to compute phase ordering on resume. It does NOT consult `ingest_outputs` at runtime in v1.6 (the runtime branches on the output's `type` field directly) — `ingest_outputs` is locked in via the equivalence test as a regression guard.

A skill can declare phases the platform hasn't seen before (e.g., `"exotic-new-phase"`). The platform will accept the manifest; runtime calls referencing that phase will return the declared PhaseDecl. This is by design — phases are descriptive.

### 2.3 `runtime`

```typescript
interface SkillRuntimeDecl {
  type: "external-http";      // only transport in v1.6
  endpoint: string;           // base URL of the orchestrator (e.g., "http://localhost:8001")
  healthcheck_path?: string;  // optional path appended to endpoint for health pings
}
```

Future transports (gRPC, in-process) are deferred to v1.7+. v1.6 only supports HTTP.

---

## 3. Versioning

Manifest version strings are `"major.minor"` (no patch). Examples: `"1.0"`, `"2.5"`.

- **Minor bump** = strictly additive. You may add optional fields with safe defaults. Existing platform code keeps working.
- **Major bump** = breaking change. Removing a required field, changing a type, narrowing an enum all require a major bump.

The platform accepts any `1.x` manifest at runtime (major must match the platform's current major). When the platform major bumps, old `1.x` skills must re-publish as `2.0+` to register.

---

## 4. Built-in Renderers

The platform provides five **platform-primitive** renderers. They are NOT movie-v1 properties — they are platform-owned node renderers that any skill can reference via `node_types[].default_renderer`:

| Renderer | Used for |
|----------|----------|
| `script` | Long-form text content (script, scenario, prompt) |
| `asset` | Static visual asset (character image, scene, prop) |
| `storyboard` | Frame-by-frame storyboard with shot metadata |
| `video` | Video clip with playback controls |
| `audio` | Audio clip with waveform + scrubber |

A skill declares a new node TYPE by picking a built-in renderer. Example: a future podcast skill could declare `podcast-v2::intro-clip` with `default_renderer: "audio"` — no canvas bundle repack needed.

A node whose `default_renderer` is NOT one of the five above renders via the platform's `FallbackNode` — a visible "unknown node type" indicator. The canvas does not crash, does not render blank.

**Out of scope for v1.6:** shipping custom renderer code via HTTPS module URLs (Architecture AP-4 — deferred to v1.7+).

---

## 5. What NOT to Do

These anti-features will get your skill rejected, silently broken, or blocklisted:

1. **No executable code in the manifest.** The manifest is descriptive JSON. Do not embed JavaScript, Python, shell, or any code that should "run" on the platform side. If you need behavior, ship it in your orchestrator and let the platform call it via `runtime.endpoint`.

2. **No dynamic React component loading.** Do not declare `default_renderer: "https://example.com/MyCustomRenderer.js"` or similar. The platform rejects this; only the five built-in renderer names are valid. Cross-bundle dynamic loading is brittle (version skew, CSP, chunk boundaries) and explicitly out of scope for v1.6 (Architecture AP-4).

3. **No sandboxing or permission matrix.** Skills run trusted. The platform assumes a single-tenant creative environment, not multi-tenant SaaS. Do not request fine-grained permissions in your manifest — there is no permission system in v1.6.

4. **No bare node type IDs.** `node_types[].type` MUST start with `<skill_id>::`. The validator rejects bare IDs at registration. Example: `"movie-v1::script"` ✓, `"script"` ✗.

5. **No overlapping node type IDs across skills (in the same project).** Two skills registering `movie-v1::script` and `podcast-v2::script` is fine (different namespaces). Two skills both trying to register `movie-v1::script` will collide; the second register overwrites the first.

6. **No patch versions.** `"1.0.3"` is rejected. Use `"1.0"` and bump minor for additive changes.

7. **No silent fallback to movie-v1.** If `registry.phaseById(yourSkillId, phase)` returns `undefined`, the platform returns an error (4xx/5xx). It does NOT silently fall back to movie-v1's phase taxonomy. Make sure every phase your orchestrator emits is declared in your manifest.

---

## 6. Deploy Order

Correct order:

1. **Platform first.** Boot the KAIS AIGC platform. The default seed populates `movie-v1` into `o_skillRegistry` on empty-DB boot (zero-config upgrade).
2. **Register your manifest via API.** `POST /api/v1/skills/register` with your manifest JSON. Validate via zod first; expect `201 { ok: true, skill: {...} }` on success or `400 { ok: false, errors: [...] }` on failure.
3. **Upgrade the OpenClaw-side skill.** Once the manifest is registered, the OpenClaw workspace can reference your skill. Update its `skillId` field to point at the new ID.

Wrong order (register after OpenClaw upgrade) → OpenClaw polls for a skill that isn't registered yet → 404s in the logs.

---

## 7. Example: movie-v1.manifest.json

The full annotated example lives at [`docs/skill-author-guide/movie-v1.manifest.json`](./skill-author-guide/movie-v1.manifest.json). Key excerpts:

```jsonc
{
  "skill_id": "movie-v1",              // unique ID
  "version": "1.0",                    // major.minor only
  "display_name": "Movie v1",
  "description": "Reference workflow skill for movie/short-video production.",
  "media_types": ["video", "image", "audio"],
  "node_types": [
    {
      "type": "movie-v1::script",      // namespaced — validator enforces
      "label": "Script",
      "icon": "page",
      "color": "#4A90E2",
      "data_schema_uri": "",
      "default_renderer": "script"     // platform primitive
    },
    // ... asset, storyboard, video, audio follow the same shape
  ],
  "phase_taxonomy": [
    {
      "id": "requirement",
      "order": 0,                       // 0-based pipeline position
      "label": "requirement",
      "requires_review": false,         // no review gate at this phase
      "ingest_outputs": ["none"]        // descriptive — what this phase produces
    },
    {
      "id": "storyboard",
      "order": 5,
      "label": "storyboard",
      "requires_review": true,          // pauses pipeline for human review
      "ingest_outputs": ["storyboard"]
    }
    // ... 10 more phases
  ],
  "runtime": {
    "type": "external-http",
    "endpoint": "http://localhost:8001",
    "healthcheck_path": "/health"
  }
}
```

---

## 8. Validate Before Registering

The platform validates every manifest via the same zod schema on register. To validate locally before POSTing, run:

```bash
npx tsx -e "
  import { validateManifest } from './src/skills/validator';
  import fs from 'node:fs';
  const manifest = JSON.parse(fs.readFileSync('./path/to/your-manifest.json', 'utf8'));
  const result = validateManifest(manifest);
  if (result.ok) {
    console.log('OK: manifest validates');
  } else {
    console.error('VALIDATION ERRORS:');
    for (const e of result.errors) {
      console.error(\`  [\${e.ruleId}] \${e.field}: \${e.message}\`);
    }
    process.exit(1);
  }
"
```

A standalone `kais-skill validate` CLI is deferred to v1.7+ (AUTHOR-03).

---

## 9. Troubleshooting

**"NODE_ID_NAMESPACING"** — your `node_types[].type` is missing the `<skill_id>::` prefix. Add it.

**"phase '<X>' not declared by skill '<Y>'"** — your orchestrator emitted a phase ID that isn't in your manifest's `phase_taxonomy`. Either add the phase to the manifest or fix the orchestrator to emit a declared phase.

**"skill '<X>' not registered"** — the skill ID you referenced isn't in the registry. Either you haven't POSTed to `/api/v1/skills/register` yet, or the registry hasn't been hydrated from `o_skillRegistry` on boot. Check `GET /api/v1/skills`.

**Canvas renders an unknown-type indicator** — your node's `default_renderer` isn't one of the five built-in names (`script`, `asset`, `storyboard`, `video`, `audio`). Fix the manifest or accept the fallback rendering.

---

## 10. Reference

- Contract spec: [`.planning/specs/SKILL-CONTRACT.md`](../.planning/specs/SKILL-CONTRACT.md)
- TypeScript source of truth: [`src/skills/contract.ts`](../src/skills/contract.ts)
- Validator: [`src/skills/validator.ts`](../src/skills/validator.ts)
- Install-ready movie-v1 manifest: [`docs/skill-author-guide/movie-v1.manifest.json`](./skill-author-guide/movie-v1.manifest.json)
- Manifest generator (regenerates JSON from TS source): [`scripts/gen-movie-v1-manifest.ts`](../scripts/gen-movie-v1-manifest.ts)
