import express from "express";
import { success, error } from "@/lib/responseFormat";
import { ACE_CONFIG } from "./config";

const router = express.Router();

/**
 * GET /api/v1/ace/models
 *
 * List available ACE-Step models by querying ComfyUI's object_info
 * for the AceStepSFTModelLoader node. Falls back to static defaults
 * if ComfyUI is unreachable.
 */
export default router.get("/", async (_req, res) => {
  const comfyuiUrl = ACE_CONFIG.comfyuiUrl;

  try {
    const resp = await fetch(
      `${comfyuiUrl}/object_info/AceStepSFTModelLoader`,
      { signal: AbortSignal.timeout(5_000) },
    );

    if (resp.ok) {
      const data = (await resp.json()) as {
        AceStepSFTModelLoader?: {
          input?: {
            required?: Record<string, [string[] | string, ...any]>;
          };
        };
      };
      const nodeInfo = data.AceStepSFTModelLoader;
      const diffusionInput = nodeInfo?.input?.required?.diffusion_model;
      const models = Array.isArray(diffusionInput)
        ? diffusionInput[0]
        : undefined;

      if (Array.isArray(models) && models.length > 0) {
        return res.status(200).send(success({
          models,
          engine_target: "comfyui",
          comfyui_url: comfyuiUrl,
          status: "live",
        }));
      }
    }
  } catch {
    // Fall through to static defaults
  }

  // Static fallback when ComfyUI is unreachable or node not registered
  return res.status(200).send(success({
    models: [
      {
        id: "acestep_v1.5_xl_sft.safetensors",
        name: "ACE-Step 1.5 XL SFT",
        description: "Highest quality, slower. Best for final output.",
        default: true,
      },
      {
        id: "acestep_v1.5_xl_turbo.safetensors",
        name: "ACE-Step 1.5 XL Turbo",
        description: "Fast generation, good quality. Recommended for preview.",
        default: false,
      },
    ],
    engine_target: "comfyui",
    comfyui_url: comfyuiUrl,
    status: "cached",
    task_types: [
      { type: "text2music", label: "Text to Music", description: "Generate music from text prompt and/or lyrics" },
      { type: "cover", label: "Cover Version", description: "Create a cover version of a reference song" },
      { type: "repaint", label: "Repaint", description: "Repaint/re-generate a section of existing audio" },
      { type: "extract", label: "Extract", description: "Extract stems/separate tracks from audio" },
      { type: "lego", label: "LEGO", description: "Build a full track from individual stem descriptions" },
      { type: "complete", label: "Complete", description: "Complete/extend an existing audio clip" },
      { type: "remix", label: "Remix", description: "Remix an existing audio track" },
    ],
    audio_formats: ["mp3", "wav", "flac", "opus", "aac", "wav32"],
    note: "ComfyUI unreachable — returning cached defaults. Verify ComfyUI is running and AceStepSFT nodes are installed.",
  }));
});
