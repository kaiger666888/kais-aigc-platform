// import "./logger";
import "./err";
import "./env";
import express, { Request, Response, NextFunction } from "express";
import { Server } from "socket.io";
import http from "node:http";
import expressWs from "express-ws";
import logger from "morgan";
import cors from "cors";
import buildRoute from "@/core";
import path from "path";
import fs from "fs";
import u from "@/utils";
import jwt from "jsonwebtoken";
import socketInit from "@/socket/index";
import { setIo } from "@/utils/ws";
import { isEletron } from "@/utils/getPath";
import { bootReady } from "@/utils/db";
import { loadArchRepos } from "@/lib/arch-tracked-repos";

const app = express();
const server = http.createServer(app);

async function checkPermissions() {
  if (!isEletron()) return true;
  const userDataPath = u.getPath();
  try {
    fs.mkdirSync(userDataPath, { recursive: true });
    const testFile = path.join(userDataPath, ".access_test");
    fs.writeFileSync(testFile, "test");
    fs.unlinkSync(testFile);
  } catch (e) {
    const { dialog, app } = require("electron");
    const { response } = await dialog.showMessageBox({
      type: "warning",
      title: "权限不足",
      message: "应用无法访问数据目录",
      detail: `无法读写以下目录：\n${userDataPath}\n\n请联系管理员授予权限，或以管理员身份运行本程序。`,
      buttons: ["确认退出"],
      defaultId: 0,
    });
    if (response === 0) {
      app.quit();
    }
  }
}

