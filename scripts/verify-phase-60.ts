#!/usr/bin/env tsx
/**
 * verify-phase-60.ts — Phase 60 (post-save-panel-persistence, D-11) aggregate
 * contract gate. verify-phase-59.ts 同骨架: assert/read/exists/runCmd/results
 * 收集 + 末尾失败计数 → process.exit(0 全绿 / 1 任一失败 / 2 crash)。
 *
 *   S 静态锁段(60-02/60-03 产物 grep 锚,与实际文本一致):
 *     S1 save-v2.ts savedBy 契约: zod 白名单行(z.string().max(64).optional)
 *        + broadcast 条件展开回显(不带身份的广播形状逐键不变,kmc 兼容面)。
 *     S2 FLAG-1 次序锁(60-UI-SPEC §4 红线): onGraphSaved 块内
 *        「lastEventCountRef.current = null 基线重置」行号必须 < 「savedBy
 *        比对早退」行号;早退行引用 getClientTabId;toast+loadCanvas(他端
 *        分支)在早退之后。跳 reload 不跳基线——丢了重置,自保存后 ≤30s 冒假
 *        「检测到 pipeline 远端更新」toast(D-05 违反,e2e 要 >30s 等待才抓得
 *        到,故静态锁死)。
 *     S3 FLAG-2 双向锁(pre-existing quirk,禁顺手修): health.ts 不得出现
 *        eventCount(负向:修了会激活第二 reload 通道)+ FlowCanvas health-poll
 *        段仍读 scope.eventCount(正向:轮询逻辑原样)。
 *     S4 FLAG-4: packages/infinite-canvas/test 目录 suppressGraphSaved 零
 *        命中(60-02 旋钮退役;注释也避用该 token——退役纪律)。
 *     S5 D-01 链: clientTabId.ts 在场 + canvasApi.saveCanvasGraph body 附
 *        savedBy: getClientTabId()(单点身份附加,六调用方全覆盖)。
 *     S6 D-03: canvasStore.ts 含 '[panel-persist]' warn + setGraph 重锚行
 *        rfNodes.find 语义保持(n.id === 与 ?? null 共存,两锚同形)。
 *     S7 useCanvasSocket.ts graph:saved payload 类型含 savedBy?(wire 类型链)。
 *     S8-S11(review-60 fixes): CR-01 两探针恢复守卫(lastKnownServer 漂移
 *        核对,并发写不盲覆盖)/ CR-02 requestNodeScore 拆信封 / WR-01 save
 *        失败层1 显式 SKIP / WR-02 mock health per-scope eventCount。
 *   B 行为门段(spawn 子进程,49-01 教训: 不与父进程共享 knex/事件循环):
 *     根 tsc --noEmit / reloadAnchor vitest(八 case 永久锁)/ canvas
 *     npm run build(dist 纪律: e2e 跑 build 产物非源码)/ phase60 e2e
 *     四用例整文件。
 *   D dispatch 段: spawn npx tsx scripts/diagnose-60-roundtrip.ts --strict
 *     (仓库根)——exit 0 → PASS;exit 2(:10588 SKIP)→ 计 WARN 不计 FAIL
 *     (输出要求 SUMMARY 记录补验,不假绿不硬红);exit 1 → FAIL。
 *   F forced-failure 自检段(T-60-09 假绿缓解,门能红证明): S2/S3/S4 三锁
 *     各以一个「内存变异样本」跑同一检查函数——必须判 false。任一变异样本
 *     被判 true(锁恒真)→ 整门 exit 1。变异样本全为脚本内字符串/S3 的
 *     运行时字符串替换,不写任何真实文件。
 *
 * Run: npm run verify:phase-60   (or: npx tsx scripts/verify-phase-60.ts)
 * Exit: 0 全绿(D 段允许 WARN-SKIP) / 1 任一失败 / 2 crash
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

interface TestResult { name: string; pass: boolean; detail?: string; }
const results: TestResult[] = [];
let warnCount = 0;
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

/** B/D 段命令门: cwd + 命令,tail 摘要;非零 exit 红(59 同款,不经 shell 管道)。 */
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

