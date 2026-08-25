/**
 * AI 图片评分器 — 调用智谱 GLM 视觉模型对图片进行 5 维度评分
 * 08-25 起模型/API 面 configurable:data/config/model-config.json(配置 Tab),
 * 优先级 文件 > env(ZHIPU_API_KEY) > 内置默认(见 src/lib/modelConfig.ts)。
 */
import { readFile } from "fs/promises";
import { resolveEffectiveModelConfig } from "@/lib/modelConfig";

/** 评分端点 = apiBase + /chat/completions(每调用解算,配置改动即时生效)。 */
function scorerEndpoint(apiBase: string): string {
  return `${apiBase.replace(/\/+$/, "")}/chat/completions`;
}

export interface AIScoreResult {
  overall: number;
  quality: number;
  aesthetic: number;
  storyConsistency: number;
  promptAdherence: number;
  emotionImpact: number;
  reasoning?: string;
}

const SCORE_PROMPT = `你是一个专业的 AI 生成内容质量评审专家。请对这张图片进行评估，从以下 5 个维度打分（0-100）：

1. quality - 画面质量：清晰度、构图、光影、细节表现
2. aesthetic - 美学评分：色彩、风格、艺术感染力
3. storyConsistency - 故事一致性：画面叙事连贯性
4. promptAdherence - 创作完成度：画面完整度和精细度
5. emotionImpact - 情感表现力：画面的情感传达能力

请严格按照以下 JSON 格式返回，不要添加其他文字：
{"overall":85,"quality":80,"aesthetic":90,"storyConsistency":75,"promptAdherence":85,"emotionImpact":80,"reasoning":"简要评价"}`;

/**
 * 读取图片并转为 base64
 */
async function imageToBase64(imagePath: string): Promise<{ base64: string; mimeType: string }> {
  let imageBuffer: Buffer;
  let filePath = imagePath;

  // 处理 OSS 路径
  if (filePath.startsWith("/oss/")) {
    filePath = `/data/workspace/kais-aigc-platform/data${filePath.replace("/oss", "")}`;
  }

  try {
    imageBuffer = await readFile(filePath);
  } catch {
    throw new Error(`无法读取图片文件: ${filePath}`);
  }

  // 根据文件头判断 MIME 类型
  const mimeMap: Record<string, string> = {
    "/9j/": "image/jpeg",
    "iVBOR": "image/png",
    "R0lG": "image/gif",
    "UklG": "image/webp",
  };
  const header = imageBuffer.slice(0, 4).toString("base64").slice(0, 4);
  const mimeType = mimeMap[header] || "image/png";

  return { base64: imageBuffer.toString("base64"), mimeType };
}

/**
 * 调用 GLM 视觉模型评分（模型/端点/密钥经 model-config 解算）
 */
export async function scoreImage(imagePath: string, _prompt?: string): Promise<AIScoreResult> {
  const { base64, mimeType } = await imageToBase64(imagePath);
  const { config } = resolveEffectiveModelConfig();

  const body = {
    model: config.scorerVisionModel,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: SCORE_PROMPT },
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
        ],
      },
    ],
    temperature: 0.2,
    max_tokens: 500,
  };

  const res = await fetch(scorerEndpoint(config.apiBase), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GLM API 请求失败 (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("GLM API 返回空内容");

  // 解析 JSON 响应
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`无法解析 GLM 响应: ${content.slice(0, 200)}`);

  const score = JSON.parse(jsonMatch[0]) as AIScoreResult;

  // 验证并 clamp 分数
  const keys = ["overall", "quality", "aesthetic", "storyConsistency", "promptAdherence", "emotionImpact"] as const;
  for (const k of keys) {
    if (typeof score[k] !== "number" || isNaN(score[k])) {
      score[k] = k === "overall" ? 50 : 50;
    }
    score[k] = Math.max(0, Math.min(100, Math.round(score[k])));
  }

  return score;
}

/**
 * 带重试的评分
 */
