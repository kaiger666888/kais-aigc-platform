/**
 * Phase 59 (59-02) — 服务端 stale 标记接缝(下划线私有模块范式,与 _engine.ts /
 * _simulate.ts 同款:不挂 router,仅导出函数供 execute 路由层消费)。
 *
 * markStaleAndBroadcast(projectId, episodesId, changedAssetId):
 *   loadFullGraph(关系表唯一真值源,save-v2 写入面)→ migrateV2toV3(事件 id
 *   确定性合成 evt_<nodeId>,migrate.ts L523,与客户端 adaptV2Graph 同规则 →
 *   triggerEventId 跨端一致)→ markStaleDownstream(宪法 §13 纯函数零改动复用:
 *   传递闭包 / sequence·isInactive 边排除 / curation:'locked' 传播终点 /
 *   环防御 / 最早 since 保留)→ diff 只取**新增** stale 资产(绝不覆盖既有
 *   since)→ 逐节点先落库(upsertNode,data.stale 三字段整包)后广播
 *   (node:updated + projectId/episodesId scope + changedFields:["data.stale"],
 *   wire 格式对齐 v2/nodes.ts L210-213 + 59-fix CR-02 scope 扩展)——客户端
 *   (59-03 node:updated 订阅 + scope 守卫)复用既有级联消费链(D-01)。
 *
 * 决策编号(59-CONTEXT):
 *   - D-01 服务端标记(窄触发成功判定处调用,失败路径结构性不进);
 *   - D-03 级联深度 = 传递闭包(纯函数单点复用,禁手写 V2 因果遍历);
 *   - D-04 落选/locked 边界沿用(stale.ts 宪法 §13 注释即契约);
 *   - D-05 stale 字段复用 data.stale——wire 三字段 {since, triggerAssetId,
 *     triggerEventId}(serialize.ts:276-281 同款形状,缺一 migrate 还原为 null)。
 *
 * 配置:无 env 依赖。错误上抛(由 execute.ts 标记位 try/catch 接管,标记自身
 * 失败不把引擎成功翻成 error)——本模块不静默吞错。
 *
 * ⚠ 跨包深链纪律(59-RESEARCH Anti-Pattern #2):禁 import flowgraph-v3 的
 * index.ts(`export * from './zod.js'` 会拉包内 zod 3.23.8,与根仓 4.3.6 版本
 * 分裂冲突)——只深链 stale.ts / migrate.ts(runtime 依赖仅 integrity.js +
 * recipe.js 纯常量;import-from-dir.ts L81 跨包相对深链运行时先例)。
 */
import { markStaleDownstream } from "../../../packages/flowgraph-v3/ts/src/stale";
import { migrateV2toV3 } from "../../../packages/flowgraph-v3/ts/src/migrate";
import type { AssetNodeV3 } from "../../../packages/flowgraph-v3/ts/src/types";
import { loadFullGraph, listNodes, upsertNode } from "@/lib/canvasRelationalStore";
import { broadcastToProject } from "@/utils/ws";

/**
 * 59-fix WR-03: migrate planNode 支持的 V2 节点类型全集(v2types.ts
 * FlowNodeV2Type 联合镜像——planNode case 表 + Pass 3/4 分流的 variant/
 * reference)。legacy 图混入集合外类型(如 'phase',probe-59-real 真机发现)时
 * planNode throw,曾使 markStaleAndBroadcast 整图级联结构性失效(execute 吞错
 * 后仍 success、零 stale 写)。进 migrate 前过滤:migrate 对悬空边 warn+丢弃
 * (宽容,Pass 2「target 无合成事件,丢弃」先例),支持节点子集的下游级联照常;
 * changedAssetId 自身被滤掉 → 空级联(该节点无法在 V3 语义表达,正确)。
 */
const MIGRATE_SUPPORTED_V2_TYPES: ReadonlySet<string> = new Set([
  "script", "storyboard", "video", "audio", "asset", "scene_image",
  "upscale", "face_restore", "variant", "reference",
]);

