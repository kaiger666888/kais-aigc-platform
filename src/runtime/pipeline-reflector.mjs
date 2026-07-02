/**
 * PipelineReflector — V8.6 管线反思器
 *
 * 元层面的自我进化闭环:
 *   1. 聚合 6 个数据源（kv_assetFeedback / kv_audit / o_agentWorkData reviewStatus
 *      + 本地 failed-shots.json / evaluations.json / creative-history.json）
 *   2. 调用 LLM 提炼结构化反思（reflections[]），含 severity/confidence/suggestion
 *   3. 写入 pending suggestion 队列（reflection-suggestions.jsonl）
 *   4. 操作者人工 approve/reject；approve 后写 prompt-overrides.json，由管线启动时注入
 *
 * 核心原则：永不自动修改管线，所有 suggestion 必须 approve 后才 apply。
 *
 * Storage: {workdir}/.pipeline-assets/reflection-suggestions.jsonl
 *          {workdir}/.pipeline-assets/reflection-applied.jsonl
 *          {workdir}/.pipeline-assets/prompt-overrides.json
 */

import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { callLLM } from './hermes-adapter.mjs';

const ASSETS_DIR = '.pipeline-assets';
const SUGGESTIONS_FILE = 'reflection-suggestions.jsonl';
const APPLIED_FILE = 'reflection-applied.jsonl';
const REFLECTION_HISTORY = 'reflection-history.json';
const PROMPT_OVERRIDES_FILE = 'prompt-overrides.json';

const SYSTEM_MSG = '你是一个 AI 短剧创作管线的反思分析专家。你的任务是从历史驳回和评价数据中提取规律性的教训，提出具体的管线优化建议。严格按 JSON 格式输出，不要输出 markdown 代码块。';

const REQUIRED_REFLECTION_KEYS = ['id', 'phase', 'pattern', 'evidence', 'severity', 'confidence', 'suggestion'];
const REQUIRED_SUGGESTION_KEYS = ['type', 'target', 'change', 'expected_impact'];
const VALID_SUGGESTION_TYPES = new Set(['prompt_modification', 'threshold_adjustment', 'parameter_change', 'workflow_redesign']);

/**
 * @typedef {Object} Reflection
 * @property {string} id
 * @property {string} phase
 * @property {string} pattern
 * @property {string[]} evidence
 * @property {'high'|'medium'|'low'} severity
 * @property {number} confidence
 * @property {Object} suggestion
 * @property {string} suggestion.type
 * @property {string} suggestion.target
 * @property {string} suggestion.change
 * @property {string} suggestion.expected_impact
 */

export class PipelineReflector {
  /**
   * @param {string} workdir
   * @param {object} [opts]
   * @param {string} [opts.episodeId]
   * @param {object} [opts.dbHelper] - knex-style helper `(tableName) => builder`
   * @param {number|string} [opts.projectId]
   * @param {number} [opts.lookbackDays=30]
   */
  constructor(workdir, opts = {}) {
    this.workdir = workdir;
    this.episodeId = opts.episodeId || null;
    this.dbHelper = opts.dbHelper || null;
    this.projectId = opts.projectId ?? null;
    this.lookbackDays = opts.lookbackDays ?? 30;
    // Injectable for tests; production callers use the default callLLM.
    this._llmCaller = opts.llmCaller || ((...args) => callLLM(...args));
    this.assetsDir = join(workdir, ASSETS_DIR);
    this.suggestionsPath = join(this.assetsDir, SUGGESTIONS_FILE);
    this.appliedPath = join(this.assetsDir, APPLIED_FILE);
    this.historyPath = join(this.assetsDir, REFLECTION_HISTORY);
    this.overridesPath = join(this.assetsDir, PROMPT_OVERRIDES_FILE);
  }

  // ─── 存储 helpers ──────────────────────────────────────────

  async _ensureDir() {
    if (!existsSync(this.assetsDir)) {
      await mkdir(this.assetsDir, { recursive: true });
    }
  }

