/**
 * contract.test.ts — Phase 28 Plan 02: field-equality drift test + negative
 * validator tests.
 *
 * Project convention (Pitfalls B3): no vitest/jest/mocha. This is a plain
 * TypeScript module exporting two async functions; the runnable entrypoint is
 * `scripts/verify-phase-28.ts`, which follows the v1.5 `verify-phase-23.ts`
 * pattern (assert() helper + results[] + main().catch(exit 2)).
 *
 * Exports:
 *   - testFieldEqualityDrift(): asserts the zod schema in validator.ts and the
 *     human-readable spec at .planning/specs/SKILL-CONTRACT.md agree
 *     field-for-field in BOTH directions (zod→spec AND spec→zod) and that the
 *     required-flag matches for every shared field. Closes Pitfalls C1
 *     mechanically.
 *   - testNegativeInputs(): asserts validateManifest() returns the correct
 *     ruleId for each of the five malformed-input classes, plus a happy-path
 *     fixture. Locks in the ruleId vocabulary Phase 33 asserts against.
 *
 * Each function returns a { passed, failed, failures } summary so the runner
 * can aggregate without re-running the assertions.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { manifestSchema, validateManifest } from "../validator";
import type { SkillManifest } from "../contract";

export interface TestSummary {
  passed: number;
  failed: number;
  failures: string[];
}

// ---------------------------------------------------------------------------
// zod v4 introspection helpers
// ---------------------------------------------------------------------------
//
// zod v4 stores the schema kind discriminator at `_zod.def.type`. For our
// purposes we need two predicates:
//   1. Is this schema a ZodOptional wrapper? (`_zod.def.type === "optional"`)
//   2. Is this schema a ZodArray whose `.element` is a ZodObject we can walk?
//
// We avoid reaching into private internals beyond `_zod.def.type` — that field
// is the documented discriminator for zod v4 (the same one zod's own
// `.isOptional()` method reads).

type AnySchema = { _zod?: { def?: { type?: string } }; isOptional?: () => boolean };

function isZodOptional(schema: unknown): boolean {
  const s = schema as AnySchema;
  if (s && typeof s.isOptional === "function") {
    return s.isOptional() === true;
  }
  // Fallback: read the zod v4 discriminator directly.
  return s?._zod?.def?.type === "optional";
}

/**
 * The manifestSchema wraps the root object in `.superRefine(...)`, which
 * returns a ZodEffects. The underlying object shape is exposed via `.shape`
 * on the inner object, accessible as `(schema as any)._zod.def.schema.shape`
 * in zod v4. We probe defensively.
 */
function rootShape(): Record<string, unknown> {
  const anySchema = manifestSchema as unknown as {
    shape?: Record<string, unknown>;
    _zod?: { def?: { schema?: { shape?: Record<string, unknown> } } };
  };
  if (anySchema.shape) return anySchema.shape;
  if (anySchema._zod?.def?.schema?.shape) return anySchema._zod.def.schema.shape;
  throw new Error("Could not resolve manifestSchema.shape (zod v4 layout probe failed)");
}

/**
 * Get the shape of a nested object schema. Handles three cases:
 *   - top-level object field directly (e.g., runtime)
 *   - array-of-object field (e.g., node_types) — returns the element's shape
 *   - already-an-object schema passed in
 */
function nestedShape(rootField: string): Record<string, unknown> {
  const shape = rootShape();
  const field = shape[rootField];
  if (!field) {
    throw new Error(`root field '${rootField}' missing — drift test cannot introspect`);
  }
  const f = field as {
    element?: { shape?: Record<string, unknown> };
    shape?: Record<string, unknown>;
  };
  // ZodArray: walk to .element.shape
  if (f.element?.shape) return f.element.shape;
  // Plain ZodObject: .shape
  if (f.shape) return f.shape;
  throw new Error(`field '${rootField}' is neither ZodArray<ZodObject> nor ZodObject`);
}

