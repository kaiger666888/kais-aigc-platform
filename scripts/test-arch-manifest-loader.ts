#!/usr/bin/env tsx
/**
 * Mechanical test for src/lib/arch-tracked-repos.ts loader.
 *
 * Run: npx tsx scripts/test-arch-manifest-loader.ts
 *
 * Uses only Node's built-in `assert` + `fs` + `os` modules — no new deps.
 * Prints "N passed" on success and exits non-zero on any failure.
 *
 * Backs Phase 06 Plan 03 contract (TSV manifest loader):
 *   - Plan 06-01 locked the 3-column TSV format.
 *   - This test pins the loader's parsing/validation/caching contract.
 */

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadArchRepos, ArchRepoEntry } from "@/lib/arch-tracked-repos";

let passed = 0;
let failed = 0;

function ok(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (e) {
    failed++;
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`  FAIL  ${name}\n        ${msg}`);
  }
}

function writeTmpManifest(content: string): string {
  const p = path.join(os.tmpdir(), `arch-manifest-${Date.now()}-${Math.random().toString(36).slice(2)}.conf`);
  fs.writeFileSync(p, content, "utf8");
  return p;
}

console.log("\narch-tracked-repos loader — mechanical test\n");

// Test 1 — parses a valid manifest with 2 rows
ok("Test 1: parses valid manifest with 2 entries", () => {
  const tmp = writeTmpManifest(
    [
      "arch-dashboard\t/arch-dashboard/\t/home/kai/workspace/arch-dashboard/site",
      "kais-aigc-platform\t/kais-aigc-platform-arch/\t/home/kai/workspace/kais-aigc-platform/site",
    ].join("\n") + "\n",
  );
  const entries = loadArchRepos(tmp);
  assert.strictEqual(entries.length, 2, `expected 2 entries, got ${entries.length}`);
  assert.strictEqual(entries[0].repoName, "arch-dashboard");
  assert.strictEqual(entries[0].urlPrefix, "/arch-dashboard/");
  assert.strictEqual(entries[0].sitePath, "/home/kai/workspace/arch-dashboard/site");
  assert.strictEqual(entries[1].repoName, "kais-aigc-platform");
  assert.strictEqual(entries[1].urlPrefix, "/kais-aigc-platform-arch/");
  assert.strictEqual(entries[1].sitePath, "/home/kai/workspace/kais-aigc-platform/site");
  fs.unlinkSync(tmp);
});

// Test 2 — skips comments and blank lines
ok("Test 2: skips comments and blank lines", () => {
  const tmp = writeTmpManifest(
    [
      "# this is a comment",
      "",
      "arch-dashboard\t/arch-dashboard/\t/home/kai/workspace/arch-dashboard/site",
      "",
      "   ",
      "# another comment",
      "kais-aigc-platform\t/kais-aigc-platform-arch/\t/home/kai/workspace/kais-aigc-platform/site",
      "",
    ].join("\n") + "\n",
  );
  const entries = loadArchRepos(tmp);
  assert.strictEqual(entries.length, 2, `expected 2 entries after skipping comments, got ${entries.length}`);
  fs.unlinkSync(tmp);
});

// Test 3 — returns [] when file missing
ok("Test 3: returns [] when manifest file missing", () => {
  const bogus = path.join(os.tmpdir(), `definitely-does-not-exist-${Date.now()}.conf`);
  const entries = loadArchRepos(bogus);
  assert.strictEqual(Array.isArray(entries), true);
  assert.strictEqual(entries.length, 0);
});

// Test 4 — returns [] when file has only comments/blank lines
ok("Test 4: returns [] when manifest has only comments/blank lines", () => {
  const tmp = writeTmpManifest(["# just comments", "", "   ", "# more"].join("\n") + "\n");
  const entries = loadArchRepos(tmp);
  assert.strictEqual(entries.length, 0);
  fs.unlinkSync(tmp);
});

