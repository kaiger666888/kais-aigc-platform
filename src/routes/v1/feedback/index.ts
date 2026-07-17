import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";

const router = express.Router();

/**
 * Asset Feedback API — 资产反馈层
 *
 * 让人工（画布 UI）和 AI（API）都能对任意资产节点打分/标注，
 * 评价沉淀为时间线，驱动下游迭代。
 *
 * 路由顺序：静态路径 (/batch, /project/:id, /aggregate/:id, /stats/:id)
 * 必须在参数路径 (/:assetId) 之前注册，否则会被 :assetId 抢先匹配。
 */

// ─── POST /api/v1/feedback — 创建反馈 ────────────────────

const createSchema = z.object({
  assetId: z.string(),
  projectId: z.number(),
  score: z.number().min(0).max(1).optional(),
  verdict: z.enum(["approve", "reject", "contest", "note"]).optional(),
  content: z.string().optional().default(""),
  tags: z.array(z.string()).optional().default([]),
  source: z.enum(["human", "ai_reviewer", "pipeline_self"]).default("human"),
  reviewer: z.string().optional().default("anonymous"),
  context: z.any().optional(),
});

router.post("/", async (req, res) => {
  const parse = createSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).send(error("反馈参数校验失败", parse.error.issues));
  }
  const f = parse.data;
  const now = Date.now();
  const id = `fb-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    await u.db("kv_assetFeedback").insert({
      id,
      assetId: f.assetId,
      projectId: f.projectId,
      score: f.score ?? null,
      verdict: f.verdict ?? null,
      content: f.content,
      tags: JSON.stringify(f.tags ?? []),
      source: f.source,
      reviewer: f.reviewer,
      context: f.context !== undefined ? JSON.stringify(f.context) : null,
      status: "open",
      createdAt: now,
      resolvedAt: null,
    });

    return res.status(201).send(success({ id, ...f, tags: f.tags ?? [], status: "open", createdAt: now }));
  } catch (err: any) {
    console.error("[v1/feedback] 创建反馈失败:", err);
    return res.status(500).send(error("创建反馈失败: " + err.message));
  }
});

// ─── POST /api/v1/feedback/batch — 批量创建（AI 打分场景） ─

const batchSchema = z.object({
  feedbacks: z.array(createSchema.omit({ source: true, reviewer: true })).min(1),
  source: z.enum(["human", "ai_reviewer", "pipeline_self"]).default("ai_reviewer"),
  reviewer: z.string().optional(),
});

router.post("/batch", async (req, res) => {
  const parse = batchSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).send(error("批量反馈参数校验失败", parse.error.issues));
  }
  const { feedbacks, source, reviewer } = parse.data;
  const now = Date.now();

  try {
    const rows = feedbacks.map((f, i) => ({
      id: `fb-${(now + i).toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      assetId: f.assetId,
      projectId: f.projectId,
      score: f.score ?? null,
      verdict: f.verdict ?? null,
      content: f.content ?? "",
      tags: JSON.stringify(f.tags ?? []),
      source,
      reviewer: reviewer ?? "anonymous",
      context: f.context !== undefined ? JSON.stringify(f.context) : null,
      status: "open",
      createdAt: now + i,
      resolvedAt: null,
    }));

    await u.db("kv_assetFeedback").insert(rows);
    return res.status(201).send(success({ created: rows.length, ids: rows.map((r) => r.id) }));
  } catch (err: any) {
    console.error("[v1/feedback/batch] 批量创建失败:", err);
    return res.status(500).send(error("批量创建失败: " + err.message));
  }
});

// ─── GET /api/v1/feedback/project/:projectId — 项目全部反馈 ─

