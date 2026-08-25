/**
 * manifestWriteback.ts — 选定 → kmc manifest 回写通道(Phase 53-04 / VAR-03
 * kap 半部,D-09/D-10/D-11)。
 *
 * 通道收口(D-09):select-winner 端点 status==='updated' 段 reviewBridge 同位
 * 挂本模块,一处扩展不另开端点。best-effort 隔离(D-10):hook 失败绝不影响
 * 200 响应;失败入 canvas_writeback_queue 重放;入队自身失败降级 warn(最坏
 * 丢一次回写,canvas 真值已在——Pitfall 4)。
 *
 * 字段名权威对齐(D-11):frameSlot='first' → selected_first_variant;
 * 'last' → selected_last_variant(p11a0 已写 iframe-manifest.json 的既有名);
 * 无 frameSlot(G14 预览等)→ chosen_variant_id(variantIndex 通用化,Wave B
 * 定最终字段形状)。
 *
 * Wave B 决策点冻结(Open Question 1):传输实现 = FS 直写 episode workdir
 * vs HTTP——本模块把传输抽象为 ManifestTransport deps 注入,Wave A 零实现
 * (KMC_MANIFEST_TRANSPORT 未配置 → warn-once + no-op,不入队——避免 Wave A
 * 把每笔选定都灌成 8 次重试的 failed 行;通道未开通 ≠ 通道故障)。
 * Wave B 挂接点:getManifestTransport() 返回实现 + replayManifestWriteback
 * 作为 drain handler。
 *
 * never-throws 纪律(reviewBridge P1 逐条复刻):全函数体 try/catch 吞一切,
 * 连 broken logger 也不 throw;幂等语义 = "目标值已相等 → no-op"(队列重放
 * 依赖 transport 自身幂等)。
 */

import { promises as fsp } from "node:fs";
import path from "node:path";
import { enqueueWriteback, type WritebackQueueRow } from "./writebackQueue";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ManifestWritebackParams {
  projectId: number
  episodesId: number
  groupId: string
  winnerNodeId: string
  variantIndex: number
  frameSlot?: "first" | "last"
  source?: string
  /**
   * 69-01 (v3.2 WBI-01):episode 候选集(gateStateService 画布探针,WR-01
   * 同源)——FS transport 在 episodes/ 下按 refs 定位真实剧集目录
   * (ep-zhongkui-ep01 形,裸 ep{id} 合不上)。
   */
  episodeRefs?: string[]
}

export interface ManifestWriteTarget {
  field: "selected_first_variant" | "selected_last_variant" | "chosen_variant_id"
  value: number // 1-based variantIndex
}

/**
 * 出站传输接口(Wave B 实现:FS 直写 / HTTP)。
 * 实现自身必须幂等:目标值已相等 → no-op(成功返回)——队列重放依赖。
 * FS 实现的路径约束(冻结,V12):必须限定在 episode workdir 内。
 */
export interface ManifestTransport {
  writeSelection(params: ManifestWritebackParams, target: ManifestWriteTarget): Promise<void>
}

// ─── Transport resolution(Wave B 挂接点)──────────────────────────────────

/**
 * 69-01 (v3.2 WBI-01):FS 直写实现——画布换选真实到达 kmc 消费面。
 *
 * 写点(两处,均为 khs 真实消费面):
 *  - `assets/P11/iframe-manifest.json`(p11a0 产物,list per shot):entry 按
 *    shot_id 匹配后覆写 selected_first_variant / selected_last_variant(int,
 *    p11b `_load_iframe_manifest` 消费);
 *  - `.pipeline-assets/hook-candidates.json`(p01 slot,value 包裹):
 *    value.chosen_variant_id = "v{N}"(string,ADR-1 裁定;_creative_hook_
 *    selector 按 variant_id string 校验消费)。
 *
 * 幂等 = 目标值已相等 → no-op;原子写 tmp+rename(khs _write_manifest_atomic
 * 同款)。episode 目录按 episodeRefs 在 KMC_EPISODES_ROOT 下解析(取第一个
 * 存在的 ep-* 目录);解析不到 → throw(入队重放,通道故障 ≠ 未开通)。
 */
class FsEpisodeManifestTransport implements ManifestTransport {
  constructor(private readonly episodesRoot: string) {}

  async writeSelection(
    params: ManifestWritebackParams,
    target: ManifestWriteTarget,
  ): Promise<void> {
    const epDir = await this.resolveEpisodeDir(params);
    if (target.field === "chosen_variant_id") {
      await this.writeHookCandidates(epDir, `v${target.value}`);
    } else {
      const shotId = shotIdOfGroup(params.groupId);
      if (shotId == null) {
        throw new Error(
          `无法从 groupId ${params.groupId} 解析 shot_id(FS transport 只支持 shot: 组)`,
        );
      }
      await this.writeIframeManifest(epDir, shotId, target.field, target.value);
    }
  }

  private async resolveEpisodeDir(params: ManifestWritebackParams): Promise<string> {
    const refs = params.episodeRefs ?? [`ep${params.episodesId}`, String(params.episodesId)];
    for (const ref of refs) {
      if (!/^[A-Za-z0-9_-]+$/.test(ref)) continue; // 路径安全:目录名单词
      const dir = path.join(this.episodesRoot, ref);
      try {
        const st = await fsp.stat(dir);
        if (st.isDirectory()) return dir;
      } catch {
        // try next ref
      }
    }
    throw new Error(
      `episode 目录解析失败(refs=${refs.join(",")} root=${this.episodesRoot})`,
    );
  }

