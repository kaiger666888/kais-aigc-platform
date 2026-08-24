/**
 * src/lib/__tests__/generationConfig.test.ts — generationConfigService 纯函数单测(62-02 D-09/D-10)。
 *
 * 运行: cd /data/workspace/kais-aigc-platform && node --import tsx --test src/lib/__tests__/generationConfig.test.ts
 *
 * 全部文件面操作走内存 fake FsLike 注入——**零真实磁盘副作用**(T-62 面零网络零磁盘纪律,
 * 沿 reviewBridge.test.ts 注入范式)。覆盖:三源合并优先级/半覆盖/legacy 降级/读失败同态/
 * applyRequirementWrite 三态(tmp+rename/乐观锁/EACCES 如实 file-fail)/钳制四象限/两段寻址。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GENERATION_CONFIG_KEYS,
  LOCKED_CONFIG_KEYS,
  clampRedundancy,
  effectivePre,
  readRequirementConfig,
  resolveRequirementFile,
  applyRequirementWrite,
  mergeThreeSources,
  type FsLike,
} from "../generationConfigService";

// ─── 内存 fake fs(注入式,零真实磁盘) ───

const DEFAULT_MTIME = 1000;

const err = (code: string) => Object.assign(new Error(code), { code });

interface FakeFsSpec {
  files?: Record<string, string>;
  /** path -> mtimeMs;缺省时 files 内路径回落 DEFAULT_MTIME。 */
  mtimes?: Record<string, number>;
  /** pipeRoot -> 子目录名列表(readdirSync withFileTypes)。 */
  dirs?: Record<string, string[]>;
  /** readFileSync 对这些路径抛 EACCES。 */
  eaccesRead?: string[];
  /** writeFileSync 一律抛 EACCES(pipe-* 本机恒败模拟)。 */
  failWrite?: boolean;
}

function mkFs(spec: FakeFsSpec = {}) {
  const writes: Array<{ path: string; data: string }> = [];
  const renames: Array<{ from: string; to: string }> = [];
  const files = spec.files ?? {};
  const fs: FsLike = {
    existsSync: (p) => Object.prototype.hasOwnProperty.call(files, p),
    readFileSync: (p) => {
      if (spec.eaccesRead?.includes(p)) throw err("EACCES");
      if (!Object.prototype.hasOwnProperty.call(files, p)) throw err("ENOENT");
      return files[p];
    },
    writeFileSync: (p, data) => {
      if (spec.failWrite) throw err("EACCES");
      writes.push({ path: p, data });
    },
    renameSync: (from, to) => renames.push({ from, to }),
    statSync: (p) => {
      if (Object.prototype.hasOwnProperty.call(spec.mtimes ?? {}, p)) {
        return { mtimeMs: spec.mtimes![p] };
      }
      if (Object.prototype.hasOwnProperty.call(files, p)) return { mtimeMs: DEFAULT_MTIME };
      throw err("ENOENT");
    },
    readdirSync: (p) =>
      (spec.dirs?.[p] ?? []).map((name) => ({ name, isDirectory: () => true })),
  };
  return { fs, writes, renames };
}

// ─── 键面口径(服务端拷贝自检;与前端 62-01 表逐键一致由 62-07 S-门锁) ───

test("键面口径:14 可配键 = 11 嵌套 + 3 扁平;preCap1 五键;unwired 两键;transition 无独立键", () => {
  const keys = GENERATION_CONFIG_KEYS;
  assert.equal(keys.length, 14);
  assert.equal(keys.filter((k) => k.phaseKey.includes(".")).length, 11);
  assert.equal(keys.filter((k) => !k.phaseKey.includes(".")).length, 3);
  assert.equal(keys.filter((k) => k.preCap1).length, 5);
  assert.equal(keys.filter((k) => k.unwired).length, 2);
  assert.ok(!keys.some((k) => k.phaseKey === "p09_shotlist.transition"));
  assert.equal(LOCKED_CONFIG_KEYS.reportAudit.count, 18);
});

// ─── clampRedundancy(D-10 服务端兜底,khs resolver 四象限) ───

