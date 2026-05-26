/**
 * Health Route — 服务健康探测
 *
 * GET /health
 * GET /api/v1/pipeline/health
 */

import { getDownstreamHealth } from '../skills/router.js';
import { callLLM } from '../../lib/llm.js';

export async function healthRouter(req, res) {
  // GET /api/v1/pipeline/health — pipeline 子系统状态
  if (req.method === 'GET' && req._path === '/api/v1/pipeline/health') {
    const checks = {
      llm: { status: 'unknown' },
      gold_team: { status: 'unknown' },
      review_platform: { status: 'unknown' },
    };

    // Check LLM availability
    const apiKey = process.env.ZHIPU_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      checks.llm = { status: 'degraded', detail: 'no API key configured (ZHIPU_API_KEY or OPENAI_API_KEY)' };
    } else {
      try {
        const response = await callLLM('回复OK', { temperature: 0 }).catch(() => null);
        checks.llm = response
          ? { status: 'ok', detail: 'LLM responded' }
          : { status: 'degraded', detail: 'LLM call returned empty' };
      } catch (err) {
        checks.llm = { status: 'error', detail: err.message };
      }
    }

    // Check gold-team
    const goldTeamUrl = process.env.GOLD_TEAM_URL || 'http://gold-team:8002';
    try {
      const r = await fetch(`${goldTeamUrl}/health`, { signal: AbortSignal.timeout(5000) });
      checks.gold_team = r.ok
        ? { status: 'ok', url: goldTeamUrl }
        : { status: 'error', url: goldTeamUrl, detail: `HTTP ${r.status}` };
    } catch (err) {
      checks.gold_team = { status: 'unreachable', url: goldTeamUrl, detail: err.message };
    }

    // Check review-platform
    const reviewUrl = process.env.REVIEW_PLATFORM_URL || 'http://review-platform:8090';
    try {
      const r = await fetch(`${reviewUrl}/health`, { signal: AbortSignal.timeout(5000) });
      checks.review_platform = r.ok
        ? { status: 'ok', url: reviewUrl }
        : { status: 'error', url: reviewUrl, detail: `HTTP ${r.status}` };
    } catch (err) {
      checks.review_platform = { status: 'unreachable', url: reviewUrl, detail: err.message };
    }

    const allOk = Object.values(checks).every(c => c.status === 'ok' || c.status === 'degraded');
    res._json({ status: allOk ? 'ok' : 'degraded', checks }, allOk ? 200 : 207);
    return true;
  }

  // GET /health
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

  res._json({
    status: 'ok',
    version: '6.0.0',
    uptime_sec: Math.round(process.uptime()),
    downstream,
  });
  return true;
}
