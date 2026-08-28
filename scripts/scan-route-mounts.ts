/**
 * Fix-3 同病扫描(一次性):后端挂载 × handler 首段 × 前端调用 三方对照。
 *
 * 背景:08-25 路由生成器重生成把 select-winner 错挂成 /api/canvas/v2/select-winner
 * (handler 内部 /:groupId/select-winner 叠加成双重路径)→ HTTP 层全 404。
 * 本扫描系统性排查同类错位:凡前端调用的路径在后端挂载×handler 拼接表中
 * 找不到唯一匹配,即为分歧候选。
 *
 * 数据源(零逻辑复刻):
 *   - 挂载表直接解析 src/router.ts(import 行 routeN↔文件 + app.use 行 routeN↔挂载),
 *     即生成器(含 ROUTE_OVERRIDES)的真实产物,不重新实现文件名映射。
 *   - handler 首段:正则抽各路由文件 router.<method>("path")。
 *   - 前端:packages/infinite-canvas/src 下 apiCall(...) 首参 + fetch(`${API_BASE}…`)。
 *
 * 用法:仓根 `npx tsx scripts/scan-route-mounts.ts` → /tmp/fix4-divergence-report.md
 */
import { readFile, writeFile } from "fs/promises";
import path from "path";
import fg from "fast-glob";

const ROOT = process.cwd();
const FRONTEND_GLOB = "packages/infinite-canvas/src/**/*.{ts,tsx}";
const HIGH_RISK = [
  "src/routes/canvas/v2/select-winner.ts",
  "src/routes/canvas/v2/gate-ops.ts",
  "src/routes/canvas/v2/g15-ops.ts",
  "src/routes/canvas/v2/events.ts",
  "src/routes/canvas/v2/branches.ts",
  "src/routes/canvas/v2/links.ts",
  "src/routes/canvas/v2/layout.ts",
];

type Method = "get" | "post" | "put" | "patch" | "delete" | "all";
type EffectiveRoute = {
  file: string;
  mount: string; // /api/...
  handlerPath: string;
  method: Method | "(mount)";
  fullPath: string; // mount + handlerPath,参数保持原样
  segments: string[];
};