test("clampRedundancy 四象限:pre≥1、final=clamp(1,final,pre)", () => {
  assert.deepEqual(clampRedundancy(0, 0), { pre: 1, final: 1 });
  assert.deepEqual(clampRedundancy(5, 9), { pre: 5, final: 5 });
  assert.deepEqual(clampRedundancy(3, 2), { pre: 3, final: 2 });
  assert.deepEqual(clampRedundancy(1, 1), { pre: 1, final: 1 });
});

test("effectivePre:覆盖列 > 文件值 > 键面默认(final 单独提供时的钳制基准)", () => {
  const def = GENERATION_CONFIG_KEYS.find((k) => k.phaseKey === "p06_script.spatio_temporal")!;
  assert.equal(effectivePre(def, 7, 2), 7);
  assert.equal(effectivePre(def, null, 2), 2);
  assert.equal(effectivePre(def, null, undefined), 1);
});

// ─── mergeThreeSources(D-09 三源合并) ───

test("三源优先级:覆盖层 > 文件值 > 快照;半覆盖行 source 取较强源 override", () => {
  const rows = mergeThreeSources(
    GENERATION_CONFIG_KEYS,
    [{ phaseKey: "p06_script.spatio_temporal", nCandidates: 4, finalCandidates: null }],
    "requirement",
    { "p06_script.spatio_temporal": { pre: 2, final: 1 } },
  );
  const row = rows.find((r) => r.phaseKey === "p06_script.spatio_temporal")!;
  assert.equal(row.pre, 4); // override 列非 null → 覆盖层
  assert.equal(row.final, 1); // 半覆盖:final 列 null → 走文件值
  assert.equal(row.source, "override"); // 行级 = 两旋钮中较强源
});

test("半覆盖(仅 final 列):pre 走文件值、final 走 override,行 source=override", () => {
  const rows = mergeThreeSources(
    GENERATION_CONFIG_KEYS,
    [{ phaseKey: "p06_script.spatio_temporal", nCandidates: null, finalCandidates: 2 }],
    "requirement",
    { "p06_script.spatio_temporal": { pre: 3, final: 1 } },
  );
  const row = rows.find((r) => r.phaseKey === "p06_script.spatio_temporal")!;
  assert.equal(row.pre, 3); // 覆盖列 null → 文件值
  assert.equal(row.final, 2); // override
  assert.equal(row.source, "override");
});

test("快照默认 + 哨兵语义(p01_hook 扁平 defaultFinal=null → final 缺省=pre)", () => {
  const rows = mergeThreeSources(GENERATION_CONFIG_KEYS, [], "not-found", {});
  const flat = rows.find((r) => r.phaseKey === "p01_hook")!;
  assert.equal(flat.pre, 3);
  assert.equal(flat.final, 3); // 哨兵回落有效 pre
  assert.equal(flat.source, "snapshot");
  const topicKernel = rows.find((r) => r.phaseKey === "p01_hook.topic_kernel")!;
  assert.equal(topicKernel.pre, 3); // 共享扁平 pre
  assert.equal(topicKernel.final, 1); // 嵌套自带 final=1
});

// ─── readRequirementConfig 三态(requirement | legacy | not-found) ───

test("requirement 态:v2.5 已知键在场,只提取已知键", () => {
  const { fs } = mkFs({
    files: {
      "/req.json": JSON.stringify({
        aspect_ratio: "16:9",
        generation_config: {
          p02_outline: { n_candidates: 5, final_candidates: 2 },
          "unknown.phase": { n_candidates: 99 },
        },
      }),
    },
  });
  const cfg = readRequirementConfig(fs, "/req.json");
  assert.equal(cfg.state, "requirement");
  assert.deepEqual(cfg.values["p02_outline"], { pre: 5, final: 2 });
  assert.equal(cfg.values["unknown.phase"], undefined);
});

test("legacy:文件在但无 generation_config(v2.5 前旧形态)→ legacy", () => {
  const { fs } = mkFs({ files: { "/req.json": JSON.stringify({ title: "t", aspect_ratio: "16:9" }) } });
  const cfg = readRequirementConfig(fs, "/req.json");
  assert.equal(cfg.state, "legacy");
  assert.deepEqual(cfg.values, {});
});

