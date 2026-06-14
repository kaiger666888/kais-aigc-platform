/**
 * Flux Dev FP8 — 模型/容器管理 API
 *
 * GET  /api/v1/production/flux/status     — 容器和模型状态
 * POST /api/v1/production/flux/start      — 启动 comfyui-flux 容器
 * POST /api/v1/production/flux/stop       — 停止容器释放 VRAM
 */

import express from "express";
import axios from "axios";
import { execSync } from "child_process";
import { success, error } from "@/lib/responseFormat";
import { FLUX_CONFIG, FLUX_DEFAULTS } from "./config";

const router = express.Router();

interface FluxStatus {
  containerRunning: boolean;
  comfyuiReady: boolean;
  vramFreeGb: number | null;
  modelsAvailable: {
    unet: boolean;
    clip1: boolean;
    clip2: boolean;
    vae: boolean;
    lora: boolean;
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
  const out = dockerExec(`docker ps --format '{{.Names}}' --filter name=${FLUX_CONFIG.containerName}`);
  return out.includes(FLUX_CONFIG.containerName);
}

function checkFileInContainer(filePath: string): boolean {
  const out = dockerExec(`docker exec ${FLUX_CONFIG.containerName} test -f ${filePath} && echo YES || echo NO`);
  return out === "YES";
}

router.get("/status", async (_req: any, res: any) => {
  try {
    const containerRunning = checkContainerRunning();
    let comfyuiReady = false;
    let vramFreeGb: number | null = null;

    if (containerRunning) {
      try {
        const resp = await axios.get(`${FLUX_CONFIG.comfyuiUrl}/system_stats`, { timeout: 5_000 });
        comfyuiReady = true;
        const devices = resp.data?.devices || [];
        if (devices.length > 0) {
          vramFreeGb = Math.round((devices[0].vram_free / 1024 ** 3) * 10) / 10;
        }
      } catch { /* not ready yet */ }
    }

    const modelsAvailable = containerRunning ? {
      unet: checkFileInContainer(`/data/models/comfyui/diffusion_models/${FLUX_DEFAULTS.unetName}`),
      clip1: checkFileInContainer(`/data/models/comfyui/text_encoders/${FLUX_DEFAULTS.clipName1}`),
      clip2: checkFileInContainer(`/data/models/comfyui/text_encoders/${FLUX_DEFAULTS.clipName2}`),
      vae: checkFileInContainer(`/data/models/comfyui/vae/${FLUX_DEFAULTS.vaeName}`),
      lora: checkFileInContainer(`/data/models/comfyui/loras/${FLUX_DEFAULTS.storyboardLoraName}`),
    } : {
      unet: false, clip1: false, clip2: false, vae: false, lora: false,
    };

    const status: FluxStatus = {
      containerRunning,
      comfyuiReady,
      vramFreeGb,
      modelsAvailable,
    };

    res.json(success(status, `Flux worker ${containerRunning ? "running" : "stopped"}`));
  } catch (err: any) {
    res.status(500).json(error("STATUS_FAILED", err.message));
  }
});

router.post("/start", async (_req: any, res: any) => {
  try {
    if (checkContainerRunning()) {
      return res.json(success({ alreadyRunning: true }, "Container already running"));
    }

    // 启动容器（通过 docker run 带 symlink 初始化）
    const cmd = `docker start ${FLUX_CONFIG.containerName}`;
    execSync(cmd, { timeout: 30_000 });

    // 等待 ComfyUI 就绪
    let ready = false;
    for (let i = 0; i < 24; i++) {
      try {
        const resp = await axios.get(`${FLUX_CONFIG.comfyuiUrl}/system_stats`, { timeout: 3_000 });
        if (resp.data) {
          ready = true;
          break;
        }
      } catch { /* still starting */ }
      await new Promise(r => setTimeout(r, 5_000));
    }

    res.json(success({ started: true, comfyuiReady: ready }, ready ? "Flux worker ready" : "Container started but ComfyUI not ready yet"));
  } catch (err: any) {
    res.status(500).json(error("START_FAILED", err.message));
  }
});

router.post("/stop", async (_req: any, res: any) => {
  try {
    if (!checkContainerRunning()) {
      return res.json(success({ alreadyStopped: true }, "Container already stopped"));
    }
    execSync(`docker stop ${FLUX_CONFIG.containerName}`, { timeout: 30_000 });
    res.json(success({ stopped: true }, "Flux worker stopped, VRAM released"));
  } catch (err: any) {
    res.status(500).json(error("STOP_FAILED", err.message));
  }
});

export default router;
