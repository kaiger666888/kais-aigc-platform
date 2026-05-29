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
}

export type ReviewAction = "approve" | "reject" | "revise";

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
