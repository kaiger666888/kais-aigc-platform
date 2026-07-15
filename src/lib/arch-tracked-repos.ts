/**
 * arch-tracked-repos — manifest-driven loader for the reverse-proxy mount loop.
 *
 * Phase 06 Plan 03 (PROXY-01/02/03): kais-aigc-platform reads
 * /etc/arch-tracked-repos.conf (or ~/.config fallback) at startup and mounts
 * each tracked repo's MkDocs site at its declared URL prefix.
 *
 * Manifest format (LOCKED by Plan 06-01):
 *   TSV, 3 columns:  repo-name \t url-prefix \t site-path
 *   Lines starting with '#' are comments; blank lines skipped.
 *
 * Resolution order:
 *   1. explicitPath argument (used by tests + ad-hoc callers)
 *   2. process.env.ARCH_TRACKED_REPOS
 *   3. /etc/arch-tracked-repos.conf            (system-wide)
 *   4. ~/.config/arch-tracked-repos.conf       (per-user fallback)
 *   5. returns []                               (graceful — no crash)
 *
 * The loader is DEFENSIVE about manifest absence: kais-aigc-platform must boot
 * cleanly even when no manifest exists. Callers handle [] by skipping the
 * mount loop entirely.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface ArchRepoEntry {
  /** Logical repo identifier, e.g. "arch-dashboard". */
  repoName: string;
  /**
   * URL prefix the reverse proxy mounts, e.g. "/arch-dashboard/".
   * ALWAYS has a leading AND trailing slash (normalised on parse).
   */
  urlPrefix: string;
  /** Absolute filesystem path to the checked-out site/, e.g. "/home/kai/workspace/arch-dashboard/site". */
  sitePath: string;
}

const DEFAULT_SYSTEM_MANIFEST = "/etc/arch-tracked-repos.conf";

function defaultUserManifest(): string {
  return path.join(os.homedir(), ".config", "arch-tracked-repos.conf");
}

/**
 * Normalise a url-prefix to have both a leading and trailing slash.
 * The Express mount requires both bounds; the manifest convention (Plan 06-01)
 * already mandates this, but the loader defends against malformed rows.
 *
 * SECURITY (CR-01, Phase 06 REVIEW): the root prefix "/" is REJECTED. The
 * generalized auth-bypass predicate in app.ts (`archRepos.some(r =>
 * req.path.startsWith(r.urlPrefix))`) matches EVERY path when urlPrefix is
 * "/", which would silently disable JWT auth for the entire application.
 * Even though the manifest is root-writable, a copy-paste error (forgetting
 * the repo-name segment) would silently produce "/" — fail fast at load
 * time instead of booting into an auth-bypassed state.
 */
function normalizeUrlPrefix(prefix: string, sourcePath: string, lineNo: number): string {
  let p = prefix.trim();
  if (!p.startsWith("/")) p = "/" + p;
  if (!p.endsWith("/")) p = p + "/";
  if (p === "/") {
    throw new Error(
      `[arch-proxy] malformed manifest ${sourcePath} line ${lineNo}: ` +
      `url-prefix "/" is forbidden — it would match every path and bypass ` +
      `JWT auth app-wide (the auth predicate \`archRepos.some(r => ` +
      `req.path.startsWith(r.urlPrefix))\` returns true for all paths when ` +
      `urlPrefix is "/"). Use a specific prefix like "/<repo>-arch/" instead.`,
    );
  }
  return p;
}

/**
 * Filesystem roots the reverse proxy must NEVER serve via `express.static`,
 * regardless of what the manifest declares. These directories contain system
 * secrets, credentials, device files, or kernel state that has no legitimate
 * place behind an HTTP endpoint — even on a trusted tailscale network.
 *
 * SECURITY (CR-02, Phase 06 REVIEW): the threat model T-06-02 originally
 * called for warn-only on non-conventional paths. That posture is wrong for
 * genuinely sensitive system directories — a typo (`/etc` instead of
 * `/home/kai/workspace/etc-repo/site`) or a malicious manifest edit would
 * expose /etc/passwd, /root/.ssh/, etc. to unauthenticated HTTP. Hard-reject
 * these; warn-only for non-conventional-but-non-sensitive paths (mirrors).
 */
