import express from "express";
import fs from "fs";
import path from "path";
import { success, error } from "@/lib/responseFormat";

const router = express.Router();

// 白名单:精确到具体项目目录,避免父目录前缀(否则 /home/kai/workspace
// 会等价于把整个工作区暴露给任何 /api/ 调用方)。
// 新增项目时显式 append,不要放父目录。
const ALLOWED_ROOTS = [
  "/home/kai/workspace/kais-movie-agent",
  "/home/kai/workspace/kais-aigc-platform",
  "/data/projects",
];

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
    : path.join("/home/kai/workspace/kais-movie-agent", filePath);

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
    : path.join("/home/kai/workspace/kais-movie-agent", filePath);

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

export default router;