  async _readJsonOptional(absPath) {
    try {
      const raw = await readFile(absPath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async _readJsonlOptional(absPath) {
    try {
      const raw = await readFile(absPath, 'utf-8');
      return raw.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);
    } catch {
      return [];
    }
  }

  async _writeJsonl(absPath, rows) {
    await this._ensureDir();
    const data = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length > 0 ? '\n' : '');
    await writeFile(absPath, data, 'utf-8');
  }

  async _appendJsonl(absPath, row) {
    await this._ensureDir();
    await appendFile(absPath, JSON.stringify(row) + '\n', 'utf-8');
  }

  // ─── 核心: aggregate() ─────────────────────────────────────

  /**
   * 聚合 6 个数据源,按 phase 分组。
   * DB 源缺失 dbHelper 时返回空数组（静默跳过,不抛错）。
   * 本地文件缺失也静默跳过。
   * @returns {Promise<{byPhase: Object, crossPhase: Object}>}
   */
  async aggregate() {
    const byPhase = {};
    const crossPhase = { totalFeedback: 0, totalRejects: 0, totalEvaluations: 0, totalFailures: 0 };

    const phaseOf = (name) => {
      if (!byPhase[name]) byPhase[name] = { rejects: [], evaluations: [], failures: [], creativeHistory: [], feedback: [], reviewStatus: [] };
      return byPhase[name];
    };

    // Infer phase from shot_id prefix (e.g. "p5_render-shot-001" -> "p5_render")
    const inferPhaseFromShotId = (shotId) => {
      if (typeof shotId !== 'string' || !shotId) return 'unknown';
      const m = shotId.match(/^([a-z0-9_]+?)(?:-shot|-s\d|-)/i);
      // Heuristic: take leading run up to first "-shot" / "-s" / numeric boundary
      const m2 = shotId.match(/^([a-zA-Z0-9_]+?)(?:-[a-zA-Z])/);
      if (m2) return m2[1];
      if (m) return m[1];
      return 'unknown';
    };

    // Parse phase from audit.detail "[phase] ..." pattern
    const parsePhaseFromDetail = (detail) => {
      if (typeof detail !== 'string') return 'unknown';
      const m = detail.match(/\[([^\]]+)\]/);
      return m ? m[1] : 'unknown';
    };

    // Run local sources in parallel; each tolerates missing file.
    const [failedShots, evaluations, creativeHistory, feedbackRows, auditRows, reviewStatusRows] = await Promise.all([
      this._readJsonOptional(join(this.assetsDir, 'failed-shots.json')),
      this._readJsonOptional(join(this.assetsDir, 'evaluations.json')),
      this._readJsonOptional(join(this.assetsDir, 'creative-history.json')),
      this._fetchDb('kv_assetFeedback'),
      this._fetchDb('kv_audit'),
      this._fetchReviewStatus(),
    ]);

    // failed-shots.json: { failures: [{ shot_id, ... }] }
    if (failedShots && Array.isArray(failedShots.failures)) {
      for (const f of failedShots.failures) {
        const phase = inferPhaseFromShotId(f.shot_id);
        phaseOf(phase).failures.push(f);
        crossPhase.totalFailures++;
      }
    }

    // evaluations.json: array of records
    if (Array.isArray(evaluations)) {
      for (const e of evaluations) {
        const phase = e.phase || 'unknown';
        phaseOf(phase).evaluations.push(e);
        crossPhase.totalEvaluations++;
      }
    }

    // creative-history.json: { shots: [...] }
    if (creativeHistory && Array.isArray(creativeHistory.shots)) {
      for (const s of creativeHistory.shots) {
        const phase = inferPhaseFromShotId(s.shot_id);
        phaseOf(phase).creativeHistory.push(s);
      }
    }

    // feedback rows
    if (Array.isArray(feedbackRows)) {
      for (const fb of feedbackRows) {
        const phase = inferPhaseFromShotId(fb.assetId);
        phaseOf(phase).feedback.push(fb);
        if (fb.verdict === 'reject') crossPhase.totalRejects++;
        crossPhase.totalFeedback++;
      }
    }

    // audit rows
    if (Array.isArray(auditRows)) {
      for (const a of auditRows) {
        const phase = parsePhaseFromDetail(a.detail);
        phaseOf(phase).rejects.push(a);
      }
    }

    // reviewStatus map
    if (Array.isArray(reviewStatusRows)) {
      for (const rs of reviewStatusRows) {
        // rs: { nodeId, reviewStatus, rejectReason, isWinner }
        // we don't have phase info reliably; bucket under 'unknown' if not inferable
        const phase = inferPhaseFromShotId(rs.nodeId);
        phaseOf(phase).reviewStatus.push(rs);
      }
    }

    return { byPhase, crossPhase };
  }

