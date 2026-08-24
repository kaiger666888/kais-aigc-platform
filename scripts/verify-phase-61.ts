#!/usr/bin/env tsx
/**
 * verify-phase-61.ts — Phase 61 (audit-debt-clearance) aggregate contract
 * gate. verify-phase-60.ts 同骨架: assert/read/exists/runCmd/results 收集
 * + 末尾失败计数 → process.exit(0 全绿 / 1 任一失败 / 2 crash)。
 *
 * 四笔审计债(DEBT-01..04, TD-3/4/5)的 phase 验收统一为一条命令:
 *
 *   S 静态锁段(61-01..04 产物 grep 锚,与实际文本一致):
 *     S1 (DEBT-02) reviewBridge 尾斜杠: /api/v1/reviews/? ≥ 2 处
 *        (模块头契约注释 + 列表代码字面量);裸 /api/v1/reviews? 零残留
 *        (54-01 S1 先例同款正负双锚)。
 *     S2 (DEBT-04) node:created canonical 写回: FlowCanvas.tsx
 *        onNewAsset 块切片(内容锚: 块起 'onNewAsset:' 止
 *        'onOrchestrateStart:',切片按内容锚提取,禁绝对行号——61-04
 *        verdict 规格)内 addNodeFromSocket ≥1 且 setNodes 调用
 *        ('setNodes(' 调用句法锚——块内合法的「不再 setNodes 直写」退役
 *        注释不含调用括号,不计)为 0;useCanvasSocket.ts 含
 *        socket.on('node:created' 订阅与 payload?.node 形状守卫。
 *     S3 (DEBT-01) 拖入链: FlowCanvas anchor:'source' 恰 1 处 + onDrop
 *        处理器在场;canvasApi placeAssetNode + '/canvas/v2/nodes/'
 *        POST 字面量;AssetLibrary ASSET_DRAG_MIME + draggable;负向:
 *        packages/infinite-canvas/src 递归 .ts/.tsx 三退役 token
 *        (placeAssetOnCanvas/handleAddToCanvas/am-card__add)零命中;
 *        mock server.mjs 两条新路由;phase61-debt.mjs e2e 文件在场。
 *     S4 (DEBT-03) migrate.ts 计数锁(58-04 纪律: == 而非 ≥,防重复接线):
 *        d.emotion != null == 2(audio 既有 + script 新增)/
 *        d.promptMeta|murchGrade|archetype|viewAngle != null 各 == 1。
 *     S5 (DEBT-04 文档) 61-DEBT-04-VERDICT.md 存在且含 'Branch A' 与
 *        'addNodeFromSocket'(裁定文档与代码事实由门强制一致,T-61-10)。
 *   B 行为门段(spawn 子进程,49-01 教训: 不与父进程共享 knex/事件循环):
 *     B1 根 npx tsc --noEmit / B2 flowgraph-v3 npm test /
 *     B3 infinite-canvas npm test / B4 根 reviewBridge node:test
 *     (process.execPath 参数数组直拼不经 shell,解析 ℹ pass/ℹ fail 计数)
 *     / B5 infinite-canvas npm run build(dist 纪律: e2e 跑 build 产物,
 *     B6 之前)/ B6 phase61 e2e 三用例整文件。
 *   F forced-failure 自检段(T-60-09 假绿缓解,门能红证明): S1/S2/S4 三锁
 *     各以一个「内存变异样本」跑同一检查函数(锁与自检同源,非两套逻辑)
 *     ——必须判 false。任一变异样本被判 true(锁恒真)→ 整门 exit 1。
 *     变异样本全为脚本内字符串替换,不写任何真实文件。
 *
 * 零 live probe 裁定(orchestrator): 四债全可 mock/静态锁定;review-nginx
 * 活体证据已存档 61-RESEARCH。本门不写任何 live URL/端口号字面量,不做
 * 任何网络探测。
 *
 * Run: npm run verify:phase-61   (or: npx tsx scripts/verify-phase-61.ts)
 * Exit: 0 全绿 / 1 任一失败 / 2 crash
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

interface TestResult { name: string; pass: boolean; detail?: string; }
const results: TestResult[] = [];
function assert(cond: boolean, name: string, detail?: string): void {
  results.push({ name, pass: cond, detail });
  console.log(`  ${cond ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
}

const REPO_ROOT = path.resolve(__dirname, "..");
function read(rel: string): string {
  const p = path.join(REPO_ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}
function exists(rel: string): boolean {
  return fs.existsSync(path.join(REPO_ROOT, rel));
}

/** B 段命令门: cwd + 命令,tail 摘要;非零 exit 红(59/60 同款)。 */
function runCmd(name: string, cwdRel: string, cmd: string, tailLines = 3): void {
  const res = spawnSync(cmd, {
    cwd: path.join(REPO_ROOT, cwdRel),
    shell: true,
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const out = (res.stdout ?? "") + (res.stderr ?? "");
  const tail = out.split("\n").filter((l) => l.trim().length > 0).slice(-tailLines).join(" | ");
  assert(
    res.status === 0,
    `cmd: ${name} (exit ${res.status})`,
    res.status === 0 ? tail.slice(0, 160) : tail.slice(-300),
  );
}

/** 字面量子串计数(indexOf 循环,非正则——避免元字符歧义)。 */
function countOcc(text: string, needle: string): number {
  let n = 0;
  let i = text.indexOf(needle);
  while (i >= 0) { n += 1; i = text.indexOf(needle, i + needle.length); }
  return n;
}

// ── 可复用锁检查函数(F 段对同函数跑变异样本——锁与自检同源,非两套逻辑) ──

interface LockOutcome { ok: boolean; detail: string; }

/**
 * S1 (DEBT-02) 尾斜杠锁(纯函数: 输入 reviewBridge.ts 源文本)。
 * 正: '/api/v1/reviews/?' ≥ 2(模块头契约注释 + 列表代码字面量);
 * 负: 裸 '/api/v1/reviews?' == 0(两者字符上互斥,无重叠计数)。
 */
export function checkSlashLock(text: string): LockOutcome {
  const pos = countOcc(text, "/api/v1/reviews/?");
  const neg = countOcc(text, "/api/v1/reviews?");
  return {
    ok: pos >= 2 && neg === 0,
    detail: `slashed=${pos}(≥2) bare=${neg}(==0)`,
  };
}

/**
 * S2 (DEBT-04) node:created canonical 写回锁(纯函数)。
 * onNewAsset 块切片(内容锚 'onNewAsset:' → 'onOrchestrateStart:',禁行号)
 * 内 addNodeFromSocket ≥1;setNodes 调用('setNodes(' 调用句法) == 0
 * (块内「不再 setNodes 直写」退役注释不含调用括号,不计——锚精度勘正);
 * socketSrc 含 node:created 订阅 + payload?.node 形状守卫。
 */
export function checkNewAssetChain(flowSrc: string, socketSrc: string): LockOutcome {
  const startIdx = flowSrc.indexOf("onNewAsset:");
  if (startIdx < 0) return { ok: false, detail: "onNewAsset 回调块不可定位" };
  const endIdx = flowSrc.indexOf("onOrchestrateStart:", startIdx);
  if (endIdx < 0) return { ok: false, detail: "onOrchestrateStart 终止锚不可定位" };
  const block = flowSrc.slice(startIdx, endIdx);
  const addCount = countOcc(block, "addNodeFromSocket");
  const setCall = countOcc(block, "setNodes(");
  const socketOk =
    socketSrc.includes("socket.on('node:created'") && socketSrc.includes("payload?.node");
  return {
    ok: addCount >= 1 && setCall === 0 && socketOk,
    detail: `切片内 addNodeFromSocket=${addCount}(≥1) setNodes(=${setCall}(==0);socket node:created 订阅+payload?.node 守卫=${socketOk}`,
  };
}

/**
 * S4 (DEBT-03) migrate.ts buildMeta 计数锁(纯函数;58-04 纪律: == 而非
 * ≥,防重复接线)。emotion == 2(script number + audio string 双分支);
 * promptMeta/murchGrade/archetype/viewAngle 各 == 1。
 */
export function checkMetaCounts(text: string): LockOutcome {
  const c = {
    emotion: countOcc(text, "d.emotion != null"),
    promptMeta: countOcc(text, "d.promptMeta != null"),
    murchGrade: countOcc(text, "d.murchGrade != null"),
    archetype: countOcc(text, "d.archetype != null"),
    viewAngle: countOcc(text, "d.viewAngle != null"),
  };
  const ok =
    c.emotion === 2 && c.promptMeta === 1 && c.murchGrade === 1 &&
    c.archetype === 1 && c.viewAngle === 1;
  return {
    ok,
    detail: `emotion=${c.emotion}==2 promptMeta=${c.promptMeta}==1 murchGrade=${c.murchGrade}==1 archetype=${c.archetype}==1 viewAngle=${c.viewAngle}==1`,
  };
}

/** S3 负向扫描: packages/infinite-canvas/src 递归 .ts/.tsx 退役 token 零命中(60 S4 扫法同款)。 */
function scanRetiredTokens(relDir: string): string[] {
  const tokens = ["placeAssetOnCanvas", "handleAddToCanvas", "am-card__add"];
  const hits: string[] = [];
  const walk = (absDir: string): void => {
    for (const ent of fs.readdirSync(absDir, { withFileTypes: true })) {
      const abs = path.join(absDir, ent.name);
      if (ent.isDirectory()) { walk(abs); continue; }
      if (!/\.(ts|tsx)$/.test(ent.name)) continue;
      try {
        const txt = fs.readFileSync(abs, "utf8");
        for (const t of tokens) {
          if (txt.includes(t)) hits.push(`${path.relative(REPO_ROOT, abs)} [${t}]`);
        }
      } catch { /* unreadable: skip */ }
    }
  };
  walk(path.join(REPO_ROOT, relDir));
  return hits;
}

function main(): void {
  console.log("=== Phase 61 — verify-phase-61.ts (audit-debt-clearance aggregate gate: DEBT-01..04 静态锁 + 行为门 + forced-failure) ===\n");

  // ═══ S — 静态锁段 ═════════════════════════════════════════════════════════
  console.log("=== S 静态锁: S1 尾斜杠 / S2 canonical 写回 / S3 拖入链 / S4 计数锁 / S5 裁定文档 ===");
  const reviewBridgeSrc = read("src/lib/reviewBridge.ts");
  const flowSrc = read("packages/infinite-canvas/src/components/FlowCanvas.tsx");
  const socketSrc = read("packages/infinite-canvas/src/hooks/useCanvasSocket.ts");
  const canvasApiSrc = read("packages/infinite-canvas/src/services/canvasApi.ts");
  const assetLibSrc = read("packages/infinite-canvas/src/components/assetManager/AssetLibrary.tsx");
  const mockServerSrc = read("packages/infinite-canvas/test/e2e/mock-backend/server.mjs");
  const migrateSrc = read("packages/flowgraph-v3/ts/src/migrate.ts");

  // S1 (DEBT-02) reviewBridge 尾斜杠(检查函数与 F1 变异自检同源)
  const s1 = checkSlashLock(reviewBridgeSrc);
  assert(s1.ok, "S1 (DEBT-02): reviewBridge 尾斜杠——slashed ≥2 + 裸斜杠 0(307 中间跳源码级消除)", s1.detail);

  // S2 (DEBT-04) node:created canonical 写回(检查函数与 F2 变异自检同源)
  const s2 = checkNewAssetChain(flowSrc, socketSrc);
  assert(s2.ok, "S2 (DEBT-04): onNewAsset 切片 addNodeFromSocket≥1/setNodes 调用 0 + socket 形状守卫(Branch A)", s2.detail);

  // S3 (DEBT-01) 拖入链(多正锚 + 负向递归扫描 + mock/e2e 存在性)
  assert(
    countOcc(flowSrc, "anchor: 'source'") === 1,
    "S3 (DEBT-01): FlowCanvas anchor:'source' 恰 1 处(placeNewAsset source 锚唯一活调用方)",
    `count=${countOcc(flowSrc, "anchor: 'source'")}`,
  );
  assert(
    flowSrc.includes("handleAssetDrop") && flowSrc.includes("onDrop={handleAssetDrop}"),
    "S3 (DEBT-01): FlowCanvas onDrop 处理器在场(handleAssetDrop 绑定 ReactFlow onDrop)",
  );
  assert(
    canvasApiSrc.includes("placeAssetNode") && canvasApiSrc.includes("'/canvas/v2/nodes/'"),
    "S3 (DEBT-01): canvasApi placeAssetNode 封装 + '/canvas/v2/nodes/' POST 字面量",
  );
  assert(
    assetLibSrc.includes("ASSET_DRAG_MIME") && assetLibSrc.includes("draggable"),
    "S3 (DEBT-01): AssetLibrary ASSET_DRAG_MIME 契约 + 卡片 draggable",
  );
  const retiredHits = scanRetiredTokens(path.join("packages", "infinite-canvas", "src"));
  assert(
    retiredHits.length === 0,
    "S3 (DEBT-01): src 递归 .ts/.tsx 三退役 token(placeAssetOnCanvas/handleAddToCanvas/am-card__add)零命中",
    retiredHits.length === 0 ? "" : `命中: ${retiredHits.join(", ")}`,
  );
  assert(
    mockServerSrc.includes("app.post('/api/canvas/v2/nodes/'") &&
      mockServerSrc.includes("app.post('/api/v1/assets-registry/search'"),
    "S3 (DEBT-01): mock server 两条新路由(POST /api/canvas/v2/nodes/ + /api/v1/assets-registry/search)",
  );
  assert(
    exists("packages/infinite-canvas/test/e2e/tests/phase61-debt.mjs"),
    "S3 (DEBT-01): phase61-debt.mjs e2e 文件在场",
  );

  // S4 (DEBT-03) migrate.ts 计数锁(检查函数与 F3 变异自检同源)
  const s4 = checkMetaCounts(migrateSrc);
  assert(s4.ok, "S4 (DEBT-03): migrate.ts buildMeta 五句式计数锁(emotion==2 其余各==1)", s4.detail);

  // S5 (DEBT-04 文档) 裁定文档存在性
  {
    const verdictPath = ".planning/phases/61-audit-debt-clearance/61-DEBT-04-VERDICT.md";
    const verdictSrc = read(verdictPath);
    assert(
      exists(verdictPath) && verdictSrc.includes("Branch A") && verdictSrc.includes("addNodeFromSocket"),
      "S5 (DEBT-04): 61-DEBT-04-VERDICT.md 存在且含 Branch A 裁定 + addNodeFromSocket 锚(T-61-10)",
    );
  }

  // ═══ B — 行为门段(spawn 子进程) ══════════════════════════════════════════
  console.log("\n=== B 行为门: 根 tsc / flowgraph-v3 vitest / infinite-canvas vitest / reviewBridge node:test / canvas build(dist 纪律) / phase61 e2e ===");
  runCmd("B1 root tsc --noEmit", ".", "npx tsc --noEmit", 2);
  runCmd(
    "B2 flowgraph-v3 npm test(migrate/buildMeta 139 用例)",
    "packages/flowgraph-v3",
    "npm test",
    3,
  );
  runCmd(
    "B3 infinite-canvas npm test(vitest run 全量)",
    "packages/infinite-canvas",
    "npm test",
    3,
  );

  // B4 reviewBridge node:test: 参数数组直拼不经 shell(49-01 范式),解析 ℹ pass/ℹ fail 计数
  {
    const res = spawnSync(
      process.execPath,
      ["--import", "tsx", "--test", "src/lib/__tests__/reviewBridge.test.ts"],
      { cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
    );
    const out = (res.stdout ?? "") + (res.stderr ?? "");
    const passM = /ℹ pass (\d+)/.exec(out);
    const failM = /ℹ fail (\d+)/.exec(out);
    const passN = passM ? parseInt(passM[1], 10) : 0;
    const failN = failM ? parseInt(failM[1], 10) : -1;
    assert(
      res.status === 0 && failN === 0 && passN >= 3,
      `B4 reviewBridge node:test(pass=${passN} ≥3, fail=${failN} ==0)`,
      res.status === 0 ? "" : out.split("\n").filter((l) => l.trim()).slice(-3).join(" | ").slice(-300),
    );
  }

  runCmd(
    "B5 infinite-canvas build(dist 纪律: B6 e2e 跑 build 产物非源码)",
    "packages/infinite-canvas",
    "npm run build",
    3,
  );
  runCmd(
    "B6 phase61 e2e 三用例整文件",
    "packages/infinite-canvas",
    "npx playwright test test/e2e/tests/phase61-debt.mjs",
    3,
  );

  // ═══ F — forced-failure 自检段(门能红证明;变异样本全为内存字符串,不写盘) ════
  console.log("\n=== Forced-failure self-check (gate can actually fail — expected FAILs below; 变异样本不写真实文件) ===");
  const selfCheckShadow: TestResult[] = [];
  const shadowAssert = (cond: boolean, name: string): void => {
    selfCheckShadow.push({ name, pass: cond });
    console.log(`  SELF-CHECK ${cond ? "UNEXPECTED-PASS" : "expected-FAIL ok"}: ${name}`);
  };

  // F1 变异样本: 尾斜杠删除(61-02 pre-fix 现场)——同一 checkSlashLock 必须判 false
  const slashMutant = reviewBridgeSrc.split("/api/v1/reviews/?").join("/api/v1/reviews?");
  shadowAssert(
    checkSlashLock(slashMutant).ok,
    "F1 变异样本(删尾斜杠)必须使 S1 尾斜杠锁判 false",
  );

  // F2 变异样本: 块内 addNodeFromSocket 全替换为 setNodes(I5 setNodes 直写复活现场)
  // ——同一 checkNewAssetChain 必须判 false(正锚失 + setNodes( 调用复活,双红)
  const chainMutant = flowSrc.split("addNodeFromSocket").join("setNodes");
  shadowAssert(
    checkNewAssetChain(chainMutant, socketSrc).ok,
    "F2 变异样本(addNodeFromSocket→setNodes)必须使 S2 canonical 写回锁判 false",
  );

  // F3 变异样本: 删一行 promptMeta 读回(pre-fix buildMeta 缺口现场)
  // ——同一 checkMetaCounts 必须判 false
  const metaMutant = migrateSrc
    .split("\n")
    .filter((l) => !l.includes("d.promptMeta != null"))
    .join("\n");
  shadowAssert(
    checkMetaCounts(metaMutant).ok,
    "F3 变异样本(删 promptMeta 读回行)必须使 S4 计数锁判 false",
  );

  const shadowFailed = selfCheckShadow.filter((r) => !r.pass).length;
  assert(
    selfCheckShadow.length >= 3 && selfCheckShadow.every((r) => !r.pass),
    "forced-failure self-check: 三个变异样本全部被对应锁判 false(锁非恒真,门能红)",
    `shadow: ${selfCheckShadow.length - shadowFailed}/${selfCheckShadow.length} unexpectedly passed`,
  );

  // ═══ Summary ═══════════════════════════════════════════════════════════════
  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  const failed = total - passed;
  console.log(`\n=== Summary: ${passed}/${total} assertions passed, FAIL count = ${failed} (self-check excluded from totals) ===`);
  if (failed === 0) {
    console.log(`✅ Phase 61 verification PASSED (S 静态锁 S1-S5 ✓ B 行为门 B1-B6 ✓ + forced-failure self-check ✓)`);
    process.exit(0);
  } else {
    console.log("❌ Phase 61 verification FAILED");
    for (const r of results.filter((x) => !x.pass)) {
      console.log(`   FAIL: ${r.name}${r.detail ? " — " + r.detail : ""}`);
    }
    process.exit(1);
  }
}

try {
  main();
} catch (err) {
  console.error("verify-phase-61.ts crashed:", err);
  process.exit(2);
}