export async function scoreImageWithRetry(imagePath: string, prompt?: string, retries = 2): Promise<AIScoreResult> {
  for (let i = 0; i <= retries; i++) {
    try {
      return await scoreImage(imagePath, prompt);
    } catch (err: any) {
      if (i === retries) throw err;
      console.warn(`[ai-scorer] 第 ${i + 1} 次评分失败，重试...`, err.message);
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw new Error("评分重试次数已用完");
}

// ---------------------------------------------------------------------------
// 双图对比评分通用方法
// ---------------------------------------------------------------------------

const CHARACTER_CONSISTENCY_PROMPT = `你是一个专业的角色一致性评审专家。请对比两张图片中的角色，评估一致性。从以下维度打分（0-100）：

1. quality - 画面质量
2. aesthetic - 美学评分
3. storyConsistency - 角色外观一致性（面部特征、服装、体型）
4. promptAdherence - 角色特征还原度
5. emotionImpact - 情感表现力

请严格按照以下 JSON 格式返回，不要添加其他文字：
{"overall":85,"quality":80,"aesthetic":90,"storyConsistency":90,"promptAdherence":85,"emotionImpact":80,"reasoning":"简要评价"}`;

const DEPTH_ACCURACY_PROMPT = `你是一个专业的深度图评审专家。请对比场景图和深度图，评估深度图的准确性。从以下维度打分（0-100）：

1. quality - 深度图质量（无伪影、连续性好）
2. aesthetic - 深度层次是否合理
3. storyConsistency - 深度图与场景图的一致性
4. promptAdherence - 物体边界清晰度
5. emotionImpact - 空间感表现力

请严格按照以下 JSON 格式返回，不要添加其他文字：
{"overall":85,"quality":80,"aesthetic":85,"storyConsistency":90,"promptAdherence":85,"emotionImpact":80,"reasoning":"简要评价"}`;

const UPSCALE_QUALITY_PROMPT = `你是一个专业的图像超分评审专家。请对比原图和超分图，评估超分质量。从以下维度打分（0-100）：

1. quality - 超分图清晰度和细节
2. aesthetic - 色彩和风格保持
3. storyConsistency - 内容一致性（无幻觉/伪影）
4. promptAdherence - 边缘锐利度和细节增强
5. emotionImpact - 整体视觉提升

请严格按照以下 JSON 格式返回，不要添加其他文字：
{"overall":85,"quality":85,"aesthetic":90,"storyConsistency":95,"promptAdherence":85,"emotionImpact":80,"reasoning":"简要评价"}`;

/**
 * 双图对比评分通用方法
 */
async function scoreDualImage(
  image1Path: string,
  image2Path: string,
  prompt: string,
): Promise<AIScoreResult> {
  const [{ base64: base64_1, mimeType: mime1 }, { base64: base64_2, mimeType: mime2 }] =
    await Promise.all([imageToBase64(image1Path), imageToBase64(image2Path)]);
  const { config } = resolveEffectiveModelConfig();

  const body = {
    model: config.scorerVisionModel,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:${mime1};base64,${base64_1}` } },
          { type: "image_url", image_url: { url: `data:${mime2};base64,${base64_2}` } },
        ],
      },
    ],
    temperature: 0.2,
    max_tokens: 500,
  };

  const res = await fetch(scorerEndpoint(config.apiBase), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GLM API 请求失败 (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("GLM API 返回空内容");

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`无法解析 GLM 响应: ${content.slice(0, 200)}`);

  const score = JSON.parse(jsonMatch[0]) as AIScoreResult;

  const keys = ["overall", "quality", "aesthetic", "storyConsistency", "promptAdherence", "emotionImpact"] as const;
  for (const k of keys) {
    if (typeof score[k] !== "number" || isNaN(score[k])) {
      score[k] = 50;
    }
    score[k] = Math.max(0, Math.min(100, Math.round(score[k])));
  }

  return score;
}

/**
 * 角色一致性评分 — 对比生成图与参考图
 */
export async function scoreCharacterConsistency(
  imagePath: string,
  referencePath: string,
  _prompt?: string,
): Promise<AIScoreResult> {
  return scoreDualImage(imagePath, referencePath, CHARACTER_CONSISTENCY_PROMPT);
}

/**
 * 深度准确度评分 — 对比场景图与深度图
 */
export async function scoreDepthAccuracy(
  imagePath: string,
  depthImagePath: string,
  _prompt?: string,
): Promise<AIScoreResult> {
  return scoreDualImage(imagePath, depthImagePath, DEPTH_ACCURACY_PROMPT);
}

/**
 * 超分质量评分 — 对比原图与超分图
 */
export async function scoreUpscaleQuality(
  originalPath: string,
  upscaledPath: string,
): Promise<AIScoreResult> {
  return scoreDualImage(originalPath, upscaledPath, UPSCALE_QUALITY_PROMPT);
}