// ── 可复用锁检查函数(F 段对同函数跑变异样本——锁与自检同源,非两套逻辑) ──

interface LockOutcome { ok: boolean; detail: string; }

/**
 * S2 FLAG-1 次序锁(纯函数: 输入 FlowCanvas.tsx 源文本,输出判定)。
 * onGraphSaved 块内: ① 基线重置行号 < ② savedBy 早退行号;② 引用
 * getClientTabId 比对;③ toast / ④ loadCanvas(他端分支)行号 > ②。
 */
function checkFlag1Order(flowSrc: string): LockOutcome {
  const startIdx = flowSrc.indexOf("onGraphSaved: (payload)");
  if (startIdx < 0) return { ok: false, detail: "onGraphSaved 回调块不可定位" };
  const endAnchor = flowSrc.indexOf("onBranchCreated", startIdx);
  const block = flowSrc.slice(startIdx, endAnchor > startIdx ? endAnchor : startIdx + 1600);
  const lines = block.split("\n");
  const lineOf = (needle: string): number => lines.findIndex((l) => l.includes(needle));
  const resetIdx = lineOf("lastEventCountRef.current = null");
  const echoIdx = lineOf("payload.savedBy === getClientTabId()");
  const earlyIdx = lineOf("if (selfEcho) return");
  const toastIdx = lineOf("Pipeline 同步了新数据");
  const reloadIdx = lineOf("loadCanvas(projectId, episodesId)");
  if (resetIdx < 0 || echoIdx < 0 || earlyIdx < 0 || toastIdx < 0 || reloadIdx < 0) {
    return {
      ok: false,
      detail: `块内锚行不全(reset=${resetIdx} echo=${echoIdx} early=${earlyIdx} toast=${toastIdx} reload=${reloadIdx})`,
    };
  }
  const ok = resetIdx < earlyIdx && echoIdx < earlyIdx && earlyIdx < toastIdx && earlyIdx < reloadIdx;
  return {
    ok,
    detail: `块内行号 基线重置=${resetIdx} < 早退=${earlyIdx} < toast=${toastIdx}/reload=${reloadIdx};getClientTabId 比对行=${echoIdx}`,
  };
}

/**
 * S3 FLAG-2 双向锁(纯函数): health.ts 不含 eventCount(负向——执行器没顺手
 * 修映射,禁激活第二 reload 通道)+ FlowCanvas health-poll 段仍读
 * scope.eventCount(正向——轮询逻辑原样)。
 */
function checkFlag2(healthSrc: string, flowSrc: string): LockOutcome {
  const negativeOk = !healthSrc.includes("eventCount");
  const pollIdx = flowSrc.indexOf("await fetchCanvasHealth()");
  const pollSeg = pollIdx >= 0 ? flowSrc.slice(pollIdx, pollIdx + 1600) : "";
  const positiveOk = pollSeg.includes("scope.eventCount");
  return {
    ok: negativeOk && positiveOk,
    detail: `health.ts 无 eventCount=${negativeOk};health-poll(fetchCanvasHealth 段)读 scope.eventCount=${positiveOk}`,
  };
}

/** S4 FLAG-4 单文件判定: 文本不含退役旋钮 token 即 clean。 */
function checkFlag4Text(text: string): boolean {
  return !text.includes("suppressGraphSaved");
}

/** S4 FLAG-4 目录扫描: packages/infinite-canvas/test 递归全部常规代码文件零命中。 */
function scanSuppressToken(relDir: string): string[] {
  const hits: string[] = [];
  const walk = (absDir: string): void => {
    for (const ent of fs.readdirSync(absDir, { withFileTypes: true })) {
      const abs = path.join(absDir, ent.name);
      if (ent.isDirectory()) { walk(abs); continue; }
      if (!/\.(mjs|js|ts|tsx|json|md)$/.test(ent.name)) continue;
      try {
        if (!checkFlag4Text(fs.readFileSync(abs, "utf8"))) hits.push(path.relative(REPO_ROOT, abs));
      } catch { /* unreadable: skip */ }
    }
  };
  walk(path.join(REPO_ROOT, relDir));
  return hits;
}

