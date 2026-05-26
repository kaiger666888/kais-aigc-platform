/**
 * Gold-Team Proxy — 转发所有请求到 gold-team 服务
 */
import { Router, Request, Response, NextFunction } from "express";

const router = Router();

const GOLD_TEAM_URL = process.env.GOLD_TEAM_URL || "http://gold-team:8002";

router.use(async (req: Request, res: Response, next: NextFunction) => {
  const path = req.url;
  const qs = new URLSearchParams(req.query as Record<string, string>).toString();
  const url = `${GOLD_TEAM_URL}${path}${qs ? "?" + qs : ""}`;

  try {
    const fetchOpts: RequestInit = {
      method: req.method,
      headers: { "Content-Type": "application/json" },
    };

    if (req.method !== "GET" && req.method !== "HEAD" && req.body) {
      fetchOpts.body = JSON.stringify(req.body);
    }

    const resp = await fetch(url, fetchOpts);
    const contentType = resp.headers.get("content-type") || "application/octet-stream";
    res.status(resp.status);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Access-Control-Allow-Origin", "*");

    const buf = await resp.arrayBuffer();
    res.send(Buffer.from(buf));
  } catch (err: any) {
    console.error(`[gold-team proxy] ${req.method} ${path} failed:`, err.message);
    res.status(502).json({ error: "gold-team unavailable", detail: err.message });
  }
});

export default router;
