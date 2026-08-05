import { SA3_CONFIG, POLL_INTERVAL_MS, POLL_TIMEOUT_MS } from "./config";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface CommonParams {
  prompt: string;
  negative_prompt: string;
  seconds_total: number;
  seconds_start: number;
  seed: number;
  model: string;
  text_encoder: string;
  sampler_name: string;
  scheduler: string;
  steps: number;
  cfg: number;
  model_shift: number;
  denoise: number;
  batch_size: number;
  format: "mp3" | "flac";
  filename_prefix: string;
}

export async function pollUntilComplete(
  comfyuiUrl: string,
  promptId: string,
): Promise<{ status: string; outputs?: any }> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(`${comfyuiUrl}/history/${promptId}`);
    if (!res.ok) throw new Error(`ComfyUI history error: ${res.status}`);
    const history = (await res.json()) as Record<string, any>;
    const entry = history[promptId];
    if (entry) {
      if (entry.status?.status === "error" || entry.status?.status_str === "error") {
        const msgs = entry.status?.messages || [];
        const errMsg = msgs
          .find((m: any[]) => m[0] === "execution_error")
          ?.[1]?.exception_message || "Unknown ComfyUI error";
        throw new Error(`ComfyUI execution error: ${errMsg}`);
      }
      if (entry.status?.completed || entry.outputs) {
        return { status: "success", outputs: entry.outputs };
      }
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error("ComfyUI generation timed out (10 min)");
}

// ─── Upload audio to ComfyUI input dir ─────────────────────────────────────

/**
 * Upload an audio file to ComfyUI's input directory via /upload/image API.
 * Returns the filename usable in LoadAudio node.
 */
export async function uploadAudioToComfyUI(
  comfyuiUrl: string,
  audioPath: string,
  filename: string,
): Promise<string> {
  const fs = await import("fs/promises");
  const buffer = await fs.readFile(audioPath);
  const formData = new FormData();
  const blob = new Blob([buffer]);
  formData.append("image", blob, filename);

  const res = await fetch(`${comfyuiUrl}/upload/image`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    throw new Error(`ComfyUI upload failed (${res.status}): ${await res.text()}`);
  }

  const result = (await res.json()) as { name: string; subfolder: string };
  return result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
}

// ─── Extract output from SaveAudio node ────────────────────────────────────

export function extractAudioOutput(
  outputs: any,
  outputDir: string,
  saveNodeId: string,
  format: string,
) {
  const audioOutput = outputs[saveNodeId];
  if (!audioOutput || !audioOutput.audio) {
    throw new Error("No audio output in ComfyUI response");
  }
  const audioFile = audioOutput.audio[0];
  const audioPath = `${outputDir}/${audioFile.filename}`;
  const audioUrl = `/api/v1/stableaudio/audio/${encodeURIComponent(audioFile.filename)}`;

  return {
    task_id: "",
    audio_path: audioPath,
    audio_url: audioUrl,
    filename: audioFile.filename,
    format,
    seed: 0,
    model: "",
    prompt: "",
  };
}

// ─── Workflow Node Builders ────────────────────────────────────────────────

/**
 * Detect if using the base (non-distilled) model and auto-switch params.
 * SA3 Medium (distilled): lcm/10steps/cfg=1 + ModelSamplingAuraFlow
 * SA3 Medium Base (non-distilled): euler/50steps/cfg=7, no AuraFlow
 */
export function isBaseModel(model: string): boolean {
  return model.toLowerCase().includes("base");
}

/**
 * Build the common SA3 node prefix:
 *   - Node 1: CheckpointLoaderSimple → MODEL + VAE
 *   - Node 2: CLIPLoader (t5gemma) → CLIP
 *   - Node 3: CLIPTextEncode (positive)
 *   - Node 4: CLIPTextEncode (negative)
 *   - Node 5: ConditioningStableAudio (seconds fix)
 *
 * Returns { workflow, modelNodeId, clipNodeId, conditioningNodeId, nextNodeId }
 * where modelNodeId may point to ModelSamplingAuraFlow (node 7) if distilled,
 * or directly to CheckpointLoader (node 1) if base.
 */
export function buildCommonNodes(p: CommonParams) {
  const workflow: Record<string, any> = {};
  const isBase = isBaseModel(p.model);

  // Node 1: Checkpoint Loader (DiT + VAE; no CLIP)
  workflow["1"] = {
    class_type: "CheckpointLoaderSimple",
    inputs: { ckpt_name: p.model },
  };

  // Node 2: CLIP Loader (T5Gemma text encoder)
  workflow["2"] = {
    class_type: "CLIPLoader",
    inputs: {
      clip_name: p.text_encoder,
      type: "stable_diffusion",
    },
  };

  // Node 3: CLIP Text Encode (positive)
  workflow["3"] = {
    class_type: "CLIPTextEncode",
    inputs: { text: p.prompt, clip: ["2", 0] },
  };

  // Node 4: CLIP Text Encode (negative)
  workflow["4"] = {
    class_type: "CLIPTextEncode",
    inputs: { text: p.negative_prompt, clip: ["2", 0] },
  };

  // Node 5: ConditioningStableAudio — fix seconds_total bug
  workflow["5"] = {
    class_type: "ConditioningStableAudio",
    inputs: {
      positive: ["3", 0],
      negative: ["4", 0],
      seconds_start: p.seconds_start,
      seconds_total: p.seconds_total,
    },
  };

  let modelNodeId = "1"; // where KSampler gets its MODEL from
  let nextNodeId = 6;

  // Node 7 (only for distilled Medium): ModelSamplingAuraFlow
  if (!isBase) {
    const auraNodeId = String(nextNodeId);
    workflow[auraNodeId] = {
      class_type: "ModelSamplingAuraFlow",
      inputs: { model: ["1", 0], shift: p.model_shift },
    };
    modelNodeId = auraNodeId;
    nextNodeId++;
  }

  return {
    workflow,
    modelNodeId,
    conditioningNodeId: "5",
    vaeNodeId: "1", // VAE comes from checkpoint loader
    isBase,
    nextNodeId,
  };
}

/**
 * Build SaveAudio / SaveAudioMP3 node.
 */
export function buildSaveNode(
  workflow: Record<string, any>,
  nodeId: string,
  decodeNodeId: string,
  format: string,
  filenamePrefix: string,
) {
  if (format === "mp3") {
    workflow[nodeId] = {
      class_type: "SaveAudioMP3",
      inputs: {
        audio: [decodeNodeId, 0],
        filename_prefix: filenamePrefix,
        quality: "320k",
      },
    };
  } else {
    workflow[nodeId] = {
      class_type: "SaveAudio",
      inputs: {
        audio: [decodeNodeId, 0],
        filename_prefix: filenamePrefix,
      },
    };
  }
}
