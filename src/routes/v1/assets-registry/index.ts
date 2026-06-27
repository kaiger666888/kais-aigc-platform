import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

/**
 * Asset Registry API — 全局资产注册表
 *
 * 设计参照: tldraw TLAssetStore / Unreal AssetManager / Unity Addressables
 * 核心原则: 资产有全局 uuid 身份，画布通过 assetId 引用，元数据和文件指针分离。
 */

// ─── POST /api/v1/assets — 注册新资产 ───────────────────

const createSchema = z.object({
  uuid: z.string().optional(),
  name: z.string(),
  type: z.enum(["character", "scene", "prop", "clip", "voice", "video", "storyboard", "script_phase", "outline", "topic", "delivery"]),
  prompt: z.string().optional().default(""),
  describe: z.string().optional().default(""),
  projectId: z.number().nullable().optional(),
  scriptId: z.number().optional(),
  imageId: z.number().optional(),
  assetsId: z.number().optional(), // Primary→Secondary 引用
  characterId: z.string().optional(),
  viewAngle: z.string().optional(),
  isPrimaryView: z.boolean().optional().default(false),
  model: z.string().optional(),
  tags: z.string().optional(),
  meta: z.any().optional(),
  createdBy: z.string().optional().default("manual"),
});

router.post("/", async (req, res) => {
  const parse = createSchema.safeParse(req.body.asset ?? req.body);
  if (!parse.success) {
    return res.status(400).send(error("资产参数校验失败", parse.error.issues));
  }
  const a = parse.data;
  const now = Date.now();

  try {
    // 生成全局 uuid (如果未提供)
    const uuid = a.uuid || `ast-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    // 生成自增 id
    const rows = await u.db("o_assets").select("id");
    const maxId = rows.reduce((m: number, r: any) => Math.max(m, r.id || 0), 0);
    const id = maxId + 1;

    await u.db("o_assets").insert({
      id,
      uuid,
      name: a.name,
      type: a.type,
      prompt: a.prompt,
      describe: a.describe,
      projectId: a.projectId ?? null,
      scriptId: a.scriptId ?? null,
      imageId: a.imageId ?? null,
      assetsId: a.assetsId ?? null,
      characterId: a.characterId ?? null,
      viewAngle: a.viewAngle ?? null,
      isPrimaryView: a.isPrimaryView ?? false,
      model: a.model ?? null,
      tags: a.tags ?? null,
      state: "active",
      meta: a.meta ? JSON.stringify(a.meta) : null,
      createdAt: now,
      createdBy: a.createdBy,
    });

    return res.status(201).send(success({ id, uuid, ...a }));
  } catch (err: any) {
    console.error("[v1/assets] 创建资产失败:", err);
    return res.status(500).send(error("创建资产失败: " + err.message));
  }
});

// ─── POST /api/v1/assets/search — 搜索资产 ──────────────

const searchSchema = z.object({
  query: z.string().optional(),
  type: z.string().optional(),
  projectId: z.number().nullable().optional(),
  characterId: z.string().optional(),
  tags: z.string().optional(),
  state: z.string().optional().default("active"),
  limit: z.number().int().min(1).max(200).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
  includeFile: z.boolean().optional().default(true), // JOIN o_image
});

router.post("/search", async (req, res) => {
  const parse = searchSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).send(error("参数校验失败", parse.error.issues));
  const s = parse.data;
  try {
    let q = u.db("o_assets as a");

    if (s.includeFile) {
      q = q.leftJoin("o_image as img", "a.imageId", "img.id")
            .select("a.*", "img.filePath as filePath", "img.state as imageState", "img.model as imageModel", "img.resolution");
    } else {
      q = q.select("a.*");
    }

    q = q.where("a.state", s.state);

    if (s.query) {
      q = q.andWhere(function () {
        this.where("a.name", "like", `%${s.query}%`)
            .orWhere("a.prompt", "like", `%${s.query}%`)
            .orWhere("a.describe", "like", `%${s.query}%`);
      });
    }
    if (s.type) q = q.andWhere("a.type", s.type);
    if (s.projectId !== undefined) {
      if (s.projectId === null) {
        q = q.whereNull("a.projectId");
      } else {
        q = q.andWhere("a.projectId", s.projectId);
      }
    }
    if (s.characterId) q = q.andWhere("a.characterId", s.characterId);
    if (s.tags) q = q.andWhere("a.tags", "like", `%${s.tags}%`);

    q = q.orderBy("a.createdAt", "desc").limit(s.limit).offset(s.offset);

    const results = await q;

    return res.status(200).send(success({ assets: results, count: results.length }));
  } catch (err: any) {
    console.error("[v1/assets/search] 搜索失败:", err);
    return res.status(500).send(error("搜索失败: " + err.message));
  }
});

// ─── GET /api/v1/assets/:id — 获取单个资产 ─────────────

router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).send(error("无效的资产 ID"));

  try {
    const asset = await u.db("o_assets as a")
      .leftJoin("o_image as img", "a.imageId", "img.id")
      .select("a.*", "img.filePath", "img.state as imageState", "img.model as imageModel", "img.resolution")
      .where("a.id", id)
      .first();

    if (!asset) return res.status(404).send(error("资产不存在"));

    // 如果有 assetsId (是 Secondary)，查父资产名
    if (asset.assetsId) {
      const parent = await u.db("o_assets").select("name", "type").where("id", asset.assetsId).first();
      asset.parentName = parent?.name ?? null;
      asset.parentType = parent?.type ?? null;
    }

    return res.status(200).send(success(asset));
  } catch (err: any) {
    console.error("[v1/assets/:id] 查询失败:", err);
    return res.status(500).send(error("查询失败: " + err.message));
  }
});

// ─── PATCH /api/v1/assets/:id — 更新资产元数据 ─────────

const updateSchema = z.object({
  name: z.string().optional(),
  prompt: z.string().optional(),
  describe: z.string().optional(),
  characterId: z.string().nullable().optional(),
  viewAngle: z.string().optional(),
  isPrimaryView: z.boolean().optional(),
  model: z.string().optional(),
  tags: z.string().optional(),
  state: z.enum(["active", "archived"]).optional(),
  meta: z.any().optional(),
  imageId: z.number().nullable().optional(),
});

router.patch("/:id", async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) return res.status(400).send(error("无效的资产 ID"));

  const parse = updateSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).send(error("参数校验失败", parse.error.issues));

  try {
    const existing = await u.db("o_assets").where("id", id).first();
    if (!existing) return res.status(404).send(error("资产不存在"));

    const updates: Record<string, any> = {};
    const allowed = ["name", "prompt", "describe", "characterId", "viewAngle", "isPrimaryView", "model", "tags", "state", "imageId"];
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (req.body.meta !== undefined) updates.meta = JSON.stringify(req.body.meta);

    if (Object.keys(updates).length === 0) {
      return res.status(200).send(success({ id, message: "无更新" }));
    }

    await u.db("o_assets").where("id", id).update(updates);
    return res.status(200).send(success({ id, updated: Object.keys(updates) }));
  } catch (err: any) {
    console.error("[v1/assets/:id] PATCH 失败:", err);
    return res.status(500).send(error("更新失败: " + err.message));
  }
});

// ─── GET /api/v1/assets/project/:projectId — 项目资产列表 ─

router.get("/project/:projectId", async (req, res) => {
  const projectId = parseInt(req.params.projectId, 10);
  if (isNaN(projectId)) return res.status(400).send(error("无效的项目 ID"));

  try {
    const assets = await u.db("o_assets as a")
      .leftJoin("o_image as img", "a.imageId", "img.id")
      .select("a.*", "img.filePath", "img.state as imageState", "img.model as imageModel", "img.resolution")
      .where("a.projectId", projectId)
      .whereNull("a.assetsId") // Primary 资产 (非派生)
      .orderBy("a.type", "asc")
      .orderBy("a.createdAt", "desc");

    return res.status(200).send(success({ assets, count: assets.length }));
  } catch (err: any) {
    console.error("[v1/assets/project] 查询失败:", err);
    return res.status(500).send(error("查询失败: " + err.message));
  }
});

// ─── POST /api/v1/assets/update-meta — 轻量更新元数据 (幂等场景) ─

router.post("/update-meta", async (req, res) => {
  const id = parseInt(req.body.id, 10);
  if (isNaN(id)) return res.status(400).send(error("无效的资产 ID"));

  try {
    const existing = await u.db("o_assets").where("id", id).first();
    if (!existing) return res.status(404).send(error("资产不存在"));

    const updates: Record<string, any> = {};
    const allowed = ["describe", "tags", "state"];
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (req.body.meta !== undefined) {
      // Merge meta rather than replace
      const oldMeta = existing.meta ? JSON.parse(existing.meta) : {};
      updates.meta = JSON.stringify({ ...oldMeta, ...req.body.meta });
    }

    if (Object.keys(updates).length === 0) {
      return res.status(200).send(success({ id, message: "无更新" }));
    }

    await u.db("o_assets").where("id", id).update(updates);
    return res.status(200).send(success({ id, updated: Object.keys(updates) }));
  } catch (err: any) {
    console.error("[v1/assets/update-meta] 失败:", err);
    return res.status(500).send(error("更新失败: " + err.message));
  }
});

// ─── GET /api/v1/assets/:id/variants — 资产的变体列表 ───

router.get("/:id/variants", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).send(error("无效的资产 ID"));

  try {
    // Secondary 资产 = assetsId 指向 id 的记录
    const variants = await u.db("o_assets as a")
      .leftJoin("o_image as img", "a.imageId", "img.id")
      .select("a.*", "img.filePath", "img.state as imageState")
      .where("a.assetsId", id)
      .orderBy("a.viewAngle", "asc");

    return res.status(200).send(success({ variants, count: variants.length }));
  } catch (err: any) {
    console.error("[v1/assets/variants] 查询失败:", err);
    return res.status(500).send(error("查询失败: " + err.message));
  }
});

export default router;