const SENSITIVE_SITE_PATH_PREFIXES = [
  "/etc",
  "/var",
  "/proc",
  "/sys",
  "/dev",
  "/root",
  "/boot",
  "/lib",
  "/lib64",
  "/usr",
  "/bin",
  "/sbin",
  "/run",
];

/**
 * Validate that a site-path is safe to mount via `express.static`.
 *
 * - HARD REJECT paths under sensitive system directories (see above array)
 *   OR paths that traverse into credentials/config dirs (.ssh, .config, .gnupg)
 *   anywhere along the path.
 * - WARN (but accept) paths outside `/home/kai/workspace/` that are NOT in
 *   the sensitive list — preserves the threat-model flexibility for
 *   legitimate private mirrors (e.g. /opt/mirror/, /tmp/arch-test/).
 *
 * @throws Error if the path points at a sensitive system or credentials dir.
 */
function validateSitePath(sitePath: string, sourcePath: string, lineNo: number): void {
  // Hard reject sensitive system paths. Match either the exact dir ("/etc")
  // or any path beneath it ("/etc/foo"). The prefix array stores names
  // WITHOUT a trailing slash so we can match the bare directory itself.
  for (const sensitive of SENSITIVE_SITE_PATH_PREFIXES) {
    if (sitePath === sensitive || sitePath.startsWith(sensitive + "/")) {
      throw new Error(
        `[arch-proxy] malformed manifest ${sourcePath} line ${lineNo}: ` +
        `site-path "${sitePath}" is forbidden — points at sensitive system ` +
        `directory (${sensitive}/). Refusing to mount — this would expose ` +
        `system files to unauthenticated HTTP.`,
      );
    }
  }
  // Reject any hidden credentials/config directory anywhere along the path.
  // Covers /home/kai/.ssh, /home/kai/.config, /home/kai/.gnupg, and any
  // nested traversal into them (e.g. /home/foo/bar/.ssh/backup).
  const hiddenCredsPatterns: Array<[RegExp, string]> = [
    [/(^|\/)\.ssh(\/|$)/, ".ssh (SSH credentials)"],
    [/(^|\/)\.config(\/|$)/, ".config (application secrets)"],
    [/(^|\/)\.gnupg(\/|$)/, ".gnupg (GPG keyring)"],
  ];
  for (const [pattern, label] of hiddenCredsPatterns) {
    if (pattern.test(sitePath)) {
      throw new Error(
        `[arch-proxy] malformed manifest ${sourcePath} line ${lineNo}: ` +
        `site-path "${sitePath}" is forbidden — points at credentials/config ` +
        `directory (${label}). Refusing to mount.`,
      );
    }
  }
  // Warn (but accept) paths outside the conventional workspace prefix.
  // Non-conventional does not mean sensitive — operators may keep private
  // mirrors under /opt or /tmp. The warning surfaces the deviation so it is
  // visible in the boot log without breaking legitimate use cases.
  if (!sitePath.startsWith("/home/kai/workspace/")) {
    console.warn(
      `[arch-tracked-repos] ${sourcePath} line ${lineNo}: site-path ` +
      `"${sitePath}" is outside the conventional /home/kai/workspace/ prefix ` +
      `— ensure this is an intentional private mirror and not a typo.`,
    );
  }
}

/**
 * Parse the raw manifest contents into typed entries.
 *
 * @throws Error if any non-comment, non-blank line does not split into exactly
 *   3 tab-separated columns. The error message references the 1-indexed line
 *   number for triage.
 */
