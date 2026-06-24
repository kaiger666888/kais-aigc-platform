import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { broadcastToProject } from "@/utils/ws";
import { appendAndSync, listEvents, getLastEventId } from "@/lib/canvasEventStore";
import type { CanvasEvent, CanvasEventType } from "@/lib/canvasEventTypes";

const router = express.Router();

const EVENT_TYPE_ENUM = [
  "node_upsert",
  "node_delete",
  "link_upsert",
  "link_delete",
  "branch_upsert",
  "branch_delete",
  "variant_group_upsert",
  "review_status",
  "bootstrap",
] as const;

const eventInputSchema = z.object({
  type: z.enum(EVENT_TYPE_ENUM),
  nodeId: z.string().optional(),
  payload: z.any(),
});

router.post(
  "/",
  validateFields({
    projectId: z.number(),
    episodesId: z.number(),
    clientId: z.string().min(1).max(128),
    source: z.string().max(32).optional(),
    events: z.array(eventInputSchema).min(1).max(200),
  }),
  async (req, res) => {
    const { projectId, episodesId, clientId, source, events } = req.body;

    try {
      const result = await appendAndSync({
        projectId,
        episodesId,
        clientId,
        source,
        events: events.map((e: { type: CanvasEventType; nodeId?: string; payload: unknown }) => ({
          type: e.type,
          nodeId: e.nodeId,
          payload: e.payload,
        })),
      });

      if (!result.duplicated && result.eventIds.length > 0) {
        const fresh = await listEvents(projectId, episodesId, Math.min(...result.eventIds) - 1);
        for (const ev of fresh) {
          broadcastCanvasEvent(projectId, episodesId, ev);
        }
      }

      return res.status(200).send(
        success({
          eventIds: result.eventIds,
          duplicated: result.duplicated,
          lastEventId: result.lastEventId,
        }),
      );
    } catch (err) {
      console.error("[v2/canvas/events] append 失败:", err);
      return res.status(500).send(error("事件追加失败"));
    }
  },
);

router.get(
  "/last-event-id",
  validateFields(
    {
      projectId: z.number(),
      episodesId: z.number(),
    },
    "query",
  ),
  async (req, res) => {
    const projectId = Number(req.query.projectId);
    const episodesId = Number(req.query.episodesId);
    try {
      const lastEventId = await getLastEventId(projectId, episodesId);
      return res.status(200).send(success({ lastEventId }));
    } catch (err) {
      console.error("[v2/canvas/events/last-event-id] 查询失败:", err);
      return res.status(500).send(error("查询失败"));
    }
  },
);

function broadcastCanvasEvent(projectId: number, episodesId: number, ev: CanvasEvent): void {
  broadcastToProject(projectId, "canvas:event", {
    eventId: ev.eventId,
    type: ev.type,
    nodeId: ev.nodeId,
    payload: ev.payload,
    projectId,
    episodesId,
    createdAt: ev.createdAt,
  });
}

export default router;
