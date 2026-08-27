/**
 * src/lib/__tests__/blindVoteLedger.test.ts — 迭代平台 M1 决策账本回归锁。
 *
 * 运行: cd /data/workspace/kais-aigc-platform && node --import tsx --test src/lib/__tests__/blindVoteLedger.test.ts
 *
 * 通道驱动走真实 env(KMC_MANIFEST_TRANSPORT/KMC_EPISODES_ROOT 指向 tmp)——
 * getManifestTransport 每次调用现读 env,无模块级缓存,env 切换即生效;
 * 零真实 episode 目录、零网络、零 db(与 reviewBridge.test 同一纯模块纪律)。
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fsp } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  appendDecisionEvent,
  blindMetaSchema,
  type DecisionEvent,
} from "../blindVoteLedger";

let tmpRoot: string;
const savedEnv: Record<string, string | undefined> = {};

function setEnv(key: string, value: string | undefined): void {
  if (!(key in savedEnv)) savedEnv[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

before(async () => {
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "blindvotes-"));
});

after(async () => {
  for (const [k, v] of Object.entries(savedEnv)) setEnv(k, v);
  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

/** 通道开通 + episodes root 指 tmp。 */
function openTransport(root: string): void {
  setEnv("KMC_MANIFEST_TRANSPORT", "fs");
  setEnv("KMC_EPISODES_ROOT", root);
}

const mkEntry = (over: Partial<DecisionEvent> = {}): DecisionEvent => ({
  schema: "decision/v1",
  project_id: 12,
  episodes_id: 34,
  session_id: "bsess_20260827_evening",
  track: "human_blind",
  group_key: "shot:S3_4:first",
  source: "p09_shotlist",
  candidates_shown: [
    { node_id: "n1", position: 1 },
    { node_id: "n2", position: 2 },
  ],
  winner_node_id: "n2",
  was_blind: true,
  selector: { operator_note: "", reason_tags: ["光感"] },
  revealed_after_vote: true,
  ...over,
});

test("append 写出合法 JSONL 单行且字段完整", async () => {
  const root = path.join(tmpRoot, "t1");
  const epDir = path.join(root, "ep-zhongkui-ep01");
  await fsp.mkdir(path.join(epDir, ".pipeline-assets"), { recursive: true });
  openTransport(root);

  const entry = mkEntry({
    vote_id: "bv_20260827T223001_a3f2",
    episode_refs: ["ep-zhongkui-ep01"], // 画布探针形态(命名目录,非 ep{id} 裸形态)
  });
  await appendDecisionEvent(entry);

  const file = path.join(epDir, ".pipeline-assets", "blind-votes.jsonl");
  const raw = await fsp.readFile(file, "utf8");
  const lines = raw.split("\n").filter((l) => l.length > 0);
  assert.equal(lines.length, 1, `应恰一行,实际 ${lines.length}`);
  assert.ok(raw.endsWith("\n"), "行尾必须带 \\n(JSONL 追加语义)");
  const evt = JSON.parse(lines[0]!) as Record<string, unknown>;
  // 字段完整:spec §2.1 契约键全在场 + 值如实透传
  assert.equal(evt.schema, "decision/v1");
  assert.equal(evt.vote_id, "bv_20260827T223001_a3f2");
  assert.equal(evt.project_id, 12);
  assert.equal(evt.episodes_id, 34);
  assert.equal(evt.session_id, "bsess_20260827_evening");
  assert.equal(evt.track, "human_blind");
  assert.equal(evt.group_key, "shot:S3_4:first");
  assert.equal(evt.source, "p09_shotlist");
  assert.deepEqual(evt.candidates_shown, [
    { node_id: "n1", position: 1 },
    { node_id: "n2", position: 2 },
  ]);
  assert.equal(evt.winner_node_id, "n2");
  assert.equal(evt.was_blind, true);
  assert.deepEqual(evt.selector, { operator_note: "", reason_tags: ["光感"] });
  assert.equal(evt.revealed_after_vote, true);
  assert.equal(evt.revoked, false, "revoked 缺省必须显式落 false(聚合口径依赖)");
  assert.match(String(evt.recorded_at), /\+08:00$/, "recorded_at 须为 ISO+08:00");
  assert.deepEqual(evt.episode_refs, ["ep-zhongkui-ep01"], "episode_refs 如实透传");
});

test("transport null(通道未开通)时 no-op 不 throw 且不落文件", async () => {
  const root = path.join(tmpRoot, "t2");
  const epDir = path.join(root, "ep1");
  await fsp.mkdir(epDir, { recursive: true });
  setEnv("KMC_MANIFEST_TRANSPORT", undefined);
  setEnv("KMC_EPISODES_ROOT", root);

  await appendDecisionEvent(mkEntry()); // 不 throw 即通过

  const file = path.join(epDir, ".pipeline-assets", "blind-votes.jsonl");
  await assert.rejects(() => fsp.access(file), { code: "ENOENT" }, "通道未开通不得写文件");
});

test("episode 目录不存在时不 throw(远端画布静默丢弃)", async () => {
  const root = path.join(tmpRoot, "t3");
  await fsp.mkdir(root, { recursive: true }); // root 在,但无任何 ep 目录
  openTransport(root);
  await appendDecisionEvent(mkEntry()); // 解析不到 epDir → 静默 return
  const files = await fsp.readdir(root);
  assert.deepEqual(files, [], "解析失败时不得在 root 下落下任何文件");
});

test("vote_id 缺省自动生成非空(bv_ 前缀 + 时间戳 + 4 位随机)", async () => {
  const root = path.join(tmpRoot, "t4");
  const epDir = path.join(root, "34");
  await fsp.mkdir(epDir, { recursive: true });
  openTransport(root);

  await appendDecisionEvent(mkEntry()); // 不带 vote_id

  const raw = await fsp.readFile(
    path.join(epDir, ".pipeline-assets", "blind-votes.jsonl"),
    "utf8",
  );
  const evt = JSON.parse(raw.trim()) as { vote_id?: string };
  assert.ok(evt.vote_id != null && evt.vote_id.length > 0, "vote_id 须非空");
  assert.match(evt.vote_id!, /^bv_\d{8}T\d{6}_[0-9a-f]{4}$/, `形状不符: ${evt.vote_id}`);
});

// ─── zod body 校验扩展(select-winner blind 字段,M1 wire 契约)────────────

test("blind 元数据通过校验且缺省 track/wasBlind 落 human_blind/true", () => {
  const parsed = blindMetaSchema.safeParse({
    sessionId: "bsess_20260827T220000",
    operatorNote: "左侧光感更贴夜戏",
    reasonTags: ["光感", "姿态语义"],
  });
  assert.ok(parsed.success, "合法 blind 应通过");
  if (parsed.success) {
    assert.equal(parsed.data.track, "human_blind", "track 缺省 human_blind");
    assert.equal(parsed.data.wasBlind, true, "wasBlind 缺省 true");
  }
});

test("非法 track 拒收(枚举外值 400 而非静默归一)", () => {
  const parsed = blindMetaSchema.safeParse({ track: "gut_feeling" });
  assert.ok(!parsed.success, "track 枚举外值必须拒收");
  if (!parsed.success) {
    assert.ok(
      parsed.error.issues.some((i) => i.path.includes("track")),
      "issue 须定位到 track 字段",
    );
  }
});