function toSegments(p: string): string[] {
  return p.split("/").filter(Boolean);
}
function isParam(seg: string): boolean {
  return seg.startsWith(":") || seg === "*" || /^\{\*?/.test(seg);
}

async function main(): Promise<void> {
  // ── 1. 解析 src/router.ts 真实挂载表 ─────────────────────────────
  const routerSrc = await readFile(path.join(ROOT, "src/router.ts"), "utf8");

  const varToFile = new Map<string, string>();
  for (const m of routerSrc.matchAll(
    /^import\s+(route\d+)\s+from\s+"(\.\/[^"]+)"/gm,
  )) {
    varToFile.set(m[1], m[2].replace(/^\.\//, "src/") + ".ts");
  }

  const fileToMount = new Map<string, string>();
  for (const m of routerSrc.matchAll(/app\.use\("([^"]+)",\s*(route\d+)\)/g)) {
    const file = varToFile.get(m[2]);
    if (file) fileToMount.set(file, m[1]);
  }
  console.log(`[scan] router.ts 挂载 ${fileToMount.size} 条`);

  // ── 2. 抽各路由文件 handler 路径 ─────────────────────────────────
  const handlerRe =
    /\brouter\s*\.\s*(get|post|put|patch|delete|all)\s*\(\s*(['"`])((?:\\.|(?!\2).)*)\2/gs;

  const routes: EffectiveRoute[] = [];
  const routeFiles = await fg("src/routes/**/*.ts", { cwd: ROOT });
  for (const file of routeFiles.sort()) {
    const mount = fileToMount.get(file);
    if (mount == null) continue; // 被 skip 或未挂载
    const src = await readFile(path.join(ROOT, file), "utf8");
    let handlerFound = false;
    for (const m of src.matchAll(handlerRe)) {
      const method = m[1] as Method;
      const handlerPath = m[3];
      const fullPath =
        handlerPath === "/" ? mount : mount.replace(/\/$/, "") + handlerPath;
      routes.push({
        file,
        mount,
        handlerPath,
        method,
        fullPath,
        segments: toSegments(fullPath),
      });
      handlerFound = true;
    }
    if (!handlerFound) {
      // 无显式 router.<method>("path") → 挂载点即端点
      routes.push({
        file,
        mount,
        handlerPath: "/",
        method: "(mount)",
        fullPath: mount,
        segments: toSegments(mount),
      });
    }
  }
  console.log(`[scan] 有效路由 ${routes.length} 条`);

  // ── 3. 抽前端调用路径 ────────────────────────────────────────────
  type FrontCall = { path: string; kind: string; file: string; line: number };
  const frontCalls: FrontCall[] = [];
  const frontFiles = await fg(FRONTEND_GLOB, {
    cwd: ROOT,
    ignore: ["**/__tests__/**", "**/*.test.*"],
  });

  function addCall(rawUrl: string, kind: string, file: string, idx: number) {
    let url = rawUrl;
    // 查询串模板:前一个字符不是 / 的插值(${query}/${queryParams}/${qs}…)
    // 一律视为 query 后缀,连同其后内容丢弃(查询串必在末尾)。
    url = url.replace(/(?<!\/)\$\{[^}]*\}.*$/, "");
    // 其余插值 → :param
    url = url.replace(/\$\{[^}]*\}/g, ":param");
    url = url.replace(/\?$/, "");
    if (url.startsWith("/")) {
      frontCalls.push({ path: url, kind, file, line: idx + 1 });
    }
  }

  for (const file of frontFiles) {
    const src = await readFile(path.join(ROOT, file), "utf8");
    // apiCall<T?>( 'path' | "path" | `path` — 首参
    for (const m of src.matchAll(
      /\bapiCall\s*(?:<[^>(]*>)?\(\s*(['"`])((?:\\.|(?!\1).)*)\1/gs,
    )) {
      const line = src.slice(0, m.index ?? 0).split("\n").length - 1;
      addCall(m[2], "apiCall", file, line);
    }
    // fetch(`${API_BASE}…`) 或已赋值模板(`${API_BASE}…` 出现即按 URL 处理)
    for (const m of src.matchAll(/`([^`]*\$\{API_BASE\}[^`]*)`/g)) {
      const line = src.slice(0, m.index ?? 0).split("\n").length - 1;
      addCall(m[1].replace(/\$\{API_BASE\}/g, ""), "fetch(API_BASE)", file, line);
    }
    // fetch('/api/…') 绝对字面量
    for (const m of src.matchAll(/fetch\(\s*(['"])(\/api[^'"]*)\1/g)) {
      const line = src.slice(0, m.index ?? 0).split("\n").length - 1;
      addCall(m[2].replace(/^\/api/, ""), "fetch(/api)", file, line);
    }
  }
  console.log(`[scan] 前端调用 ${frontCalls.length} 条`);

  // ── 4. 匹配 ─────────────────────────────────────────────────────
  // 前端路径不带 /api 前缀(apiCall 在 fetch 时才拼 API_BASE),后端 fullPath 带
  // → 对比时剥掉后端首段 "api"。
  function matchCount(callSegs: string[]): EffectiveRoute[] {
    return routes.filter((r) => {
      const segs = r.segments[0] === "api" ? r.segments.slice(1) : r.segments;
      if (segs.length !== callSegs.length) return false;
      return segs.every((seg, i) => {
        const c = callSegs[i];
        return seg === c || isParam(seg) || c === ":param" || isParam(c);
      });
    });
  }

  // ── 5. 报告 ─────────────────────────────────────────────────────
  const out: string[] = [];
  out.push("# Fix-4 同病扫描 — 路由挂载 × handler 首段 × 前端调用 对照报告");
  out.push("");
  out.push("- 生成时间: 2026-08-28(脚本 scripts/scan-route-mounts.ts,一次性)");
  out.push(
    `- 数据源: src/router.ts 挂载 ${fileToMount.size} 条 / 有效路由 ${routes.length} 条 / 前端调用 ${frontCalls.length} 条(packages/infinite-canvas/src,排除 __tests__)`,
  );
  out.push(
    "- 匹配规则: 前端插值 `${…}` 与后端 `:param`/`*` 互为通配,段数一致且逐段兼容即命中",
  );
  out.push("");

  // 5a. 病灶确认
  out.push("## ① 病灶确认(已修)");
  out.push("");
  const sw = routes.filter(
    (r) => r.file === "src/routes/canvas/v2/select-winner.ts",
  );
  for (const r of sw) {
    out.push(
      `- select-winner.ts → 挂载 \`${r.mount}\` + handler \`${r.handlerPath}\` = \`${r.fullPath}\``,
    );
  }
  const feSw = frontCalls.filter((c) => c.path.includes("select-winner"));
  for (const c of feSw) {
    const hits = matchCount(toSegments(c.path));
    out.push(
      `- 前端 ${c.file}:${c.line} \`${c.path}\` → 命中 ${hits.length} 条后端路由`,
    );
  }
  out.push("");

  // 5b. 高危六文件 handler 首段体检
  out.push("## ② 高危文件 handler 首段体检(文件名派生挂载是否成立)");
  out.push("");
  out.push("| 文件 | 挂载 | handler 首段 | 判定 |");
  out.push("|---|---|---|---|");
  for (const f of HIGH_RISK) {
    const rs = routes.filter((r) => r.file === f);
    const mount = fileToMount.get(f) ?? "(未挂载)";
    const firsts = [
      ...new Set(rs.map((r) => toSegments(r.handlerPath)[0] ?? "(root)")),
    ];
    // select-winner 型病灶 = 该文件所有 handler 路由首段都是 :param(挂载必须
    // 被重映射,文件名派生必错)。文件里同时存在 root(/)路由时,:param 只是
    // 同挂载下的子路由资源,文件名派生成立。
    const allParamFirst =
      rs.length > 0 &&
      rs.every((r) => (toSegments(r.handlerPath)[0] ?? "").startsWith(":"));
    const verdict = allParamFirst
      ? "🚨 select-winner 型:全部路由首段为 :param,文件名派生挂载必错,需 ROUTE_OVERRIDES"
      : "✅ 文件名派生挂载成立(:param 子路由同挂载生效,终判见 ③)";
    out.push(
      `| ${f} | \`${mount}\` | ${firsts
        .map((s) => `\`${s}\``)
        .join(" / ")} | ${verdict} |`,
    );
  }
  out.push("");

  // 5c. 前端调用全对照
  out.push("## ③ 前端调用 → 后端路由 全对照(分歧即 404)");
  out.push("");
  out.push("| 前端调用 | 位置 | 后端命中 | 判定 |");
  out.push("|---|---|---|---|");
  const missing: FrontCall[] = [];
  for (const c of frontCalls) {
    const segs = toSegments(c.path);
    const hits = matchCount(segs);
    const loc = `${c.file}:${c.line}`;
    if (hits.length === 0) {
      missing.push(c);
      out.push(`| \`${c.path}\` | ${loc} | — | ❌ 404(无匹配) |`);
    } else if (hits.length === 1) {
      out.push(
        `| \`${c.path}\` | ${loc} | \`${hits[0].method.toUpperCase()} ${hits[0].fullPath}\` (${hits[0].file}) | ✅ 唯一 |`,
      );
    } else {
      out.push(
        `| \`${c.path}\` | ${loc} | ${hits
          .map((h) => `\`${h.method.toUpperCase()} ${h.fullPath}\``)
          .join("<br>")} | ⚠️ 多匹配(${hits.length}) |`,
      );
    }
  }
  out.push("");

  // 5d. 后端 canvas v2 路由未被前端引用清单(信息面)
  out.push("## ④ /api/canvas/* 后端路由未被前端引用清单(信息面,非缺陷)");
  out.push("");
  out.push("| 后端路由 | 文件 |");
  out.push("|---|---|");
  const canvasRoutes = routes.filter((r) => r.mount.startsWith("/api/canvas"));
  for (const r of canvasRoutes) {
    const called = frontCalls.some((c) =>
      matchCount(toSegments(c.path)).includes(r),
    );
    if (!called) {
      out.push(`| \`${r.method.toUpperCase()} ${r.fullPath}\` | ${r.file} |`);
    }
  }
  out.push("");

  // 5e. 分歧逐条定性(人工复核结论,2026-08-28;随脚本固化保证重跑可复现)
  const NOTES: Record<string, string> = {
    "/canvas/storyboard/preview":
      "死代码:previewStoryboard 无 UI/store 调用方。后端真实端点是 camelCase 单段 `/canvas/storyboardPreview`(storyboardPreview.ts),前端误写三段斜杠式。若复活需改调 `/canvas/storyboardPreview`。",
    "/v2/canvas/nodes":
      "死代码:createNode 无调用方。词序反转(/v2/canvas/* vs 后端 /canvas/v2/*),真后端必 404。",
    "/v2/canvas/branches":
      "死代码:createBranch 无调用方(canvasStore:1045 注释证实 branch 创建 REST 已删,分支经 save-v2 全量写)。词序反转同上。",
    "/v2/canvas/branches/:param":
      "**活代码,真实 404**:updateBranch ← canvasStore.selectBranchAsMain(canvasStore.ts:1074)← BranchPanel.tsx:85「升主线」(55-06)。PATCH 打到 /api/v2/canvas/branches/:id,后端只有 /api/canvas/v2/branches → 升主线必失败走 catch 回滚。与 select-winner 同族(契约层错位),但根因在前端词序,不在挂载;待批修复(建议前端改 `/canvas/v2/branches/:id`)。",
    "/v2/canvas/layout":
      "死代码:requestLayout 无调用方。词序反转同上。",
  };
  out.push("## ⑤ 分歧逐条定性(人工复核 2026-08-28)");
  out.push("");
  if (missing.length === 0) {
    out.push("- 无 404 分歧。");
  } else {
    out.push(`共 ${missing.length} 条前端调用在后端无匹配:`);
    out.push("");
    for (const c of missing) {
      out.push(
        `### \`${c.path}\` (${c.file}:${c.line}, ${c.kind})`,
      );
      out.push("");
      out.push(NOTES[c.path] ?? "(待人工复核)");
      out.push("");
    }
  }
  out.push("## ⑥ 结论");
  out.push("");
  out.push(
    "- 挂载层(文件名派生 × handler 首段)同病扫描:**仅 select-winner 一例**(已由 Fix-4 ROUTE_OVERRIDES 修复);高危六文件(gate-ops/g15-ops/events/branches/links/layout)文件名派生挂载全部成立。",
  );
  out.push(
    "- 其余 404 分歧是**前端路径词序反转**(/v2/canvas/* ≠ /canvas/v2/*)与死代码,非挂载层病灶;本轮红线**只修 select-winner**,上表定性待批。",
  );

  await writeFile("/tmp/fix4-divergence-report.md", out.join("\n"), "utf8");
  console.log(
    `[scan] 报告 → /tmp/fix4-divergence-report.md(${missing.length} 条 404 分歧)`,
  );
}

main().catch((err) => {
  console.error("[scan] 失败:", err);
  process.exit(1);
});
