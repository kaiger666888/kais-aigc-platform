/**
 * Telegram Review — send review cards with inline buttons and handle callbacks.
 *
 * Uses the Telegram Bot API directly (axios) so the platform stays
 * independent of any specific bot framework.
 */
import axios from "axios";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const CALLBACK_BASE_URL = process.env.CALLBACK_BASE_URL || "http://localhost:3000";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReviewCardData {
  /** Unique review card id returned by the review-platform */
  reviewId: string;
  /** Pipeline run id */
  pipelineId: string;
  /** Shot identifier */
  shotId: string;
  /** Pipeline phase under review */
  phase: string;
  /** URL of the rendered asset */
  assetUrl?: string;
  /** Optional thumbnail */
  thumbnailUrl?: string;
  /** Optional AI scores summary */
  aiScores?: Record<string, number>;
  /** 对比图 B 的 URL */
  compareAssetUrl?: string;
  /** 区分类型 */
  assetType?: "image" | "video" | "compare";
  /** 多选选项 */
  variantOptions?: Array<{
    id: string;
    label: string;
    url: string;
  }>;
  /** 评分类型 */
  scoreType?: "general" | "character" | "depth" | "upscale";
}

export type ReviewAction = "approve" | "reject" | "revise" | "select";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildScoreLine(scores?: Record<string, number>): string {
  if (!scores) return "";
  const lines = Object.entries(scores)
    .map(([k, v]) => `  ${k}: ${v}/10`)
    .join("\n");
  return `\n📊 AI Scores:\n${lines}`;
}

function escapeMarkdown(text: string): string {
  // Telegram MarkdownV2 escape — only escape required chars
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

// ---------------------------------------------------------------------------
// sendReviewCard
// ---------------------------------------------------------------------------

/**
 * Send a Telegram message with inline review buttons to the given chat.
 *
 * callback_data format: `review:{action}:{pipelineId}:{phase}:{reviewId}`
 * — kept under 64 bytes (Telegram limit).
 */
export async function sendReviewCard(
  chatId: string | number,
  data: ReviewCardData,
): Promise<{ messageId: number }> {
  const { reviewId, pipelineId, shotId, phase, assetUrl, aiScores } = data;

  const text =
    `🎬 *审核请求*\n\n` +
    `阶段: \`${phase}\`\n` +
    `Shot: \`${shotId}\`\n` +
    `Pipeline: \`${pipelineId}\`\n` +
    `Review: \`${reviewId}\`` +
    (assetUrl ? `\n\n🔗 [查看产出物](${assetUrl})` : "") +
    buildScoreLine(aiScores) +
    `\n\n请选择操作:`;

  // Encode callback_data — max 64 bytes
  const cb = (action: ReviewAction) =>
    `review:${action}:${pipelineId}:${phase}:${reviewId}`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: "✅ 通过", callback_data: cb("approve") },
        { text: "🔄 重做", callback_data: cb("reject") },
        { text: "✏️ 修改", callback_data: cb("revise") },
      ],
    ],
  };

  const res = await axios.post(`${TELEGRAM_API}/sendMessage`, {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
    reply_markup: keyboard,
  });

  return { messageId: res.data.result?.message_id };
}

// ---------------------------------------------------------------------------
// answerCallbackQuery
// ---------------------------------------------------------------------------

async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
): Promise<void> {
  await axios.post(`${TELEGRAM_API}/answerCallbackQuery`, {
    callback_query_id: callbackQueryId,
    text: text || "已处理",
  });
}

// ---------------------------------------------------------------------------
// editMessageText
// ---------------------------------------------------------------------------

async function editMessageText(
  chatId: string | number,
  messageId: number,
  newText: string,
): Promise<void> {
  await axios.post(`${TELEGRAM_API}/editMessageText`, {
    chat_id: chatId,
    message_id: messageId,
    text: newText,
    parse_mode: "Markdown",
  }).catch(() => {
    // editMessageText may fail if content unchanged — safe to ignore
  });
}

// ---------------------------------------------------------------------------
// handleReviewCallback
// ---------------------------------------------------------------------------

/**
 * Parse a Telegram callback_query whose data follows the
 * `review:{action}:{pipelineId}:{phase}:{reviewId}` convention,
 * call the internal review-result API, and update the message.
 */