router.get("/project/:projectId", async (req, res) => {
  const projectId = parseInt(req.params.projectId, 10);
  if (isNaN(projectId)) return res.status(400).send(error("无效的项目 ID"));

  try {
    const list = await u.db("kv_assetFeedback")
      .where("projectId", projectId)
      .orderBy("createdAt", "desc");
    return res.status(200).send(success(decorateList(list)));
  } catch (err: any) {
    console.error("[v1/feedback/project] 查询失败:", err);
    return res.status(500).send(error("查询失败: " + err.message));
  }
});

// ─── GET /api/v1/feedback/aggregate/:projectId — 项目内按资产聚合 ─

router.get("/aggregate/:projectId", async (req, res) => {
  const projectId = parseInt(req.params.projectId, 10);
  if (isNaN(projectId)) return res.status(400).send(error("无效的项目 ID"));

  try {
    const rows = await u.db("kv_assetFeedback")
      .select("assetId", "score", "verdict", "createdAt")
      .where("projectId", projectId);

    const byAsset = new Map<string, { count: number; scoreSum: number; scoreN: number; verdictBreakdown: Record<string, number>; latest: { verdict: string | null; createdAt: number } | null }>();

    for (const r of rows) {
      let bucket = byAsset.get(r.assetId);
      if (!bucket) {
        bucket = { count: 0, scoreSum: 0, scoreN: 0, verdictBreakdown: {}, latest: null };
        byAsset.set(r.assetId, bucket);
      }
      bucket.count += 1;
      if (r.score != null) {
        bucket.scoreSum += r.score;
        bucket.scoreN += 1;
      }
      if (r.verdict) {
        bucket.verdictBreakdown[r.verdict] = (bucket.verdictBreakdown[r.verdict] ?? 0) + 1;
      }
      if (!bucket.latest || r.createdAt > bucket.latest.createdAt) {
        bucket.latest = { verdict: r.verdict ?? null, createdAt: r.createdAt };
      }
    }

    const aggregate: Record<string, any> = {};
    for (const [assetId, b] of byAsset) {
      aggregate[assetId] = {
        count: b.count,
        avgScore: b.scoreN > 0 ? b.scoreSum / b.scoreN : null,
        verdictBreakdown: b.verdictBreakdown,
        latestVerdict: b.latest?.verdict ?? null,
      };
    }

    return res.status(200).send(success(aggregate));
  } catch (err: any) {
    console.error("[v1/feedback/aggregate] 查询失败:", err);
    return res.status(500).send(error("聚合查询失败: " + err.message));
  }
});

// ─── POST /api/v1/feedback/propagate — 拓扑传播计算 ───────
// 计算给定资产节点的下游（或上游）受影响节点，并附带已有反馈聚合。
// 用于人工/AI 反馈时展示"此反馈会影响多少下游节点"。

const propagateSchema = z.object({
  assetId: z.string(),
  projectId: z.number(),
  direction: z.enum(["downstream", "upstream", "both"]).default("downstream"),
});

router.post("/propagate", async (req, res) => {
  const parse = propagateSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).send(error("传播参数校验失败", parse.error.issues));
  }
  const { assetId, projectId, direction } = parse.data;

  try {
    const result = await computePropagation(assetId, projectId, direction);
    if (result === null) {
      return res.status(404).send(error("项目暂无画布数据"));
    }
    return res.status(200).send(success(result));
  } catch (err: any) {
    console.error("[v1/feedback/propagate] 计算失败:", err);
    return res.status(500).send(error("传播计算失败: " + err.message));
  }
});

// ─── GET /api/v1/feedback/propagation/:assetId — 拓扑传播查询 ─
// 与 POST /propagate 等价的 GET 版本。projectId 通过 query 参数传递。
// 用于画布前端 Badge hover 时拉取"影响 Y 个下游节点"。

