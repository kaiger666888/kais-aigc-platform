import express from "express";
import { success, error } from "@/lib/responseFormat";
import { insertEntries, CinemaEntry } from "./_shared/db";

const router = express.Router();

/**
 * POST /api/v1/cinema/seed
 * Imports knowledge entries from a JSON array. Used for initialisation or
 * updating the knowledge base.
 *
 * Body: { entries: CinemaEntry[], replace?: boolean }
 *   - replace (default true): delete any existing row with the same
 *     (category, key_name) before inserting, making the import idempotent.
 */
router.post("/", async (req: any, res) => {
  try {
    const body = req.body || {};
    const entries: CinemaEntry[] = Array.isArray(body.entries) ? body.entries : [];
    const replace = body.replace !== false;
    if (entries.length === 0) {
      res.status(400).send(error("entries must be a non-empty array"));
      return;
    }
    const result = await insertEntries(entries, replace);
    res.status(200).send(success(result, "ok"));
  } catch (err: any) {
    const msg = err?.message || String(err);
    res.status(500).send(error(`cinema seed failed: ${msg}`));
  }
});

export default router;
