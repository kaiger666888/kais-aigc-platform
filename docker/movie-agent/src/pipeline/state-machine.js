/**
 * Pipeline Manager — 管线状态机
 *
 * 管理 Pipeline 实例的创建、启动、恢复、取消、状态查询。
 * 将 V6.0 Phase 0~7 映射到现有 11 Phase system。
 * 复用 lib/pipeline.js 的 Pipeline 类，不修改原逻辑。
 */

import { Pipeline } from '../../lib/pipeline.js';
import { PHASES_V6, mapV6ToLegacy, PHASES_ORDER } from './phase-registry.js';

export class PipelineManager {
  constructor() {
    /** @type {Map<string, {pipeline: Pipeline, status: string, config: object, job: object|null}>} */
    this.pipelines = new Map();
    /** @type {Map<string, string>} — taskId → pipelineId mapping for callbacks */
    this.taskIndex = new Map();
  }

  /**
   * 创建新管线实例
   */
  create(projectId, config = {}, metadata = {}) {
    const pipelineId = `pipe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const workdir = config.workdir || `/tmp/movie-agent/${pipelineId}`;

    const pipeline = new Pipeline({
      workdir,
      episode: metadata.episode || projectId,
      config: config.config || config.projectConfig || {},
      traceId: pipelineId,
    });

    const entry = {
      pipelineId,
      projectId,
      pipeline,
      status: 'pending',
      v6Config: config,
      metadata,
      workdir,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      phases: PHASES_V6.map(p => ({
        id: p.id,
        name: p.name,
        status: 'pending',
      })),
      currentPhase: null,
      job: null,
    };

    this.pipelines.set(pipelineId, entry);
    return this._summarize(entry);
  }

  /**
   * 启动管线
   */
  async start(pipelineId, options = {}) {
    const entry = this._get(pipelineId);
    if (!entry) throw new Error(`Pipeline not found: ${pipelineId}`);
    if (entry.status === 'running') {
      const err = new Error('Pipeline already running');
      err.status = 409;
      throw err;
    }

    entry.status = 'running';
    entry.updatedAt = new Date().toISOString();

    // 确定 V6 起始 phase
    const fromPhase = options.from_phase || 'requirement';
    const v6Phase = PHASES_V6.find(p => p.id === fromPhase);
    if (!v6Phase) throw new Error(`Unknown phase: ${fromPhase}`);

    entry.currentPhase = fromPhase;
    const startIdx = PHASES_V6.indexOf(v6Phase);

    // 标记之前的 phase 为 completed
    for (let i = 0; i < startIdx; i++) {
      entry.phases[i].status = 'completed';
    }
    entry.phases[startIdx].status = 'running';

    // 异步执行管线
    this._runPipeline(entry, startIdx);

    return this._summarize(entry);
  }

  /**
   * 异步执行管线（非阻塞）
   */
  async _runPipeline(entry, startIdx) {
    try {
      for (let i = startIdx; i < PHASES_V6.length; i++) {
        const v6Phase = PHASES_V6[i];
        entry.currentPhase = v6Phase.id;
        entry.phases[i].status = 'running';
        entry.updatedAt = new Date().toISOString();

        // 执行该 V6 Phase 对应的 legacy stages
        const legacyStages = v6Phase.stages;
        for (const stageId of legacyStages) {
          // Pass pipeline config so phase handlers can read requirement data
          const phaseConfig = this._buildPhaseConfig(entry, stageId);
          await entry.pipeline.runPhase(stageId, phaseConfig);
        }

        entry.phases[i].status = 'completed';
        entry.updatedAt = new Date().toISOString();
      }

      entry.status = 'completed';
      entry.currentPhase = null;
      entry.updatedAt = new Date().toISOString();
    } catch (err) {
      entry.status = 'failed';
      const failedPhaseIdx = PHASES_V6.findIndex(p => p.id === entry.currentPhase);
      if (failedPhaseIdx >= 0) {
        entry.phases[failedPhaseIdx].status = 'failed';
        entry.phases[failedPhaseIdx].error = err.message;
      }
      entry.updatedAt = new Date().toISOString();
      console.error(`[PipelineManager] Pipeline ${entry.pipelineId} failed: ${err.message}`);
    }
  }

  /**
   * Build phaseConfig for a legacy stage.
   * Passes project config + stage-specific overrides so phases have data to work with.
   */
  _buildPhaseConfig(entry, stageId) {
    const config = {};
    const v6Config = entry.v6Config || {};

    // Pass project config from the create request (title, genre, characters, etc.)
    if (v6Config.config) {
      config.projectConfig = v6Config.config;
    }

    // If v6Config has phase-specific config, pass it through
    const phaseConfig = v6Config.phasesConfig?.[stageId];
    if (phaseConfig) {
      Object.assign(config, phaseConfig);
    }

    return config;
  }

  /**
   * 恢复管线
   */
  async resume(pipelineId, options = {}) {
    const entry = this._get(pipelineId);
    if (!entry) throw new Error(`Pipeline not found: ${pipelineId}`);
    if (entry.status === 'running') {
      const err = new Error('Pipeline already running');
      err.status = 409;
      throw err;
    }

    const fromPhase = options.phase || entry.currentPhase;
    if (!fromPhase) throw new Error('Cannot determine resume phase');

    entry.status = 'running';
    entry.updatedAt = new Date().toISOString();

    const v6Idx = PHASES_V6.findIndex(p => p.id === fromPhase);
    if (v6Idx < 0) throw new Error(`Unknown phase: ${fromPhase}`);

    // 如果有审核决定，处理之
    if (options.decision) {
      const phaseEntry = entry.phases[v6Idx];
      phaseEntry.status = options.decision === 'approved' ? 'completed' : 'failed';
    }

    // 从下一个 phase 继续
    const nextIdx = options.decision === 'approved' ? v6Idx + 1 : v6Idx;
    if (nextIdx >= PHASES_V6.length) {
      entry.status = 'completed';
      entry.currentPhase = null;
      return this._summarize(entry);
    }

    this._runPipeline(entry, nextIdx);
    return this._summarize(entry);
  }

  /**
   * 取消管线
   */
  async cancel(pipelineId, reason = '') {
    const entry = this._get(pipelineId);
    if (!entry) throw new Error(`Pipeline not found: ${pipelineId}`);
    if (['completed', 'cancelled', 'failed'].includes(entry.status)) {
      const err = new Error(`Pipeline already ${entry.status}, cannot cancel`);
      err.status = 409;
      throw err;
    }

    entry.status = 'cancelled';
    entry.currentPhase = null;
    entry.updatedAt = new Date().toISOString();
    return this._summarize(entry);
  }

  /**
   * 获取管线状态
   */
  getStatus(pipelineId) {
    const entry = this._get(pipelineId);
    if (!entry) return null;
    return this._summarize(entry);
  }

  /**
   * 获取 Phase 列表
   */
  getPhases(pipelineId) {
    const entry = this._get(pipelineId);
    if (!entry) return null;
    return { pipeline_id: pipelineId, phases: entry.phases };
  }

  /**
   * 注册 task → pipeline 映射（供回调使用）
   */
  registerTask(taskId, pipelineId, phaseId) {
    this.taskIndex.set(taskId, { pipelineId, phaseId });
  }

  /**
   * 通过 taskId 查找管线
   */
  findByTaskId(taskId) {
    const mapping = this.taskIndex.get(taskId);
    if (!mapping) return null;
    return { ...mapping, entry: this._get(mapping.pipelineId) };
  }

  /**
   * 通过 pipelineId 查找
   */
  _get(pipelineId) {
    return this.pipelines.get(pipelineId);
  }

  /**
   * 生成管线摘要
   */
  _summarize(entry) {
    const completedPhases = entry.phases.filter(p => p.status === 'completed').length;
    const progress = entry.phases.length > 0 ? completedPhases / entry.phases.length : 0;

    return {
      pipeline_id: entry.pipelineId,
      status: entry.status,
      current_phase: entry.currentPhase,
      progress: Math.round(progress * 100) / 100,
      phases: entry.phases,
      created_at: entry.createdAt,
      updated_at: entry.updatedAt,
    };
  }
}
