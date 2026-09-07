/**
 * Text-Guard M1 — 生成图中文错字修复守卫 sidecar 薄路由 (2026-09-07)
 *
 * 生成图中文错字后处理守卫: RapidOCR 检测 → 单目标 crop-zoom → qwen-edit 修字
 * → 期望串复验 → seed 彩票。引擎逻辑全在 Python sidecar (:5120,
 * textguard/server.py), 本路由只做参数校验 + 转发 + 响应透传, 不含业务。
 *
 * POST /api/production/text-guard/check
 *   body { image_path, expect?: [{carrier, text}], regions?: [[x0,y0,x1,y1]] }
 *   → 全图 OCR 报告 (findings: ok / suspect / missing)
 *
 * POST /api/production/text-guard/fix
 *   body { image_path, box:[x0,y0,x1,y1], expect_text, variants?, carrier_desc?, max_lottery? }
 *   → 单目标修字 (同步, 磁盘级长请求)。未中 = code:200 + hit:false (引擎边界,
 *     非 4xx/5xx — 勿在此把 hit:false 改写成错误语义)
 *
 * 响应: sidecar 的 {code, data, message} 包装原样透传 (状态码一并透传);
 * sidecar 不可达 → 502, 转发超时 → 504 (KAP error 包装)。
 *
 * 挂载: codegen 生成 (src/routes/production/text-guard/index.ts →
 * /api/production/text-guard, 见 scripts/regen-router.ts 与 DELIVERY.md)。
 */

import express from "express";
import { error } from "@/lib/responseFormat";
import type { Request, Response } from "express";

const router = express.Router();

const TEXTGUARD_URL = process.env.TEXTGUARD_URL || "http://127.0.0.1:5120";

// /check 只做 CPU OCR (秒级), 5 分钟预算余量充足
const CHECK_TIMEOUT_MS = 300_000;
// /fix 是磁盘级长请求: sidecar 单轮 ComfyUI poll 1800s + 探活稳定窗 + 羽化贴回,
// 转发超时给 1950s (≥1900s 工单要求)。注意多轮彩票最坏可超此值 — 客户端断连
// 只断 KAP↔客户端链路, sidecar 侧照常跑完并落盘 (见 DELIVERY.md 边界声明)。
const FIX_TIMEOUT_MS = 1_950_000;

/** 校验 image_path: 非空 + 拒 URL scheme (sidecar 只认本机路径, 此处前置拦截) */
function validateImagePath(path: unknown): string {
  if (typeof path !== "string" || !path.trim()) {
    throw new Error("image_path 必填 (本机绝对路径)");
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(path.trim())) {
    throw new Error("image_path 只认本机路径, 拒绝 URL");
  }
  return path.trim();
}

/** 转发到 sidecar 并原样透传 {code,data,message} 包装 */
async function forwardToSidecar(
  pathname: "/check" | "/fix",
  payload: Record<string, unknown>,
  timeoutMs: number,
  res: Response,
): Promise<Response> {
  let resp: globalThis.Response;
  try {
    resp = await fetch(`${TEXTGUARD_URL}${pathname}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err: any) {
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    console.error(`[text-guard${pathname}] ${timedOut ? "超时" : "转发失败"}:`, err?.message || err);
    return res.status(timedOut ? 504 : 502).json(
      error(`text-guard sidecar ${timedOut ? `超时 (${timeoutMs / 1000}s)` : `不可达 (${TEXTGUARD_URL})`}: ${err?.message || err}`),
    );
  }
  // 状态码 + envelope 原样透传 (hit:false 也是 200, 勿改写)
  const text = await resp.text();
  res.status(resp.status).type("application/json").send(text);
  return res;
}

router.post("/check", async (req: Request, res: Response): Promise<Response | void> => {
  let image_path: string;
  try {
    image_path = validateImagePath(req.body?.image_path);
    if (req.body?.expect !== undefined && !Array.isArray(req.body.expect)) {
      throw new Error("expect 须为 [{carrier?, text}] 数组");
    }
    if (req.body?.regions !== undefined && !Array.isArray(req.body.regions)) {
      throw new Error("regions 须为 [box] 数组");
    }
  } catch (err: any) {
    return res.status(400).json(error(err.message));
  }
  const payload: Record<string, unknown> = { image_path };
  if (req.body?.expect !== undefined) payload.expect = req.body.expect;
  if (req.body?.regions !== undefined) payload.regions = req.body.regions;
  return forwardToSidecar("/check", payload, CHECK_TIMEOUT_MS, res);
});

router.post("/fix", async (req: Request, res: Response): Promise<Response | void> => {
  let image_path: string;
  try {
    image_path = validateImagePath(req.body?.image_path);
    const box = req.body?.box;
    if (!Array.isArray(box) || box.length !== 4 || !box.every((v: unknown) => Number.isFinite(Number(v)))) {
      throw new Error("box 须为 [x0,y0,x1,y1] 四元数值数组");
    }
    if (typeof req.body?.expect_text !== "string" || !req.body.expect_text.trim()) {
      throw new Error("expect_text 必填");
    }
    if (req.body?.variants !== undefined &&
        (!Array.isArray(req.body.variants) || !req.body.variants.every((v: unknown) => typeof v === "string"))) {
      throw new Error("variants 须为字符串数组");
    }
    if (req.body?.carrier_desc !== undefined && typeof req.body.carrier_desc !== "string") {
      throw new Error("carrier_desc 须为字符串");
    }
    if (req.body?.max_lottery !== undefined && typeof req.body.max_lottery !== "number") {
      throw new Error("max_lottery 须为数值");
    }
  } catch (err: any) {
    return res.status(400).json(error(err.message));
  }
  const payload: Record<string, unknown> = { image_path, box: req.body.box, expect_text: req.body.expect_text };
  for (const key of ["variants", "carrier_desc", "max_lottery"] as const) {
    if (req.body?.[key] !== undefined) payload[key] = req.body[key];
  }
  return forwardToSidecar("/fix", payload, FIX_TIMEOUT_MS, res);
});

export default router;
