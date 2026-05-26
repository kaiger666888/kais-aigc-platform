/**
 * CoreBackendClient — 管线回调客户端
 *
 * movie-agent 在每个 phase 完成后，通过此客户端通知 core-backend。
 * core-backend 将产出物写入 Toonflow SQLite，前端自动显示。
 */

export class CoreBackendClient {
  /**
   * @param {object} options
   * @param {string} [options.baseUrl] - core-backend URL (或 CORE_BACKEND_URL env)
   */
  constructor({ baseUrl = process.env.CORE_BACKEND_URL || 'http://core-backend:8000' } = {}) {
    this._baseUrl = baseUrl.replace(/\/$/, '');
  }

  /**
   * 通知 core-backend 某阶段已完成
   * @param {string} pipelineId
   * @param {number} projectId
   * @param {string} phase - 阶段名
   * @param {number} [phaseOrder] - 阶段序号
   * @param {string} status - "completed" | "failed"
   * @param {Array}  [outputs=[]] - 产出物列表
   * @param {object} [summary={}]
   */
  async notifyPhaseComplete(pipelineId, projectId, phase, { phaseOrder = 0, status = 'completed', outputs = [], summary = {} } = {}) {
    const url = `${this._baseUrl}/api/v1/pipeline/callback/phase-complete`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pipelineId, projectId, phase, phaseOrder, status, outputs, summary }),
      });
      if (!res.ok) {
        const text = await res.text();
        console.error(`[core-backend-client] phase-complete failed (${res.status}): ${text}`);
      }
    } catch (err) {
      console.error(`[core-backend-client] phase-complete error: ${err.message}`);
    }
  }

  /**
   * 通知 core-backend 阶段进度更新
   * @param {string} pipelineId
   * @param {number} projectId
   * @param {string} phase
   * @param {number} progress - 0-100
   * @param {string} [message]
   */
  async notifyProgress(pipelineId, projectId, phase, progress, message = '') {
    const url = `${this._baseUrl}/api/v1/pipeline/callback/phase-progress`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pipelineId, projectId, phase, progress, message }),
      });
      if (!res.ok) {
        const text = await res.text();
        console.error(`[core-backend-client] progress failed (${res.status}): ${text}`);
      }
    } catch (err) {
      console.error(`[core-backend-client] progress error: ${err.message}`);
    }
  }

  /**
   * 通知管线已全部完成
   * @param {string} pipelineId
   * @param {number} projectId
   * @param {object} [result]
   */
  async notifyPipelineCompleted(pipelineId, projectId, result = {}) {
    return this.notifyPhaseComplete(pipelineId, projectId, 'delivery', {
      phaseOrder: 99,
      status: 'completed',
      outputs: [],
      summary: result,
    });
  }
}
