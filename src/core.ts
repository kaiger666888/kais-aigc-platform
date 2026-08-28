import fg from "fast-glob";
import path from "path";
import { readFile, writeFile } from "fs/promises";
import crypto from "crypto";

/**
 * Skip patterns for non-route files inside src/routes/.
 *
 * v1.5 CORE-01: previously, fast-glob scanned ALL .ts files under src/routes/
 * and registered each as a route. Config-only files (config.ts) and shared
 * modules (_shared/, _lib/) were incorrectly registered as empty route
 * handlers, polluting the route table and risking silent middleware chains.
 *
 * These patterns are matched against the path relative to src/routes/.
 */
const SKIP_PATTERNS: RegExp[] = [
  /(^|\/)config\.ts$/i,            // any path ending in config.ts
  /(^|\/)constants\.ts$/i,         // any path ending in constants.ts
  /(^|\/)types\.ts$/i,             // type-only modules
  /(^|\/)_shared\//i,              // shared code dirs
  /(^|\/)_lib\//i,                 // lib dirs
  /(^|\/)_internal\//i,            // internal modules
  /(^|\/)_helpers\//i,             // helper module dirs
  /(^|\/)[^/]+-helpers\.ts$/i,     // helper module files (e.g. graph-helpers.ts) — no default export
  /(^|\/)_[^/]+\.ts$/i,            // underscore-prefixed files (e.g. _engine.ts, _simulate.ts) — internal modules
  /(^|\/)shared\.ts$/i,            // shared util modules (e.g. stableaudio/shared.ts) — no default export
  /(^|\/)prompt-guide\.ts$/i,      // doc/guide modules (e.g. stableaudio/prompt-guide.ts) — no default export
  /(^|\/)__tests__\//i,            // 路由级测试目录 (e.g. indextts2/__tests__/) — 无路由 default export
  /(^|\/)[^/]+\.test\.ts$/i,       // 测试文件 — 无路由 default export
  /(^|\/)[^/]+\.spec\.ts$/i,       // 测试文件 — 无路由 default export
];

function shouldSkip(routeKey: string): boolean {
  return SKIP_PATTERNS.some((re) => re.test(routeKey));
}

function fileNameToRoutePath(fileName: string): string {
  let routePath = fileName.replace(/\.(ts)$/, "");
  routePath = routePath.split(path.sep).join("/");
  routePath = routePath.replace(/\[([^\]]+)\]/g, (_, p1: string) => (p1.startsWith("...") ? "*" : `:${p1}`));
  if (routePath === "index") return "/";
  routePath = routePath.replace(/\/index$/, "");
  routePath = "/" + routePath.replace(/\/+/g, "/").replace(/\/$/, "");
  return routePath;
}

/**
 * Route-path override table.
 *
 * The auto-generator maps file paths to mount paths mechanically
 * (e.g. v1/skills/get → /api/v1/skills/get). Some route groups need
 * parameterized mount paths that the generator cannot infer from the file
 * name alone. Each entry remaps the generated path to the correct one.
 *
 * Key: the auto-generated routePath (relative, e.g. "/v1/skills/get").
 * Value: the correct routePath to use instead.
 *
 * Entries MUST be sorted so that literal paths (e.g. /v1/skills/register)
 * appear before parameterized paths (e.g. /v1/skills/:skillId) — Express
 * matches routes in mount order, and "register" would otherwise be captured
 * by :skillId.
 */
