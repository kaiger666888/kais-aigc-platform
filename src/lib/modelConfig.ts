/**
 * modelConfig.ts — GLM 模型配置的文件面（08-25 配置 Tab 落地）。
 *
 * 存储:data/config/model-config.json(仓库根相对,cwd = 服务进程工作目录),
 * 全字段可选——空串/缺省 = 回落默认;文件缺失 = 全默认(等效未配置)。
 * 优先级:调用方显式参数 > 配置文件 > 环境变量 > 内置默认。
 *
 * 消费方:
 *   - src/lib/ai-scorer.ts(图片评分 vision 模型 / apiBase / apiKey)
 *   - src/runtime/hermes-adapter.mjs(文本/视觉默认模型;独立内联读,见该文件头注)
 *   - src/routes/canvas/v2/model-config.ts(GET/PUT HTTP 面)
 */
import fs from "fs";
import path from "path";

export interface ModelConfig {
  /** 图片评分视觉模型(ai-scorer;默认 glm-4v-flash)。 */
  scorerVisionModel: string;
  /** 文本模型默认(hermes-adapter callLLM;默认 glm-5.1)。 */
  textModel: string;
  /** 视觉模型默认(hermes-adapter;原 ZHIPU_VISION_MODEL,默认 glm-4.6v)。 */
  visionModel: string;
  /** API Base(默认 https://open.bigmodel.cn/api/paas/v4)。 */
  apiBase: string;
  /** API Key(默认回落 env ZHIPU_API_KEY / OPENAI_API_KEY)。 */
  apiKey: string;
}

export const MODEL_CONFIG_DEFAULTS: Readonly<ModelConfig> = {
  scorerVisionModel: "glm-4v-flash",
  textModel: "glm-5.1",
  visionModel: "glm-4.6v",
  apiBase: "https://open.bigmodel.cn/api/paas/v4",
  apiKey: "",
};

const MODEL_CONFIG_FIELDS = Object.keys(MODEL_CONFIG_DEFAULTS) as Array<keyof ModelConfig>;

export function modelConfigFile(): string {
  return path.join(process.cwd(), "data", "config", "model-config.json");
}

/** 读原始文件面(缺省字段补空串;文件缺失/损坏返回 null——视为未配置)。 */
export function readModelConfigRaw(): Partial<ModelConfig> | null {
  const file = modelConfigFile();
  try {
    const raw = fs.readFileSync(file, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<ModelConfig> = {};
    for (const key of MODEL_CONFIG_FIELDS) {
      const v = parsed[key];
      if (typeof v === "string" && v.trim().length > 0) out[key] = v.trim();
    }
    return out;
  } catch {
    return null;
  }
}

/** 原子写(tmp+rename;字段全量落盘,空串字段直接省略——语义即「回落默认」)。 */
export function writeModelConfig(patch: Partial<ModelConfig>): ModelConfig {
  const file = modelConfigFile();
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const next: Partial<ModelConfig> = {};
  for (const key of MODEL_CONFIG_FIELDS) {
    const v = patch[key];
    if (typeof v === "string" && v.trim().length > 0) next[key] = v.trim();
  }
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
  fs.renameSync(tmp, file);
  return next as ModelConfig;
}

/** 解析生效视图 + 每字段来源('file' | 'env' | 'default';apiBase/textModel/visionModel 无 env 面)。 */
export function resolveEffectiveModelConfig(): {
  config: ModelConfig;
  source: Record<keyof ModelConfig, "file" | "env" | "default">;
} {
  const raw = readModelConfigRaw() ?? {};
  const envKey = process.env.ZHIPU_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim() || "";
  const source = {} as Record<keyof ModelConfig, "file" | "env" | "default">;
  const config = {} as ModelConfig;
  for (const key of MODEL_CONFIG_FIELDS) {
    if (raw[key]) {
      config[key] = raw[key]!;
      source[key] = "file";
    } else if (key === "apiKey" && envKey) {
      config[key] = envKey;
      source[key] = "env";
    } else {
      config[key] = MODEL_CONFIG_DEFAULTS[key];
      source[key] = "default";
    }
  }
  return { config, source };
}
