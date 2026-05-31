/**
 * AI 图片评分器 — 调用智谱 GLM-4V-Flash 对图片进行 5 维度评分
 */
import u from "@/utils";

const ZHIPU_API_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const ZHIPU_API_KEY = process.env.ZHIPU_API_KEY || "";

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
    imageBuffer = await u.readBinary(filePath);
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
 * 调用 GLM-4V-Flash 评分
 */
export async function scoreImage(imagePath: string, _prompt?: string): Promise<AIScoreResult> {
  const { base64, mimeType } = await imageToBase64(imagePath);

  const body = {
    model: "glm-4v-flash",
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

  const res = await fetch(ZHIPU_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ZHIPU_API_KEY}`,
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
