import express from "express";
import { z } from "zod";
import { spawn } from "child_process";
import { success, error } from "@/lib/responseFormat";

const router = express.Router();

/**
 * Iteration Engine API — 单集内版本化迭代接口
 *
 * Quick Task 260702-rg2. Bridges the TypeScript Express backend to the
 * kais-movie-agent IterationEngine (pure ESM JavaScript) via a hermetic
 * `node -e` subprocess. Mirrors the reflection route pattern (q6l):
 * user-controlled values are passed via `process.env` (never string
 * interpolation) to defeat shell/script injection (threat T-rg2-02).
 */

// Absolute path to the iteration-engine module.
const ENGINE_PATH =
  "/data/workspace/kais-movie-agent/lib/iteration-engine.js";

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

const planSchema = z.object({
  workdir: workdirSchema,
  projectId: z.union([z.number(), z.string()]),
  episodesId: z.string().optional(),
  apiBase: z.string().optional(),
});

const executeSchema = z.object({
  workdir: workdirSchema,
  planId: z.string().min(1),
  projectId: z.union([z.number(), z.string()]),
  episodesId: z.string().optional(),
  apiBase: z.string().optional(),
});

const confirmSchema = z.object({
  workdir: workdirSchema,
  branchId: z.string().min(1),
  projectId: z.union([z.number(), z.string()]),
  episodesId: z.string().optional(),
  apiBase: z.string().optional(),
});

const discardSchema = z.object({
  workdir: workdirSchema,
  branchId: z.string().min(1),
  reason: z.string().max(500).optional().default(""),
  projectId: z.union([z.number(), z.string()]),
  episodesId: z.string().optional(),
  apiBase: z.string().optional(),
});

const approveAdjustmentSchema = z.object({
  workdir: workdirSchema,
  planId: z.string().min(1),
});

// Hermes-driven split: collect-feedback runs only collectFeedback() (HTTP fetch,
// no LLM). Hermes Agent reads this payload, does diagnosis itself, then writes
// the plan back via /store-plan. spec: /tmp/gsd-task-hermes-driven-iteration.md
const collectFeedbackSchema = z.object({
  workdir: workdirSchema,
  projectId: z.union([z.number(), z.string()]),
  episodesId: z.string().optional(),
  apiBase: z.string().optional(),
});

const storePlanSchema = z.object({
  workdir: workdirSchema,
  plan: z.object({
    id: z.string().optional(),
    episodeId: z.string().nullable().optional(),
    branchLabel: z.string(),
    diagnosis: z.object({
      type: z.enum(["reroll", "pipeline_adjust", "upstream_fix"]),
      rootCause: z.string(),
      confidence: z.number().min(0).max(1),
      evidence: z.array(z.string()),
    }),
    actions: z.array(
      z.object({
        nodeId: z.string(),
        action: z.enum(["regenerate", "regenerate_after_parent", "skip"]),
        promptDelta: z.string().optional(),
        pipelineAdjustment: z
          .object({
            type: z.enum([
              "prompt_modification",
              "threshold_adjustment",
              "parameter_change",
            ]),
            target: z.string(),
            change: z.string(),
          })
          .nullable()
          .optional(),
        reason: z.string(),
        dependsOn: z.array(z.string()).optional(),
      }),
    ),
    summary: z.string().optional().default(""),
    requiresApproval: z.boolean().optional().default(false),
    adjustmentApproved: z.boolean().optional().default(false),
  }),
});

// ─── Subprocess bridge ──────────────────────────────────────
//
// Async (child_process.spawn). The node `-e` script is built from constants
// only; user-controlled values (workdir, method, args) are passed via
// process.env and read inside the subprocess. NEVER string-interpolate
// raw user input.
//
// spawn (not spawnSync) is load-bearing: collectFeedback() and friends make
// HTTP fetch calls back into THIS server, so blocking the event loop with
// spawnSync deadlocks the subprocess's fetch against the parent. With async
// spawn, the Express event loop stays alive to serve those requests.
//
// The script imports IterationEngine from ENGINE_PATH, instantiates it
// with ctorOpts from process.env, calls the named method (with JSON-encoded
// args from RG2_ARGS), and prints JSON on stdout: { ok: true, data: ... }
// or { ok: false, error: "..." }.

