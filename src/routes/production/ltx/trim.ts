import express from "express";
import axios from "axios";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { LTX_CONFIG } from "./config";
import { calcTrimFrames } from "./msr";

const router = express.Router();

/**
 * POST /api/production/ltx/msr/trim
 *
 * Body:
 *   videoUrl  — ComfyUI /view URL or local path to raw video
 *   numRefs   — Number of reference images used in generation (2-5)
 *   msrFc     — LiconMSR frame_count (17, 25, 33, 41)
 *   fps       — Frame rate (default 24)
 *   outputDir — Output directory (optional)
 *
 * Downloads the raw video, trims leading conditioning frames, returns the trimmed video path.
 */
router.post(
  "/",
  validateFields({
    videoUrl: z.string().min(1),
    numRefs: z.coerce.number().min(2).max(5),
    msrFc: z.coerce.number().refine((v) => [17, 25, 33, 41].includes(v)),
  }),
  async (req, res) => {
    const { videoUrl, numRefs, msrFc } = req.body;
    const fps = Number(req.body.fps) || 24;
    const outputDir = (req.body.outputDir as string) || "/tmp/ltx-trim";

    const trimFrames = calcTrimFrames(numRefs, msrFc);
    const trimSec = +(trimFrames / fps).toFixed(4);

    fs.mkdirSync(outputDir, { recursive: true });

    const rawPath = path.join(outputDir, `raw_${Date.now()}.mp4`);
    const trimmedPath = path.join(outputDir, `trimmed_${Date.now()}.mp4`);

    try {
      // Download raw video
      if (videoUrl.startsWith("http")) {
        const response = await axios.get(videoUrl, { responseType: "stream", timeout: 60_000 });
        const ws = fs.createWriteStream(rawPath);
        await new Promise<void>((resolve, reject) => {
          response.data.pipe(ws);
          response.data.on("error", reject);
          ws.on("finish", resolve);
        });
      } else {
        // Local path (could be inside Docker container)
        try {
          execSync(`docker cp "${LTX_CONFIG.containerName}:${videoUrl}" "${rawPath}"`, { timeout: 30_000 });
        } catch {
          // Try as local file
          fs.copyFileSync(videoUrl, rawPath);
        }
      }

      // Trim via ffmpeg
      execSync(
        `ffmpeg -y -i "${rawPath}" ` +
          `-vf "select=gt(n\\,${trimFrames - 1}),setpts=PTS-STARTPTS" ` +
          `-af "atrim=start=${trimSec},asetpts=PTS-STARTPTS" ` +
          `-c:v libx264 -crf 18 -preset fast -c:a aac -b:a 128k ` +
          `"${trimmedPath}"`,
        { timeout: 60_000 },
      );

      // Cleanup raw
      fs.unlinkSync(rawPath);

      res.status(200).send(
        success({
          trimmedPath,
          trimFrames,
          trimSec,
          message: `Trimmed ${trimFrames} frames (${trimSec}s) from raw video`,
        }),
      );
    } catch (err: any) {
      try { fs.unlinkSync(rawPath); } catch {}
      try { fs.unlinkSync(trimmedPath); } catch {}
      const msg = err.message || String(err);
      res.status(500).send(error(`Trim failed: ${msg}`));
    }
  },
);

export default router;