export default async function startServe(randomPort: Boolean = false) {
  await checkPermissions();

  await u.writeVersion();
  const io = new Server(server, { cors: { origin: "*" } });
  socketInit(io);
  setIo(io);

  if (process.env.NODE_ENV == "dev") await buildRoute();

  expressWs(app);

  app.use(logger("dev"));
  app.use(cors({ origin: "*" }));
  app.use(express.json({ limit: "100mb" }));
  app.use(express.urlencoded({ extended: true, limit: "100mb" }));

  // oss 静态资源
  const ossDir = u.getPath("oss");
  if (!fs.existsSync(ossDir)) {
    fs.mkdirSync(ossDir, { recursive: true });
  }
  console.log("文件目录:", ossDir);
  app.use("/oss", express.static(ossDir, { acceptRanges: true, maxAge: "1d", cacheControl: true }));

  // Pipeline 输出目录（挂载自 /mnt/agents/output，作为 /oss 的后备源）
  const pipelineOutputDir = process.env.OUTPUT_DIR || "/mnt/agents/output";
  if (fs.existsSync(pipelineOutputDir)) {
    console.log("Pipeline 输出目录:", pipelineOutputDir);
    // 将 /oss/* 路径路由到 Pipeline 输出目录（fallback: 先查 ossDir，查不到再查 pipelineOutputDir）
    app.use("/oss", (req, res, next) => {
      const filePath = path.join(ossDir, req.path);
      if (fs.existsSync(filePath)) {
        next(); // 交给前面的 express.static(ossDir)
      } else {
        express.static(pipelineOutputDir, { acceptRanges: true, maxAge: "1d", cacheControl: true })(req, res, next);
      }
    });
  }
  // skills 静态资源
  const skillsDir = u.getPath("skills");
  if (!fs.existsSync(skillsDir)) {
    fs.mkdirSync(skillsDir, { recursive: true });
  }
  console.log("文件目录:", skillsDir);
  // 只允许图片文件访问
  app.use(
    "/skills",
    (req, res, next) => {
      /\.(jpe?g|png|gif|webp|svg|ico|bmp)$/i.test(req.path) ? next() : res.status(403).end();
    },
    express.static(skillsDir, { acceptRanges: true, maxAge: "1d", cacheControl: true }),
  );

  // assets 静态资源
  const assetsDir = u.getPath("assets");
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }
  console.log("文件目录:", assetsDir);
  app.use("/assets", express.static(assetsDir, { acceptRanges: true, maxAge: "1d", cacheControl: true }));

  // 本地文件代理 — 用于画布缩略图加载
  // 当 o_assets 的 filePath 是绝对路径时（如管线产出物），通过此端点安全访问
  app.get("/local-file", (req, res) => {
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).send("Missing path parameter");

    // Pipeline output directory. Default keeps historical kais-movie-agent path
    // (JS runtime vendored into src/runtime/ during 260702 retirement, but
    // legacy media outputs may still live here).
    const KAIS_OUTPUT_DIR =
      process.env.KAIS_OUTPUT_DIR || "/data/workspace/kais-movie-agent";

    // 安全检查：只允许已知的目录前缀（必须以 sep 结尾，避免共享前缀漏洞）
    const allowedPrefixes = [
      KAIS_OUTPUT_DIR.endsWith("/") ? KAIS_OUTPUT_DIR : KAIS_OUTPUT_DIR + "/",
      "/mnt/agents/output/",
    ];
    const isAllowed = allowedPrefixes.some((p) => filePath.startsWith(p));
    if (!isAllowed) {
      return res.status(403).send("Access denied: path outside allowed directories");
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).send("File not found");
    }

    res.sendFile(path.resolve(filePath));
  });

  // data/web 静态网站
  const webDir = u.getPath("web");
  if (fs.existsSync(webDir)) {
    console.log("静态网站目录:", webDir);
    app.use(express.static(webDir, { acceptRanges: true, maxAge: "5m", cacheControl: true }));
  } else {
    console.warn("静态网站目录不存在:", webDir);
  }

  // 无限画布：从 data/web/infinite-canvas 提供独立 SPA
  const canvasDir = path.join(webDir, "infinite-canvas");
  if (fs.existsSync(canvasDir)) {
    app.use("/infinite-canvas", express.static(canvasDir, { acceptRanges: true, maxAge: "5m", cacheControl: true }));
    app.get("/infinite-canvas/{*path}", (_req, res) => {
      res.sendFile(path.join(canvasDir, "index.html"));
    });
  }

  // 3D 导演台：从 data/web/director-desk 提供独立 SPA (storyai-3d-director-desk)
  const directorDeskDir = path.join(webDir, "director-desk");
  if (fs.existsSync(directorDeskDir)) {
    app.use("/director-desk", express.static(directorDeskDir, { acceptRanges: true, maxAge: "5m", cacheControl: true }));
    app.get("/director-desk/{*path}", (_req, res) => {
      res.sendFile(path.join(directorDeskDir, "index.html"));
    });
  }

  // arch dashboards：manifest-driven reverse proxy (Phase 6 PROXY-01/02/03).
  // Reads /etc/arch-tracked-repos.conf (or ~/.config fallback) and mounts each
  // tracked repo's MkDocs site at its declared URL prefix. Adding a repo
  // requires editing ONLY the manifest — never this file.
  const archRepos = loadArchRepos();
  if (archRepos.length === 0) {
    console.warn("[arch-proxy] no manifest found — 0 repos mounted (graceful skip)");
  }
  for (const { repoName, urlPrefix, sitePath } of archRepos) {
    if (!fs.existsSync(sitePath)) {
      console.warn(`[arch-proxy] skipping ${repoName}: site-path missing (${sitePath})`);
      continue;
    }
    app.use(urlPrefix, express.static(sitePath, { acceptRanges: true, maxAge: "5m", cacheControl: true }));
    // Extension-aware SPA fallback — generalized from the timetravel fix.
    // Only directory-type URLs (no extension) fall back to index.html.
    // Requests with extensions (.json/.js/.png) that static didn't find
    // fall through to 404 — otherwise missing .json would be masked as
    // the SPA shell, hiding bugs (the timetravel bug, generalized).
    app.get(`${urlPrefix === "/" ? "" : urlPrefix}{*path}`, (req, res, next) => {
      if (path.extname(req.path)) return next();
      res.sendFile(path.join(sitePath, "index.html"));
    });
    console.log(`[arch-proxy] mounted ${repoName} at ${urlPrefix} -> ${sitePath}`);
  }

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "kais-core-backend", version: "6.0.0" });
  });

  // SPA fallback: serve index.html BEFORE auth middleware
  // so that deep links like /project, /production work without JWT
  app.use((req, res, next) => {
    if (req.method !== "GET") return next();
    if (req.path.startsWith("/api/") || req.path.startsWith("/oss/") || req.path.startsWith("/assets/") || req.path.startsWith("/skills/") || req.path.startsWith("/infinite-canvas") || archRepos.some(r => req.path.startsWith(r.urlPrefix))) {
      return next();
    }
    if (req.path.match(/\.[^/]+$/)) {
      return next();
    }
    const indexPath = path.join(webDir, "index.html");
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      next();
    }
  });

  app.use(async (req, res, next) => {
    const setting = await u.db("o_setting").where("key", "tokenKey").select("value").first();
    if (!setting) return res.status(444).send({ message: "服务器秘钥未配置，请联系管理员" });
    const { value: tokenKey } = setting;
    // 从 header 或 query 参数获取 token
    const rawToken = req.headers.authorization || (req.query.token as string) || "";
    const token = rawToken.replace("Bearer ", "");
    // 白名单路径
    if (req.path === "/api/login/login") return next();
    if (req.path === "/health") return next();
    // 静态前端文件（Toonflow UI）
    if (req.path === "/" || req.path === "/index.html") return next();
    if (req.path.startsWith("/assets/") || req.path.endsWith(".js") || req.path.endsWith(".css") || req.path.endsWith(".ico") || req.path.endsWith(".map")) return next();
    // 无限画布页面
    if (req.path.startsWith("/infinite-canvas")) return next();
    // arch dashboards: auth bypass generalized to all manifest-mounted repos
    // (arch dashboards are intentionally public within the tailscale network —
    // PROJECT.md PRIV posture: architecture data carries no secrets).
    if (archRepos.some(r => req.path.startsWith(r.urlPrefix))) return next();
    // V6.0 API routes: pass through without auth (internal service mesh)
    if (req.path.startsWith("/api/v1/")) {
      (req as any).user = { source: "v6-internal" };
      return next();
    }

    // V6.0: open all API routes for web deployment (no login required)
    if (req.path.startsWith("/api/")) {
      (req as any).user = { source: "v6-web" };
      return next();
    }

    // OSS 静态资源（无需鉴权，文件级别通过目录隔离）
    // 静态服务找不到文件时 fall through 到这里，需要放行让 404 handler 处理，
    // 否则缺失文件会被当成 401，掩盖真正的 404。
    if (req.path.startsWith("/oss/")) return next();

    if (!token) return res.status(401).send({ message: "未提供token" });
    try {
      const decoded = jwt.verify(token, tokenKey as string);
      (req as any).user = decoded;
      next();
    } catch (err) {
      return res.status(401).send({ message: "无效的token" });
    }
  });

  const router = await import("@/router");
  await router.default(app);

  // 404 处理
  app.use((_, res, next: NextFunction) => {
    return res.status(404).send({ message: "API 404 Not Found" });
  });

  // 错误处理
  app.use((err: any, _: Request, res: Response, __: NextFunction) => {
    res.locals.message = err.message;
    res.locals.error = err;
    console.error(err);
    res.status(err.status || 500).send(err);
  });

  const port = randomPort ? 0 : (parseInt(process.env.PORT || '') || 10588);
  return await new Promise((resolve) => {
    server.listen(port, async () => {
      // CR-02: ensure the DB boot IIFE (initDB → fixDB → loadAllFromDB →
      // seedDefaultIfEmpty) has completed before accepting requests. Without
      // this, a request hitting GET /api/v1/skills in the ~10-500ms window
      // between listen() and seed completion returns { skills: [] } even on
      // a fresh-DB boot (breaks SC #1). bootReady resolves on success OR
      // failure (on failure, routes degrade gracefully to [] / 404).
      await bootReady;
      const address = server.address();
      const realPort = typeof address === "string" ? address : address?.port;
      console.log(`[服务启动成功]: http://localhost:${realPort}`);
      resolve(realPort);
    });
  });
}

// 支持await关闭
export function closeServe(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (server) {
      server.close((err?: Error) => {
        if (err) return reject(err);
        console.log("[服务已关闭]");
        resolve();
      });
    } else {
      resolve();
    }
  });
}

const isElectron = typeof process.versions?.electron !== "undefined";
if (!isElectron) startServe();
