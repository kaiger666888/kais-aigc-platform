import express from "express";
import { success, error } from "@/lib/responseFormat";
import { listCategories } from "./_shared/db";

const router = express.Router();

/**
 * GET|POST /api/v1/cinema/categories
 * Lists every knowledge category present in the DB plus its entry count,
 * so an agent knows which knowledge domains are available to query.
 */
async function handle(_req: any, res: any) {
  try {
    const categories = await listCategories();
    res.status(200).send(success({ categories, total: categories.length }));
  } catch (err: any) {
    const msg = err?.message || String(err);
    res.status(500).send(error(`cinema categories failed: ${msg}`));
  }
}

router.get("/", handle);
router.post("/", handle);

export default router;
