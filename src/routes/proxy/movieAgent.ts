/**
 * Movie-Agent Proxy — 转发所有请求到 movie-agent 服务
 * 使用中间件模式避免 Express v5 通配路由问题
 */
import { Router, Request, Response, NextFunction } from "express";

const router = Router();

const MOVIE_AGENT_URL = process.env.MOVIE_AGENT_URL || "http://movie-agent:8001";

router.use(async (req: Request, res: Response, next: NextFunction) => {
  // req.originalUrl = /api/proxy/movieAgent/xxx
  // req.url = /xxx (after stripping mount path)
  const path = req.url;
  const qs = new URLSearchParams(req.query as Record<string, string>).toString();
  const url = `${MOVIE_AGENT_URL}${path}${qs ? "?" + qs : ""}`;

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (req.headers.authorization) {
      headers["Authorization"] = req.headers.authorization as string;
    }

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
    console.error(`[movie-agent proxy] ${req.method} ${path} failed:`, err.message);
    res.status(502).json({ error: "movie-agent unavailable", detail: err.message });
  }
});

export default router;
