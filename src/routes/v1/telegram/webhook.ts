import express from "express";
import { handleReviewCallback } from "@/lib/telegram-review";

const router = express.Router();

/**
 * POST /api/v1/telegram/webhook
 *
 * Receives updates (callback_query, message, etc.) from the Telegram
 * Bot API via webhook.
 *
 * For now we only handle callback_query events whose data starts with
 * "review:" — all other updates are silently acknowledged.
 */
router.post("/", async (req, res) => {
  const update = req.body;

  // Acknowledge immediately — Telegram expects a 200 within 60s
  res.sendStatus(200);

  // Handle callback_query (inline button presses)
  if (update.callback_query) {
    try {
      await handleReviewCallback(update.callback_query);
    } catch (err) {
      console.error("[telegram-webhook] callback error:", err);
    }
    return;
  }

  // Future: handle regular messages, commands, etc.
});

export default router;