// Test 5 — rejects malformed row (wrong column count) with line number
ok("Test 5: rejects malformed row with line-number context", () => {
  const tmp = writeTmpManifest(
    [
      "# header",
      "arch-dashboard\t/arch-dashboard/\t/home/kai/workspace/arch-dashboard/site",
      "broken-only-two-cols\t/foo/",
    ].join("\n") + "\n",
  );
  assert.throws(
    () => loadArchRepos(tmp),
    (err: Error) => {
      assert.ok(err instanceof Error, "threw non-Error");
      // The bad row is line 3 in the file (1-indexed header comment, 2 good, 3 bad)
      assert.ok(/line\s*3/i.test(err.message) || /3/.test(err.message),
        `error message should reference the line number, got: ${err.message}`);
      return true;
    },
  );
  fs.unlinkSync(tmp);
});

// Test 6 — normalizes url-prefix (adds trailing slash)
ok("Test 6: normalizes url-prefix to have leading + trailing slash", () => {
  const tmp = writeTmpManifest("demo\t/demo\t/home/kai/workspace/demo/site\n");
  const entries = loadArchRepos(tmp);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].urlPrefix, "/demo/", `expected /demo/, got ${entries[0].urlPrefix}`);
  fs.unlinkSync(tmp);
});

// Test 7 — respects ARCH_TRACKED_REPOS env override
ok("Test 7: respects ARCH_TRACKED_REPOS env override", () => {
  const tmp = writeTmpManifest("env-override\t/env-arch/\t/home/kai/workspace/env/site\n");
  const prev = process.env.ARCH_TRACKED_REPOS;
  process.env.ARCH_TRACKED_REPOS = tmp;
  try {
    // No explicit path — loader should consult env
    const entries = loadArchRepos();
    assert.strictEqual(entries.length, 1, `expected 1 entry from env override, got ${entries.length}`);
    assert.strictEqual(entries[0].repoName, "env-override");
  } finally {
    if (prev === undefined) delete process.env.ARCH_TRACKED_REPOS;
    else process.env.ARCH_TRACKED_REPOS = prev;
    try { fs.unlinkSync(tmp); } catch { /* tmp may be GC'd */ }
  }
});

// Test 8 — default path resolution: with no env var, loader consults
// /etc/arch-tracked-repos.conf then ~/.config fallback. The contract is
// "returns the first one that exists (or [] if neither)". On this host
// /etc/arch-tracked-repos.conf exists with the seed row, so we assert that
// the loader finds it. On a host without either file the result would be [].
ok("Test 8: default resolution finds /etc manifest when env unset", () => {
  const prev = process.env.ARCH_TRACKED_REPOS;
  delete process.env.ARCH_TRACKED_REPOS;
  try {
    const entries = loadArchRepos();
    assert.strictEqual(Array.isArray(entries), true);
    // /etc/arch-tracked-repos.conf exists on kais-engine with the seed row.
    // If neither default file existed, entries.length would be 0 — also valid.
    // The contract under test is "no crash, returns array".
    if (entries.length > 0) {
      assert.ok(
        entries.some(e => e.repoName === "arch-dashboard"),
        `expected arch-dashboard seed row when /etc manifest present, got: ${JSON.stringify(entries)}`,
      );
    }
  } finally {
    if (prev === undefined) delete process.env.ARCH_TRACKED_REPOS;
    else process.env.ARCH_TRACKED_REPOS = prev;
  }
});

// ============================================================================
// CR-01 + CR-02 regression tests (Phase 06 REVIEW)
//   CR-01: urlPrefix === "/" must be REJECTED — would bypass auth app-wide
//          because the auth predicate `archRepos.some(r => req.path.startsWith(r.urlPrefix))`
//          matches every path when urlPrefix is "/".
//   CR-02: sensitive site-paths (/etc, /var, /.ssh, ...) must be REJECTED so
//          the proxy cannot mount `express.static("/etc")` and leak /etc/passwd.
//          Non-conventional-but-non-sensitive paths (e.g. /tmp/arch-test) are
//          WARNED but accepted — preserves flexibility for private mirrors.
// ============================================================================