function _runEngine(
  workdir: string,
  method: string,
  args: unknown[] = [],
  extra: { projectId?: number | string; episodesId?: string; apiBase?: string } = {},
): Promise<any> {
  const script = `
import { IterationEngine } from ${JSON.stringify(ENGINE_PATH)};
const workdir = process.env.RG2_WORKDIR;
const method = process.env.RG2_METHOD;
const args = JSON.parse(process.env.RG2_ARGS || "[]");
const ctorOpts = { workdir };
if (process.env.RG2_PROJECT_ID) ctorOpts.projectId = isNaN(Number(process.env.RG2_PROJECT_ID)) ? process.env.RG2_PROJECT_ID : Number(process.env.RG2_PROJECT_ID);
if (process.env.RG2_EPISODES_ID) ctorOpts.episodesId = process.env.RG2_EPISODES_ID;
if (process.env.RG2_API_BASE) ctorOpts.apiBase = process.env.RG2_API_BASE;
const e = new IterationEngine(workdir, ctorOpts);
const fn = e[method];
if (typeof fn !== "function") {
  console.log(JSON.stringify({ ok: false, error: "unknown method " + method }));
  process.exit(0);
}
Promise.resolve(fn.apply(e, args))
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
    RG2_WORKDIR: workdir,
    RG2_METHOD: method,
    RG2_ARGS: JSON.stringify(args),
  };
  if (extra.projectId != null) env.RG2_PROJECT_ID = String(extra.projectId);
  if (extra.episodesId) env.RG2_EPISODES_ID = extra.episodesId;
  if (extra.apiBase) env.RG2_API_BASE = extra.apiBase;

  return new Promise((resolve, reject) => {
    const child = spawn("node", ["--input-type=module", "-e", script], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });

    child.on("error", (err) => {
      reject(
        new Error(`iteration-engine subprocess failed to spawn: ${err.message}`),
      );
    });

    child.on("close", (code, signal) => {
      // Timeout (SIGTERM) or signal kill with no useful output.
      if (signal) {
        reject(
          new Error(
            `iteration-engine subprocess killed by signal ${signal}` +
              (stderr ? `: ${stderr.slice(0, 500)}` : " (no stderr)"),
          ),
        );
        return;
      }

      // Match spawnSync semantics: non-zero exit + no stdout → "exited N".
      if (code !== 0 && !stdout) {
        reject(
          new Error(
            `iteration-engine subprocess exited ${code}: ${stderr || "(no stderr)"}`,
          ),
        );
        return;
      }

      let payload: { ok: boolean; data?: any; error?: string };
      try {
        payload = JSON.parse(stdout.trim());
      } catch (e: any) {
        reject(
          new Error(
            `iteration-engine subprocess returned non-JSON output: ${stdout.slice(0, 500)}`,
          ),
        );
        return;
      }
      if (!payload.ok) {
        reject(
          new Error(payload.error || "iteration-engine subprocess reported failure"),
        );
        return;
      }
      resolve(payload.data);
    });
  });
}

// ─── POST /api/v1/iteration/collect-feedback — feedback only (no LLM) ─
//
// Hermes-driven split part 1: returns raw collectFeedback() payload. No
// diagnose(), no callLLM() — cannot hang the backend. Hermes Agent reads
// this and produces the diagnosis in conversation with the user.

router.post("/collect-feedback", async (req, res) => {
  const parse = collectFeedbackSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).send(error("参数校验失败", parse.error.issues));
  }
  const { workdir, projectId, episodesId, apiBase } = parse.data;
  try {
    const feedback = await _runEngine(workdir, "collectFeedback", [], {
      projectId,
      episodesId,
      apiBase,
    });
    return res.status(200).send(success({ status: "ok", feedback }));
  } catch (err: any) {
    console.error("[v1/iteration/collect-feedback] failed:", err);
    return res.status(500).send(error("收集反馈失败: " + err.message));
  }
});

// ─── POST /api/v1/iteration/store-plan — persist externally-diagnosed plan ─
//
// Hermes-driven split part 2: Hermes Agent has already produced a complete
// IterationPlan (same shape diagnose() would have returned). We fill in
// id/createdAt/status defaults and hand it to _storePlan(). _runEngine calls
// methods dynamically via e[method], so the underscore prefix is fine.

router.post("/store-plan", async (req, res) => {
  const parse = storePlanSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).send(error("参数校验失败", parse.error.issues));
  }
  const { workdir, plan } = parse.data;
  try {
    const fullPlan = {
      id:
        plan.id ||
        `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      episodeId: plan.episodeId ?? null,
      branchLabel: plan.branchLabel,
      diagnosis: plan.diagnosis,
      actions: plan.actions,
      summary: plan.summary ?? "",
      requiresApproval: plan.requiresApproval ?? false,
      adjustmentApproved: plan.adjustmentApproved ?? false,
      createdAt: new Date().toISOString(),
      status: "pending",
    };
    await _runEngine(workdir, "_storePlan", [fullPlan]);
    return res.status(200).send(success({ status: "ok", plan: fullPlan }));
  } catch (err: any) {
    console.error("[v1/iteration/store-plan] failed:", err);
    return res.status(500).send(error("存储迭代计划失败: " + err.message));
  }
});

// ─── POST /api/v1/iteration/plan — build iteration plan (deprecated) ─────
//
// DEPRECATED: this endpoint calls IterationEngine.plan() which internally
// invokes callLLM() → GLM via spawnSync with a 120s timeout. If the LLM
// hangs or the token expires, the entire Express backend freezes. Prefer
// the Hermes-driven split: /collect-feedback → (Hermes diagnoses) → /store-plan.
// Kept for backward compatibility.