const ROUTE_OVERRIDES: Record<string, string> = {
  // skills sub-routers that carry :skillId in the mount path (mergeParams)
  "/v1/skills/get": "/v1/skills/:skillId",          // handler: GET /
  "/v1/skills/node-types": "/v1/skills/:skillId",    // handler: GET /node-types
  "/v1/skills/phases": "/v1/skills/:skillId",        // handler: GET /phases
  // list expects mount at /v1/skills (handler: GET /), NOT /v1/skills/list
  "/v1/skills/list": "/v1/skills",
  // register stays as literal /v1/skills/register (correct as-is, handler: POST /)
  // select-winner handler 内部路径是 /:groupId/select-winner,
  // 挂载必须在 /canvas/v2/variant-groups (与前端 canvasApi.ts 契约一致)。
  // 文件名派生会错挂成 /canvas/v2/select-winner → 双重路径 404 (08-25 实锤)。
  "/canvas/v2/select-winner": "/canvas/v2/variant-groups",
};

function applyRouteOverride(routePath: string): string {
  return ROUTE_OVERRIDES[routePath] ?? routePath;
}

type RouteModulePair = { routePath: string; varName: string; entry: string };

export default async function generateRouter(): Promise<void> {
  // glob 得到 entries
  let entries: string[] = await fg(["src/routes/**/*.ts"]);
  // 排序
  entries = entries.sort((a, b) => a.localeCompare(b));

  const importLines: string[] = [];
  const routeModulePairs: RouteModulePair[] = [];
  const skipped: string[] = [];

  entries.forEach((entry: string) => {
    const routeKey = path.relative("src/routes", entry).replace(/\\/g, "/");
    if (shouldSkip(routeKey)) {
      skipped.push(routeKey);
      return;
    }
    const i = routeModulePairs.length;
    const varName = `route${i + 1}`;
    let importPath = path.relative("src", entry).replace(/\\/g, "/");
    if (!importPath.startsWith(".")) importPath = "./" + importPath;
    importPath = importPath.replace(/\.ts$/, "");
    importLines.push(`import ${varName} from "${importPath}";`);
    const routePath = applyRouteOverride(fileNameToRoutePath(routeKey));
    routeModulePairs.push({ routePath, varName, entry });
  });

  // Sort: literal paths before parameterized paths sharing the same prefix.
  // E.g. /v1/skills/register and /v1/skills/list must come before
  // /v1/skills/:skillId, otherwise Express treats "register"/"list" as a
  // skillId value. We compare the routePath after removing any trailing
  // sub-path segment (handler-level) so all /v1/skills/* siblings group together.
  routeModulePairs.sort((a, b) => {
    const segA = a.routePath.split("/");
    const segB = b.routePath.split("/");
    // Compare segment by segment
    for (let i = 0; i < Math.min(segA.length, segB.length); i++) {
      const sa = segA[i];
      const sb = segB[i];
      if (sa === sb) continue;
      const aIsParam = sa.startsWith(":");
      const bIsParam = sb.startsWith(":");
      if (aIsParam && !bIsParam) return 1;   // literal first
      if (!aIsParam && bIsParam) return -1;
      return sa.localeCompare(sb);            // both literal or both param
    }
    return segA.length - segB.length;
  });

  if (skipped.length > 0) {
    console.log(`[router-gen] Skipped ${skipped.length} non-route file(s): ${skipped.join(", ")}`);
  }

  const routerData = JSON.stringify(routeModulePairs.map(({ routePath, varName }) => ({ routePath, varName })));
  const hash = crypto.createHash("md5").update(routerData).digest("hex");

  let content = `// @routes-hash ${hash}\nimport { Express } from "express";\n\n`;
  content += `${importLines.join("\n")}\n\n`;
  content += `export default async (app: Express) => {\n`;
  for (const { routePath, varName } of routeModulePairs) {
    content += `  app.use("/api${routePath}", ${varName});\n`;
  }
  content += `}\n`;

  let needWrite = true;
  try {
    const current = await readFile("src/router.ts", "utf8");
    const match = current.match(/^\/\/\s*@routes-hash\s*([a-z0-9]+)\n/);
    const currentHash = match ? match[1] : null;
    if (currentHash === hash) {
      needWrite = false;
    }
  } catch {
    needWrite = true;
  }
  if (needWrite) await writeFile("src/router.ts", content, "utf8");
}
