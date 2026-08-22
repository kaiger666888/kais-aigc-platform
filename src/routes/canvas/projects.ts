import express from "express";
import u from "@/utils";
import { success, error } from "@/lib/responseFormat";
const router = express.Router();

/**
 * 画布内容节点的展示分类。canvas_nodes.type 的取值里:
 *  - asset / reference → 资产(角色卡/场景/参考资产,reference 合并计入资产)
 *  - storyboard        → 分镜
 *  - video             → 视频
 *  - zone / phase / suggestion → 布局分区 / AI 建议,非创作内容,不计入。
 */
const ASSET_TYPES = ["asset", "reference"];
const STORYBOARD_TYPE = "storyboard";
const VIDEO_TYPE = "video";
const CONTENT_TYPES = [...ASSET_TYPES, STORYBOARD_TYPE, VIDEO_TYPE];

/** Phase 57-02（U-08）管线带直方图的计数口径：创作内容节点。
 *  排除 zone/phase/suggestion/variant —— 布局分区/AI 建议同样带 phase_index，
 *  计入会让「这部片子走到了哪」失真（每个 zone 都算 filled）。script/audio
 *  不在 CONTENT_TYPES 里但承载 P01-P03/P10-P12b 的真实产物，必须计入。 */
const RIBBON_TYPES = ["asset", "reference", "script", "storyboard", "audio", "video"];

/** 获取所有项目列表（供画布项目选择器使用）。
 *
 * 统计来自 canvas_nodes（画布真实数据），不再查 o_script/o_assets 旧表——后者对绝大多数
 * 项目为空（数据早已写入 canvas_nodes），导致旧的 scriptCount/assetCount 长期为 0。
 * 一次 GROUP BY 聚合所有项目，避免 N+1。 */
export default router.post("/", async (_req, res) => {
  try {
    const projects = await u.db("o_project").select(
      "id", "name", "type", "mode", "intro", "artStyle",
      "imageModel", "videoModel", "createTime",
    );

    if (projects.length === 0) {
      res.status(200).send(success([]));
      return;
    }
    const projectIds = projects.map((p) => p.id).filter((x): x is number => typeof x === "number");

    // 一次聚合：每个 project 的内容节点按 type 计数（canvas_nodes 列名为下划线）
    const typeStats = (await u.db("canvas_nodes")
      .select("project_id", "type")
      .count("* as cnt")
      .whereIn("project_id", projectIds)
      .whereIn("type", CONTENT_TYPES)
      .groupBy("project_id", "type")) as Array<{ project_id: number; type: string; cnt: number }>;

    // 一次聚合：每个 project 的 episodes（集）分布 + 各集节点数
    const epStats = (await u.db("canvas_nodes")
      .select("project_id", "episodes_id")
      .count("* as cnt")
      .whereIn("project_id", projectIds)
      .groupBy("project_id", "episodes_id")) as Array<{ project_id: number; episodes_id: number; cnt: number }>;

    // 一次聚合（Phase 57-02/U-08）：每集的 phase 直方图 —— 管线带 micro 数据源。
    // additive 字段 episodes[].phases（phaseIndex → count，只含 count>0 键）；
    // null phase_index 不进直方图。单条 GROUP BY 增一维，与既有聚合同量级（无 N+1）。
    const phaseStats = (await u.db("canvas_nodes")
      .select("project_id", "episodes_id", "phase_index")
      .count("* as cnt")
      .whereIn("project_id", projectIds)
      .whereIn("type", RIBBON_TYPES)
      .whereNotNull("phase_index")
      .groupBy("project_id", "episodes_id", "phase_index")) as Array<{
      project_id: number;
      episodes_id: number;
      phase_index: number;
      cnt: number;
    }>;

    // 归组：project_id → { asset, storyboard, video }
    const typeByProj = new Map<number, { asset: number; storyboard: number; video: number }>();
    for (const r of typeStats) {
      let entry = typeByProj.get(r.project_id);
      if (!entry) { entry = { asset: 0, storyboard: 0, video: 0 }; typeByProj.set(r.project_id, entry); }
      const cnt = Number(r.cnt);
      if (ASSET_TYPES.includes(r.type)) entry.asset += cnt;
      else if (r.type === STORYBOARD_TYPE) entry.storyboard += cnt;
      else if (r.type === VIDEO_TYPE) entry.video += cnt;
    }

    // 归组：project_id → episodes[{id, nodeCount}]（按集号升序）
    const epsByProj = new Map<number, Array<{ id: number; nodeCount: number }>>();
    for (const r of epStats) {
      let arr = epsByProj.get(r.project_id);
      if (!arr) { arr = []; epsByProj.set(r.project_id, arr); }
      arr.push({ id: r.episodes_id, nodeCount: Number(r.cnt) });
    }

    // 归组：project_id + episodes_id → phases 直方图（additive；count>0 才进键集）
    const phasesByEp = new Map<string, Record<number, number>>();
    for (const r of phaseStats) {
      const key = `${r.project_id}:${r.episodes_id}`;
      let entry = phasesByEp.get(key);
      if (!entry) { entry = {}; phasesByEp.set(key, entry); }
      entry[Number(r.phase_index)] = Number(r.cnt);
    }

    const enriched = projects.map((p) => {
      const pid = p.id as number;
      const t = typeByProj.get(pid) ?? { asset: 0, storyboard: 0, video: 0 };
      const episodes = (epsByProj.get(pid) ?? [])
        .sort((a, b) => a.id - b.id)
        .map((ep) => ({ ...ep, phases: phasesByEp.get(`${pid}:${ep.id}`) ?? {} }));
      return {
        ...p,
        assetCount: t.asset,
        storyboardCount: t.storyboard,
        videoCount: t.video,
        episodeCount: episodes.length,
        episodes,
      };
    });

    res.status(200).send(success(enriched));
  } catch (err) {
    console.error("[canvas:projects] 获取项目列表失败:", err);
    res.status(500).send(error("获取项目列表失败"));
  }
});
