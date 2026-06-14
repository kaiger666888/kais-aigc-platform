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
  /(^|\/)_helpers\//i,             // helper modules
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
    const routePath = fileNameToRoutePath(routeKey);
    routeModulePairs.push({ routePath, varName, entry });
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
