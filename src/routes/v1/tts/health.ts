/**
 * GET /api/v1/tts/health
 *
 * v1 TTS 引擎健康检查（KMC P10 preflight 消费，见 docs/kmc-tts-error-contract.md）。
 *
 * 与 status.ts 的区别: status 返回能力清单（始终 200）；health 返回机器可判定的
 * ok/degraded 二态 + 具体缺失项，供 fail-fast 决策。
 *
 * 探测两层:
 *   1. ComfyUI /object_info 可达性 (comfyui_reachable)
 *   2. AILab_Qwen3TTSVoiceDesign 节点注册 (voice_design_node_registered)
 *
 * status 判定:
 *   ok      — ComfyUI 可达且 QwenTTS 节点已注册
 *   degraded — 其余任何情况（不可达 / 节点缺失）
 * 注意: HTTP 恒返 200（健康端点不报 5xx，语义在 body.status 里）；KMC 侧按
 * body.status === "ok" 判定，不要看 HTTP code。
 */
import express, { Router } from "express";
import { success } from "@/lib/responseFormat";
import { TTS_CONFIG } from "./config";

const router = express.Router();

const REQUIRED_NODES = [
  TTS_CONFIG.NODE_TYPES.VOICE_DESIGN, // AILab_Qwen3TTSVoiceDesign
  TTS_CONFIG.NODE_TYPES.VOICE_CLONE, // AILab_Qwen3TTSVoiceClone
  TTS_CONFIG.NODE_TYPES.CUSTOM_VOICE, // AILab_Qwen3TTSCustomVoice
];

router.get("/", async (_req, res) => {
  let comfyuiReachable = false;
  let registeredNodes: string[] = [];
  let detail = "";

  try {
    const resp = await fetch(`${TTS_CONFIG.comfyuiUrl}/object_info`, {
      signal: AbortSignal.timeout(5000),
    });
    if (resp.ok) {
      const data = (await resp.json()) as Record<string, unknown>;
      comfyuiReachable = true;
      registeredNodes = REQUIRED_NODES.filter((n) => n in data);
    } else {
      detail = `ComfyUI /object_info returned HTTP ${resp.status}`;
    }
  } catch (e: any) {
    detail = `ComfyUI unreachable (${TTS_CONFIG.comfyuiUrl}): ${e?.message || e}`;
  }

  const voiceDesignNodeRegistered = registeredNodes.includes(TTS_CONFIG.NODE_TYPES.VOICE_DESIGN);
  const pluginLoaded = registeredNodes.length > 0;
  const status = comfyuiReachable && voiceDesignNodeRegistered ? "ok" : "degraded";

  if (status === "degraded" && !detail) {
    detail = `node ${TTS_CONFIG.NODE_TYPES.VOICE_DESIGN} not registered in ComfyUI (plugin dir missing or import failed)`;
  }

  res.json(
    success({
      status,
      comfyui_reachable: comfyuiReachable,
      plugin_loaded: pluginLoaded,
      voice_design_node_registered: voiceDesignNodeRegistered,
      registered_nodes: registeredNodes,
      missing_nodes: REQUIRED_NODES.filter((n) => !registeredNodes.includes(n)),
      detail,
      config: {
        comfyui_url: TTS_CONFIG.comfyuiUrl,
        speak_route: "/api/v1/tts/speak",
      },
    }),
  );
});

export default router;
