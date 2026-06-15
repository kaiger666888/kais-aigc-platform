/**
 * GET /api/v1/skills/:skillId — full manifest for a registered skill.
 *
 * Mounted at `/api/v1/skills/:skillId` so the handler path is the bare `/`
 * (mount path already carries `:skillId`). Reads `req.params.skillId`.
 *
 * API-02 (CONTEXT.md D-04 verbatim):
 *   - Known skill → 200 { ok: true, skill: <full SkillManifest> }
 *   - Unknown skill → 404 { ok: false, error: "skill '<skillId>' not found" }
 *
 * NO FALLBACK to movie-v1 for unknown skills — the registry is the source of
 * truth, and silent fallback would mask registration bugs (Phase 29 design
 * decision, mirrored here). Unknown id returns 404 with the exact error
 * string from D-04 so Phase 33 negative tests can assert on the substring.
 *
 * Response shape: raw `{ ok, skill | error }` object via `res.status(N).send(...)`.
 * Deliberately does NOT use the legacy `success()`/`error()` helpers.
 */
import express, { Request, Response } from "express";
import { registry } from "@/skills/registry";

const router = express.Router();

// `req.params.skillId` is populated by the mount path `/api/v1/skills/:skillId`
// in router.ts. Express infers req.params from the handler path string; since
// the handler path is the bare `/` (mount carries :skillId), we type the
// params explicitly via the Request generic so destructuring type-checks.
export default router.get("/", async (req: Request<{ skillId: string }>, res: Response) => {
  const { skillId } = req.params;
  const manifest = registry.get(skillId);
  if (!manifest) {
    return res.status(404).send({ ok: false, error: `skill '${skillId}' not found` });
  }
  res.status(200).send({ ok: true, skill: manifest });
});
