import express from "express";
import { success, error } from "@/lib/responseFormat";
import { queryCinema, CinemaQueryInput } from "./_shared/db";

const router = express.Router();

/**
 * POST /api/v1/cinema/query
 * Multi-dimensional progressive-disclosure query.
 *
 * Any combination of the inputs below may be provided; the engine intersects
 * (AND) across dimensions and unions across tokens within the emotion field,
 * returning the most relevant decision cards ordered by priority.
 */
router.post("/", async (req: any, res) => {
  try {
    const body = req.body || {};
    const q: CinemaQueryInput = {
      emotion: body.emotion ?? null,
      shot_scale: body.shot_scale ?? null,
      narrative_beat: body.narrative_beat ?? null,
      duration_category: body.duration_category ?? null,
      form_factor: body.form_factor ?? null,
      category: body.category ?? null,
      key_name: body.key_name ?? null,
      key_type: body.key_type ?? null,
      extra_data: body.extra_data ?? null,
      limit: typeof body.limit === "number" ? body.limit : 5,
    };
    const result = await queryCinema(q);
    res.status(200).send(success(result, "ok"));
  } catch (err: any) {
    const msg = err?.message || String(err);
    res.status(500).send(error(`cinema query failed: ${msg}`));
  }
});

export default router;
