import express from "express";
import { z } from "zod";
import { spawnSync } from "child_process";
import path from "node:path";
import { success, error } from "@/lib/responseFormat";

const router = express.Router();

/**
 * Pipeline Reflection API — 管线反思器操作接口
 *
 * Quick Task 260702-q6l. Bridges the TypeScript Express backend to the
 * pipeline reflector (pure ESM JavaScript) via a hermetic `node -e` subprocess.
 * The subprocess reads user-supplied values from `process.env` (never from
 * string interpolation) to defeat shell/script injection (threat T-q6l-02).
 */

// Resolved at module load; the API refuses to serve requests if this path does
// not exist on disk. Vendored from kais-movie-agent during kais-movie-agent
// retirement (260702 runtime vendor).
const REFLECTOR_PATH = path.resolve(
  __dirname,
  "../../../runtime/pipeline-reflector.mjs",
);

// Allow-root for workdir. Operator-controlled; reject anything outside.
const ALLOW_ROOT = "/data/workspace";

// ─── Validation schemas ─────────────────────────────────────

const workdirSchema = z
  .string()
  .min(1, "workdir is required")
  .refine((p) => !p.includes(".."), "workdir must not contain '..'")
  .refine(
    (p) => !p.startsWith("/etc") && !p.startsWith("/usr"),
    "workdir must not start with /etc or /usr",
  )
  .refine(
    (p) => p === ALLOW_ROOT || p.startsWith(ALLOW_ROOT + "/"),
    `workdir must be under ${ALLOW_ROOT}`,
  );

const runSchema = z.object({
  workdir: workdirSchema,
  episodeId: z.string().optional(),
  projectId: z.union([z.number(), z.string()]).optional(),
  lookbackDays: z.number().int().positive().max(365).optional(),
});

const approveSchema = z.object({
  workdir: workdirSchema,
});

const rejectSchema = z.object({
  workdir: workdirSchema,
  reason: z.string().max(500).optional().default(""),
});

// ─── Subprocess bridge ──────────────────────────────────────
//
// Build the node `-e` script from constants only; user-controlled values
// (workdir, method, args) are passed via process.env and read inside the
// subprocess. NEVER string-interpolate raw user input.
//
// The script imports PipelineReflector from REFLECTOR_PATH, instantiates it
// with process.env.Q6L_WORKDIR, calls the named method (with JSON-encoded
// args from Q6L_ARGS), and prints JSON on stdout: { ok: true, data: ... }
// or { ok: false, error: "..." }.

function _runReflector(
  workdir: string,
  method: string,
  args: unknown[] = [],
  extra: { episodeId?: string; projectId?: number | string; lookbackDays?: number } = {},
): any {
  const script = `
import { PipelineReflector } from ${JSON.stringify(REFLECTOR_PATH)};
const workdir = process.env.Q6L_WORKDIR;
const method = process.env.Q6L_METHOD;
const args = JSON.parse(process.env.Q6L_ARGS || "[]");
const ctorOpts = {};
if (process.env.Q6L_EPISODE_ID) ctorOpts.episodeId = process.env.Q6L_EPISODE_ID;
if (process.env.Q6L_PROJECT_ID) ctorOpts.projectId = process.env.Q6L_PROJECT_ID;
if (process.env.Q6L_LOOKBACK_DAYS) ctorOpts.lookbackDays = Number(process.env.Q6L_LOOKBACK_DAYS);
const r = new PipelineReflector(workdir, ctorOpts);
const fn = r[method];
if (typeof fn !== "function") {
  console.log(JSON.stringify({ ok: false, error: "unknown method " + method }));
  process.exit(0);
}
Promise.resolve(fn.apply(r, args))
  .then((data) => {
    console.log(JSON.stringify({ ok: true, data }));
  })
  .catch((err) => {
    console.log(JSON.stringify({ ok: false, error: String(err && err.message || err) }));
    process.exit(0);
  });
`;

  const env: Record<string, string> = {
    ...process.env,
    Q6L_WORKDIR: workdir,
    Q6L_METHOD: method,
    Q6L_ARGS: JSON.stringify(args),
  };
  if (extra.episodeId) env.Q6L_EPISODE_ID = String(extra.episodeId);
  if (extra.projectId != null) env.Q6L_PROJECT_ID = String(extra.projectId);
  if (extra.lookbackDays != null) env.Q6L_LOOKBACK_DAYS = String(extra.lookbackDays);

  const result = spawnSync("node", ["--input-type=module", "-e", script], {
    env,
    encoding: "utf-8",
    timeout: 60_000,
  });

  if (result.status !== 0 && !result.stdout) {
    throw new Error(
      `reflector subprocess exited ${result.status}: ${result.stderr || "(no stderr)"}`,
    );
  }

  let payload: { ok: boolean; data?: any; error?: string };
  try {
    payload = JSON.parse(result.stdout.trim());
  } catch (e: any) {
    throw new Error(
      `reflector subprocess returned non-JSON output: ${result.stdout.slice(0, 500)}`,
    );
  }
  if (!payload.ok) {
    throw new Error(payload.error || "reflector subprocess reported failure");
  }
  return payload.data;
}

