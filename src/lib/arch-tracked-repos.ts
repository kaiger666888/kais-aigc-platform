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
 */
function normalizeUrlPrefix(prefix: string): string {
  let p = prefix.trim();
  if (!p.startsWith("/")) p = "/" + p;
  if (!p.endsWith("/")) p = p + "/";
  return p;
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
    entries.push({
      repoName: repoNameTrim,
      urlPrefix: normalizeUrlPrefix(urlPrefixRaw),
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