router.get("/propagation/:assetId", async (req, res) => {
  const assetId = req.params.assetId;
  const projectIdRaw = (req.query.projectId ?? req.query.project_id) as string | undefined;
  const projectId = projectIdRaw != null ? parseInt(projectIdRaw, 10) : NaN;
  if (isNaN(projectId)) {
    return res.status(400).send(error("缺少或无效的 projectId 查询参数"));
  }
  const direction = ((req.query.direction as string) || "downstream") as
    | "downstream"
    | "upstream"
    | "both";

  try {
    const result = await computePropagation(assetId, projectId, direction);
    if (result === null) {
      return res.status(404).send(error("项目暂无画布数据"));
    }
    return res.status(200).send(success(result));
  } catch (err: any) {
    console.error("[v1/feedback/propagation] 查询失败:", err);
    return res.status(500).send(error("传播查询失败: " + err.message));
  }
});

// ─── 拓扑传播核心算法 ─────────────────────────────────────
// 输入：起点 assetId + 项目 ID + 方向
// 输出：受影响节点列表 + 已有反馈聚合 + 子图（用于前端可视化）
// 返回 null 表示项目暂无画布数据。

async function computePropagation(
  assetId: string,
  projectId: number,
  direction: "downstream" | "upstream" | "both",
): Promise<PropagationResult | null> {
  // 1. 加载画布图
  const row = await u
    .db("o_agentWorkData")
    .where("projectId", String(projectId))
    .andWhere("key", "canvasGraph")
    .first();
  if (!row?.data) return null;
  let graph: { nodes?: any[]; links?: any[] };
  try {
    graph = JSON.parse(row.data);
  } catch {
    return null;
  }
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const links = Array.isArray(graph.links) ? graph.links : [];

  // 节点查找表
  const nodeById = new Map<string, any>();
  for (const n of nodes) {
    if (n && typeof n.id === "string") nodeById.set(n.id, n);
  }
  // 起点节点不在图中时，仍然允许返回空传播（不视为错误）
  if (!nodeById.has(assetId)) {
    return {
      sourceAssetId: assetId,
      downstream: [],
      upstream: [],
      affectedWithFeedback: [],
      propagationGraph: { nodes: [], links: [] },
    };
  }

  // 2. 构建邻接表
  //    downstream: source -> [target]
  //    upstream:   target -> [source]
  const downstreamAdj = new Map<string, Array<{ target: string; dataType: string }>>();
  const upstreamAdj = new Map<string, Array<{ source: string; dataType: string }>>();
  for (const link of links) {
    if (!link || typeof link.source !== "string" || typeof link.target !== "string") continue;
    const dataType = typeof link.dataType === "string" ? link.dataType : "output";
    if (!downstreamAdj.has(link.source)) downstreamAdj.set(link.source, []);
    downstreamAdj.get(link.source)!.push({ target: link.target, dataType });
    if (!upstreamAdj.has(link.target)) upstreamAdj.set(link.target, []);
    upstreamAdj.get(link.target)!.push({ source: link.source, dataType });
  }

  // 3. BFS 收集可达节点 + 记录深度 + 进入路径的 link
  const bfs = (
    start: string,
    adj: Map<string, Array<{ target?: string; source?: string; dataType: string }>>,
    nextKey: "target" | "source",
  ): { visited: Map<string, number>; pathLinks: Set<string> } => {
    const visited = new Map<string, number>([[start, 0]]);
    const pathLinks = new Set<string>();
    const queue: string[] = [start];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const curDepth = visited.get(cur) ?? 0;
      const neighbors = adj.get(cur) ?? [];
      for (const edge of neighbors) {
        const next = edge[nextKey];
        if (!next) continue;
        if (!visited.has(next)) {
          visited.set(next, curDepth + 1);
          queue.push(next);
        }
        // 记录子图用到的 link（source/target 复合键，避免重复）
        const a = nextKey === "target" ? cur : next;
        const b = nextKey === "target" ? next : cur;
        pathLinks.add(`${a}->${b}|${edge.dataType}`);
      }
    }
    return { visited, pathLinks };
  };

  const wantDown = direction === "downstream" || direction === "both";
  const wantUp = direction === "upstream" || direction === "both";

  const downRes = wantDown
    ? bfs(assetId, downstreamAdj as any, "target")
    : { visited: new Map<string, number>(), pathLinks: new Set<string>() };
  const upRes = wantUp
    ? bfs(assetId, upstreamAdj as any, "source")
    : { visited: new Map<string, number>(), pathLinks: new Set<string>() };

  // 移除起点本身
  downRes.visited.delete(assetId);
  upRes.visited.delete(assetId);

  const downstream = [...downRes.visited.keys()];
  const upstream = [...upRes.visited.keys()];

  // 4. 收集已有反馈（一次性查询项目内全部反馈，按 assetId 聚合）
  const affectedIds = new Set<string>([...downstream, ...upstream]);
  const affectedWithFeedback: Array<{
    assetId: string;
    latestVerdict: string | null;
    avgScore: number | null;
    count: number;
  }> = [];

  if (affectedIds.size > 0) {
    const rows = await u
      .db("kv_assetFeedback")
      .select("assetId", "score", "verdict", "createdAt")
      .where("projectId", projectId)
      .whereIn("assetId", [...affectedIds]);

    const byAsset = new Map<
      string,
      {
        count: number;
        scoreSum: number;
        scoreN: number;
        latestVerdict: string | null;
        latestAt: number;
      }
    >();
    for (const r of rows) {
      let bucket = byAsset.get(r.assetId);
      if (!bucket) {
        bucket = {
          count: 0,
          scoreSum: 0,
          scoreN: 0,
          latestVerdict: null,
          latestAt: -1,
        };
        byAsset.set(r.assetId, bucket);
      }
      bucket.count += 1;
      if (r.score != null) {
        bucket.scoreSum += r.score;
        bucket.scoreN += 1;
      }
      if (r.verdict && (r.createdAt ?? 0) > bucket.latestAt) {
        bucket.latestVerdict = r.verdict;
        bucket.latestAt = r.createdAt ?? 0;
      } else if (r.verdict && bucket.latestAt === -1) {
        bucket.latestVerdict = r.verdict;
      }
    }
    for (const [id, b] of byAsset) {
      affectedWithFeedback.push({
        assetId: id,
        latestVerdict: b.latestVerdict,
        avgScore: b.scoreN > 0 ? b.scoreSum / b.scoreN : null,
        count: b.count,
      });
    }
  }

  // 5. 构造传播子图（用于前端可视化）
  const propNodeIds = new Set<string>([assetId, ...downstream, ...upstream]);
  const propNodes: PropagationNode[] = [];
  for (const id of propNodeIds) {
    const n = nodeById.get(id);
    const depth = id === assetId ? 0 : (downRes.visited.get(id) ?? upRes.visited.get(id) ?? 0);
    propNodes.push({
      id,
      type: n?.type ?? "unknown",
      label:
        (n?.data?.label as string | undefined) ??
        (n?.phaseName as string | undefined) ??
        id,
      depth,
    });
  }

  // 子图边集：只保留两端都在 propNodeIds 中的 link
  const propLinks: PropagationLink[] = [];
  const seenLink = new Set<string>();
  for (const link of links) {
    if (
      !link ||
      typeof link.source !== "string" ||
      typeof link.target !== "string"
    )
      continue;
    if (!propNodeIds.has(link.source) || !propNodeIds.has(link.target)) continue;
    const dataType = typeof link.dataType === "string" ? link.dataType : "output";
    const key = `${link.source}->${link.target}|${dataType}`;
    if (seenLink.has(key)) continue;
    seenLink.add(key);
    propLinks.push({ source: link.source, target: link.target, dataType });
  }

  return {
    sourceAssetId: assetId,
    downstream,
    upstream,
    affectedWithFeedback,
    propagationGraph: { nodes: propNodes, links: propLinks },
  };
}

