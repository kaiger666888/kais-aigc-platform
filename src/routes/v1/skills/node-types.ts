/**
 * GET /api/v1/skills/:skillId/node-types — declared node types for a skill.
 *
 * Mounted at `/api/v1/skills/:skillId`; handler path is `/node-types`
 * (full URL: /api/v1/skills/:skillId/node-types).
 *
 * API-04 (CONTEXT.md D-04 verbatim):
 *   - Known skill   → 200 { ok: true, node_types: <NodeTypeDecl[]> }
 *   - Unknown skill → 404 { ok: false, error: "skill '<skillId>' not found" }
 *
 * Returns the manifest's declared `node_types` array VERBATIM — not derived
 * constants (ROADMAP SC #4). The skill author is the source of truth for
 * which node types their skill contributes.
 *
 * Response shape: raw `{ ok, ... }` object via `res.status(N).send(...)`.
 * Deliberately does NOT use the legacy `success()`/`error()` helpers.
 */
import express, { Request, Response } from "express";
import { registry } from "@/skills/registry";

// See get.ts for why mergeParams is required (mount path carries :skillId).
const router = express.Router({ mergeParams: true });

export default router.get("/node-types", async (req: Request<{ skillId: string }>, res: Response) => {
  const { skillId } = req.params;
  const manifest = registry.get(skillId);
  if (!manifest) {
    return res.status(404).send({ ok: false, error: `skill '${skillId}' not found` });
  }
  res.status(200).send({ ok: true, node_types: manifest.node_types });
});
