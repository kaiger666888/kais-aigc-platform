import express from "express";
import fs from "fs";
import path from "path";
import { success, error } from "@/lib/responseFormat";

const router = express.Router();

// Pipeline output directory. Default keeps the historical kais-movie-agent
// path so existing deployments don't break; set KAIS_OUTPUT_DIR to relocate
// (kais-movie-agent repo was retired 260702 — JS runtime vendored into
// src/runtime/, but legacy media outputs may still live here).
const KAIS_OUTPUT_DIR =
  process.env.KAIS_OUTPUT_DIR || "/data/workspace/kais-movie-agent";

// 白名单:精确到具体项目目录,避免父目录前缀(否则 /home/kai/workspace
// 会等价于把整个工作区暴露给任何 /api/ 调用方)。
// 新增项目时显式 append,不要放父目录。
const ALLOWED_ROOTS = [
  KAIS_OUTPUT_DIR,
  "/home/kai/workspace/kais-aigc-platform",
  "/data/workspace/kais-aigc-platform",
  "/data/projects",
];

// 图片文件后缀 — 用于 /image 端点返回二进制
const IMAGE_EXT = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg"];

// 写入端点:只允许这些后缀,杜绝 .js/.ts/.sh/.py 等可执行代码注入。
const WRITABLE_EXT = [".json", ".md", ".txt", ".yaml", ".yml"];
const MAX_BYTES = 5 * 1024 * 1024; // read & write 共用 5MB 上限

function safeResolve(filePath: string): string | null {
  const resolved = path.resolve(filePath);
  for (const root of ALLOWED_ROOTS) {
    // 必须是 root 自身或 root 的直接子路径 —— startsWith 单独用会有
    // 共享前缀漏洞 (e.g. /home/kai/workspaceEVIL/x 会通过 /home/kai/workspace 检查)。
    if (resolved === root || resolved.startsWith(root + path.sep)) return resolved;
  }
  return null;
}

/**
 * POST /api/v2/canvas/file/read
 */
router.post("/read", (req, res) => {
  const { filePath } = req.body;
  if (!filePath || typeof filePath !== "string") {
    return res.json(error("filePath is required"));
  }

  const fullPath = filePath.startsWith("/")
    ? filePath
    : path.join(KAIS_OUTPUT_DIR, filePath);

  const safePath = safeResolve(fullPath);
  if (!safePath) {
    return res.json(error("Access denied: path outside allowed roots"));
  }

  try {
    if (!fs.existsSync(safePath)) {
      return res.json(error("File not found"));
    }

    const stat = fs.statSync(safePath);
    if (!stat.isFile()) {
      return res.json(error("Not a regular file"));
    }
    if (stat.size > MAX_BYTES) {
      return res.json(error("File too large (max 5MB)"));
    }

    const content = fs.readFileSync(safePath, "utf-8");

    let parsed: any = null;
    let isJson = false;
    try {
      parsed = JSON.parse(content);
      isJson = true;
    } catch {
      // Not JSON
    }

    return res.json(success({
      filePath: safePath,
      fileName: path.basename(safePath),
      size: stat.size,
      modified: stat.mtime.toISOString(),
      isJson,
      content: isJson ? JSON.stringify(parsed, null, 2) : content,
      raw: parsed,
    }));
  } catch (err: any) {
    return res.json(error(`Read failed`));
  }
});

/**
 * POST /api/v2/canvas/file/write
 */
router.post("/write", (req, res) => {
  const { filePath, content } = req.body;
  if (!filePath || typeof filePath !== "string" || content === undefined) {
    return res.json(error("filePath and content are required"));
  }
  if (typeof content === "string" && Buffer.byteLength(content) > MAX_BYTES) {
    return res.json(error("Content too large (max 5MB)"));
  }

  const fullPath = filePath.startsWith("/")
    ? filePath
    : path.join(KAIS_OUTPUT_DIR, filePath);

  const safePath = safeResolve(fullPath);
  if (!safePath) {
    return res.json(error("Access denied: path outside allowed roots"));
  }

  const ext = path.extname(safePath).toLowerCase();
  if (!WRITABLE_EXT.includes(ext)) {
    return res.json(error(`Unsupported file type: ${ext || "(none)"}`));
  }

  try {
    // 写入前对 .bak 带时间戳,避免反复覆盖丢失历史
    if (fs.existsSync(safePath)) {
      const bakPath = `${safePath}.${Date.now()}.bak`;
      fs.copyFileSync(safePath, bakPath);
    }

    if (safePath.endsWith(".json")) {
      try {
        JSON.parse(content);
      } catch {
        return res.json(error("Invalid JSON content"));
      }
    }

    fs.writeFileSync(safePath, content, "utf-8");
    const stat = fs.statSync(safePath);

    return res.json(success({
      filePath: safePath,
      fileName: path.basename(safePath),
      size: stat.size,
      modified: stat.mtime.toISOString(),
    }));
  } catch (err: any) {
    return res.json(error(`Write failed`));
  }
});

/**
 * GET /api/canvas/v2/file/image?path=<absolute_path>
 * 返回图片二进制，用于节点缩略图展示。
 */
router.get("/image", (req, res) => {
  const filePath = String(req.query.path || "");
  if (!filePath) {
    return res.status(400).json(error("path query param is required"));
  }

  const safePath = safeResolve(filePath);
  if (!safePath) {
    return res.status(403).json(error("Access denied: path outside allowed roots"));
  }

  try {
    if (!fs.existsSync(safePath)) {
      return res.status(404).json(error("File not found"));
    }
    const stat = fs.statSync(safePath);
    if (!stat.isFile()) {
      return res.status(400).json(error("Not a regular file"));
    }
    const ext = path.extname(safePath).toLowerCase();
    if (!IMAGE_EXT.includes(ext)) {
      return res.status(400).json(error(`Not an image file: ${ext}`));
    }

    const mimeMap: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".gif": "image/gif",
      ".bmp": "image/bmp",
      ".svg": "image/svg+xml",
    };
    res.setHeader("Content-Type", mimeMap[ext] || "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=3600");
    const stream = fs.createReadStream(safePath);
    stream.on("error", () => res.status(500).json(error("Read failed")));
    stream.pipe(res);
  } catch {
    return res.status(500).json(error("Image read failed"));
  }
});

export default router;
