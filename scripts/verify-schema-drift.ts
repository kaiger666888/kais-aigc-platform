#!/usr/bin/env tsx
/**
 * verify-schema-drift.ts — Phase 46 VERIFY-04.
 *
 * Diffs the Python MANIFEST_PARAM_SCHEMA (Phase 42 source-side contract)
 * against the TypeScript EXPECTED_PARAM_FIELDS_BY_TYPE (Phase 44
 * receiver-side mirror). Fails loudly on any field-set divergence.
 *
 * Both schemas are parsed via targeted regex from source files — single
 * source of truth, no duplication. If Phase 42 changes Python without
 * updating TS (or vice versa), this test fails. That's the contract
 * drift signal the v2.0 milestone is designed to catch.
 *
 * Run: npx tsx scripts/verify-schema-drift.ts
 *
 * Env vars:
 *   KAIS_HERMES_SKILLS_PATH — sibling repo root (default: /data/workspace/kais-hermes-skills)
 */

import fs from "node:fs";
import path from "node:path";

interface TestResult { name: string; pass: boolean; detail?: string; }
const results: TestResult[] = [];
function assert(cond: boolean, name: string, detail?: string): void {
  results.push({ name, pass: cond, detail });
  console.log(`  ${cond ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
}

const REPO_ROOT = path.resolve(__dirname, "..");
const SIBLING_ROOT = process.env.KAIS_HERMES_SKILLS_PATH ?? "/data/workspace/kais-hermes-skills";
const PYTHON_SCHEMA_PATH = path.join(
  SIBLING_ROOT,
  "skills/kais-movie-pipeline/pipeline/phases/_manifest.py",
);
const TS_SCHEMA_PATH = path.join(REPO_ROOT, "src/lib/canvasAssetSchema.ts");

/**
 * Parse Python MANIFEST_PARAM_SCHEMA. Recognizes two forms per entry:
 *   "type": {"field1", "field2"}     → set initializer
 *   "type": set()                    → empty set
 * Multiple empty-set entries may share a single line (e.g.
 * `"reference": set(), "zone": set(), ...`) — handle them.
 */
function parsePythonSchema(source: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  // Locate the MANIFEST_PARAM_SCHEMA dict body (between the assignment
  // and the closing brace).
  const startMatch = source.match(/^MANIFEST_PARAM_SCHEMA[^{]*\{/m);
  if (!startMatch || startMatch.index === undefined) return out;
  const startIdx = startMatch.index + startMatch[0].length;
  // Find the matching closing brace by simple depth counting.
  let depth = 1;
  let endIdx = startIdx;
  for (let i = startIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) { endIdx = i; break; }
    }
  }
  const body = source.slice(startIdx, endIdx);

  // Match `"type": { ... }` blocks (non-empty set initializers).
  const setRe = /"([^"]+)"\s*:\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = setRe.exec(body)) !== null) {
    const type = m[1];
    const fieldsRaw = m[2];
    // Skip empty bodies that are actually `set()` written differently.
    if (!fieldsRaw.trim()) continue;
    const fields = Array.from(fieldsRaw.matchAll(/"([^"]+)"/g)).map((x) => x[1]);
    if (fields.length > 0) {
      out.set(type, fields.sort());
    }
  }

  // Match empty forms: `"type": set()` (single per line).
  const emptyRe = /"([^"]+)"\s*:\s*set\(\)/g;
  while ((m = emptyRe.exec(body)) !== null) {
    const type = m[1];
    if (!out.has(type)) out.set(type, []);
  }

  return out;
}

/**
 * Parse TS EXPECTED_PARAM_FIELDS_BY_TYPE. Recognizes:
 *   typename: ["field1", "field2"]   → non-empty
 *   typename: []                     → empty
 */
function parseTSSchema(source: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  // Locate the EXPECTED_PARAM_FIELDS_BY_TYPE object body.
  const startMatch = source.match(/EXPECTED_PARAM_FIELDS_BY_TYPE[^{]*\{/);
  if (!startMatch || startMatch.index === undefined) return out;
  const startIdx = startMatch.index + startMatch[0].length;
  let depth = 1;
  let endIdx = startIdx;
  for (let i = startIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) { endIdx = i; break; }
    }
  }
  const body = source.slice(startIdx, endIdx);

  // Match `typename: [...]` or `"typename": [...]`. typename is a JS
  // identifier (no quotes) in this codebase but we accept both forms.
  const entryRe = /(?:"([^"]+)"|([a-zA-Z_][a-zA-Z0-9_]*))\s*:\s*\[([^\]]*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(body)) !== null) {
    const type = m[1] ?? m[2];
    const fieldsRaw = m[3];
    const fields = Array.from(fieldsRaw.matchAll(/"([^"]+)"/g)).map((x) => x[1]);
    out.set(type, fields.sort());
  }

  return out;
}

async function main(): Promise<void> {
  console.log("=== Phase 46 VERIFY-04 — verify-schema-drift.ts ===\n");
  console.log(`  python schema: ${PYTHON_SCHEMA_PATH}`);
  console.log(`  ts schema:     ${TS_SCHEMA_PATH}`);

  // Gate: both files exist.
  if (!fs.existsSync(PYTHON_SCHEMA_PATH)) {
    assert(false, "VERIFY-04: Python MANIFEST_PARAM_SCHEMA source present", `not found at ${PYTHON_SCHEMA_PATH}`);
    finish();
    return;
  }
  if (!fs.existsSync(TS_SCHEMA_PATH)) {
    assert(false, "VERIFY-04: TS EXPECTED_PARAM_FIELDS_BY_TYPE source present", `not found at ${TS_SCHEMA_PATH}`);
    finish();
    return;
  }

  const pySource = fs.readFileSync(PYTHON_SCHEMA_PATH, "utf8");
  const tsSource = fs.readFileSync(TS_SCHEMA_PATH, "utf8");

  const pySchema = parsePythonSchema(pySource);
  const tsSchema = parseTSSchema(tsSource);

  console.log(`  python types parsed: ${pySchema.size}`);
  console.log(`  ts types parsed:     ${tsSchema.size}`);

  if (pySchema.size === 0) {
    assert(false, "VERIFY-04: Python parser captured ≥1 type", "got 0 — regex broken or schema moved");
    finish();
    return;
  }
  if (tsSchema.size === 0) {
    assert(false, "VERIFY-04: TS parser captured ≥1 type", "got 0 — regex broken or export renamed");
    finish();
    return;
  }

  const allTypes = new Set<string>([...pySchema.keys(), ...tsSchema.keys()]);
  const sortedTypes = Array.from(allTypes).sort();

  for (const type of sortedTypes) {
    const py = pySchema.get(type) ?? null;
    const ts = tsSchema.get(type) ?? null;

    if (py === null) {
      assert(false, `VERIFY-04: ${type} matches`, `only in TS: ${ts?.join(", ")}`);
      continue;
    }
    if (ts === null) {
      assert(false, `VERIFY-04: ${type} matches`, `only in Python: ${py.join(", ")}`);
      continue;
    }

    const pyOnly = py.filter((f) => !ts.includes(f));
    const tsOnly = ts.filter((f) => !py.includes(f));
    const matches = pyOnly.length === 0 && tsOnly.length === 0;
    const detail = matches
      ? `${py.length} fields aligned`
      : [`py-only: [${pyOnly.join(",")}]`, `ts-only: [${tsOnly.join(",")}]`].join(" · ");
    assert(matches, `VERIFY-04: ${type} matches`, detail);
  }

  const driftCount = results.filter((r) => !r.pass).length;
  assert(driftCount === 0, "VERIFY-04: TS EXPECTED_PARAM_FIELDS_BY_TYPE matches Python MANIFEST_PARAM_SCHEMA (zero drift)");

  finish();
}

function finish(): void {
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
