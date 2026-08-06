import express from "express";
import { success, error } from "@/lib/responseFormat";
import { listCinema } from "./_shared/db";

const router = express.Router();

/**
 * GET|POST /api/v1/cinema/list?category=emotion_camera&key_type=emotion
 * Lists all entries within a category (and optional key_type), ordered by
 * priority. Useful for browsing a whole knowledge domain.
 */
async function handle(req: any, res: any) {
  try {
    const body = req.body || {};
    const category = (req.query?.category ?? body.category ?? null) as string | null;
    const key_type = (req.query?.key_type ?? body.key_type ?? null) as string | null;
    const entries = await listCinema({ category, key_type });
    res.status(200).send(success({ entries, total: entries.length }));
  } catch (err: any) {
    const msg = err?.message || String(err);
    res.status(500).send(error(`cinema list failed: ${msg}`));
  }
}

router.get("/", handle);
router.post("/", handle);

export default router;