// ─── POST /api/v1/feedback/:assetId/resolve-downstream — 批量解决下游反馈 ─
// 当源资产被修复后，一键将该资产下游节点上所有 OPEN 状态的反馈标记为 resolved。
// projectId 从源资产已有的反馈记录中解析（同资产的所有反馈共享同一 projectId）。

router.post("/:assetId/resolve-downstream", async (req, res) => {
  const assetId = req.params.assetId;
  try {
    // 1. 解析 projectId（从源资产的已有反馈中读取）
    const sourceRow = await u.db("kv_assetFeedback")
      .select("projectId")
      .where("assetId", assetId)
      .first();
    if (!sourceRow) {
      return res.status(404).send(error("该资产暂无反馈，无需级联解决"));
    }
    const projectId = sourceRow.projectId;

    // 2. 运行下游传播
    const propagation = await computePropagation(assetId, projectId, "downstream");
    if (!propagation) {
      return res.status(404).send(error("项目暂无画布数据"));
    }
    const downstreamIds = propagation.downstream;
    if (downstreamIds.length === 0) {
      return res
        .status(200)
        .send(success({ resolvedCount: 0, affectedAssetIds: [] as string[] }));
    }

    // 3. 查询下游节点上所有 OPEN 状态的反馈
    const openRows = await u
      .db("kv_assetFeedback")
      .select("id", "assetId")
      .where("projectId", projectId)
      .whereIn("assetId", downstreamIds)
      .andWhere("status", "open");

    if (openRows.length === 0) {
      return res
        .status(200)
        .send(success({ resolvedCount: 0, affectedAssetIds: [] as string[] }));
    }

    const now = Date.now();
    const ids = openRows.map((r) => r.id);
    const affectedAssetIds = [...new Set(openRows.map((r) => r.assetId))];

    await u.db("kv_assetFeedback").whereIn("id", ids).update({
      status: "resolved",
      resolvedAt: now,
    });

    return res.status(200).send(
      success({
        resolvedCount: ids.length,
        affectedAssetIds,
        note: "Auto-resolved: source asset fixed",
      }),
    );
  } catch (err: any) {
    console.error("[v1/feedback/resolve-downstream] 失败:", err);
    return res.status(500).send(error("级联解决失败: " + err.message));
  }
});

