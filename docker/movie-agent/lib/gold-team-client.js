/**
 * GoldTeamClient — GPU 任务调度客户端
 *
 * 调用 gold-team Control Node REST API 提交/查询 GPU 任务。
 * 认证: X-API-Key header
 * 回调签名: HMAC-SHA256
 *
 * 参考: review-platform-client.js, jimeng-client.js
 */

import { sign as hmacSign, verify as hmacVerify } from '../shared/hmac_node.js';

export class GoldTeamError extends Error {
  constructor(message, { task = null, status = null } = {}) {
    super(message);
    this.name = 'GoldTeamError';
    this.task = task;
    this.status = status;
  }
}

export class GoldTeamClient {
  /**
   * @param {object} options
   * @param {string} [options.baseUrl] - Gold-team Control Node URL (或 GOLD_TEAM_URL env)
   * @param {string} [options.apiKey] - API key (或 GOLD_TEAM_API_KEY env)
   * @param {number} [options.timeout=60000] - 请求超时 ms（GPU 任务可能较长）
   * @param {string} [options.callbackBaseUrl] - 回调基础 URL (或 CALLBACK_BASE_URL env)
   */
  constructor({
    baseUrl = process.env.GOLD_TEAM_URL || 'http://192.168.71.166:8900',
    apiKey = process.env.GOLD_TEAM_API_KEY || '',
    timeout = 60000,
    callbackBaseUrl = process.env.CALLBACK_BASE_URL || 'http://192.168.71.140:3000',
    traceId = '',
  } = {}) {
    this._baseUrl = baseUrl.replace(/\/$/, '');
    this._apiKey = apiKey;
    this._timeout = timeout;
    this._callbackBaseUrl = callbackBaseUrl;
    this._callbackSecret = process.env.HMAC_SECRET_MA_GT || '';
    this._traceId = traceId;
  }

