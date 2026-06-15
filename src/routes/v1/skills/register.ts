/**
 * POST /api/v1/skills/register — validate + persist + cache a new skill.
 *
 * Mounted at `/api/v1/skills/register` (literal path, registered BEFORE the
 * parameterized `/api/v1/skills/:skillId` so the literal string "register"
 * is NOT captured as a skillId parameter — see router.ts).
 *
 * API-03 (CONTEXT.md D-04 verbatim):
 *   - Valid manifest   → 201 { ok: true, skill: { skill_id, version, display_name } }
 *   - Invalid manifest → 400 { ok: false, errors: [<ManifestValidationError>] }
 *
 * Per CONTEXT.md D-05: skip `validateFields` middleware and call
 * `validateManifest()` DIRECTLY on req.body. The validator's structured errors
 * (ruleId + field + message + raw) are echoed verbatim into the 400 response
 * body — Phase 33 negative tests assert on `errors[0].ruleId`. Using zod via
 * validateFields would produce zod's body-parser error shape, not the
 * contract's structured ManifestValidationError[].
 *
 * Flow:
 *   1. validateManifest(req.body) — never throws; returns {ok, value | errors}.
 *   2. On failure: 400 with errors verbatim. NO DB mutation, NO registry mutation.
 *   3. On success: UPSERT into o_skillRegistry via `.onConflict("skill_id").merge()`
 *      (re-registering an existing skill_id overwrites the row — acceptable in
 *      v1.6 trusted internal network; auth in v1.7+).
 *   4. registry.register(manifest) — hydrates the in-memory cache WITHOUT a
 *      restart (the whole point of the register endpoint). register() re-validates
 *      defensively (Phase 29 Pitfalls A5); the try/catch surfaces a 500 if a
 *      future code path bypasses our validateManifest gate.
 *   5. 201 with a summary object { skill_id, version, display_name } (not the
 *      full manifest — the caller just sent it, no need to echo it back).
 *
 * Response shape: raw `{ ok, ... }` object via `res.status(N).send(...)`.
 * Deliberately does NOT use the legacy `success()`/`error()` helpers.
 *
 * Threat model (T-30-08 mitigation): validateManifest is the sole gatekeeper
 * for untrusted input. The DB write only happens AFTER validation passes.
 */
import express from "express";
import u from "@/utils";
import { validateManifest } from "@/skills/validator";
import { registry } from "@/skills/registry";

// SECURITY (v1.6 deferral — CR-01): POST /api/v1/skills/register is
// UNAUTHENTICATED. CONTEXT.md D-04 explicitly accepts this for v1.6 ("trusted
// internal network; matches existing /api/v1/* routes which have no auth
// middleware"). The platform's only network boundary today is whatever the
// deployment reverse-proxy provides. v1.7+ MUST add an auth gate (API key,
// mTLS, or RBAC) before exposing /register beyond the trusted perimeter —
// see PROJECT.md deferred items. Until then, operators MUST ensure the
// listening port is not reachable from untrusted networks.

const router = express.Router();

export default router.post("/", async (req, res) => {
  // 1. Validate via the contract's structured validator. NEVER throws.
  const result = validateManifest(req.body);

  // 2. On failure: echo errors verbatim. No DB or registry mutation.
  if (!result.ok) {
    return res.status(400).send({ ok: false, errors: result.errors });
  }

  const manifest = result.value;

  // 3. UPSERT into o_skillRegistry. onConflict.merge() handles re-registration
  //    of an existing skill_id (overwrites the row). Column names match the
  //    Phase 29 initDB schema verbatim.
  try {
    await u.db("o_skillRegistry")
      .insert({
        skill_id: manifest.skill_id,
        manifest_json: JSON.stringify(manifest),
        version: manifest.version,
        active: 1,
        registered_at: Date.now(),
      })
      .onConflict("skill_id")
      .merge();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).send({ ok: false, error: `database upsert failed: ${msg}` });
  }

  // 4. Hydrate the in-memory cache without restart. registry.register() is
  //    documented to throw on invalid input (defensive double-check); the
  //    try/catch honors that contract even though validateManifest already
  //    passed upstream.
  try {
    registry.register(manifest);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).send({ ok: false, error: `registry update failed: ${msg}` });
  }

  // 5. 201 with a summary object (skill_id, version, display_name only).
  res.status(201).send({
    ok: true,
    skill: {
      skill_id: manifest.skill_id,
      version: manifest.version,
      display_name: manifest.display_name,
    },
  });
});