// ─── GET /api/v1/feedback/heatmap/:projectId — 项目热力图 ────
// 返回项目内所有资产的反馈聚合，附带每个资产的下游影响数与风险等级，
// 用于画布 overlay 显示。必须在 GET /:assetId 之前注册。

router.get("/heatmap/:projectId", async (req, res) => {
  const projectId = parseInt(req.params.projectId, 10);
  if (isNaN(projectId)) return res.status(400).send(error("无效的项目 ID"));

  try {
    // 1. 拉取项目内全部反馈
    const rows = await u
      .db("kv_assetFeedback")
      .select("assetId", "score", "verdict", "createdAt", "status")
      .where("projectId", projectId);

    // 2. 按资产聚合
    const byAsset = new Map<
      string,
      {
        count: number;
        scoreSum: number;
        scoreN: number;
        latestVerdict: string | null;
        latestAt: number;
      }
    >();
    for (const r of rows) {
      let bucket = byAsset.get(r.assetId);
      if (!bucket) {
        bucket = {
          count: 0,
          scoreSum: 0,
          scoreN: 0,
          latestVerdict: null,
          latestAt: -1,
        };
        byAsset.set(r.assetId, bucket);
      }
      bucket.count += 1;
      if (r.score != null) {
        bucket.scoreSum += r.score;
        bucket.scoreN += 1;
      }
      if (r.verdict && (r.createdAt ?? 0) > bucket.latestAt) {
        bucket.latestVerdict = r.verdict;
        bucket.latestAt = r.createdAt ?? 0;
      } else if (r.verdict && bucket.latestAt === -1) {
        bucket.latestVerdict = r.verdict;
      }
    }

    // 3. 加载画布图（一次性），计算每个资产下游可达节点数
    const graphRow = await u
      .db("o_agentWorkData")
      .where("projectId", String(projectId))
      .andWhere("key", "canvasGraph")
      .first();
    let graph: { nodes?: any[]; links?: any[] } | null = null;
    if (graphRow?.data) {
      try {
        graph = JSON.parse(graphRow.data);
      } catch {
        graph = null;
      }
    }
    const downstreamCounts = computeDownstreamCounts(graph, new Set(byAsset.keys()));

    // 4. 组装 assets + 风险分级
    const assets: Array<{
      assetId: string;
      feedbackCount: number;
      avgScore: number | null;
      latestVerdict: string | null;
      downstreamCount: number;
      riskLevel: "high" | "medium" | "low";
    }> = [];
    for (const [assetId, b] of byAsset) {
      const downstreamCount = downstreamCounts.get(assetId) ?? 0;
      let riskLevel: "high" | "medium" | "low";
      if (b.latestVerdict === "reject" && downstreamCount > 0) {
        riskLevel = "high";
      } else if (b.latestVerdict === "contest" || b.latestVerdict === "reject") {
        riskLevel = "medium";
      } else {
        riskLevel = "low";
      }
      assets.push({
        assetId,
        feedbackCount: b.count,
        avgScore: b.scoreN > 0 ? b.scoreSum / b.scoreN : null,
        latestVerdict: b.latestVerdict,
        downstreamCount,
        riskLevel,
      });
    }

    // 5. 汇总统计
    const totalFeedback = rows.length;
    const countVerdict = (v: string) => rows.filter((r) => r.verdict === v).length;
    const approveRate = totalFeedback > 0 ? countVerdict("approve") / totalFeedback : 0;
    const rejectRate = totalFeedback > 0 ? countVerdict("reject") / totalFeedback : 0;
    const contestRate = totalFeedback > 0 ? countVerdict("contest") / totalFeedback : 0;
    const highRiskAssets = assets.filter((a) => a.riskLevel === "high").map((a) => a.assetId);

    return res.status(200).send(
      success({
        projectId,
        totalAssets: assets.length,
        assets,
        summary: {
          totalFeedback,
          approveRate,
          rejectRate,
          contestRate,
          highRiskAssets,
        },
      }),
    );
  } catch (err: any) {
    console.error("[v1/feedback/heatmap] 查询失败:", err);
    return res.status(500).send(error("热力图查询失败: " + err.message));
  }
});

