/**
 * Director Desk — 场景管理 API
 *
 * POST   /api/v1/director-desk/scene       → 保存/更新场景 JSON
 * GET    /api/v1/director-desk/scene/:id   → 读取场景 JSON
 * GET    /api/v1/director-desk/scenes      → 列出某 episode 下所有场景
 *
 * 场景存储在 o_agentWorkData 表中，key = director-desk-scene:<sceneId>
 */

import express from "express";
import { z } from "zod";
import u from "@/utils";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

const SCENE_KEY_PREFIX = "director-desk-scene:";

/** POST /scene — 保存场景 */
router.post(
  "/",
  validateFields({
    projectId: z.number(),
    episodesId: z.number(),
    sceneId: z.string().optional(),
    project: z.record(z.string(), z.any()), // DirectorProject JSON
    label: z.string().optional(),
  }),
  async (req, res) => {
    const { projectId, episodesId, sceneId, project, label } = req.body;

    const id = sceneId || `scene-${Date.now()}`;
    const key = `${SCENE_KEY_PREFIX}${id}`;

    const payload = {
      id,
      projectId,
      episodesId,
      label: label || id,
      project,
      updatedAt: new Date().toISOString(),
    };

    try {
      // upsert
      const existing = await u
        .db("o_agentWorkData")
        .where("projectId", String(projectId))
        .andWhere("episodesId", String(episodesId))
        .andWhere("key", key)
        .first();

      if (existing) {
        await u
          .db("o_agentWorkData")
          .where("id", existing.id)
          .update({ data: JSON.stringify(payload) });
      } else {
        await u.db("o_agentWorkData").insert({
          projectId: String(projectId) as any,
          episodesId: String(episodesId) as any,
          key,
          data: JSON.stringify(payload),
        });
      }

      res.status(200).send(success({ sceneId: id, saved: true }));
    } catch (err: any) {
      console.error("[director-desk:scene] save error:", err.message);
      res.status(500).send(error("场景保存失败: " + err.message));
    }
  },
);

/** GET /scene/:id — 读取单个场景 */
router.get("/:sceneId", async (req, res) => {
  const { sceneId } = req.params;
  const { projectId, episodesId } = req.query;

  if (!projectId || !episodesId) {
    return res.status(400).send(error("缺少 projectId/episodesId"));
  }

  const key = `${SCENE_KEY_PREFIX}${sceneId}`;
  try {
    const row = await u
      .db("o_agentWorkData")
      .where("projectId", String(projectId))
      .andWhere("episodesId", String(episodesId))
      .andWhere("key", key)
      .first();

    if (!row?.data) {
      return res.status(404).send(error("场景不存在"));
    }

    const payload = JSON.parse(row.data);
    res.status(200).send(success(payload));
  } catch (err: any) {
    res.status(500).send(error("场景读取失败: " + err.message));
  }
});

/** GET /scenes — 列出所有场景 */
router.get("/", async (req, res) => {
  const { projectId, episodesId } = req.query;

  if (!projectId || !episodesId) {
    return res.status(400).send(error("缺少 projectId/episodesId"));
  }

  try {
    const rows = await u
      .db("o_agentWorkData")
      .where("projectId", String(projectId))
      .andWhere("episodesId", String(episodesId))
      .where("key", "like", `${SCENE_KEY_PREFIX}%`)
      .select("key", "data");

    const scenes = rows.map((r) => {
      try {
        const d = JSON.parse(r.data ?? "{}");
        return { id: d.id, label: d.label, updatedAt: d.updatedAt };
      } catch {
        return null;
      }
    }).filter(Boolean);

    res.status(200).send(success(scenes));
  } catch (err: any) {
    res.status(500).send(error("场景列表失败: " + err.message));
  }
});

export default router;
