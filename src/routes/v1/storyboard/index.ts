import express from "express";
import { readFile } from "fs/promises";
import { join } from "path";
import u from "@/utils";
import { success } from "@/lib/responseFormat";

const router = express.Router();

/**
 * GET /api/v1/storyboard/:projectId/:episodesId
 *
 * Returns the structured storyboard board JSON for an episode (the
 * E-Konte-style grid of scenes → shots assembled by KMC's p10b phase).
 *
 * Resolution is a 3-tier degrade chain — the board is a DISPLAY layer (not a
 * quality gate), so the route NEVER 500s; on every miss it returns a
 * well-formed empty board so the frontend renders a clean empty state:
 *
 *   1. ``o_assets`` row with ``type='storyboard_board'`` scoped to
 *      ``(projectId, episodesId)`` — the canonical store. canvas_sync persists
 *      the full board JSON in the ``meta`` column on each p10b sync.
 *   2. ``canvas_nodes`` row ``a-storyboard_board`` scoped to
 *      ``(project_id, episodes_id)`` — future-proof fallback if the board
 *      payload is carried in the node's ``data``.
 *   3. File fallback: ``<workdir>/.pipeline-assets/storyboard-board.json``,
 *      resolving the workdir from env (``KMC_WORKDIR`` /
 *      ``KMC_EPISODES_DIR``) then ``process.cwd()``.
 *   4. Empty board (scenes=[], zeroed stats) with ``source='empty'``.
 *
 * Response: ``success(board, message)`` where ``board`` is the storyboard
 * board object (``{ type, episode_id, generated_at, scenes[], stats }``) plus
 * a ``source`` field indicating which tier served it.
 */
router.get("/:projectId/:episodesId", async (req, res) => {
  const projectId = Number(req.params.projectId);
  const episodesId = Number(req.params.episodesId);

  const emptyBoard = (source: string) => ({
    type: "storyboard_board",
    episode_id: String(episodesId),
    generated_at: null,
    scenes: [],
    stats: { total_shots: 0, total_duration_sec: 0, total_scenes: 0 },
    source,
  });

  const finish = (board: any, source: string) =>
    res.status(200).send(success({ ...board, source }));

  // ── Tier 1: o_assets (canonical — written by canvas_sync on p10b sync) ──
  try {
    if (Number.isFinite(projectId) && Number.isFinite(episodesId)) {
      const row = await u.db("o_assets")
        .where("type", "storyboard_board")
        .andWhere("projectId", projectId)
        .andWhere("episodesId", episodesId)
        .orderBy("createdAt", "desc")
        .first();
      if (row) {
        // The full board JSON lives in the meta column (stringified).
        let board: any = null;
        if (row.meta) {
          try { board = JSON.parse(row.meta); } catch { board = null; }
        }
        if (board && Array.isArray(board.scenes)) {
          return finish(board, "o_assets");
        }
      }
    }
  } catch (err) {
    // o_assets may be absent in older deployments — fall through to the next tier.
  }

  // ── Tier 2: canvas_nodes (a-storyboard_board, future-proof) ─────────────
  try {
    if (Number.isFinite(projectId) && Number.isFinite(episodesId)) {
      const node = await u.db("canvas_nodes")
        .where("id", "a-storyboard_board")
        .andWhere("project_id", projectId)
        .andWhere("episodes_id", episodesId)
        .first();
      if (node && node.data) {
        let data: any = null;
        try { data = JSON.parse(node.data); } catch { data = null; }
        if (data && Array.isArray(data.scenes)) {
          return finish(data, "canvas_nodes");
        }
      }
    }
  } catch {
    // canvas_nodes unavailable — fall through.
  }

  // ── Tier 3: file fallback (.pipeline-assets/storyboard-board.json) ──────
  const candidates: string[] = [];
  if (process.env.KMC_WORKDIR) {
    candidates.push(join(process.env.KMC_WORKDIR, ".pipeline-assets", "storyboard-board.json"));
  }
  if (process.env.KMC_EPISODES_DIR) {
    candidates.push(join(process.env.KMC_EPISODES_DIR, String(episodesId), ".pipeline-assets", "storyboard-board.json"));
  }
  candidates.push(join(process.cwd(), ".pipeline-assets", "storyboard-board.json"));
  for (const filePath of candidates) {
    try {
      const raw = await readFile(filePath, "utf8");
      const board = JSON.parse(raw);
      if (board && Array.isArray(board.scenes)) {
        return finish(board, "file");
      }
    } catch {
      // not found / unparseable — try the next candidate.
    }
  }

  // ── Tier 4: graceful empty board ────────────────────────────────────────
  return res.status(200).send(success(emptyBoard("empty")));
});

export default router;