// ─── 批量计算下游可达节点数 ─────────────────────────────────
// 用于 heatmap：一次加载图，对每个有反馈的资产 BFS 统计可达节点数。
function computeDownstreamCounts(
  graph: { nodes?: any[]; links?: any[] } | null,
  assetIds: Set<string>,
): Map<string, number> {
  const result = new Map<string, number>();
  if (!graph || !Array.isArray(graph.links)) {
    for (const id of assetIds) result.set(id, 0);
    return result;
  }

  const adj = new Map<string, string[]>();
  for (const link of graph.links) {
    if (!link || typeof link.source !== "string" || typeof link.target !== "string") continue;
    if (!adj.has(link.source)) adj.set(link.source, []);
    adj.get(link.source)!.push(link.target);
  }

  for (const start of assetIds) {
    if (!adj.has(start)) {
      result.set(start, 0);
      continue;
    }
    const visited = new Set<string>([start]);
    const queue: string[] = [start];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const neighbors = adj.get(cur) ?? [];
      for (const next of neighbors) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    visited.delete(start); // 不计自身
    result.set(start, visited.size);
  }

  return result;
}

// ─── 传播相关类型（同时供前端通过 canvasApi 镜像使用） ─────
interface PropagationNode {
  id: string;
  type: string;
  label: string;
  depth: number;
}
interface PropagationLink {
  source: string;
  target: string;
  dataType: string;
}
interface PropagationResult {
  sourceAssetId: string;
  downstream: string[];
  upstream: string[];
  affectedWithFeedback: Array<{
    assetId: string;
    latestVerdict: string | null;
    avgScore: number | null;
    count: number;
  }>;
  propagationGraph: {
    nodes: PropagationNode[];
    links: PropagationLink[];
  };
}

