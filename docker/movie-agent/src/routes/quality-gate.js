/**
 * Quality Gate Routes — 质量闸门 API
 *
 * POST /api/v1/quality-gate/trigger        触发闸门
 * GET  /api/v1/quality-gate/:phase_id/result  获取结果
 */

const QG_PREFIX = '/api/v1/quality-gate';

/** @type {Map<string, object>} gate_id → result */
const gateResults = new Map();

export async function qualityGateRouter(req, res) {
  const { method } = req;
  const path = req._path;

  if (!path.startsWith(QG_PREFIX + '/')) return false;

  // POST /api/v1/quality-gate/trigger
  if (method === 'POST' && path === `${QG_PREFIX}/trigger`) {
    const body = await req._parseBody();
    if (!body.pipeline_id || !body.phase) {
      return res._error('pipeline_id and phase are required', 400);
    }

    const gateId = `gate_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // 存储初始状态
    gateResults.set(gateId, {
      gate_id: gateId,
      pipeline_id: body.pipeline_id,
      phase: body.phase,
      status: 'evaluating',
      triggered_at: new Date().toISOString(),
    });

    // 异步执行评估（当前 mock，后续接入 QualityGateV2）
    _evaluateGate(gateId, body).catch(err => {
      const entry = gateResults.get(gateId);
      if (entry) {
        entry.status = 'failed';
        entry.error = err.message;
      }
    });

    return res._json({
      gate_id: gateId,
      status: 'evaluating',
      pipeline_id: body.pipeline_id,
      phase: body.phase,
    }, 202);
  }

  // GET /api/v1/quality-gate/:phase_id/result?pipeline_id=xxx
  if (method === 'GET' && path.startsWith(`${QG_PREFIX}/`) && path.endsWith('/result')) {
    const phaseId = path.slice(`${QG_PREFIX}/`.length, -'/result'.length);
    const pipelineId = req._url.searchParams.get('pipeline_id');

    if (!pipelineId) return res._error('pipeline_id query param is required', 400);

    // 查找匹配的 gate result
    for (const [, result] of gateResults) {
      if (result.pipeline_id === pipelineId && result.phase === phaseId) {
        return res._json(result);
      }
    }

    return res._error('Gate result not found', 404);
  }

  return false;
}

/**
 * Mock 闸门评估 — 自动通过
 * 后续替换为 QualityGateV2 三级闸门
 */
async function _evaluateGate(gateId, body) {
  const entry = gateResults.get(gateId);
  if (!entry) return;

  // Simulate evaluation delay
  await new Promise(r => setTimeout(r, 1000));

  entry.status = 'passed';
  entry.scores = {
    overall: 85,
    aesthetics: 88,
    consistency: 82,
    compliance: 90,
    technical_quality: 80,
  };
  entry.decision = 'approved';
  entry.checked_at = new Date().toISOString();
}