test("not-found:ENOENT 与 EACCES 读失败均不抛 → 与无文件同态", () => {
  const { fs } = mkFs({ eaccesRead: ["/locked/req.json"] });
  assert.deepEqual(readRequirementConfig(fs, "/nope.json"), { state: "not-found", values: {} });
  assert.deepEqual(readRequirementConfig(fs, "/locked/req.json"), { state: "not-found", values: {} });
});

test("legacy 经 mergeThreeSources:全行快照默认值 + source=legacy + sourceLegacy 角标", () => {
  const { fs } = mkFs({ files: { "/req.json": JSON.stringify({ title: "t" }) } });
  const cfg = readRequirementConfig(fs, "/req.json");
  const rows = mergeThreeSources(GENERATION_CONFIG_KEYS, [], cfg.state, cfg.values);
  const row = rows.find((r) => r.phaseKey === "p09_shotlist.shot_list")!;
  assert.equal(row.pre, 1); // 快照默认值
  assert.equal(row.final, 1);
  assert.equal(row.source, "legacy"); // UI-SPEC C8:旧形态 → source=legacy + 「无 v2.5 键」角标
  assert.equal(row.sourceLegacy, true);
  assert.ok(rows.every((r) => r.sourceLegacy === true));
});

test("not-found 经 mergeThreeSources:全行快照默认(source=snapshot,无 legacy 标志)", () => {
  const rows = mergeThreeSources(GENERATION_CONFIG_KEYS, [], "not-found", {});
  assert.ok(rows.every((r) => r.source === "snapshot"));
  assert.ok(rows.every((r) => r.sourceLegacy === undefined));
});

// ─── applyRequirementWrite(D-08② 三态之二:synced | file-fail) ───

test("applyRequirementWrite 成功:tmp+rename 被调,其他顶层键与 namespace 其他条目保留", () => {
  const P = "/writable/req.json";
  const { fs, writes, renames } = mkFs({
    files: {
      [P]: JSON.stringify({
        aspect_ratio: "16:9",
        generation_config: { p03_script: { n_candidates: 1 } },
      }),
    },
  });
  const result = applyRequirementWrite(
    fs, P, "p02_outline",
    { nCandidates: 4, finalCandidates: null },
    DEFAULT_MTIME,
  );
  assert.equal(result, "synced");
  assert.equal(writes.length, 1);
  assert.ok(writes[0].path.startsWith(P + ".tmp-"), `tmp 写路径: ${writes[0].path}`);
  assert.deepEqual(renames, [{ from: writes[0].path, to: P }]); // 原子替换到位
  const next = JSON.parse(writes[0].data);
  assert.equal(next.aspect_ratio, "16:9"); // 其他顶层键保留
  assert.deepEqual(next.generation_config["p03_script"], { n_candidates: 1 }); // namespace 其他条目保留
  assert.deepEqual(next.generation_config["p02_outline"], { n_candidates: 4 }); // 新条目写入
});

test("applyRequirementWrite:写抛 EACCES → 'file-fail',绝不向上抛(pipe-* 本机恒败设计验证面)", () => {
  const P = "/mnt/agents/output/pipelines/pipe-x/requirement.json";
  const { fs, writes } = mkFs({ files: { [P]: "{}" }, failWrite: true });
  const result = applyRequirementWrite(
    fs, P, "p01_hook",
    { nCandidates: 3, finalCandidates: null },
    DEFAULT_MTIME,
  );
  assert.equal(result, "file-fail");
  assert.equal(writes.length, 0);
});

test("applyRequirementWrite:mtime 变化(stale)→ 'file-fail' 且 writeFileSync 未被调(不丢他方写入)", () => {
  const P = "/shared/req.json"; // statSync 回落 DEFAULT_MTIME=1000
  const { fs, writes, renames } = mkFs({ files: { [P]: "{}" } });
  const result = applyRequirementWrite(
    fs, P, "p01_hook",
    { nCandidates: 3, finalCandidates: null },
    999, // 读时记录的 mtime ≠ 当前 mtime → stale
  );
  assert.equal(result, "file-fail");
  assert.equal(writes.length, 0); // 关键反断言:stale 时不得写盘
  assert.equal(renames.length, 0);
});