// ---------------------------------------------------------------------------
// Spec markdown parsing
// ---------------------------------------------------------------------------

const SPEC_PATH = resolve(process.cwd(), ".planning", "specs", "SKILL-CONTRACT.md");

/**
 * Parse a markdown table section. Returns a Map<fieldName, { required: "yes" | "no" }>.
 *
 * The spec doc's field tables are pipe-delimited markdown with this column
 * layout (Task 1 spec):
 *   | Field | Type | Required | Description |
 *
 * The "Required" column contains the literal token "yes" or "no" (no
 * checkmarks, no emojis — the drift test greps text).
 *
 * `sectionHeader` is the markdown heading that introduces the table, e.g.
 *   "### Root table — `SkillManifest`"
 * or
 *   "### Sub-interface: `NodeTypeDecl`"
 *
 * The parser reads rows from the first pipe-table that follows the heading,
 * stopping at the next markdown heading or end-of-section.
 */
function parseFieldTable(spec: string, sectionHeader: string): Map<string, { required: "yes" | "no" }> {
  const out = new Map<string, { required: "yes" | "no" }>();
  const headerIdx = spec.indexOf(sectionHeader);
  if (headerIdx === -1) {
    throw new Error(`spec section '${sectionHeader}' not found in ${SPEC_PATH}`);
  }
  // Slice everything after the header until the next `##` heading.
  const after = spec.slice(headerIdx + sectionHeader.length);
  const nextSectionMatch = after.match(/\n(#{1,4})\s/);
  const slice = nextSectionMatch ? after.slice(0, nextSectionMatch.index) : after;

  // Walk lines. A markdown table row matches /^\| .* \|$/ and contains pipes.
  // Skip the separator row (|---|---|...).
  const lines = slice.split("\n");
  let inTable = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      inTable = false;
      continue;
    }
    // Skip header separator: |---|---|---|---|
    if (/^\|[\s:-]+\|[\s:|-]+$/.test(trimmed)) {
      inTable = true;
      continue;
    }
    // Skip header row (| Field | Type | Required | Description |) — detect by
    // first cell being literally "Field".
    const cells = trimmed.slice(1, -1).split("|").map((c) => c.trim());
    if (cells[0] === "Field") {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    // Data row: cells[0] = field name, cells[2] = required token.
    const fieldName = cells[0];
    const requiredRaw = (cells[2] || "").toLowerCase();
    // The "Required" cell is either "yes" or "no" — accept anything containing
    // the literal token, so future prose additions don't break the parser.
    const required: "yes" | "no" = requiredRaw.includes("yes")
      ? "yes"
      : requiredRaw.includes("no")
        ? "no"
        : "yes"; // default conservative — absence of explicit "no" means required
    if (fieldName) {
      out.set(fieldName, { required });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shared manifest fixtures for negative tests
// ---------------------------------------------------------------------------

/**
 * A minimal well-formed manifest base. Each negative-test fixture clones this
 * and mutates one field. Matches the `validBase()` shape used in the Plan 01
 * behavior harness for consistency.
 */
const VALID_BASE: SkillManifest = {
  skill_id: "movie-v1",
  version: "1.0",
  display_name: "Movie v1",
  description: "Reference skill",
  media_types: ["video", "image", "audio"],
  node_types: [
    {
      type: "movie-v1::script",
      label: "Script",
      icon: "page",
      color: "#ffffff",
      data_schema_uri: "https://example.com/schemas/script.json",
      default_renderer: "script",
    },
  ],
  phase_taxonomy: [
    {
      id: "requirement",
      order: 0,
      label: "Requirement",
      requires_review: false,
      ingest_outputs: ["none"],
    },
  ],
  asset_categories: [{ id: "character-image", label: "Character" }],
  review_criteria: { auto_threshold: 0.7, human_threshold: 0.9 },
  engine_task_types: ["text-to-image", "text-to-video"],
  runtime: { type: "external-http", endpoint: "http://localhost:8001" },
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ---------------------------------------------------------------------------
// testFieldEqualityDrift
// ---------------------------------------------------------------------------

export async function testFieldEqualityDrift(): Promise<TestSummary> {
  const summary: TestSummary = { passed: 0, failed: 0, failures: [] };

  function ok(name: string): void {
    summary.passed++;
    console.log(`  PASS: ${name}`);
  }
  function bad(name: string, detail: string): void {
    summary.failed++;
    summary.failures.push(`${name} — ${detail}`);
    console.log(`  FAIL: ${name} — ${detail}`);
  }

  const spec = readFileSync(SPEC_PATH, "utf8");

  // Root-level drift check.
  console.log("\n[drift] root field set ↔ spec root table");
  {
    const zodRoot = rootShape();
    const zodRootKeys = Object.keys(zodRoot);
    const specRoot = parseFieldTable(
      spec,
      "### Root table — `SkillManifest`",
    );

    // zod → spec
    for (const key of zodRootKeys) {
      if (!specRoot.has(key)) {
        bad(
          "root drift",
          `Field '${key}' present in zod but missing in spec`,
        );
      }
    }
    // spec → zod
    for (const key of specRoot.keys()) {
      if (!(key in zodRoot)) {
        bad(
          "root drift",
          `Field '${key}' present in spec but missing in zod`,
        );
      }
    }
    // required-flag mismatch
    for (const key of zodRootKeys) {
      if (!specRoot.has(key)) continue;
      const specRequired = specRoot.get(key)!.required;
      const zodRequired = !isZodOptional(zodRoot[key]);
      const zodFlag = zodRequired ? "yes" : "no";
      if (specRequired !== zodFlag) {
        bad(
          "root drift",
          `Field '${key}' required-flag mismatch: spec=${specRequired}, zod=${zodRequired ? "required" : "optional"}`,
        );
      }
    }
    if (summary.failed === 0) ok("root field set matches spec in both directions + required flags");
  }

  // Per-sub-interface drift checks. Each entry: [spec section header, zod root
  // field that owns the nested object].
  const subInterfaces: Array<{ header: string; rootField: string; label: string }> = [
    { header: "### Sub-interface: `NodeTypeDecl`", rootField: "node_types", label: "NodeTypeDecl" },
    { header: "### Sub-interface: `PhaseDecl`", rootField: "phase_taxonomy", label: "PhaseDecl" },
    { header: "### Sub-interface: `AssetCategoryDecl`", rootField: "asset_categories", label: "AssetCategoryDecl" },
    { header: "### Sub-interface: `ReviewCriteriaDecl`", rootField: "review_criteria", label: "ReviewCriteriaDecl" },
    { header: "### Sub-interface: `SkillRuntimeDecl`", rootField: "runtime", label: "SkillRuntimeDecl" },
  ];

  for (const sub of subInterfaces) {
    console.log(`\n[drift] ${sub.label} field set ↔ spec sub-table`);
    const beforeFailed = summary.failed;
    let zodShape: Record<string, unknown>;
    try {
      zodShape = nestedShape(sub.rootField);
    } catch (err) {
      bad(sub.label, `zod introspection failed: ${(err as Error).message}`);
      continue;
    }
    const zodKeys = Object.keys(zodShape);
    let specSub: Map<string, { required: "yes" | "no" }>;
    try {
      specSub = parseFieldTable(spec, sub.header);
    } catch (err) {
      bad(sub.label, `spec parse failed: ${(err as Error).message}`);
      continue;
    }
    // zod → spec
    for (const key of zodKeys) {
      if (!specSub.has(key)) {
        bad(sub.label, `Field '${key}' present in zod but missing in spec`);
      }
    }
    // spec → zod
    for (const key of specSub.keys()) {
      if (!(key in zodShape)) {
        bad(sub.label, `Field '${key}' present in spec but missing in zod`);
      }
    }
    // required-flag mismatch
    for (const key of zodKeys) {
      if (!specSub.has(key)) continue;
      const specRequired = specSub.get(key)!.required;
      const zodRequired = !isZodOptional(zodShape[key]);
      const zodFlag = zodRequired ? "yes" : "no";
      if (specRequired !== zodFlag) {
        bad(
          sub.label,
          `Field '${key}' required-flag mismatch: spec=${specRequired}, zod=${zodRequired ? "required" : "optional"}`,
        );
      }
    }
    if (summary.failed === beforeFailed) ok(`${sub.label} field set matches spec in both directions + required flags`);
  }

  return summary;
}

// ---------------------------------------------------------------------------
// testNegativeInputs
// ---------------------------------------------------------------------------

export async function testNegativeInputs(): Promise<TestSummary> {
  const summary: TestSummary = { passed: 0, failed: 0, failures: [] };

  function ok(name: string): void {
    summary.passed++;
    console.log(`  PASS: ${name}`);
  }
  function bad(name: string, detail: string): void {
    summary.failed++;
    summary.failures.push(`${name} — ${detail}`);
    console.log(`  FAIL: ${name} — ${detail}`);
  }

  function expectRuleId(
    label: string,
    input: unknown,
    expectedRuleId: string,
  ): void {
    const result = validateManifest(input);
    if (result.ok) {
      bad(label, `expected ok:false with ruleId '${expectedRuleId}', got ok:true`);
      return;
    }
    const ruleIds = result.errors.map((e) => e.ruleId);
    if (!ruleIds.includes(expectedRuleId as never)) {
      bad(
        label,
        `expected errors to include ruleId '${expectedRuleId}', got [${ruleIds.join(", ")}]`,
      );
      return;
    }
    ok(label);
  }

  console.log("\n[neg] MANIFEST_REQUIRED_FIELD — validateManifest({})");
  expectRuleId(
    "empty object yields MANIFEST_REQUIRED_FIELD",
    {},
    "MANIFEST_REQUIRED_FIELD",
  );

  console.log("\n[neg] MANIFEST_TYPE_MISMATCH — skill_id: 123");
  {
    const m = clone(VALID_BASE) as unknown as Record<string, unknown>;
    m.skill_id = 123;
    expectRuleId("numeric skill_id yields MANIFEST_TYPE_MISMATCH", m, "MANIFEST_TYPE_MISMATCH");
  }

  console.log("\n[neg] MANIFEST_VERSION_FORMAT — version: '1.0.0'");
  {
    const m = clone(VALID_BASE);
    m.version = "1.0.0";
    expectRuleId("version '1.0.0' yields MANIFEST_VERSION_FORMAT", m, "MANIFEST_VERSION_FORMAT");
  }

  console.log("\n[neg] NODE_ID_NAMESPACING — node_types[0].type: 'script'");
  {
    const m = clone(VALID_BASE);
    m.node_types[0].type = "script";
    expectRuleId("bare node type 'script' yields NODE_ID_NAMESPACING", m, "NODE_ID_NAMESPACING");
  }

  console.log("\n[neg] MANIFEST_UNKNOWN_FIELD — top-level 'foobar: 1'");
  {
    const m = clone(VALID_BASE) as unknown as Record<string, unknown>;
    m.foobar = 1;
    expectRuleId("unknown top-level 'foobar' yields MANIFEST_UNKNOWN_FIELD", m, "MANIFEST_UNKNOWN_FIELD");
  }

  console.log("\n[positive] well-formed manifest returns ok:true with value");
  {
    const result = validateManifest(VALID_BASE);
    if (!result.ok) {
      bad(
        "happy path returns ok:true",
        `got ok:false with ruleIds [${result.errors.map((e) => e.ruleId).join(", ")}]`,
      );
    } else if (result.value.skill_id !== VALID_BASE.skill_id) {
      bad(
        "happy path value.skill_id roundtrips",
        `expected '${VALID_BASE.skill_id}', got '${result.value.skill_id}'`,
      );
    } else {
      ok("well-formed manifest returns ok:true with value.skill_id roundtrip");
    }
  }

  return summary;
}
