/**
 * model-config.ts — GET / PUT /api/canvas/v2/model-config(08-25 配置 Tab)。
 *
 * GLM 模型配置的 HTTP 面:文件面 data/config/model-config.json 经
 * src/lib/modelConfig.ts 读写(优先级:文件 > env > 默认,解算在 lib)。
 *
 * GET → { config: 生效视图, source: 每字段来源(file/env/default) }
 * PUT → 全量写(空串 = 回落默认);zod 校验:apiBase 非空须 http(s)://。
 */
import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import {
  resolveEffectiveModelConfig,
  writeModelConfig,
  type ModelConfig,
} from "@/lib/modelConfig";

const router = express.Router();

router.get("/", (_req, res) => {
  try {
    const { config, source } = resolveEffectiveModelConfig();
    return res.json(success({ config, source }));
  } catch (err) {
    console.error("[canvas:v2/model-config] GET 失败", err);
    return res
      .status(500)
      .json(error("model-config 读取失败", err instanceof Error ? err.message : String(err)));
  }
});

const putSchema = z.object({
  scorerVisionModel: z.string().trim().max(120).default(""),
  textModel: z.string().trim().max(120).default(""),
  visionModel: z.string().trim().max(120).default(""),
  apiBase: z
    .string()
    .trim()
    .max(300)
    .refine((v) => v === "" || /^https?:\/\//.test(v), "apiBase 须为 http(s):// 开头")
    .default(""),
  apiKey: z.string().trim().max(300).default(""),
});

router.put("/", (req, res) => {
  const parsed = putSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json(error("参数校验失败", parsed.error.issues));
  }
  try {
    const saved = writeModelConfig(parsed.data as Partial<ModelConfig>);
    const { config, source } = resolveEffectiveModelConfig();
    return res.json(success({ saved, config, source }));
  } catch (err) {
    console.error("[canvas:v2/model-config] PUT 失败", err);
    return res
      .status(500)
      .json(error("model-config 写入失败", err instanceof Error ? err.message : String(err)));
  }
});

export default router;
