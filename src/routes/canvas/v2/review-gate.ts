import express from "express";
import fs from "fs";
import path from "path";
import { success, error } from "@/lib/responseFormat";

const router = express.Router();

/**
 * POST /api/v2/canvas/review/options
 * Body: { filePath: string }
 * 解析剧本文件，提取变体选项
 */
router.post("/options", (req, res) => {
  const { filePath } = req.body;
  if (!filePath) {
    return res.json(error("filePath is required"));
  }

  const fullPath = filePath.startsWith("/")
    ? filePath
    : path.join("/home/kai/workspace/kais-movie-agent", filePath);

  try {
    if (!fs.existsSync(fullPath)) {
      return res.json(error(`File not found: ${filePath}`));
    }

    const content = fs.readFileSync(fullPath, "utf-8");
    const data = JSON.parse(content);

    // Extract variant options from scripts
    const scripts = data.scripts || data;
    const options: Array<{
      id: string;
      label: string;
      title: string;
      logline: string;
      emotion: string;
      hook: string;
      episodes: number;
      beats: number;
      episodeList: Array<{ ep: string; title: string; logline: string; emotion: string; hook_ending: string }>;
    }> = [];

    if (typeof scripts === "object" && !Array.isArray(scripts)) {
      for (const [vid, variant] of Object.entries(scripts)) {
        const v = variant as any;
        const ep1 = v.episodes?.[0] || {};
        const totalBeats = (v.episodes || []).reduce((s: number, e: any) => s + (e.beat_count || 0), 0);
        const episodeList = (v.episodes || []).map((e: any) => ({
          ep: e.ep || "",
          title: e.title || "",
          logline: e.logline || "",
          emotion: e.emotion || "",
          hook_ending: e.hook_ending || "",
        }));
        options.push({
          id: vid,
          label: vid === "alpha" ? "α 悬疑版" : vid === "beta" ? "β 均衡版" : vid === "gamma" ? "γ 奇幻版" : vid,
          title: ep1.title || vid,
          logline: ep1.logline || "",
          emotion: ep1.emotion || "",
          hook: (ep1.hook_ending || "").slice(0, 150),
          episodes: v.episodes?.length || 0,
          beats: totalBeats,
          episodeList,
        });
      }
    }

    return res.json(success({ options, sourceFile: filePath }));
  } catch (err: any) {
    return res.json(error(`Parse failed: ${err.message}`));
  }
});

/**
 * POST /api/v2/canvas/review/submit
 * Body: { projectId, episodesId, nodeId, selection }
 * 提交审核选择
 */
router.post("/submit", (req, res) => {
  const { projectId, episodesId, nodeId, selection } = req.body;
  if (!nodeId || !selection) {
    return res.json(error("nodeId and selection are required"));
  }

  // Sanitize nodeId — only allow [a-zA-Z0-9-_], prevent path traversal
  if (!/^[a-zA-Z0-9_-]+$/.test(nodeId)) {
    return res.status(400).json(error("Invalid nodeId: only [a-zA-Z0-9_-] allowed"));
  }

  // Write selection to a review state file
  const reviewDir = path.join("/home/kai/workspace/kais-movie-agent", ".review-state");
  if (!fs.existsSync(reviewDir)) {
    fs.mkdirSync(reviewDir, { recursive: true });
  }

  const reviewFile = path.join(reviewDir, `${nodeId}.json`);
  // Double-check resolved path stays inside reviewDir
  if (!reviewFile.startsWith(reviewDir + path.sep)) {
    return res.status(400).json(error("Resolved path escapes review dir"));
  }

  fs.writeFileSync(reviewFile, JSON.stringify({
    nodeId,
    projectId,
    episodesId,
    selection,
    reviewedAt: new Date().toISOString(),
  }, null, 2));

  return res.json(success({
    nodeId,
    selection,
    status: "approved",
    reviewedAt: new Date().toISOString(),
  }));
});

export default router;
