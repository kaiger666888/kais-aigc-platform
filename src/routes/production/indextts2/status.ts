/**
 * IndexTTS 2.0 — 容器/模型状态 API
 *
 * GET  /api/production/indextts2/status   — 容器和模型状态
 * POST /api/production/indextts2/preload  — 预加载模型（可选）
 */

import express from "express";
import { execSync } from "child_process";
import { success, error } from "@/lib/responseFormat";
import { INDEXTTS2_CONFIG, INDEXTTS2_DEFAULTS } from "./config";

const router = express.Router();

interface IndexTTS2Status {
  containerRunning: boolean;
  comfyuiReady: boolean;
  nodesRegistered: boolean;
  transformersVersion: string | null;
  vramFreeGb: number | null;
  modelsAvailable: {
    gpt: boolean;
    s2mel: boolean;
    bigvgan: boolean;
    qwenEmotion: boolean;
    semanticCodec: boolean;
  };
}

function dockerExec(cmd: string): string {
  try {
    return execSync(cmd, { timeout: 10_000, encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

function checkContainerRunning(): boolean {
  const out = dockerExec(`docker ps --format '{{.Names}}' --filter name=${INDEXTTS2_CONFIG.containerName}`);
  return out.includes(INDEXTTS2_CONFIG.containerName);
}

function checkComfyUIReady(): boolean {
  try {
    const out = execSync(`docker exec ${INDEXTTS2_CONFIG.containerName} node -e "fetch('http://127.0.0.1:8188/system_stats').then(r=>r.text()).then(t=>process.stdout.write(t)).catch(()=>process.exit(1))"`, {
      timeout: 8_000, encoding: "utf-8",
    });
    return out.includes("comfyui_version") || out.includes("system");
  } catch {
    return false;
  }
}

function checkNodesRegistered(): boolean {
  try {
    const out = execSync(`docker exec ${INDEXTTS2_CONFIG.containerName} node -e "fetch('http://127.0.0.1:8188/object_info/IndexTTS2ModelLoader').then(r=>r.text()).then(t=>process.stdout.write(t)).catch(()=>process.exit(1))"`, {
      timeout: 8_000, encoding: "utf-8",
    });
    return out.includes("IndexTTS2ModelLoader");
  } catch {
    return false;
  }
}

function getTransformersVersion(): string | null {
  const out = dockerExec(`docker exec ${INDEXTTS2_CONFIG.containerName} pip show transformers 2>/dev/null | grep '^Version:'`);
  const m = out.match(/Version:\s*(\S+)/);
  return m ? m[1] : null;
}

function getVramFreeGb(): number | null {
  const out = dockerExec(`nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits -i 0`);
  const mb = parseInt(out, 10);
  return isNaN(mb) ? null : mb / 1024;
}

function checkModels(): IndexTTS2Status["modelsAvailable"] {
  const checkFile = (rel: string) => {
    const out = dockerExec(`docker exec ${INDEXTTS2_CONFIG.containerName} test -f /root/ComfyUI/models/IndexTTS-2/${rel} && echo YES || echo NO`);
    return out === "YES";
  };
  const checkDir = (rel: string) => {
    const out = dockerExec(`docker exec ${INDEXTTS2_CONFIG.containerName} test -d /root/ComfyUI/models/IndexTTS-2/${rel} && echo YES || echo NO`);
    return out === "YES";
  };
  return {
    gpt: checkFile("gpt.pth"),
    s2mel: checkFile("s2mel.pth"),
    bigvgan: checkDir("bigvgan_v2_22khz_80band_256x"),
    qwenEmotion: checkDir("qwen0.6bemo4-merge"),
    semanticCodec: checkDir("semantic_codec"),
  };
}

router.get("/status", async (_req: any, res: any) => {
  try {
    const containerRunning = checkContainerRunning();

    const status: IndexTTS2Status = {
      containerRunning,
      comfyuiReady: containerRunning && checkComfyUIReady(),
      nodesRegistered: containerRunning && checkNodesRegistered(),
      transformersVersion: containerRunning ? getTransformersVersion() : null,
      vramFreeGb: getVramFreeGb(),
      modelsAvailable: checkModels(),
    };

    return res.json(success(status));
  } catch (err: any) {
    return res.status(500).json(error(err.message));
  }
});

/**
 * 预加载模型 — 提交一个空的模型加载请求，让 ComfyUI 缓存模型权重
 * 后续推理请求更快（跳过 30-60s 加载时间）
 */
router.post("/preload", async (_req: any, res: any) => {
  try {
    const prompt = {
      "1": {
        class_type: "IndexTTS2ModelLoader",
        inputs: {
          model_dir: INDEXTTS2_DEFAULTS.modelDir,
          device: INDEXTTS2_DEFAULTS.device,
          use_fp16: INDEXTTS2_DEFAULTS.useFp16,
          use_cuda_kernel: INDEXTTS2_DEFAULTS.useCudaKernel,
          use_deepspeed: INDEXTTS2_DEFAULTS.useDeepspeed,
        },
      },
    };

    const resp = await fetch(`${INDEXTTS2_CONFIG.comfyuiUrl}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      return res.status(resp.status).json(error(`Preload failed: ${txt.slice(0, 300)}`));
    }

    const data = await resp.json() as { prompt_id?: string };
    return res.json(success({ message: "Model preload submitted", prompt_id: data.prompt_id }));
  } catch (err: any) {
    return res.status(500).json(error(err.message));
  }
});

export default router;