export async function handleReviewCallback(
  callbackQuery: any,
): Promise<void> {
  const data: string = callbackQuery.data || "";
  const chatId = callbackQuery.message?.chat?.id;
  const messageId = callbackQuery.message?.message_id;
  const queryId = callbackQuery.id;

  // Parse callback_data
  const parts = data.split(":");
  if (parts[0] !== "review" || parts.length < 5) {
    await answerCallbackQuery(queryId, "⚠️ 无效的回调数据");
    return;
  }

  const [, actionStr, pipelineId, phase, reviewId] = parts as [
    string,
    ReviewAction,
    string,
    string,
    string,
  ];

  // Map UI action to API action
  const actionMap: Record<string, string> = {
    approve: "approve",
    reject: "reject",
    revise: "revise",
    select: "select",
  };
  const apiAction = actionMap[actionStr];
  if (!apiAction) {
    await answerCallbackQuery(queryId, "⚠️ 未知操作");
    return;
  }

  const actionLabel: Record<string, string> = {
    approve: "✅ 已通过",
    reject: "🔄 重做",
    revise: "✏️ 修改",
  };

  try {
    // Call internal review-result endpoint
    await axios.post(
      `${CALLBACK_BASE_URL}/api/v1/pipeline/callback/review-result`,
      {
        reviewId,
        pipelineId,
        shotId: `shot-from-${pipelineId}`, // fallback; real shotId stored in pipeline
        phase,
        action: apiAction,
      },
      { timeout: 10_000 },
    );

    // Update the original message
    if (chatId && messageId) {
      await editMessageText(
        chatId,
        messageId,
        `🎬 审核 — ${phase}\n\n${actionLabel[actionStr]}\nPipeline: \`${pipelineId}\``,
      );
    }

    await answerCallbackQuery(queryId, actionLabel[actionStr]);
  } catch (err: any) {
    const msg = err.response?.data?.message || err.message || String(err);
    console.error("[telegram-review] callback error:", msg);
    await answerCallbackQuery(queryId, `❌ 处理失败: ${msg.slice(0, 100)}`);
  }
}

// ---------------------------------------------------------------------------
// sendCompareReviewCard — AB 对比审核
// ---------------------------------------------------------------------------

/**
 * 发送对比审核卡片（AB对比）
 * 发送两张图 + approve(选A) / select(选B) / reject(都不选)
 */
export async function sendCompareReviewCard(card: ReviewCardData): Promise<void> {
  const { reviewId, shotId, phase, assetUrl, compareAssetUrl, pipelineId } = card;
  if (!assetUrl || !compareAssetUrl) throw new Error("对比审核需要两张图");

  const chatId = process.env.TELEGRAM_REVIEW_CHAT_ID;
  if (!chatId) throw new Error("TELEGRAM_REVIEW_CHAT_ID not set");

  // 发送 media_group（两张图）
  await axios.post(`${TELEGRAM_API}/sendMediaGroup`, {
    chat_id: chatId,
    media: [
      { type: "photo", media: assetUrl, caption: "A: 原始" },
      { type: "photo", media: compareAssetUrl, caption: "B: 变体" },
    ],
  });

  // 发送 inline buttons
  const replyMarkup = {
    inline_keyboard: [
      [
        { text: "✅ 选 A", callback_data: `review:approve:${pipelineId}:${phase}:${reviewId}` },
        { text: "🔄 选 B", callback_data: `review:select:${pipelineId}:${phase}:${reviewId}` },
        { text: "❌ 都不要", callback_data: `review:reject:${pipelineId}:${phase}:${reviewId}` },
      ],
    ],
  };
  await axios.post(`${TELEGRAM_API}/sendMessage`, {
    chat_id: chatId,
    text: `📋 对比审核 [${phase}] shot: ${shotId}`,
    reply_markup: replyMarkup,
  });
}

// ---------------------------------------------------------------------------
// sendVariantReviewCard — 多选审核
// ---------------------------------------------------------------------------

/**
 * 发送多选审核卡片（IPAdapter 多视角选一）
 * 发送多张图 + 每张一个"选择"按钮
 */
export async function sendVariantReviewCard(card: ReviewCardData): Promise<void> {
  const { reviewId, shotId, phase, variantOptions, pipelineId } = card;
  const chatId = process.env.TELEGRAM_REVIEW_CHAT_ID;

  // 发送所有变体图
  if (variantOptions && variantOptions.length > 0) {
    const media = variantOptions.slice(0, 10).map((opt, i) => ({
      type: "photo" as const,
      media: opt.url,
      caption: `V${i + 1}: ${opt.label}`,
    }));
    await axios.post(`${TELEGRAM_API}/sendMediaGroup`, { chat_id: chatId, media });
  }

  // inline keyboard: 一行一个选项
  const buttons: Array<Array<{ text: string; callback_data: string }>> =
    variantOptions?.slice(0, 9).map((opt, i) => [
      { text: `✅ 选 V${i + 1}: ${opt.label}`, callback_data: `review:select:${pipelineId}:${phase}:${reviewId}` },
    ]) || [];
  buttons.push([{ text: "❌ 都不要", callback_data: `review:reject:${pipelineId}:${phase}:${reviewId}` }]);

  await axios.post(`${TELEGRAM_API}/sendMessage`, {
    chat_id: chatId,
    text: `📋 多选审核 [${phase}] shot: ${shotId}`,
    reply_markup: { inline_keyboard: buttons },
  });
}