  /**
   * 提交 GPU 任务
   * @param {object} options
   * @param {string} options.taskType - 任务类型 (如 "tts_generation")
   * @param {object} options.params - 任务参数
   * @param {Array}  [options.assets=[]] - 输入资产
   * @param {number} [options.priority=5] - 优先级 1-10
   * @param {string} [options.description] - 描述
   * @param {string} [options.callbackPath] - 自定义回调路径
   * @returns {Promise<{taskId: string, state: string, createdAt: string}>}
   */
  async submitTask({ taskType, params, assets = [], priority = 5, description, callbackPath }) {
    const callbackUrl = callbackPath
      ? `${this._callbackBaseUrl}${callbackPath}`
      : `${this._callbackBaseUrl}/callback/gpu-task`;

    const taskId = `ma-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const body = {
      task_id: taskId,
      // task_type removed for V6
      type: taskType, // gold-team v2 expects 'type'
      params,
      assets,
      priority,
      description,
      callback_url: callbackUrl,
      callback_secret: this._callbackSecret,
      model_preference: 'local',
      priority: priority === 5 ? 'normal' : (typeof priority === 'number' ? 'normal' : priority),
    };

    const result = await this._request('POST', '/api/v1/tasks', body);
    return {
      taskId: result.data?.task_id || result.task_id || taskId,
      state: result.data?.status || result.status || 'submitted',
      createdAt: result.data?.created_at || result.created_at || new Date().toISOString(),
    };
  }

  /**
   * 查询任务状态
   * @param {string} taskId
   * @returns {Promise<object>} 任务详情
   */
  async getTask(taskId) {
    const result = await this._request('GET', `/api/v1/tasks/${taskId}`);
    return result.data || result;
  }

  /**
   * 查询任务列表
   * @param {object} [options]
   * @param {string} [options.state] - 按状态过滤
   * @param {string} [options.taskType] - 按任务类型过滤
   * @param {number} [options.limit=20]
   * @param {number} [options.offset=0]
   */
  async listTasks({ state, taskType, limit = 20, offset = 0 } = {}) {
    const params = new URLSearchParams({ limit, offset });
    if (state) params.set('state', state);
    // task_type param removed for V6
    const result = await this._request('GET', `/api/v1/tasks?${params}`);
    return result.data || result;
  }

  /**
   * 等待任务完成（轮询）
   * @param {string} taskId
   * @param {object} [options]
   * @param {number} [options.pollIntervalMs=5000]
   * @param {number} [options.timeoutMs=600000] - 10min 默认超时
   * @returns {Promise<object>} 完成后的任务详情
   */
  async waitForTask(taskId, { pollIntervalMs = 5000, timeoutMs = 600000 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const task = await this.getTask(taskId);
      const status = task.status || task.state || '';
      if (status === 'done' || status === 'completed') return task;
      if (status === 'failed') {
        throw new GoldTeamError(`GPU 任务失败: ${task.error}`, { task });
      }
      await new Promise(r => setTimeout(r, pollIntervalMs));
    }
    throw new GoldTeamError(`GPU 任务超时: ${taskId}`);
  }

  /**
   * 提交 TTS 语音合成任务（快捷方法）
   * @param {string} text - 要合成的文本
   * @param {object} [options]
   * @param {string} [options.voiceId='Vivian'] - 语音 ID
   * @param {string} [options.language='zh'] - 语言
   * @param {string} [options.outputFormat='wav'] - 输出格式
   */
  async submitTTS(text, { voiceId = 'Vivian', language = 'zh', outputFormat = 'wav', ...rest } = {}) {
    return this.submitTask({
      taskType: 'tts',
      params: {
        text,
        output_format: outputFormat,
        extra: { tts: { model_id: 'default', voice_id: voiceId, language } },
      },
      description: `TTS: ${text.substring(0, 50)}...`,
      ...rest,
    });
  }

  /**
   * 验证回调签名
   * @param {string|Buffer} body - 原始请求 body
   * @param {string} headerValue - X-HMAC-Signature header 值
   * @returns {boolean}
   */
  verifyCallback(body, headerValue) {
    return hmacVerify(body, this._callbackSecret, headerValue);
  }

  /**
   * 提交 GPU 任务（带降级）
   * gold-team 不可用时返回降级结果，不抛错。
   * @param {object} options - 同 submitTask
   * @returns {Promise<{taskId: string|null, state: string, degraded?: boolean}>}
   */
  async submitTaskDegraded(options) {
    try {
      return await this.submitTask(options);
    } catch (err) {
      console.warn(`[GoldTeamClient] GPU 服务不可用, 降级跳过: ${err.message}`);
      this._logDegraded({ taskType: options.taskType, reason: err.message });
      return {
        taskId: null,
        state: 'DEGRADED_SKIPPED',
        degraded: true,
        reason: err.message,
      };
    }
  }

  /**
   * 提交 TTS 任务（带降级）— gold-team 不可用时跳过
   * @param {string} text
   * @param {object} [options] - 同 submitTTS
   * @returns {Promise<{taskId: string|null, state: string, degraded?: boolean}>}
   */
  async submitTTSDegraded(text, options = {}) {
    return this.submitTaskDegraded({
      taskType: 'tts',
      params: {
        text,
        output_format: options.outputFormat || 'wav',
        extra: { tts: { model_id: 'default', voice_id: options.voiceId || 'Vivian', language: options.language || 'zh' } },
      },
      description: `TTS: ${text.substring(0, 50)}...`,
      ...options,
    });
  }

  /**
   * 记录降级审计日志
   */
  _logDegraded({ taskType, reason }) {
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      event: 'gpu_task_degraded',
      taskType,
      reason,
    }));
  }

  /**
   * 健康检查
   * @param {number} [timeoutMs=5000]
   * @returns {Promise<boolean>}
   */
  async ping(timeoutMs = 5000) {
    try {
      const resp = await fetch(`${this._baseUrl}/health`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  // --- 内部方法 ---

  async _request(method, path, body = null) {
    const url = `${this._baseUrl}${path}`;
    const headers = {
      'Content-Type': 'application/json',
      'X-API-Key': this._apiKey,
    };
    if (this._traceId) headers['X-Trace-Id'] = this._traceId;

    const options = {
      method,
      headers,
      signal: AbortSignal.timeout(this._timeout),
    };
    if (body) options.body = JSON.stringify(body);

    try {
      const resp = await fetch(url, options);

      const text = await resp.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new GoldTeamError(`Invalid JSON response: ${text.substring(0, 200)}`, { status: resp.status });
      }

      if (resp.status >= 400) {
        throw new GoldTeamError(`HTTP ${resp.status}: ${text.substring(0, 200)}`, { status: resp.status });
      }

      return parsed;
    } catch (err) {
      if (err instanceof GoldTeamError) throw err;
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        throw new GoldTeamError(`请求超时: ${method} ${path}`);
      }
      throw new GoldTeamError(`请求失败: ${err.message}`);
    }
  }
}

export default GoldTeamClient;