  async _fetchDb(tableName) {
    if (!this.dbHelper) return [];
    try {
      const builder = this.dbHelper(tableName);
      if (this.projectId != null) builder.where('projectId', this.projectId);
      builder.orderBy('createdAt', 'desc');
      return await builder;
    } catch {
      return [];
    }
  }

  async _fetchReviewStatus() {
    if (!this.dbHelper) return [];
    try {
      // reviewStatus stored under o_agentWorkData with key=reviewStatus-{episodeId}
      const key = this.episodeId ? `reviewStatus-${this.episodeId}` : null;
      const builder = this.dbHelper('o_agentWorkData');
      if (this.projectId != null) builder.where('projectId', String(this.projectId));
      if (key) builder.andWhere('key', key);
      const rows = await builder;
      const out = [];
      for (const r of rows || []) {
        if (!r || !r.data) continue;
        try {
          const map = JSON.parse(r.data);
          for (const [nodeId, v] of Object.entries(map)) {
            out.push({ nodeId, ...(v || {}) });
          }
        } catch { /* skip malformed */ }
      }
      return out;
    } catch {
      return [];
    }
  }

  // ─── 核心: reflect() ───────────────────────────────────────

  /**
   * 调用 LLM 提炼 reflections[]。
   * @param {{byPhase: Object, crossPhase: Object}} aggregatedData
   * @returns {Promise<{reflections: Reflection[], summary: string}>}
   */
  async reflect(aggregatedData) {
    const prompt = this._buildReflectionPrompt(aggregatedData);
    const raw = await this._callJson(prompt, SYSTEM_MSG);
    let parsed;
    try {
      parsed = typeof raw === 'string' ? JSON.parse(this._stripFences(raw)) : raw;
    } catch (e) {
      throw new Error(`reflect(): LLM 返回无法解析为 JSON — ${e.message}`);
    }
    if (!parsed || !Array.isArray(parsed.reflections)) {
      throw new Error('reflect(): LLM 输出缺少 reflections[] 数组');
    }
    // Validate each reflection
    for (const ref of parsed.reflections) {
      for (const k of REQUIRED_REFLECTION_KEYS) {
        if (!(k in ref)) throw new Error(`reflect(): reflection 缺少必需字段 '${k}'`);
      }
      if (!ref.suggestion || typeof ref.suggestion !== 'object') {
        throw new Error('reflect(): suggestion 必须是对象');
      }
      for (const k of REQUIRED_SUGGESTION_KEYS) {
        if (!(k in ref.suggestion)) throw new Error(`reflect(): suggestion 缺少必需字段 '${k}'`);
      }
      if (!VALID_SUGGESTION_TYPES.has(ref.suggestion.type)) {
        throw new Error(`reflect(): suggestion.type 非法: ${ref.suggestion.type}`);
      }
      if (!Array.isArray(ref.evidence)) {
        throw new Error('reflect(): evidence 必须是数组');
      }
    }
    return parsed;
  }

  /**
   * 调用 LLM 返回 JSON。优先用 callLLM 的 responseFormat:'json'，
   * 若返回仍是带 code fence 的文本则手动剥离再 JSON.parse。
   * @returns {Promise<string|object>} raw LLM content (string) or parsed object
   */
  async _callJson(prompt, system) {
    // callLLM({prompt, system, responseFormat:'json'}) per spec
    const content = await this._llmCaller({ prompt, system, responseFormat: 'json' });
    return content;
  }

