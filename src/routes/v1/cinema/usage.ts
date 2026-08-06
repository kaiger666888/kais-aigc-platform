import express from "express";
import { success, error } from "@/lib/responseFormat";
import { recordUsage } from "./_shared/db";

const router = express.Router();

/**
 * POST /api/v1/cinema/usage
 * Records what the agent actually selected for a shot. Reserved for future
 * closed-loop optimisation of the knowledge base.
 *
 * Body: { knowledge_id:number, episode_id?:string, shot_id?:string, selected_field?:string }
 */
router.post("/", async (req: any, res) => {
  try {
    const body = req.body || {};
    const knowledge_id = Number(body.knowledge_id);
    if (!Number.isFinite(knowledge_id)) {
      res.status(400).send(error("knowledge_id (number) is required"));
      return;
    }
    const result = await recordUsage({
      knowledge_id,
      episode_id: body.episode_id ?? null,
      shot_id: body.shot_id ?? null,
      selected_field: body.selected_field ?? null,
    });
    res.status(200).send(success(result, "ok"));
  } catch (err: any) {
    const msg = err?.message || String(err);
    res.status(500).send(error(`cinema usage failed: ${msg}`));
  }
});

export default router;