// ─── GET /api/v1/feedback/stats/:assetId — 单资产统计 ─────

router.get("/stats/:assetId", async (req, res) => {
  const assetId = req.params.assetId;
  try {
    const rows = await u.db("kv_assetFeedback")
      .where("assetId", assetId)
      .orderBy("createdAt", "desc");

    if (rows.length === 0) {
      return res.status(200).send(success({ count: 0, avgScore: null, verdictBreakdown: {}, latest: null }));
    }

    let scoreSum = 0;
    let scoreN = 0;
    const verdictBreakdown: Record<string, number> = {};
    for (const r of rows) {
      if (r.score != null) {
        scoreSum += r.score;
        scoreN += 1;
      }
      if (r.verdict) {
        verdictBreakdown[r.verdict] = (verdictBreakdown[r.verdict] ?? 0) + 1;
      }
    }

    const latest = decorateRow(rows[0]);
    return res.status(200).send(success({
      count: rows.length,
      avgScore: scoreN > 0 ? scoreSum / scoreN : null,
      verdictBreakdown,
      latest,
    }));
  } catch (err: any) {
    console.error("[v1/feedback/stats] 查询失败:", err);
    return res.status(500).send(error("统计查询失败: " + err.message));
  }
});

// ─── GET /api/v1/feedback/:assetId — 资产反馈时间线 ───────
// 注意：必须放在所有静态子路径之后。

router.get("/:assetId", async (req, res) => {
  const assetId = req.params.assetId;
  try {
    const list = await u.db("kv_assetFeedback")
      .where("assetId", assetId)
      .orderBy("createdAt", "desc");
    return res.status(200).send(success(decorateList(list)));
  } catch (err: any) {
    console.error("[v1/feedback/:assetId] 查询失败:", err);
    return res.status(500).send(error("查询失败: " + err.message));
  }
});

// ─── PATCH /api/v1/feedback/:id — 更新状态 ──────────────

const updateSchema = z.object({
  status: z.enum(["open", "acknowledged", "resolved", "contested"]),
});

router.patch("/:id", async (req, res) => {
  const id = req.params.id;
  const parse = updateSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).send(error("状态参数校验失败", parse.error.issues));
  }
  const { status } = parse.data;

  try {
    const existing = await u.db("kv_assetFeedback").where("id", id).first();
    if (!existing) return res.status(404).send(error("反馈不存在"));

    const updates: Record<string, any> = { status };
    if (status === "resolved" || status === "contested") {
      updates.resolvedAt = Date.now();
    }
    await u.db("kv_assetFeedback").where("id", id).update(updates);
    return res.status(200).send(success({ id, ...updates }));
  } catch (err: any) {
    console.error("[v1/feedback/:id] PATCH 失败:", err);
    return res.status(500).send(error("更新失败: " + err.message));
  }
});

// ─── 行解码 helper：把 DB 行里的 JSON 字符串还原 ─────────

function decorateRow(row: any): any {
  if (!row) return row;
  let tags: any[] = [];
  try {
    tags = row.tags ? JSON.parse(row.tags) : [];
  } catch {
    tags = [];
  }
  let ctx: any = undefined;
  try {
    ctx = row.context ? JSON.parse(row.context) : undefined;
  } catch {
    ctx = row.context;
  }
  return { ...row, tags, context: ctx };
}

function decorateList(rows: any[]): any[] {
  return (rows ?? []).map(decorateRow);
}

export default router;