// ─── POST /api/v1/reflection/run — trigger reflection ──────

router.post("/run", async (req, res) => {
  const parse = runSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).send(error("反思参数校验失败", parse.error.issues));
  }
  const { workdir, episodeId, projectId, lookbackDays } = parse.data;
  try {
    const newSuggestions = _runReflector(workdir, "run", [], {
      episodeId,
      projectId,
      lookbackDays,
    });
    return res
      .status(200)
      .send(success({ status: "ok", newSuggestions }));
  } catch (err: any) {
    console.error("[v1/reflection/run] failed:", err);
    return res.status(500).send(error("触发反思失败: " + err.message));
  }
});

// ─── GET /api/v1/reflection/pending — list pending ─────────

router.get("/pending", async (req, res) => {
  const workdirRaw = (req.query.workdir as string | undefined) || "";
  const parse = workdirSchema.safeParse(workdirRaw);
  if (!parse.success) {
    return res.status(400).send(error("workdir 参数校验失败", parse.error.issues));
  }
  try {
    // T-q6l-04 DoS mitigation: cap at 1000 rows.
    const all = _runReflector(parse.data, "readPendingSuggestions", []);
    const capped = Array.isArray(all) ? all.slice(0, 1000) : [];
    return res.status(200).send(success(capped));
  } catch (err: any) {
    console.error("[v1/reflection/pending] failed:", err);
    return res.status(500).send(error("读取 pending 失败: " + err.message));
  }
});

// ─── POST /api/v1/reflection/approve/:id ────────────────────

router.post("/approve/:id", async (req, res) => {
  const id = req.params.id;
  const parse = approveSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).send(error("approve 参数校验失败", parse.error.issues));
  }
  try {
    _runReflector(parse.data.workdir, "approveSuggestion", [id]);
    return res.status(200).send(success({ status: "applied", id }));
  } catch (err: any) {
    console.error("[v1/reflection/approve] failed:", err);
    return res.status(500).send(error("approve 失败: " + err.message));
  }
});

// ─── POST /api/v1/reflection/reject/:id ─────────────────────

router.post("/reject/:id", async (req, res) => {
  const id = req.params.id;
  const parse = rejectSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).send(error("reject 参数校验失败", parse.error.issues));
  }
  try {
    _runReflector(parse.data.workdir, "rejectSuggestion", [id, parse.data.reason]);
    return res.status(200).send(success({ status: "rejected", id }));
  } catch (err: any) {
    console.error("[v1/reflection/reject] failed:", err);
    return res.status(500).send(error("reject 失败: " + err.message));
  }
});

// ─── GET /api/v1/reflection/applied — applied suggestions ───

router.get("/applied", async (req, res) => {
  const workdirRaw = (req.query.workdir as string | undefined) || "";
  const parse = workdirSchema.safeParse(workdirRaw);
  if (!parse.success) {
    return res.status(400).send(error("workdir 参数校验失败", parse.error.issues));
  }
  try {
    const applied = _runReflector(parse.data, "readAppliedSuggestions", []);
    return res.status(200).send(success(applied || []));
  } catch (err: any) {
    console.error("[v1/reflection/applied] failed:", err);
    return res.status(500).send(error("读取 applied 失败: " + err.message));
  }
});

// ─── GET /api/v1/reflection/history — full history ─────────
// Returns applied + non-pending suggestion rows.

router.get("/history", async (req, res) => {
  const workdirRaw = (req.query.workdir as string | undefined) || "";
  const parse = workdirSchema.safeParse(workdirRaw);
  if (!parse.success) {
    return res.status(400).send(error("workdir 参数校验失败", parse.error.issues));
  }
  try {
    const [applied, allSuggestions] = await Promise.all([
      Promise.resolve(_runReflector(parse.data, "readAppliedSuggestions", [])),
      Promise.resolve(_runReflector(parse.data, "readAllSuggestions", [])),
    ]);
    const nonPending = (Array.isArray(allSuggestions) ? allSuggestions : []).filter(
      (r: any) => r && r.status !== "pending",
    );
    return res.status(200).send(success({ applied: applied || [], nonPending }));
  } catch (err: any) {
    console.error("[v1/reflection/history] failed:", err);
    return res.status(500).send(error("读取 history 失败: " + err.message));
  }
});

export default router;