router.post("/plan", async (req, res) => {
  const parse = planSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).send(error("迭代参数校验失败", parse.error.issues));
  }
  const { workdir, projectId, episodesId, apiBase } = parse.data;
  try {
    const plan = await _runEngine(workdir, "plan", [], { projectId, episodesId, apiBase });
    return res.status(200).send(success({ status: "ok", plan }));
  } catch (err: any) {
    console.error("[v1/iteration/plan] failed:", err);
    return res.status(500).send(error("构建迭代计划失败: " + err.message));
  }
});

// ─── POST /api/v1/iteration/execute — execute plan ──────────

router.post("/execute", async (req, res) => {
  const parse = executeSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).send(error("execute 参数校验失败", parse.error.issues));
  }
  const { workdir, planId, projectId, episodesId, apiBase } = parse.data;
  try {
    const result = await _runEngine(workdir, "execute", [planId], { projectId, episodesId, apiBase });
    return res.status(200).send(success({ status: "ok", result }));
  } catch (err: any) {
    console.error("[v1/iteration/execute] failed:", err);
    return res.status(500).send(error("执行迭代失败: " + err.message));
  }
});

// ─── POST /api/v1/iteration/confirm — approve new branch ────

router.post("/confirm", async (req, res) => {
  const parse = confirmSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).send(error("confirm 参数校验失败", parse.error.issues));
  }
  const { workdir, branchId, projectId, episodesId, apiBase } = parse.data;
  try {
    await _runEngine(workdir, "confirm", [branchId], { projectId, episodesId, apiBase });
    return res.status(200).send(success({ status: "ok" }));
  } catch (err: any) {
    console.error("[v1/iteration/confirm] failed:", err);
    return res.status(500).send(error("confirm 失败: " + err.message));
  }
});

// ─── POST /api/v1/iteration/discard — discard branch ────────

router.post("/discard", async (req, res) => {
  const parse = discardSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).send(error("discard 参数校验失败", parse.error.issues));
  }
  const { workdir, branchId, reason, projectId, episodesId, apiBase } = parse.data;
  try {
    await _runEngine(workdir, "discard", [branchId, reason], { projectId, episodesId, apiBase });
    return res.status(200).send(success({ status: "ok" }));
  } catch (err: any) {
    console.error("[v1/iteration/discard] failed:", err);
    return res.status(500).send(error("discard 失败: " + err.message));
  }
});

// ─── GET /api/v1/iteration/plans — list plans ───────────────

router.get("/plans", async (req, res) => {
  const workdirRaw = (req.query.workdir as string | undefined) || "";
  const parse = workdirSchema.safeParse(workdirRaw);
  if (!parse.success) {
    return res.status(400).send(error("workdir 参数校验失败", parse.error.issues));
  }
  const projectId = req.query.projectId as string | number | undefined;
  const episodesId = req.query.episodesId as string | undefined;
  try {
    // T-rg2-05 DoS mitigation: cap at 1000 rows (parity with reflection).
    const all = await _runEngine(parse.data, "listPlans", [], { projectId, episodesId });
    const capped = Array.isArray(all) ? all.slice(0, 1000) : [];
    return res.status(200).send(success(capped));
  } catch (err: any) {
    console.error("[v1/iteration/plans] failed:", err);
    return res.status(500).send(error("读取计划列表失败: " + err.message));
  }
});

// ─── GET /api/v1/iteration/status/:planId ───────────────────

router.get("/status/:planId", async (req, res) => {
  const workdirRaw = (req.query.workdir as string | undefined) || "";
  const parse = workdirSchema.safeParse(workdirRaw);
  if (!parse.success) {
    return res.status(400).send(error("workdir 参数校验失败", parse.error.issues));
  }
  const planId = req.params.planId;
  try {
    const status = await _runEngine(parse.data, "getStatus", [planId]);
    return res.status(200).send(success(status));
  } catch (err: any) {
    console.error("[v1/iteration/status] failed:", err);
    return res.status(500).send(error("读取迭代状态失败: " + err.message));
  }
});

// ─── POST /api/v1/iteration/approve-adjustment ──────────────

router.post("/approve-adjustment", async (req, res) => {
  const parse = approveAdjustmentSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).send(error("approve-adjustment 参数校验失败", parse.error.issues));
  }
  const { workdir, planId } = parse.data;
  try {
    await _runEngine(workdir, "approveAdjustment", [planId]);
    return res.status(200).send(success({ status: "ok", planId }));
  } catch (err: any) {
    console.error("[v1/iteration/approve-adjustment] failed:", err);
    return res.status(500).send(error("approve 失败: " + err.message));
  }
});

export default router;
