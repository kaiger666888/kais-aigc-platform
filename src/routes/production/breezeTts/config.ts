/**
 * Breeze TTS 2 — 克隆 + 零参考音色设计 配置
 *
 * 引擎: Breeze TTS 2 (BreezeBlue 0825 开源, LLM + 深度解码器 + Qwen3-TTS 音频分词器)
 * 服务: breeze-tts.service (systemd) → /opt/breeze-tts/breeze_server.py, :5130
 * 权重: /data/models/Breeze-TTS-2, GPU UUID 锚定 RENDER_GEN1 (3090 24GB)
 * ⚠️ 许可证: 代码 Apache-2.0; 权重非商用 (自托管输出限研究/非商用), Kai 已知情拍板。
 *
 * 契约 (2026-09-03 盲测定谳后接入):
 *   GET  /health   → {status:"ok", model_loaded, engine:"breeze-tts-2"}
 *   POST /clone    (multipart) text, ref_audio(file), ref_text?, instruction?,
 *                  cfg_scale?(default 1.0), seed?(42) → audio/wav 原始字节 (24kHz PCM16)
 *   POST /generate (JSON) {text, instruct, cfg_scale?(4.0), seed?(42)}
 *                  → {success, audio_base64, duration, sr}
 *
 * 能力差异 (vs IndexTTS 2.5): 无 duration_factor 语速参数 (时长校准靠 instruction
 * 文字或后级音频处理); lang 收下不生效 (Breeze 原生双语 ZH/EN)。
 */

/** 引擎标识 (envelope engine 字段, 与 /health 返回的 engine 一致) */
export const BREEZE_ENGINE_ID = "breeze-tts-2";

export const BREEZE_TTS_CONFIG = {
  /** Breeze TTS 2 standalone server (systemd breeze-tts.service, 宿主 127.0.0.1) */
  serverUrl: process.env.BREEZE_TTS_SERVER_URL || "http://127.0.0.1:5130",
  /**
   * 合成产物落盘目录 (映射 /oss/tts 静态服务)。
   * 默认走 cwd 相对 — 与 /oss 静态挂载同源 (getPath("oss") 同为 cwd/data/oss),
   * 保证 audio_url 在任何 checkout (prod/worktree/dev) 都可直接下载;
   * 旧绝对路径可用 BREEZE_TTS_OUTPUT_DIR 覆盖。
   */
  outputDir: process.env.BREEZE_TTS_OUTPUT_DIR || `${process.cwd()}/data/oss/tts`,
  /**
   * ComfyUI 基地址 — 与 Breeze 同卡 (RENDER_GEN1) 的显存预检 /free 驱逐目标,
   * 透传 withGpuQueue ensureVram (与旧 indextts2 链路同一把 GPU 锁语义)。
   */
  comfyuiUrl: process.env.BREEZE_TTS_COMFYUI_URL || process.env.INDEXTTS2_COMFYUI_URL || "http://comfyui-primary:8188",
  /** /health 探针超时 (ms) */
  healthTimeoutMs: 5000,
};

export const BREEZE_TTS_DEFAULTS = {
  /**
   * cfg_scale — 2026-09-03 盲测胜出配方 (克隆+情绪导演 cfg=4 / 零参考设计 cfg=4)。
   * Breeze server 裸默认 1.0, 平台层收口为 4.0, 调用方可显式覆盖。
   */
  cfgScale: 4.0,
  /** 采样种子 (Breeze server 默认 42) */
  seed: 42,
  /**
   * ref_text 兜底转写 — Breeze /clone 带 ref 时走 ref_edit_tata 模板, ref_text
   * (参考音频转写) 是模板必填字段, 缺失直接 500 (实测 2026-09-04); 旧调用方
   * (KMC) 在 IndexTTS 2.5 零样本语义下从不携带 ref_text。调用方未传时 KAP
   * 回退本默认文本保证链路不断 — 转写与真实 ref 内容不符会折损克隆质量,
   * 调用方应尽量传入 ref 实际朗读文本 (env 可覆盖)。
   */
  fallbackRefText: process.env.BREEZE_TTS_FALLBACK_REF_TEXT
    || "你好，我是这个角色的声音参考。今天天气不错，我们一起出去走走吧。",
  /** 兼容字段默认值 (envelope 回显用; Breeze 不消费) */
  lang: "ZH",
  /** 零参考设计默认参考文本 (envelope 回显用; 单步设计不再有独立 ref 合成步) */
  refTexts: {
    Chinese: "你好，我是这个角色的声音参考。今天天气不错，我们一起出去走走吧。",
    English: "Hello, this is a voice reference for this character. The weather is nice today, let's go for a walk.",
    Japanese: "こんにちは、このキャラクターの声の参考です。今日はいい天気ですね、一緒に散歩しませんか。",
  } as Record<string, string>,
};
