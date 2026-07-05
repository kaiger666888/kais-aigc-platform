import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { broadcastToProject } from "@/utils/ws";
import type { FlowLinkV2 } from "@/types/flowgraph-v2";
import {
  upsertLink,
  deleteLink,
  listLinks,
  listNodes,
  touchMeta,
  ensureMeta,
} from "@/lib/canvasRelationalStore";

const router = express.Router();

const linkInputSchema = z.object({
  id: z.string().optional(),
  source: z.string(),
  target: z.string(),
  branchId: z.string(),
  dataType: z.string(),
  isExplore: z.boolean().optional(),
  isInactive: z.boolean().optional(),
});

/** 创建连线 — single-row INSERT */
router.post(
  "/",
  validateFields({
    projectId: z.number(),
    episodesId: z.number(),
    link: linkInputSchema,
  }),
  async (req, res) => {
    const { projectId, episodesId, link: linkInput } = req.body;

    try {
      await ensureMeta({ projectId, episodesId });

      const link: FlowLinkV2 = {
        ...linkInput,
        id: linkInput.id || `link-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      } as FlowLinkV2;

      // Check nodes exist (direct row lookup)
      const nodes = await listNodes({ projectId, episodesId });
      if (!nodes.some((n) => n.id === link.source)) {
        return res.status(400).send(error(`源节点 ${link.source} 不存在`));
      }
      if (!nodes.some((n) => n.id === link.target)) {
        return res.status(400).send(error(`目标节点 ${link.target} 不存在`));
      }

      const links = await listLinks({ projectId, episodesId });
      if (links.some((l) => l.id === link.id)) {
        return res.status(409).send(error(`连线 ${link.id} 已存在`));
      }

      await upsertLink({ projectId, episodesId }, link);
      await touchMeta({ projectId, episodesId });

      broadcastToProject(projectId, "link:created", { link });
      return res.status(200).send(success({ link }));
    } catch (err) {
      console.error("[v2/canvas/links] 创建连线失败:", err);
      return res.status(500).send(error("创建连线失败"));
    }
  },
);

/** 删除连线 — single-row DELETE */
router.delete(
  "/:linkId",
  validateFields({
    projectId: z.number(),
    episodesId: z.number(),
  }, "query"),
  async (req, res) => {
    const projectId = Number(req.query.projectId);
    const episodesId = Number(req.query.episodesId);
    const linkId = String(req.params.linkId);

    try {
      await ensureMeta({ projectId, episodesId });
      const links = await listLinks({ projectId, episodesId });
      if (!links.some((l) => l.id === linkId)) {
        return res.status(404).send(error(`连线 ${linkId} 不存在`));
      }

      await deleteLink({ projectId, episodesId }, linkId);
      await touchMeta({ projectId, episodesId });

      broadcastToProject(projectId, "link:deleted", { linkId });
      return res.status(200).send(success({ linkId }));
    } catch (err) {
      console.error("[v2/canvas/links] 删除连线失败:", err);
      return res.status(500).send(error("删除连线失败"));
    }
  },
);

export default router;
