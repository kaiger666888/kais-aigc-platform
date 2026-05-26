/**
 * Callback Routes — 回调接收端点
 *
 * POST /api/v1/callbacks/gpu-task   gold-team 生成完成回调
 * POST /api/v1/callbacks/review     review-platform 审核回调
 */

import { handleGpuCallback } from '../callbacks/gpu-handler.js';
import { handleReviewCallback } from '../callbacks/review-handler.js';

const CALLBACKS_PREFIX = '/api/v1/callbacks';

export async function callbacksRouter(req, res) {
  const { method } = req;
  const path = req._path;

  if (method !== 'POST' || !path.startsWith(CALLBACKS_PREFIX + '/')) return false;

  const action = path.slice(CALLBACKS_PREFIX.length + 1);

  // POST /api/v1/callbacks/gpu-task
  if (action === 'gpu-task') {
    try {
      const body = await req._parseBody();
      const result = await handleGpuCallback(req._ctx.manager, body);
      return res._json({ ok: true, ...result });
    } catch (err) {
      return res._json({ ok: false, error: err.message }, 400);
    }
  }

  // POST /api/v1/callbacks/review
  if (action === 'review') {
    try {
      const body = await req._parseBody();
      const result = await handleReviewCallback(req._ctx.manager, body);
      return res._json({ ok: true, ...result });
    } catch (err) {
      return res._json({ ok: false, error: err.message }, 400);
    }
  }

  return false;
}