  _stripFences(text) {
    if (typeof text !== 'string') return text;
    let t = text.trim();
    // Remove ```json ... ``` or ``` ... ``` fences
    const fenceMatch = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fenceMatch) return fenceMatch[1].trim();
    return t;
  }

  _buildReflectionPrompt(agg) {
    const stats = this._summarizeStats(agg);
    const rejects = this._recentRejects(agg);
    const failures = this._failedShotsSummary(agg);
    const evals = this._evaluationSummary(agg);
    return `你是一个 AI 短剧创作管线的反思分析专家。你的任务是从历史驳回和评价数据中提取规律性的教训，提出具体的管线优化建议。

## 数据摘要
${stats}

## 典型驳回案例
${rejects}

## 失败技术数据
${failures}

## GPU 评估数据
${evals}

## 分析要求
1. 重复模式
2. 根因推测
3. 可操作性
4. 优先级

## 输出格式 (只输出 JSON)
{ "reflections": [{ "id", "phase", "pattern", "evidence":[...], "severity":"high|medium|low", "confidence":0-1, "suggestion": { "type":"prompt_modification|threshold_adjustment|parameter_change|workflow_redesign", "target", "change", "expected_impact" } }], "summary": "..." }`;
  }

  _summarizeStats(agg) {
    const lines = [];
    lines.push(`- 总反馈数: ${agg.crossPhase?.totalFeedback || 0}`);
    lines.push(`- 总驳回数: ${agg.crossPhase?.totalRejects || 0}`);
    lines.push(`- 总失败镜头数: ${agg.crossPhase?.totalFailures || 0}`);
    lines.push(`- 总评估记录数: ${agg.crossPhase?.totalEvaluations || 0}`);
    const phaseKeys = Object.keys(agg.byPhase || {});
    lines.push(`- 涉及阶段: ${phaseKeys.join(', ') || '(无)'}`);
    for (const p of phaseKeys) {
      const d = agg.byPhase[p];
      lines.push(`  - [${p}] feedback=${d.feedback.length} rejects=${d.rejects.length} failures=${d.failures.length} evaluations=${d.evaluations.length}`);
    }
    return lines.join('\n');
  }

  _recentRejects(agg) {
    const rows = [];
    for (const [phase, d] of Object.entries(agg.byPhase || {})) {
      for (const r of d.rejects.slice(0, 5)) {
        rows.push(`- [${phase}] ${(r.detail || JSON.stringify(r)).slice(0, 200)}`);
      }
      for (const f of d.feedback.filter((x) => x.verdict === 'reject').slice(0, 5)) {
        rows.push(`- [${phase}] feedback=${f.id} content="${(f.content || '').slice(0, 150)}"`);
      }
    }
    return rows.length > 0 ? rows.join('\n') : '(无)';
  }

  _failedShotsSummary(agg) {
    const rows = [];
    for (const [phase, d] of Object.entries(agg.byPhase || {})) {
      for (const f of d.failures.slice(0, 5)) {
        rows.push(`- [${phase}] shot=${f.shot_id} error=${(f.error || '').slice(0, 150)}`);
      }
    }
    return rows.length > 0 ? rows.join('\n') : '(无)';
  }

  _evaluationSummary(agg) {
    const rows = [];
    for (const [phase, d] of Object.entries(agg.byPhase || {})) {
      const evals = d.evaluations;
      if (evals.length === 0) continue;
      const succ = evals.filter((e) => e.success).length;
      const avgQ = evals.filter((e) => e.ai_quality_score != null);
      const q = avgQ.length > 0 ? (avgQ.reduce((s, e) => s + e.ai_quality_score, 0) / avgQ.length).toFixed(1) : 'n/a';
      rows.push(`- [${phase}] n=${evals.length} success=${succ}/${evals.length} avg_quality=${q}`);
    }
    return rows.length > 0 ? rows.join('\n') : '(无)';
  }

  // ─── 核心: storeSuggestions() ──────────────────────────────

  /**
   * 追加写入 reflection-suggestions.jsonl，每条带 status:'pending' / createdAt / unique id
   * @param {Reflection[]} reflections
   * @returns {Promise<number>} number of rows written
   */
  async storeSuggestions(reflections) {
    const ts = new Date().toISOString();
    let written = 0;
    for (const ref of reflections) {
      const row = {
        ...ref,
        id: this._genId(),
        status: 'pending',
        createdAt: ts,
      };
      await this._appendJsonl(this.suggestionsPath, row);
      written++;
    }
    return written;
  }

  _genId() {
    return `refl-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
  }

  async readPendingSuggestions() {
    const all = await this._readJsonlOptional(this.suggestionsPath);
    return all.filter((r) => r.status === 'pending');
  }

  /** Returns all suggestion rows regardless of status (for history UI). */
  async readAllSuggestions() {
    return this._readJsonlOptional(this.suggestionsPath);
  }

  // ─── 核心: approve / reject ────────────────────────────────

  /**
   * Approve and apply a suggestion by id.
   * - prompt_modification → prompt-overrides.json keyed by target
   * - threshold_adjustment → prompt-overrides.json under thresholds{}
   * - parameter_change / workflow_redesign → applied only (no source change)
   * Then updates the JSONL row status='applied' and appends to reflection-applied.jsonl.
   * @param {string} id
   */
  async approveSuggestion(id) {
    const rows = await this._readJsonlOptional(this.suggestionsPath);
    const idx = rows.findIndex((r) => r.id === id);
    if (idx < 0) throw new Error(`approveSuggestion(): 未找到 id='${id}'`);
    const row = rows[idx];

    // Apply by type
    const type = row.suggestion?.type;
    if (type === 'prompt_modification' || type === 'threshold_adjustment') {
      await this._applyOverride(row.suggestion);
    }
    // parameter_change / workflow_redesign: only record to applied file

    // Mutate row status
    row.status = 'applied';
    row.appliedAt = new Date().toISOString();
    rows[idx] = row;
    await this._writeJsonl(this.suggestionsPath, rows);

    // Append to applied file
    await this._appendJsonl(this.appliedPath, {
      id: row.id,
      suggestion: row.suggestion,
      pattern: row.pattern,
      phase: row.phase,
      status: 'applied',
      appliedAt: row.appliedAt,
      sourceCreatedAt: row.createdAt,
    });
  }

  async _applyOverride(suggestion) {
    await this._ensureDir();
    let overrides = {};
    if (existsSync(this.overridesPath)) {
      try { overrides = JSON.parse(await readFile(this.overridesPath, 'utf-8')); }
      catch { overrides = {}; }
    }
    if (suggestion.type === 'prompt_modification') {
      overrides[suggestion.target] = overrides[suggestion.target] || [];
      overrides[suggestion.target].push({ change: suggestion.change, expected_impact: suggestion.expected_impact, appliedAt: new Date().toISOString() });
    } else if (suggestion.type === 'threshold_adjustment') {
      overrides.thresholds = overrides.thresholds || {};
      overrides.thresholds[suggestion.target] = { change: suggestion.change, expected_impact: suggestion.expected_impact, appliedAt: new Date().toISOString() };
    }
    await writeFile(this.overridesPath, JSON.stringify(overrides, null, 2), 'utf-8');
  }

  /**
   * Reject a suggestion by id with reason.
   * @param {string} id
   * @param {string} reason
   */
  async rejectSuggestion(id, reason) {
    const rows = await this._readJsonlOptional(this.suggestionsPath);
    const idx = rows.findIndex((r) => r.id === id);
    if (idx < 0) throw new Error(`rejectSuggestion(): 未找到 id='${id}'`);
    const row = rows[idx];
    row.status = 'rejected';
    row.reason = reason || '';
    row.rejectedAt = new Date().toISOString();
    rows[idx] = row;
    await this._writeJsonl(this.suggestionsPath, rows);
  }

  async readAppliedSuggestions() {
    return this._readJsonlOptional(this.appliedPath);
  }

  // ─── 核心: run() ───────────────────────────────────────────

  /**
   * Full pipeline: aggregate → reflect → storeSuggestions
   * @returns {Promise<number>} count of new suggestions
   */
  async run() {
    const agg = await this.aggregate();
    const reflections = await this.reflect(agg);
    return this.storeSuggestions(reflections.reflections || []);
  }
}
