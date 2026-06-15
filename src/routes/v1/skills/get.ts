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

// mergeParams: true is REQUIRED. This router is mounted at
// `/api/v1/skills/:skillId` in router.ts (mount path carries the param), and
// the handler path is the bare `/`. Without mergeParams, Express 4 does NOT
// propagate the mount-path param into req.params inside this sub-router's
// handlers — req.params.skillId would be undefined at runtime. mergeParams
// merges the parent (mount) params into this router's req.params.
const router = express.Router({ mergeParams: true });

// Type the params explicitly so destructuring type-checks (Express's default
// inferred params type is {} because the handler path has no :param).
export default router.get("/", async (req: Request<{ skillId: string }>, res: Response) => {
  const { skillId } = req.params;
  const manifest = registry.get(skillId);
  if (!manifest) {
    return res.status(404).send({ ok: false, error: `skill '${skillId}' not found` });
  }
  res.status(200).send({ ok: true, skill: manifest });
});
