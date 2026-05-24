/**
 * Health Route — 服务健康探测
 *
 * GET /health
 */

import { getDownstreamHealth } from '../skills/router.js';

export async function healthRouter(req, res) {
  if (req.method !== 'GET' || req._path !== '/health') return false;

  // 检查下游服务（非阻塞，超时 5s）
  let downstream = {};
  try {
    downstream = await Promise.race([
      getDownstreamHealth(),
      new Promise(r => setTimeout(() => r({}), 5000)),
    ]);
  } catch {
    downstream = {};
  }

  return res._json({
    status: 'ok',
    version: '6.0.0',
    uptime_sec: Math.round(process.uptime()),
    downstream,
  });
}