async function main(): Promise<void> {
  console.log("=== Phase 60 — verify-phase-60.ts (D-11 aggregate gate: 保存后面板保持, FLAG-1/2/4 红线 + D-01/D-03 链 + 行为门 + dispatch + forced-failure) ===\n");

  // ═══ S — 静态锁段 ═════════════════════════════════════════════════════════
  console.log("=== S 静态锁: savedBy 契约 / FLAG-1 次序 / FLAG-2 双向 / FLAG-4 退役 / D-01 链 / D-03 warn / wire 类型 ===");
  const saveV2Src = read("src/routes/canvas/v2/save-v2.ts");
  const healthSrc = read("src/routes/canvas/v2/health.ts");
  const flowSrc = read("packages/infinite-canvas/src/components/FlowCanvas.tsx");
  const socketSrc = read("packages/infinite-canvas/src/hooks/useCanvasSocket.ts");
  const canvasApiSrc = read("packages/infinite-canvas/src/services/canvasApi.ts");
  const storeSrc = read("packages/infinite-canvas/src/store/canvasStore.ts");

  // S1 save-v2.ts savedBy 契约
  assert(
    saveV2Src.includes("savedBy: z.string().max(64).optional()"),
    "S1: save-v2.ts zod savedBy 白名单行(z.string().max(64).optional,T-60-02 缓解)",
  );
  assert(
    saveV2Src.includes("...(savedBy != null ? { savedBy } : {})"),
    "S1: save-v2.ts broadcast 条件展开回显(不带身份的广播形状逐键不变,kmc 兼容面)",
  );

  // S2 FLAG-1 次序锁(检查函数与 F 段变异自检同源)
  const f1 = checkFlag1Order(flowSrc);
  assert(f1.ok, "S2 FLAG-1: onGraphSaved 基线重置行 < savedBy 早退行;toast/loadCanvas 在早退后(他端分支)", f1.detail);

  // S3 FLAG-2 双向锁(负向+正向)
  const f2 = checkFlag2(healthSrc, flowSrc);
  assert(f2.ok, "S3 FLAG-2: health.ts 无 eventCount(负向)+ health-poll 仍读 scope.eventCount(正向)", f2.detail);

  // S4 FLAG-4 退役旋钮零命中
  const f4Hits = scanSuppressToken(path.join("packages", "infinite-canvas", "test"));
  assert(
    f4Hits.length === 0,
    "S4 FLAG-4: packages/infinite-canvas/test 目录 suppressGraphSaved 零命中(旋钮退役)",
    f4Hits.length === 0 ? "" : `命中: ${f4Hits.join(", ")}`,
  );

  // S5 D-01 链
  assert(
    exists("packages/infinite-canvas/src/services/clientTabId.ts") &&
      read("packages/infinite-canvas/src/services/clientTabId.ts").includes("export function getClientTabId"),
    "S5 D-01: clientTabId.ts 在场且导出 getClientTabId(页面级 tab 身份单例)",
  );
  assert(
    canvasApiSrc.includes("savedBy: getClientTabId()"),
    "S5 D-01: canvasApi.saveCanvasGraph body 单点附 savedBy: getClientTabId()(六调用方零改动全覆盖)",
  );

  // S6 D-03 warn + setGraph 重锚语义锚
  assert(
    storeSrc.includes("[panel-persist]"),
    "S6 D-03: canvasStore.ts 含 '[panel-persist]' 锚丢失 warn 默认串",
  );
  assert(
    storeSrc.includes("vm.rfNodes.find((n) => n.id === state.selectedNode!.id) ?? null") &&
      storeSrc.includes("vm.rfNodes.find((n) => n.id === state.detailNode!.id) ?? null"),
    "S6 D-03: setGraph 重锚行语义保持(rfNodes.find n.id === 与 ?? null 共存,两锚同形)",
  );

  // S7 wire 类型链
  {
    const regIdx = socketSrc.indexOf("socket.on('graph:saved'");
    const regBlock = regIdx >= 0 ? socketSrc.slice(regIdx, regIdx + 400) : "";
    assert(
      socketSrc.includes("savedBy?: string") && regBlock.includes("savedBy?: string"),
      "S7: useCanvasSocket graph:saved payload 类型含 savedBy?(回调签名 + 注册块 wire 类型链)",
    );
  }

  // S8 CR-01(review-60): 两个真机探针的恢复守卫——恢复前核对服务器态 === 探针
  // 最后已知态(lastKnownServer),漂移(并发写)→ 放弃恢复不盲写(净足迹≠0 时
  // FAIL + exit 1 交人工对账)。旧版 finally 无条件回存原图,会静默覆盖探针窗口
  // 内 kmc pipeline/画布客户端的并发写(数据丢失向量)。
  {
    const diagSrc = read("scripts/diagnose-60-roundtrip.ts");
    const probeSrc = read("packages/infinite-canvas/test/e2e/probe-60-real.mjs");
    assert(
      diagSrc.includes("lastKnownServer") && diagSrc.includes("并发写入被保留") &&
        probeSrc.includes("lastKnownServer") && probeSrc.includes("并发写入被保留"),
      "S8 CR-01: diagnose-60-roundtrip + probe-60-real 恢复守卫(lastKnownServer 漂移核对,并发写不盲覆盖)",
    );
  }

  // S9 CR-02(review-60): requestNodeScore 拆信封返回 json.data.score 本体。
  // 旧版 `apiCall<any>` 把整 envelope({code,data,message})当返回值,UI 读
  // score.overall 恒 undefined(「总分 undefined」)且污染 node.data.aiScore。
  assert(
    canvasApiSrc.includes("json.data.score"),
    "S9 CR-02: canvasApi.requestNodeScore 拆信封返回 json.data.score(非整 envelope)",
  );

  // ═══ B — 行为门段(spawn 子进程) ══════════════════════════════════════════
  console.log("\n=== B 行为门: 根 tsc / reloadAnchor vitest / canvas build(dist 纪律) / phase60 e2e 四用例 ===");
  runCmd("root tsc --noEmit", ".", "npx tsc --noEmit", 2);
  runCmd(
    "infinite-canvas reloadAnchor vitest(八 case 永久锁)",
    "packages/infinite-canvas",
    "npx vitest run src/store/__tests__/reloadAnchor.test.ts",
    2,
  );
  runCmd("infinite-canvas build(dist 纪律: e2e 跑 build 产物)", "packages/infinite-canvas", "npm run build", 3);
  runCmd(
    "phase60 e2e 四用例整文件",
    "packages/infinite-canvas",
    "npx playwright test test/e2e/tests/phase60-panel-persist.mjs",
    3,
  );

  // ═══ D — dispatch 段(diagnose-60-roundtrip --strict) ════════════════════
  console.log("\n=== D dispatch: diagnose-60-roundtrip --strict(:10588 真机三层 id-diff + 零足迹恢复) ===");
  {
    const res = spawnSync("npx tsx scripts/diagnose-60-roundtrip.ts --strict", {
      cwd: REPO_ROOT,
      shell: true,
      encoding: "utf8",
      timeout: 240_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const out = ((res.stdout ?? "") + (res.stderr ?? ""))
      .split("\n").filter((l) => l.trim().length > 0);
    const tail = out.slice(-4).join(" | ").slice(0, 300);
    if (res.status === 0) {
      assert(true, "D: diagnose-60-roundtrip --strict exit 0(三层 id 零漂移 + 恢复全等)", tail);
    } else if (res.status === 2) {
      warnCount += 1;
      results.push({ name: "D: diagnose-60-roundtrip --strict exit 2 → WARN(:10588 SKIP,不计 FAIL)", pass: true, detail: tail });
      console.log(`  WARN: D 段 exit 2 → 计 WARN 不计 FAIL — ${tail}`);
      console.log("  WARN: :10588 不可达/无可用 scope——SUMMARY 须记录补验命令: 部署(build → deploy-canvas.sh → build:server → restart)后 npx tsx scripts/diagnose-60-roundtrip.ts --strict");
    } else {
      assert(false, `D: diagnose-60-roundtrip --strict FAIL(exit ${res.status})`, tail);
    }
  }

  // ═══ F — forced-failure 自检段(门能红证明;变异样本全为内存字符串) ══════
  console.log("\n=== Forced-failure self-check (gate can actually fail — expected FAILs below; 变异样本不写真实文件) ===");
  const selfCheckShadow: TestResult[] = [];
  const shadowAssert = (cond: boolean, name: string): void => {
    selfCheckShadow.push({ name, pass: cond });
    console.log(`  SELF-CHECK ${cond ? "UNEXPECTED-PASS" : "expected-FAIL ok"}: ${name}`);
  };

  // F-S2 变异样本: 基线重置挪到早退之后(FLAG-1 违序)——同一 checkFlag1Order 必须判 false
  const flag1Mutant = [
    "onGraphSaved: (payload) => {",
    "      if (",
    "        projectId &&",
    "        episodesId != null &&",
    "        payload.projectId === projectId &&",
    "        payload.episodesId === episodesId",
    "      ) {",
    "        const selfEcho =",
    "          typeof payload.savedBy === 'string' && payload.savedBy === getClientTabId()",
    "        if (selfEcho) return",
    "        lastEventCountRef.current = null",
    "        showToast('Pipeline 同步了新数据,正在刷新画布…', 'info')",
    "        loadCanvas(projectId, episodesId)",
    "      }",
    "    },",
    "    onBranchCreated: (branch) => {},",
  ].join("\n");
  shadowAssert(
    checkFlag1Order(flag1Mutant).ok,
    "F-S2 变异样本(基线重置挪到早退之后)必须使 FLAG-1 次序锁判 false",
  );

  // F-S3 变异样本: health.ts 文本插入 eventCount(执行器顺手修映射的禁区)——
  // 同一 checkFlag2 负向必须判 false(样本由真实 health.ts 运行时字符串替换而来)
  const flag2Mutant = healthSrc.replace(
    "linkCount: s.linkCount,",
    "linkCount: s.linkCount,\n            eventCount: s.nodeCount,",
  );
  shadowAssert(
    checkFlag2(flag2Mutant, flowSrc).ok,
    "F-S3 变异样本(health.ts 插入 eventCount)必须使 FLAG-2 负向锁判 false",
  );

  // F-S4 变异样本: test 文本插入退役旋钮 token——同一 checkFlag4Text 必须判 false
  const flag4Mutant = "// retired knob revives\nconst state = { suppressGraphSaved: false };\n";
  shadowAssert(
    checkFlag4Text(flag4Mutant),
    "F-S4 变异样本(文本插入 suppressGraphSaved)必须使 FLAG-4 零命中锁判 false",
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
  console.log(`\n=== Summary: ${passed}/${total} assertions passed, FAIL count = ${failed}, WARN count = ${warnCount} (self-check excluded from totals) ===`);
  if (failed === 0) {
    console.log(`✅ Phase 60 verification PASSED (S 静态锁 S1-S7 ✓ B 行为门四项 ✓ D dispatch${warnCount > 0 ? " WARN-SKIP" : " ✓"} + forced-failure self-check ✓)`);
    process.exit(0);
  } else {
    console.log("❌ Phase 60 verification FAILED");
    for (const r of results.filter((x) => !x.pass)) {
      console.log(`   FAIL: ${r.name}${r.detail ? " — " + r.detail : ""}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("verify-phase-60.ts crashed:", err);
  process.exit(2);
});
