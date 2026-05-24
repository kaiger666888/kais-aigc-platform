/**
 * Pipeline Routes — 管线生命周期 API
 *
 * POST   /api/v1/pipeline/create         创建管线
 * POST   /api/v1/pipeline/:id/start       启动管线
 * POST   /api/v1/pipeline/:id/resume      恢复管线
 * GET    /api/v1/pipeline/:id/status      查询状态
 * GET    /api/v1/pipeline/:id/phases      获取 Phase 列表
 * POST   /api/v1/pipeline/:id/cancel      取消管线
 */

const PIPELINE_PREFIX = '/api/v1/pipeline';

export async function pipelineRouter(req, res) {
  const { method } = req;
  const path = req._path;

  // POST /api/v1/pipeline/create
  if (method === 'POST' && path === `${PIPELINE_PREFIX}/create`) {
    const body = await req._parseBody();
    if (!body.project_id) return res._error('project_id is required', 400);
    if (!body.config?.phases?.length) return res._error('config.phases is required', 400);

    try {
      const result = req._ctx.manager.create(body.project_id, body.config, body.metadata || {});
      return res._json(result, 201);
    } catch (err) {
      return res._error(err.message, 400);
    }
  }

  // All :id routes — extract id from path
  if (!path.startsWith(`${PIPELINE_PREFIX}/`)) return false;

  // Match /api/v1/pipeline/:id/:action or /api/v1/pipeline/:id/phases
  const suffix = path.slice(PIPELINE_PREFIX.length + 1);
  const parts = suffix.split('/');
  if (parts.length < 1) return false;

  const pipelineId = parts[0];
  const action = parts[1] || '';

  // POST /api/v1/pipeline/:id/start
  if (method === 'POST' && action === 'start') {
    try {
      const body = await req._parseBody();
      const result = await req._ctx.manager.start(pipelineId, body || {});
      return res._json(result, 202);
    } catch (err) {
      return res._error(err.message, err.status || 400);
    }
  }

  // POST /api/v1/pipeline/:id/resume
  if (method === 'POST' && action === 'resume') {
    try {
      const body = await req._parseBody();
      const result = await req._ctx.manager.resume(pipelineId, body || {});
      return res._json(result, 202);
    } catch (err) {
      return res._error(err.message, err.status || 400);
    }
  }

  // POST /api/v1/pipeline/:id/cancel
  if (method === 'POST' && action === 'cancel') {
    try {
      const body = await req._parseBody();
      const result = await req._ctx.manager.cancel(pipelineId, body?.reason);
      return res._json(result);
    } catch (err) {
      return res._error(err.message, err.status || 400);
    }
  }

  // GET /api/v1/pipeline/:id/status
  if (method === 'GET' && action === 'status') {
    const result = req._ctx.manager.getStatus(pipelineId);
    if (!result) return res._error('Pipeline not found', 404);
    return res._json(result);
  }

  // GET /api/v1/pipeline/:id/phases
  if (method === 'GET' && action === 'phases') {
    const result = req._ctx.manager.getPhases(pipelineId);
    if (!result) return res._error('Pipeline not found', 404);
    return res._json(result);
  }

  return false;
}
