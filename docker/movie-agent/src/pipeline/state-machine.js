/**
 * Pipeline Manager — 管线状态机
 *
 * 管理 Pipeline 实例的创建、启动、恢复、取消、状态查询。
 * 将 V6.0 Phase 0~7 映射到现有 11 Phase system。
 * 复用 lib/pipeline.js 的 Pipeline 类，不修改原逻辑。
 */

import { Pipeline } from '../../lib/pipeline.js';
import { PHASES_V6, mapV6ToLegacy, PHASES_ORDER } from './phase-registry.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export class PipelineManager {
  constructor() {
    /** @type {Map<string, {pipeline: Pipeline, status: string, config: object, job: object|null}>} */
    this.pipelines = new Map();
    /** @type {Map<string, string>} — taskId → pipelineId mapping for callbacks */
    this.taskIndex = new Map();
  }

  /**
   * 创建新管线实例 — 从 core-backend 拉取项目数据
   */
  async create(projectId, config = {}, metadata = {}) {
    const pipelineId = `pipe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const workdir = config.workdir || `/tmp/movie-agent/${pipelineId}`;

    // ── Fetch project data from core-backend ──
    const coreBackendUrl = process.env.CORE_BACKEND_URL || 'http://core-backend:8000';
    let projectData = null;
    let novelData = null;

    try {
      console.log(`[PipelineManager] Fetching project ${projectId} from core-backend...`);

      // Fetch project details
      const projResp = await fetch(`${coreBackendUrl}/api/project/getProject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: Number(projectId) }),
        signal: AbortSignal.timeout(10000),
      });
      if (projResp.ok) {
        const projJson = await projResp.json();
        const list = projJson.data || projJson;
        // API returns array — find our project
        if (Array.isArray(list)) {
          projectData = list.find(p => p.id === Number(projectId)) || list[0];
        } else {
          projectData = list;
        }
        console.log(`[PipelineManager] Project loaded: ${projectData?.name || projectId}`);
      } else {
        console.warn(`[PipelineManager] Failed to fetch project: ${projResp.status}`);
      }

      // Fetch novel data
      const novelResp = await fetch(`${coreBackendUrl}/api/novel/getNovel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: Number(projectId), page: 1, limit: 10 }),
        signal: AbortSignal.timeout(10000),
      });
      if (novelResp.ok) {
        const novelJson = await novelResp.json();
        // API returns { data: [ { data: [...chapters], total: 1 } ] } or similar nested structure
        let rawNovelData = novelJson.data || novelJson;
        // Unwrap nested {data: [...], total: N} → actual chapter array
        if (rawNovelData && !Array.isArray(rawNovelData) && Array.isArray(rawNovelData.data)) {
          rawNovelData = rawNovelData.data;
        }
        // Unwrap nested arrays of arrays
        if (Array.isArray(rawNovelData) && rawNovelData.length && Array.isArray(rawNovelData[0]?.data)) {
          novelData = rawNovelData.flatMap(item => Array.isArray(item.data) ? item.data : [item]);
        } else if (Array.isArray(rawNovelData)) {
          novelData = rawNovelData;
        } else {
          novelData = [rawNovelData];
        }
        console.log(`[PipelineManager] Novel chapters loaded: ${novelData.length}`);
      } else {
        console.warn(`[PipelineManager] Failed to fetch novel: ${novelResp.status}`);
      }
    } catch (err) {
      console.warn(`[PipelineManager] Core-backend fetch error: ${err.message}`);
    }

    // ── Build pipeline config from project data ──
    const pipelineConfig = this._buildConfigFromProject(projectData, novelData, config);

    const pipeline = new Pipeline({
      workdir,
      episode: metadata.episode || projectId,
      config: pipelineConfig,
      traceId: pipelineId,
    });

    const entry = {
      pipelineId,
      projectId,
      pipeline,
      status: 'pending',
      v6Config: { ...config, config: pipelineConfig },
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
      // Store raw data for phase handlers
      projectData,
      novelData,
    };

    this.pipelines.set(pipelineId, entry);

    // Persist project data to workdir for phase handlers
    await mkdir(workdir, { recursive: true });
    if (projectData) {
      await writeFile(join(workdir, 'project-data.json'), JSON.stringify(projectData, null, 2));
    }
    if (novelData) {
      await writeFile(join(workdir, 'novel-data.json'), JSON.stringify(novelData, null, 2));
    }

    return this._summarize(entry);
  }

  /**
   * Build pipeline config from core-backend project + novel data
   */
  _buildConfigFromProject(projectData, novelData, userConfig) {
    const cfg = { ...userConfig.config };

    if (projectData) {
      cfg.title = projectData.name || cfg.title || '';
      cfg.genre = projectData.genre || '短片';
      cfg.style_preference = projectData.artStyle || cfg.style_preference || '';
      cfg.artStyle = projectData.artStyle || '';
      cfg.videoRatio = projectData.videoRatio || '16:9';
      cfg.imageModel = projectData.imageModel || 'flux-dev';
      cfg.videoModel = projectData.videoModel || 'wan2.2-14b';

      // Parse video ratio to dimensions
      const ratioMap = {
        '16:9': { width: 1344, height: 768 },
        '9:16': { width: 768, height: 1344 },
        '1:1': { width: 1024, height: 1024 },
        '4:3': { width: 1152, height: 864 },
      };
      cfg.resolution = ratioMap[projectData.videoRatio] || ratioMap['16:9'];

      // Extract characters from novel events
      if (novelData?.length) {
        const charSet = new Set();
        for (const chapter of novelData) {
          if (chapter.event) {
            // Parse pipe-delimited event table: | chapter | character | description | ... |
            const rows = chapter.event.split('\n').filter(r => r.includes('|'));
            for (const row of rows) {
              const cols = row.split('|').map(c => c.trim()).filter(Boolean);
              // Skip header-like rows (first col looks like a header)
              if (cols.length >= 3 && !cols[0].match(/^第\d+[章节]/)) {
                // This row might be the header — but also might be data, try character col
                charSet.add(cols[1]);
              } else if (cols.length >= 2) {
                charSet.add(cols[1]);
              }
            }
          }
        }
        cfg.characters = [...charSet].map(name => ({ name, description: '' }));
      }

      // Novel content for LLM context
      cfg.novelContent = novelData?.map(ch => ch.chapterData || '').filter(Boolean).join('\n\n') || '';

      // Event data for scene/shot generation
      cfg.events = [];
      if (novelData?.length) {
        for (const chapter of novelData) {
          if (chapter.event) {
            const rows = chapter.event.split('\n').filter(r => r.includes('|'));
            for (const row of rows) {
              const cols = row.split('|').map(c => c.trim()).filter(Boolean);
              if (cols.length >= 3) {
                // Detect if this is a header row (first col is generic like "章节")
                const isHeader = /^(章节|chapter|第\d+章)/i.test(cols[0]) && /^(角色|character)/i.test(cols[1]);
                if (!isHeader) {
                  cfg.events.push({
                    chapter: cols[0],
                    character: cols[1],
                    description: cols[2],
                  });
                }
              }
            }
          }
        }
      }
    }

    // Gold-team config (use Docker internal URL)
    cfg.goldTeam = {
      baseUrl: process.env.GOLD_TEAM_URL || 'http://gold-team:8002',
      enableFluxArt: true,
      enableVideoGpu: true,
      ...cfg.goldTeam,
    };

    // Review platform config
    cfg.reviewPlatform = {
      baseUrl: process.env.REVIEW_PLATFORM_URL || 'http://review-platform:8090',
      ...cfg.reviewPlatform,
    };

    return cfg;
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
   * Passes project config + stage-specific overrides + core-backend data so phases have data to work with.
   */
  _buildPhaseConfig(entry, stageId) {
    const config = {};
    const v6Config = entry.v6Config || {};
    const pipelineConfig = v6Config.config || {};

    // Pass through all pipeline config (includes title, genre, characters, events, novelContent, etc.)
    Object.assign(config, pipelineConfig);

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
