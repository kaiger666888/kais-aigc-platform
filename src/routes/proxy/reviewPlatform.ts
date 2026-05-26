/**
 * Review-Platform Proxy — 转发所有请求到 review-platform 服务
 */
import { Router, Request, Response, NextFunction } from "express";

const router = Router();

const REVIEW_PLATFORM_URL = process.env.REVIEW_PLATFORM_URL || "http://review-platform:8090";

router.use(async (req: Request, res: Response, next: NextFunction) => {
  const path = req.url;
  const qs = new URLSearchParams(req.query as Record<string, string>).toString();
  const url = `${REVIEW_PLATFORM_URL}${path}${qs ? "?" + qs : ""}`;

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    const fetchOpts: RequestInit = {
      method: req.method,
      headers,
    };

    if (req.method !== "GET" && req.method !== "HEAD" && req.body) {
      fetchOpts.body = JSON.stringify(req.body);
    }

    const resp = await fetch(url, fetchOpts);
    const contentType = resp.headers.get("content-type") || "application/json";
    res.status(resp.status);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Access-Control-Allow-Origin", "*");

    if (contentType.includes("application/json")) {
      const data = await resp.json();
      res.json(data);
    } else {
      const buf = await resp.arrayBuffer();
      res.send(Buffer.from(buf));
    }
  } catch (err: any) {
    console.error(`[review-platform proxy] ${req.method} ${path} failed:`, err.message);
    res.status(502).json({ error: "review-platform unavailable", detail: err.message });
  }
});

export default router;