// Test 9 (CR-01) — rejects urlPrefix "/"
ok("Test 9 (CR-01): rejects urlPrefix \"/\" with auth-bypass error", () => {
  const tmp = writeTmpManifest("evil\t/\t/tmp/foo\n");
  try {
    assert.throws(
      () => loadArchRepos(tmp),
      (err: Error) => {
        assert.ok(err instanceof Error, "threw non-Error");
        assert.ok(
          /url-prefix/i.test(err.message) && /"/.test(err.message),
          `error message should mention url-prefix and the forbidden value, got: ${err.message}`,
        );
        // Must reference the auth-bypass risk so operators understand WHY.
        assert.ok(
          /auth|bypass|forbidden/i.test(err.message),
          `error message should reference the auth-bypass risk, got: ${err.message}`,
        );
        return true;
      },
    );
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* GC */ }
  }
});

// Test 10 (CR-02) — rejects /etc site-path
ok("Test 10 (CR-02): rejects site-path \"/etc\" as sensitive system dir", () => {
  const tmp = writeTmpManifest("evil\t/evil-arch/\t/etc\n");
  try {
    assert.throws(
      () => loadArchRepos(tmp),
      (err: Error) => {
        assert.ok(err instanceof Error, "threw non-Error");
        assert.ok(
          /sensitive|forbidden|system/i.test(err.message),
          `error should flag the path as sensitive, got: ${err.message}`,
        );
        return true;
      },
    );
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* GC */ }
  }
});

// Test 11 (CR-02) — rejects /var site-path (and by extension /var/log)
ok("Test 11 (CR-02): rejects site-path \"/var\" as sensitive system dir", () => {
  const tmp = writeTmpManifest("evil\t/evil-arch/\t/var\n");
  try {
    assert.throws(
      () => loadArchRepos(tmp),
      (err: Error) => {
        assert.ok(err instanceof Error, "threw non-Error");
        assert.ok(
          /sensitive|forbidden|system/i.test(err.message),
          `error should flag the path as sensitive, got: ${err.message}`,
        );
        return true;
      },
    );
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* GC */ }
  }
});

// Test 12 (CR-02) — rejects /.ssh (and /.config, /.gnupg) anywhere in path
ok("Test 12 (CR-02): rejects site-path pointing at ~/.ssh credentials dir", () => {
  const tmp = writeTmpManifest("evil\t/evil-arch/\t/home/kai/.ssh\n");
  try {
    assert.throws(
      () => loadArchRepos(tmp),
      (err: Error) => {
        assert.ok(err instanceof Error, "threw non-Error");
        assert.ok(
          /credentials|config|forbidden/i.test(err.message),
          `error should reference credentials/config, got: ${err.message}`,
        );
        return true;
      },
    );
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* GC */ }
  }
});

// Test 13 (CR-02) — WARNS but ACCEPTS a non-conventional, non-sensitive path
// (e.g. /tmp/arch-test — outside /home/kai/workspace/ but not in the sensitive
// allowlist). The threat model T-06-02 says "warn, do not hard-fail, for
// paths outside the convention". This preserves operator flexibility for
// legitimate private mirrors while logging the deviation.
ok("Test 13 (CR-02): warns but accepts non-conventional non-sensitive path", () => {
  const tmp = writeTmpManifest("test\t/test-arch/\t/tmp/arch-test\n");
  // Capture console.warn output to verify the warning fires.
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (msg: string) => { warnings.push(String(msg)); };
  try {
    const entries = loadArchRepos(tmp);
    assert.strictEqual(entries.length, 1, `expected 1 accepted entry, got ${entries.length}`);
    assert.strictEqual(entries[0].repoName, "test");
    assert.strictEqual(entries[0].sitePath, "/tmp/arch-test");
    // A warning MUST fire for non-conventional paths.
    const joined = warnings.join("\n");
    assert.ok(
      joined.length > 0 && /outside|conventional|workspace/i.test(joined),
      `expected a warning about non-conventional path, got: ${joined || "(no warnings)"}`,
    );
  } finally {
    console.warn = originalWarn;
    try { fs.unlinkSync(tmp); } catch { /* GC */ }
  }
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.exit(1);
}
