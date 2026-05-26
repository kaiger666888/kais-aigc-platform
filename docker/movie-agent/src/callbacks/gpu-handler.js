/**
 * GPU Callback Handler — 处理 gold-team 生成完成回调
 *
 * 验证 HMAC 签名，更新管线状态，通知等待中的管线。
 */

import { createHmac } from 'node:crypto';

const GPU_HMAC_SECRET = process.env.HMAC_SECRET_MA_GT || '';

/**
 * 验证 GPU 回调 HMAC 签名
 */
function verifyGpuHmac(bodyStr, signature) {
  if (!GPU_HMAC_SECRET) return true; // Dev mode
  const expected = createHmac('sha256', GPU_HMAC_SECRET).update(bodyStr).digest('hex');
  return `sha256=${expected}` === signature;
}

/**
 * 处理 GPU 任务回调
 * @param {import('../pipeline/state-machine.js').PipelineManager} manager
 * @param {object} body - 回调数据
 */
export async function handleGpuCallback(manager, body) {
  const { task_id, status, outputs, error, metadata } = body;

  if (!task_id) throw new Error('task_id is required');
  if (!status) throw new Error('status is required');

  console.log(JSON.stringify({
    event: 'gpu_callback_received',
    task_id,
    status,
    ts: new Date().toISOString(),
  }));

  // 查找关联管线
  const mapping = manager.findByTaskId(task_id);
  if (!mapping) {
    console.warn(`[GPU Callback] Unknown task: ${task_id}`);
    return { message: `Task ${task_id} not tracked` };
  }

  const { pipelineId, phaseId } = mapping;

  if (status === 'completed' && outputs) {
    console.log(`[GPU Callback] Task ${task_id} completed for pipeline=${pipelineId} phase=${phaseId}`);

    // 更新管线状态（后续可通知 worker thread）
    const entry = manager._get(pipelineId);
    if (entry) {
      // Store output references for the phase
      if (!entry.gpuOutputs) entry.gpuOutputs = new Map();
      entry.gpuOutputs.set(task_id, { outputs, metadata });
    }
  } else if (status === 'failed') {
    console.warn(`[GPU Callback] Task ${task_id} failed: ${error || 'unknown'}`);
  }

  return { pipeline_id: pipelineId, phase: phaseId, acknowledged: true };
}

/**
 * 验证签名（由 route 层调用，传入原始 body 字符串）
 */
export function verifySignature(bodyStr, signature) {
  return verifyGpuHmac(bodyStr, signature);
}