test("applyRequirementWrite:null 清旋钮;条目清空后整个条目移除(镜像 PUT 全 null 删行)", () => {
  const P = "/w/req.json";
  const { fs, writes } = mkFs({
    files: {
      [P]: JSON.stringify({
        generation_config: {
          p02_outline: { n_candidates: 4 },
          p03_script: { n_candidates: 1 },
        },
      }),
    },
  });
  const result = applyRequirementWrite(
    fs, P, "p02_outline",
    { nCandidates: null, finalCandidates: null },
    DEFAULT_MTIME,
  );
  assert.equal(result, "synced");
  const next = JSON.parse(writes[0].data).generation_config;
  assert.equal(next.p02_outline, undefined);
  assert.deepEqual(next.p03_script, { n_candidates: 1 }); // 其他条目不受影响
});

// ─── resolveRequirementFile(两段寻址) ───

test("resolveRequirementFile:段一 envFile 绝对路径存在即直取(优先于段二)", () => {
  const { fs } = mkFs({
    files: {
      "/cfg/req.json": JSON.stringify({ project_id: "7" }),
      "/pipes/pipe-1/requirement.json": JSON.stringify({ project_id: "7" }),
    },
    dirs: { "/pipes": ["pipe-1"] },
    mtimes: { "/cfg/req.json": 10, "/pipes/pipe-1/requirement.json": 99 },
  });
  const r = resolveRequirementFile(fs, { envFile: "/cfg/req.json", pipeRoot: "/pipes", projectId: 7 });
  assert.equal(r.path, "/cfg/req.json");
  assert.equal(r.mtime, 10);
});

test("resolveRequirementFile:envFile 指向不存在文件 → 落段二 pipe 扫描", () => {
  const B = "/pipes/pipe-1/requirement.json";
  const { fs } = mkFs({
    files: { [B]: JSON.stringify({ project_id: "7" }) },
    dirs: { "/pipes": ["pipe-1"] },
    mtimes: { [B]: 50 },
  });
  const r = resolveRequirementFile(fs, { envFile: "/missing/req.json", pipeRoot: "/pipes", projectId: 7 });
  assert.equal(r.path, B);
});

test("resolveRequirementFile:pipe-* 双字符串键(project_id/projectId)等值过滤,mtime 最新胜出", () => {
  const A = "/pipes/pipe-old/requirement.json";
  const B = "/pipes/pipe-new/requirement.json";
  const C = "/pipes/pipe-other/requirement.json";
  const { fs } = mkFs({
    files: {
      [A]: JSON.stringify({ project_id: "1779861265924" }),
      [B]: JSON.stringify({ projectId: "1779861265924" }), // RESEARCH B:两键并存,任一命中
      [C]: JSON.stringify({ project_id: "42" }), // 异 project 排除(即使 mtime 最新)
    },
    dirs: { "/pipes": ["pipe-old", "pipe-new", "pipe-other"] },
    mtimes: { [A]: 100, [B]: 200, [C]: 999 },
  });
  const r = resolveRequirementFile(fs, { envFile: null, pipeRoot: "/pipes", projectId: 1779861265924 });
  assert.equal(r.path, B);
  assert.equal(r.mtime, 200);
});

test("resolveRequirementFile:零命中(pipeRoot 缺失 / 无 project 匹配)→ path=null", () => {
  const missing = resolveRequirementFile(mkFs().fs, { envFile: null, pipeRoot: "/nowhere", projectId: 1 });
  assert.equal(missing.path, null);
  assert.equal(missing.state, "not-found");

  const { fs } = mkFs({
    files: { "/pipes/pipe-1/requirement.json": JSON.stringify({ project_id: "1" }) },
    dirs: { "/pipes": ["pipe-1"] },
  });
  const mismatch = resolveRequirementFile(fs, { envFile: null, pipeRoot: "/pipes", projectId: 999 });
  assert.equal(mismatch.path, null);
});