export async function markStaleAndBroadcast(
  projectId: number,
  episodesId: number,
  changedAssetId: string,
): Promise<void> {
  const scope = { projectId, episodesId };
  const v2 = await loadFullGraph(scope);
  if (!v2) return;

  // 事件 id 确定性合成 evt_<nodeId>(migrate.ts L523)——与客户端 adaptV2Graph
  // 同规则,triggerEventId 跨端一致(服务端/客户端级联收敛的前提)。
  // 59-fix WR-03: 先滤掉 migrate 不支持的 V2 节点类型(整图 throw → 支持子集
  // 级联;见 MIGRATE_SUPPORTED_V2_TYPES 注释),滤过即 warn 可观测。
  // (root FlowGraphV2 与 flowgraph-v3 FlowGraphV2Export 结构性近同但类型独立,
  //  沿用下方既有 as any 传递——注释/成员访问零差异。)
  const unsupported = v2.nodes.filter((n) => !MIGRATE_SUPPORTED_V2_TYPES.has(n.type));
  const graphInput =
    unsupported.length > 0
      ? { ...v2, nodes: v2.nodes.filter((n) => MIGRATE_SUPPORTED_V2_TYPES.has(n.type)) }
      : v2;
  if (unsupported.length > 0) {
    console.warn(
      `[canvas:_stale] scope=${projectId}/${episodesId} 图含 ${unsupported.length} 个 migrate 不支持的 V2 节点类型` +
        `(${[...new Set(unsupported.map((n) => n.type))].join(",")}),已过滤——级联对支持节点子集继续(WR-03)`,
    );
  }
  const { graph: v3 } = migrateV2toV3(graphInput as any);
  const next = markStaleDownstream(v3, [changedAssetId], Date.now());

  // diff 只取增量:仅「本次新变 stale」的资产进入落库/广播——既有 stale 不
  // 覆盖(保最早 since,宪法 §13「已 stale 的资产不重复覆盖」落库侧兑现)。
  const prevById = new Map(v3.nodes.map((n) => [n.id, n]));
  const newlyStale: AssetNodeV3[] = [];
  for (const n of next.nodes) {
    if (n.kind !== "asset") continue;
    const asset = n as AssetNodeV3;
    if (asset.stale == null) continue;
    const prev = prevById.get(asset.id);
    const prevStale =
      prev != null && prev.kind === "asset" ? (prev as AssetNodeV3).stale : null;
    if (prevStale != null) continue;
    newlyStale.push(asset);
  }

  // 逐节点:先落库后广播(Pitfall 4——客户端全量 save 竞态下服务端真值先行)。
  // 找不到关系表行(已删节点/悬空 id)silent skip:广播必须与库一致,不广播
  // 库里不存在的节点。
  const existing = await listNodes(scope);
  for (const asset of newlyStale) {
    const row = existing.find((r) => r.id === asset.id);
    if (!row) continue;
    const stale = asset.stale!;
    const data = {
      ...(row.data ?? {}),
      // D-05:三字段整包(serialize.ts:276-281 同款 wire 形状,缺一 migrate
      // 还原为 null——刷新即丢,故必须整包)
      stale: {
        since: stale.since,
        triggerAssetId: stale.triggerAssetId,
        triggerEventId: stale.triggerEventId,
      },
    };
    await upsertNode(scope, { ...row, data });
    broadcastToProject(projectId, "node:updated", {
      // 59-fix CR-02: scope 字段上 wire — socket room=project:{id} 只隔离跨项目,
      // 同项目多 episodes 共享一室;缺 episodesId 使跨 episode 串扰成为可能
      // (确定性节点 id 跨 episodes 复用 → 他集客户端对自有图误触发级联并随
      // save 落库)。客户端守卫(FlowCanvas onNodeUpdated)以此为比对源。
      projectId,
      episodesId,
      node: { ...row, data },
      changedFields: ["data.stale"],
    });
  }
}
