/**
 * GET /api/v1/skills — list registered skill summaries.
 *
 * API-01 (CONTEXT.md D-04 verbatim):
 *   200 { ok: true, skills: [{ skill_id, version, display_name, description, registered_at }, ...] }
 *
 * Summary objects only — the list endpoint does NOT ship full manifests (they
 * can be large; per D-04 callers fetch a specific skill via GET /:skillId).
 *
 * `registered_at` is platform metadata, NOT part of the descriptive manifest.
 * It lives in o_skillRegistry.registered_at. We fetch it via a side SELECT and
 * merge by skill_id so the summary matches API-01 verbatim. A skill that is in
 * the in-memory cache but missing from the DB (theoretically impossible in
 * normal operation — the loader + seed always pair them) reports 0, never null.
 *
 * Response shape: raw `{ ok, skills }` object via `res.status(200).send(...)`.
 * Deliberately does NOT use the legacy `success()` helper (its `{code, data,
 * message}` wrapper does not match D-04 — Phase 33 asserts on this shape and
 * the OpenClaw client is coded against it).
 */
import express from "express";
import u from "@/utils";
import { registry } from "@/skills/registry";

const router = express.Router();

export default router.get("/", async (_req, res) => {
  // Side SELECT to fetch registered_at alongside registry.list(). The registry
  // cache holds only descriptive manifests (Phase 29 design decision); the
  // platform metadata column lives in o_skillRegistry.
  //
  // WR-01 fix: filter active=1 to mirror src/skills/loader.ts. Without this
  // filter, a skill whose DB row was deactivated (active=0) but is still in
  // the in-memory cache would leak its registered_at into the summary,
  // creating asymmetry with the loader (which only loads active=1 rows).
  const rows = await u.db("o_skillRegistry").select("skill_id", "registered_at").where("active", 1);
  const registeredAtById = new Map<string, number>();
  for (const r of rows) {
    if (r.skill_id) registeredAtById.set(r.skill_id, r.registered_at ?? 0);
  }

  const skills = registry.list().map((m) => ({
    skill_id: m.skill_id,
    version: m.version,
    display_name: m.display_name,
    description: m.description,
    registered_at: registeredAtById.get(m.skill_id) ?? 0,
  }));

  res.status(200).send({ ok: true, skills });
});