  /** iframe-manifest.json:list entry 按 shot_id 匹配 → entry[field]=value。 */
  private async writeIframeManifest(
    epDir: string,
    shotId: string,
    field: "selected_first_variant" | "selected_last_variant",
    value: number,
  ): Promise<void> {
    const file = path.join(epDir, "assets", "P11", "iframe-manifest.json");
    const manifest = JSON.parse(await fsp.readFile(file, "utf8")) as Array<Record<string, unknown>>;
    if (!Array.isArray(manifest)) throw new Error(`${file} 非 list 形状`);
    const entry = manifest.find((e) => e != null && e.shot_id === shotId);
    if (entry == null) throw new Error(`${file} 无 shot_id=${shotId} entry`);
    if (entry[field] === value) return; // 幂等 no-op
    entry[field] = value;
    await atomicWriteJson(file, manifest);
  }

  /** hook-candidates.json slot:value.chosen_variant_id = "v{N}"。 */
  private async writeHookCandidates(epDir: string, variantId: string): Promise<void> {
    const file = path.join(epDir, ".pipeline-assets", "hook-candidates.json");
    const doc = JSON.parse(await fsp.readFile(file, "utf8")) as {
      value?: Record<string, unknown>;
    } & Record<string, unknown>;
    const value = (doc.value ??= {});
    if (value["chosen_variant_id"] === variantId) return; // 幂等 no-op
    value["chosen_variant_id"] = variantId;
    value["resolved_at"] = new Date().toISOString();
    await atomicWriteJson(file, doc);
  }
}

function shotIdOfGroup(groupId: string): string | null {
  const m = /^cand:shot:([^:]+):(?:first|last)$/.exec(groupId);
  return m ? m[1]! : null;
}

async function atomicWriteJson(file: string, data: unknown): Promise<void> {
  const tmp = `${file}.kap-writeback-${process.pid}-${Date.now()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, undefined, 2), "utf8");
  await fsp.rename(tmp, file);
}

export function getManifestTransport(): ManifestTransport | null {
  // 69-01 (WBI-01):KMC_MANIFEST_TRANSPORT=fs → FS 直写 episode workdir。
  // 未配置 = 通道未开通(warn-once + no-op,不入队——避免每笔选定灌成 8 次
  // 重试 failed 行)。FS 路径约束(V12):必须限定在 episode workdir 内——
  // KMC_EPISODES_ROOT 之外的路径不写。
  const configured = process.env.KMC_MANIFEST_TRANSPORT;
  if (configured !== "fs") {
    if (configured != null && configured !== "") {
      // 配置了但不认识的值——按未开通处理,不猜通道
      console.warn(`[manifestWriteback] 未知 KMC_MANIFEST_TRANSPORT=${configured}(支持: fs)`);
    }
    return null;
  }
  const root = process.env.KMC_EPISODES_ROOT
    ?? "/data/workspace/kais-hermes-skills/skills/kais-movie-pipeline/episodes";
  return new FsEpisodeManifestTransport(root);
}

// ─── Target mapping(D-11 权威字段名)──────────────────────────────────────

export function targetForParams(params: ManifestWritebackParams): ManifestWriteTarget {
  const field: ManifestWriteTarget["field"] =
    params.frameSlot === "first"
      ? "selected_first_variant"
      : params.frameSlot === "last"
        ? "selected_last_variant"
        : "chosen_variant_id";
  return { field, value: params.variantIndex };
}

// ─── enqueueManifestWriteback(never-throws 挂点)──────────────────────────

export interface ManifestWritebackDeps {
  /** 传输解析注入(verify 用);缺省读 getManifestTransport()。 */
  getTransport?: () => ManifestTransport | null
  /** db 注入(verify :memory: 用);缺省 @/utils/db。 */
  db?: unknown
}

let warnedNoTransport = false;

export async function enqueueManifestWriteback(
  params: ManifestWritebackParams,
  deps?: ManifestWritebackDeps,
): Promise<void> {
  try {
    const transport = deps?.getTransport ? deps.getTransport() : getManifestTransport();
    if (transport == null) {
      if (!warnedNoTransport) {
        warnedNoTransport = true;
        console.warn(
          "[manifestWriteback] 传输未配置,跳过 manifest 回写(队列未启用)",
        );
      }
      return;
    }
    try {
      await transport.writeSelection(params, targetForParams(params));
      return; // 直投成功——不入队
    } catch {
      // 直投失败 → 入队重放(D-10)
    }
    try {
      const db = deps?.db != null
        ? (deps.db as import("knex").Knex)
        : (await import("@/utils/db")).db;
      await enqueueWriteback(db, {
        projectId: params.projectId,
        episodesId: params.episodesId,
        action: "manifest_writeback",
        payload: params as unknown as Record<string, unknown>,
      });
    } catch (queueErr) {
      // Pitfall 4:入队失败降级日志——最坏丢一次回写,canvas 真值已在
      console.warn("[manifestWriteback] 回写入队失败(降级丢弃):", queueErr);
    }
  } catch (outer) {
    // never-throws 双保险(连 getManifestTransport 抛错也不影响选定响应)
    console.warn("[manifestWriteback] 回写通道异常(吞错):", outer);
  }
}

// ─── replayManifestWriteback(drain handler)────────────────────────────────

/** 队列重放 handler:按行 payload 重放 writeSelection,成功 true。 */
export async function replayManifestWriteback(
  row: WritebackQueueRow,
  transport: ManifestTransport,
): Promise<boolean> {
  const params = JSON.parse(row.payload) as ManifestWritebackParams;
  await transport.writeSelection(params, targetForParams(params));
  return true;
}