function parseManifest(contents: string, sourcePath: string): ArchRepoEntry[] {
  const lines = contents.split("\n");
  const entries: ArchRepoEntry[] = [];
  lines.forEach((raw, idx) => {
    const lineNo = idx + 1;
    const line = raw.trim();
    if (line === "") return; // blank
    if (line.startsWith("#")) return; // comment
    const cols = line.split("\t");
    if (cols.length !== 3) {
      throw new Error(
        `[arch-proxy] malformed manifest ${sourcePath} line ${lineNo}: ` +
        `expected 3 tab-separated columns, got ${cols.length} ` +
        `(${JSON.stringify(raw)})`,
      );
    }
    const [repoName, urlPrefixRaw, sitePathRaw] = cols;
    const repoNameTrim = repoName.trim();
    const sitePath = sitePathRaw.trim();
    if (!repoNameTrim || !urlPrefixRaw.trim() || !sitePath) {
      throw new Error(
        `[arch-proxy] malformed manifest ${sourcePath} line ${lineNo}: ` +
        `empty field(s) in row (${JSON.stringify(raw)})`,
      );
    }
    // SECURITY (CR-01, CR-02): validate BEFORE adding to the result array.
    // Both validators throw on violation — fail-fast at load time prevents
    // the app from booting into an auth-bypassed or filesystem-leaking state.
    const urlPrefix = normalizeUrlPrefix(urlPrefixRaw, sourcePath, lineNo);
    validateSitePath(sitePath, sourcePath, lineNo);
    entries.push({
      repoName: repoNameTrim,
      urlPrefix,
      sitePath,
    });
  });
  return entries;
}

/**
 * Read + parse the manifest at `manifestPath`. Returns null if the file does
 * not exist (callers fall through to the next candidate). Throws on a present
 * but malformed file (fail-fast — silent corruption of the manifest would
 * silently drop reverse-proxy mounts).
 */
function loadFromPath(manifestPath: string): ArchRepoEntry[] | null {
  if (!fs.existsSync(manifestPath)) return null;
  const contents = fs.readFileSync(manifestPath, "utf8");
  return parseManifest(contents, manifestPath);
}

/**
 * Load the list of tracked arch repos from the manifest.
 *
 * Resolution order (first hit wins):
 *   1. `explicitPath` arg (used by tests + ad-hoc callers)
 *   2. `process.env.ARCH_TRACKED_REPOS`
 *   3. `/etc/arch-tracked-repos.conf`
 *   4. `~/.config/arch-tracked-repos.conf`
 *   5. `[]` (graceful absence — no crash)
 *
 * The result is cached per-process so repeated calls during a single boot do
 * not re-read the file. nodemon hot-reload re-imports the module, busting
 * the cache appropriately.
 *
 * @param explicitPath Optional path; bypasses env/default resolution.
 * @throws Error if a manifest exists but is malformed (3-column TSV violation).
 */
export function loadArchRepos(explicitPath?: string): ArchRepoEntry[] {
  // Cache is keyed by (explicitPath, env) so tests that swap manifests in a
  // single process do not see stale results. nodemon hot-reload re-imports
  // the module, busting the cache appropriately for dev-server reloads.
  const envPath = process.env.ARCH_TRACKED_REPOS || "";
  const cacheKey = `${explicitPath || ""}\0${envPath}`;
  if (cached !== undefined && cachedKey === cacheKey) {
    return cached;
  }

  let resolvedPath: string | undefined;
  if (explicitPath !== undefined) {
    resolvedPath = explicitPath;
  } else if (envPath) {
    resolvedPath = envPath;
  }

  let entries: ArchRepoEntry[] | null;
  if (resolvedPath) {
    entries = loadFromPath(resolvedPath);
    if (entries !== null) {
      cached = entries;
      cachedKey = cacheKey;
      return entries;
    }
    // Explicit arg OR env var pointed at a path that does not exist.
    // The caller asked for a SPECIFIC file — do NOT fall through to the
    // default chain (that would silently mask a misconfigured env var by
    // serving a stale /etc manifest). Surface the absence as [] so the boot
    // log shows "[arch-proxy] no manifest found — 0 repos mounted".
    cached = [];
    cachedKey = cacheKey;
    return [];
  }

  // Default resolution chain
  entries = loadFromPath(DEFAULT_SYSTEM_MANIFEST);
  if (entries !== null) {
    cached = entries;
    cachedKey = cacheKey;
    return entries;
  }
  entries = loadFromPath(defaultUserManifest());
  if (entries !== null) {
    cached = entries;
    cachedKey = cacheKey;
    return entries;
  }

  cached = [];
  cachedKey = cacheKey;
  return [];
}

// Module-level cache. `cached === undefined` = not yet computed; `[]` = computed+empty.
// `cachedKey` ties the cache to the resolution inputs so tests swapping manifests
// in one process get fresh reads.
let cached: ArchRepoEntry[] | undefined;
let cachedKey: string | undefined;
