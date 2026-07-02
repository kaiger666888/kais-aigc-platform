/**
 * IterationEngine — 单集内版本化迭代引擎
 *
 * 与 PipelineReflector 的分工:
 *   - PipelineReflector: 跨集策略优化,从驳回模式中提炼教训改 formula / prompt-overrides
 *   - IterationEngine:   单集内版本化迭代,诊断具体反馈 → 重新生成资产 → 版本对比
 *
 * 三种诊断类型 (LLM 输出):
 *   - reroll           抽卡问题,重跑即可(只对 reject 节点微调 prompt + 重生成)
 *   - pipeline_adjust  系统性缺陷,需改管线参数再重生成受影响节点
 *   - upstream_fix     上游污染,回退到上游问题节点重新生成,下游级联重生成
 *
 * 核心原则:
 *   #1 不自动执行 — plan() 返回计划,execute() 是独立调用
 *   #2 不自动确认管线改动 — requiresApproval gate,approveAdjustment 单独端点
 *   #3 分支隔离 — 新版挂到新分支,不动源分支
 *   #4 拓扑顺序 — 重生成按拓扑序(上游先跑完下游再跑)
 *   #8 失败降级 — 单节点失败标记 failed 不中断整轮迭代
 *
 * Storage: {workdir}/.pipeline-assets/iteration-plans.jsonl
 *          {workdir}/.pipeline-assets/iteration-current.json
 *          {workdir}/.pipeline-assets/prompt-overrides.json
 */

import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { callLLM } from './hermes-adapter.mjs';

const ASSETS_DIR = '.pipeline-assets';
const PLANS_FILE = 'iteration-plans.jsonl';
const CURRENT_FILE = 'iteration-current.json';
const PROMPT_OVERRIDES_FILE = 'prompt-overrides.json';

const SYSTEM_MSG = `你是一个 AI 短剧创作管线的迭代诊断专家。
你的任务是根据用户对一批资产的反馈，诊断问题根因，制定下一版迭代计划。

## 诊断框架

请判断问题属于以下哪一类：

### A. reroll（抽卡问题）
特征：个别镜头质量不稳，但同类镜头有成功的。问题出在随机性/运气。
判据：同一 phase 下大部分节点 score 正常，只有少数低分被 reject。
动作：只对被 reject 的节点换 prompt 微调 + 重新生成，不改管线。

### B. pipeline_adjust（系统性缺陷）
特征：某 phase 的节点大面积同类问题。问题出在 prompt/参数设计。
判据：多个 reject 原因指向同一模式（如"表情呆板"出现 5 次以上）。
动作：先修改管线参数 → 再重新生成受影响的所有节点。

### C. upstream_fix（上游污染）
特征：下游节点全崩，但根因在上游（如角色图质量差导致所有镜头都丑）。
判据：feedback propagation 显示下游 reject 聚集，且上游节点评分也偏低。
动作：回退到上游问题节点重新生成 → 下游级联重生成。

## 输出格式（只输出 JSON）

{
  "diagnosis": {
    "type": "reroll" | "pipeline_adjust" | "upstream_fix",
    "rootCause": "一句话描述",
    "confidence": 0.0-1.0,
    "evidence": ["证据1", "证据2"]
  },
  "actions": [
    {
      "nodeId": "节点ID",
      "action": "regenerate" | "regenerate_after_parent" | "skip",
      "promptDelta": "建议的 prompt 增补词（可为空）",
      "pipelineAdjustment": null 或 { "type", "target", "change" },
      "reason": "为什么这样处理",
      "dependsOn": ["依赖的上游节点ID"]
    }
  ],
  "branchLabel": "v{N}-{简述}",
  "requiresApproval": true/false,
  "summary": "整体计划摘要"
}`;

const REQUIRED_DIAGNOSIS_KEYS = ['type', 'rootCause', 'confidence', 'evidence'];
const REQUIRED_ACTION_KEYS = ['nodeId', 'action', 'reason'];
const VALID_DIAGNOSIS_TYPES = new Set(['reroll', 'pipeline_adjust', 'upstream_fix']);
const VALID_ACTION_TYPES = new Set(['regenerate', 'regenerate_after_parent', 'skip']);
const VALID_ADJUSTMENT_TYPES = new Set(['prompt_modification', 'threshold_adjustment', 'parameter_change']);

/**
 * @typedef {Object} IterationAction
 * @property {string} nodeId
 * @property {'regenerate'|'regenerate_after_parent'|'skip'} action
 * @property {string} [promptDelta]
 * @property {{type:string, target:string, change:string}|null} [pipelineAdjustment]
 * @property {string} reason
 * @property {string[]} [dependsOn]
 */

/**
 * @typedef {Object} IterationPlan
 * @property {string} id
 * @property {string} [episodeId]
 * @property {string} branchLabel
 * @property {{type:string, rootCause:string, confidence:number, evidence:string[]}} diagnosis
 * @property {IterationAction[]} actions
 * @property {boolean} requiresApproval
 * @property {boolean} adjustmentApproved
 * @property {string} createdAt
 * @property {string} status
 * @property {Object} [result]
 */

export class IterationEngine {
  /**
   * @param {string} workdir
   * @param {object} [opts]
   * @param {string} [opts.apiBase='http://localhost:10588']
   * @param {number|string} [opts.projectId]
   * @param {string} [opts.episodesId]
   * @param {function} [opts.llmCaller]
   */
  constructor(workdir, opts = {}) {
    this.workdir = workdir;
    this.apiBase = opts.apiBase || 'http://localhost:10588';
    this.projectId = opts.projectId ?? null;
    this.episodesId = opts.episodesId || null;
    this._llmCaller = opts.llmCaller || ((...args) => callLLM(...args));
    this.assetsDir = join(workdir, ASSETS_DIR);
    this.plansPath = join(this.assetsDir, PLANS_FILE);
    this.currentPath = join(this.assetsDir, CURRENT_FILE);
    this.overridesPath = join(this.assetsDir, PROMPT_OVERRIDES_FILE);
  }

  // ─── 存储 helpers (mirror PipelineReflector) ───────────────

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

  _genId() {
    return `iter-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
  }

  _stripFences(text) {
    if (typeof text !== 'string') return text;
    let t = text.trim();
    const fenceMatch = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fenceMatch) return fenceMatch[1].trim();
    return t;
  }

  async _callJson(prompt, system) {
    const content = await this._llmCaller({ prompt, system, responseFormat: 'json' });
    return content;
  }

  // ─── 核心: collectFeedback() ───────────────────────────────

  /**
   * 收集本轮反馈,按节点分组,拉取拓扑影响。
   * @returns {Promise<{byNode: Object, topology: Object, summary: Object}>}
   */
  async collectFeedback() {
    if (this.projectId == null) throw new Error('collectFeedback(): projectId is required');
    const byNode = {};
    const topology = {};

    let feedbackRows = [];
    try {
      const resp = await fetch(`${this.apiBase}/api/v1/feedback/project/${this.projectId}`, {
        headers: { accept: 'application/json' },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const body = await resp.json();
      feedbackRows = (body && Array.isArray(body.data)) ? body.data : (Array.isArray(body) ? body : []);
    } catch (err) {
      throw new Error(`collectFeedback(): 无法获取反馈列表 — ${err.message}`);
    }

    for (const fb of feedbackRows) {
      const assetId = fb.assetId || fb.asset_id || fb.nodeId;
      if (!assetId) continue;
      if (!byNode[assetId]) byNode[assetId] = [];
      byNode[assetId].push(fb);

      // For reject/contest verdicts, fetch downstream propagation
      const verdict = (fb.verdict || '').toLowerCase();
      if (verdict === 'reject' || verdict === 'contest' || verdict === 'rejected') {
        try {
          const pResp = await fetch(
            `${this.apiBase}/api/v1/feedback/propagation/${assetId}?projectId=${this.projectId}&direction=downstream`,
            { headers: { accept: 'application/json' } },
          );
          if (pResp.ok) {
            const pBody = await pResp.json();
            const pData = (pBody && pBody.data) ? pBody.data : pBody;
            topology[assetId] = {
              downstream: Array.isArray(pData?.downstream) ? pData.downstream : [],
              upstream: Array.isArray(pData?.upstream) ? pData.upstream : [],
            };
          }
        } catch { /* best-effort topology */ }
      }
    }

    const summary = {
      totalFeedback: feedbackRows.length,
      nodesAffected: Object.keys(byNode).length,
      rejectedNodes: Object.keys(topology),
    };

    return { byNode, topology, summary };
  }

  // ─── 核心: diagnose() ──────────────────────────────────────

  /**
   * 构建 LLM prompt → 调用 → 解析为 IterationPlan。
   * @param {{byNode:Object, topology:Object, summary:Object}} feedback
   * @returns {Promise<IterationPlan>}
   */
  async diagnose(feedback) {
    const prompt = this._buildDiagnosisPrompt(feedback);
    const raw = await this._callJson(prompt, SYSTEM_MSG);
    let parsed;
    try {
      parsed = typeof raw === 'string' ? JSON.parse(this._stripFences(raw)) : raw;
    } catch (e) {
      throw new Error(`diagnose(): LLM 输出无法解析为 JSON — ${e.message}`);
    }
    if (!parsed || !parsed.diagnosis) {
      throw new Error('diagnose(): LLM 输出缺少 diagnosis 字段');
    }
    if (!parsed.actions || !Array.isArray(parsed.actions)) {
      throw new Error('diagnose(): LLM 输出缺少 actions[] 数组');
    }

    // Validate diagnosis
    for (const k of REQUIRED_DIAGNOSIS_KEYS) {
      if (!(k in parsed.diagnosis)) {
        throw new Error(`diagnose(): diagnosis 缺少必需字段 '${k}'`);
      }
    }
    if (!VALID_DIAGNOSIS_TYPES.has(parsed.diagnosis.type)) {
      throw new Error(`diagnose(): diagnosis.type 非法: ${parsed.diagnosis.type}`);
    }
    if (!Array.isArray(parsed.diagnosis.evidence)) {
      throw new Error('diagnose(): diagnosis.evidence 必须是数组');
    }

    // Validate actions + compute requiresApproval
    let requiresApproval = false;
    for (const action of parsed.actions) {
      for (const k of REQUIRED_ACTION_KEYS) {
        if (!(k in action)) {
          throw new Error(`diagnose(): action 缺少必需字段 '${k}'`);
        }
      }
      if (!VALID_ACTION_TYPES.has(action.action)) {
        throw new Error(`diagnose(): action.action 非法: ${action.action}`);
      }
      if (action.pipelineAdjustment) {
        if (!VALID_ADJUSTMENT_TYPES.has(action.pipelineAdjustment.type)) {
          throw new Error(`diagnose(): pipelineAdjustment.type 非法: ${action.pipelineAdjustment.type}`);
        }
        requiresApproval = true;
      }
    }

    if (typeof parsed.requiresApproval === 'boolean') {
      requiresApproval = requiresApproval || parsed.requiresApproval;
    }

    const plan = {
      id: this._genId(),
      episodeId: this.episodesId || null,
      branchLabel: parsed.branchLabel || `v${Date.now().toString(36)}`,
      diagnosis: parsed.diagnosis,
      actions: parsed.actions,
      summary: parsed.summary || '',
      requiresApproval,
      adjustmentApproved: false,
      createdAt: new Date().toISOString(),
      status: 'pending',
    };

    return plan;
  }

  _buildDiagnosisPrompt(feedback) {
    const { byNode = {}, topology = {}, summary = {} } = feedback || {};
    const lines = [];

    lines.push('## 反馈数据 (按节点分组)');
    const nodeIds = Object.keys(byNode);
    if (nodeIds.length === 0) {
      lines.push('(无反馈)');
    } else {
      for (const nodeId of nodeIds) {
        const fbs = byNode[nodeId];
        const verdicts = fbs.map((f) => f.verdict || '?').join(',');
        const contents = fbs.slice(0, 3).map((f) => (f.content || '').slice(0, 200)).join(' / ');
        lines.push(`- 节点 ${nodeId}: verdicts=[${verdicts}] n=${fbs.length} 样本="${contents}"`);
      }
    }

    lines.push('');
    lines.push('## 节点拓扑关系');
    const topoNodes = Object.keys(topology);
    if (topoNodes.length === 0) {
      lines.push('(无下游传播)');
    } else {
      for (const nodeId of topoNodes) {
        const t = topology[nodeId];
        const dCount = Array.isArray(t.downstream) ? t.downstream.length : 0;
        lines.push(`- ${nodeId} → 下游 ${dCount} 节点`);
      }
    }

    lines.push('');
    lines.push('## 历史评估数据');
    lines.push('(无)');

    return lines.join('\n');
  }

  // ─── 核心: plan() ──────────────────────────────────────────

  /**
   * 一键规划: collectFeedback → diagnose → _storePlan。
   * @returns {Promise<IterationPlan>}
   */
  async plan() {
    const feedback = await this.collectFeedback();
    const planObj = await this.diagnose(feedback);
    await this._storePlan(planObj);
    return planObj;
  }

  // ─── 核心: execute() ───────────────────────────────────────

  /**
   * 执行迭代: fork 分支 → 按拓扑序重生成 → 返回 IterationResult。
   * @param {string} planId
   * @returns {Promise<{planId:string, branchId:string, regeneratedNodes:Array}>}
   */
  async execute(planId) {
    const planObj = await this._readPlan(planId);

    if (planObj.requiresApproval && !planObj.adjustmentApproved) {
      throw new Error('Pipeline adjustment requires approval before execution');
    }

    if (planObj.adjustmentApproved && this._hasPipelineAdjustment(planObj)) {
      await this._applyPipelineAdjustment(planObj);
    }

    const branchId = await this._forkBranch(planObj);
    const sorted = this._topologicalSort(planObj.actions);
    const results = [];

    for (const action of sorted) {
      if (action.action === 'skip') {
        results.push({ nodeId: action.nodeId, newNodeId: null, status: 'pending' });
        continue;
      }
      const newNodeId = `${action.nodeId}-v${planObj.id.slice(-6)}`;
      try {
        const prompt = await this._buildPrompt(action);
        const taskResult = await this._callEngine(action.nodeId, prompt, branchId);
        results.push({
          nodeId: action.nodeId,
          newNodeId,
          status: 'success',
          outputUrl: taskResult?.outputUrl || null,
        });
        this._broadcast('iteration:progress', { planId, newNodeId, status: 'done' });
      } catch (err) {
        results.push({
          nodeId: action.nodeId,
          newNodeId,
          status: 'failed',
          error: err.message,
        });
        this._broadcast('iteration:progress', { planId, newNodeId, status: 'failed' });
        // DO NOT rethrow — continue iteration per constraint #8
      }
    }

    const result = { planId, branchId, regeneratedNodes: results };

    // Persist current.json + update plan row with result
    await this._ensureDir();
    await writeFile(this.currentPath, JSON.stringify(result, null, 2), 'utf-8');

    // Update plan row with result + status
    const rows = await this._readJsonlOptional(this.plansPath);
    const idx = rows.findIndex((r) => r.id === planId);
    if (idx >= 0) {
      rows[idx].result = result;
      rows[idx].status = 'executed';
      rows[idx].executedAt = new Date().toISOString();
      await this._writeJsonl(this.plansPath, rows);
    }

    return result;
  }

  _hasPipelineAdjustment(planObj) {
    return (planObj.actions || []).some((a) => a.pipelineAdjustment);
  }

  async _forkBranch(planObj) {
    try {
      const resp = await fetch(`${this.apiBase}/api/canvas/v2/branches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: this.projectId,
          label: planObj.branchLabel,
          parentLabel: null,
        }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const body = await resp.json();
      const data = (body && body.data) ? body.data : body;
      return data.id || data.branchId || data.label;
    } catch (err) {
      throw new Error(`_forkBranch(): 创建分支失败 — ${err.message}`);
    }
  }

  async _callEngine(nodeId, prompt, branchId) {
    try {
      const resp = await fetch(`${this.apiBase}/api/canvas/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId, prompt, branchId, projectId: this.projectId }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const body = await resp.json();
      const data = (body && body.data) ? body.data : body;
      return data;
    } catch (err) {
      throw new Error(`_callEngine(${nodeId}): 引擎调用失败 — ${err.message}`);
    }
  }

  async _buildPrompt(action) {
    // Step 1: fetch original node context (breakpoint 4)
    let base = '';
    try {
      const resp = await fetch(`${this.apiBase}/api/canvas/load`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: Number(this.projectId),
          episodesId: Number(this.episodesId),
        }),
      });
      if (resp.ok) {
        const body = await resp.json();
        const graph = body?.data ?? body;
        const node = Array.isArray(graph?.nodes)
          ? graph.nodes.find((n) => n.id === action.nodeId)
          : null;
        base = node?.description || node?.content || node?.prompt || '';
      }
    } catch { /* graceful degrade — empty base */ }

    // Step 2: load prompt-overrides.json (breakpoints 1+2)
    const overrides = (await this._readJsonOptional(this.overridesPath)) || {};

    // Step 3: collect prompt_modification additions (skip thresholds/parameterChanges)
    const additions = [];
    for (const [target, entries] of Object.entries(overrides)) {
      if (target === 'thresholds' || target === 'parameterChanges') continue;
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          if (entry?.change) additions.push(entry.change);
        }
      }
    }

    // Step 4: compose base + [进化指令] + [迭代增补]
    let result = base;
    if (additions.length > 0) {
      result = result
        ? `${result}\n\n[进化指令] ${additions.join('; ')}`
        : `[进化指令] ${additions.join('; ')}`;
    }
    if (action.promptDelta) {
      result = result
        ? `${result}\n\n[迭代增补] ${action.promptDelta}`
        : `[迭代增补] ${action.promptDelta}`;
    }
    return result;
  }

  /**
   * 拓扑排序 — Kahn's algorithm。
   * @param {IterationAction[]} actions
   * @returns {IterationAction[]}
   */
  _topologicalSort(actions) {
    const nodeIds = new Set(actions.map((a) => a.nodeId));
    // Build edges from action.dependsOn (filter to existing nodeIds)
    const edges = {}; // nodeId -> [dependent nodeIds]
    const inDeg = {};
    for (const a of actions) {
      if (!inDeg[a.nodeId]) inDeg[a.nodeId] = 0;
      if (!edges[a.nodeId]) edges[a.nodeId] = [];
    }
    for (const a of actions) {
      const deps = Array.isArray(a.dependsOn) ? a.dependsOn.filter((d) => nodeIds.has(d)) : [];
      for (const dep of deps) {
        if (!edges[dep]) edges[dep] = [];
        edges[dep].push(a.nodeId);
        inDeg[a.nodeId] = (inDeg[a.nodeId] || 0) + 1;
      }
    }

    // Seed queue with in-degree 0, preserving original order
    const queue = actions.filter((a) => (inDeg[a.nodeId] || 0) === 0).map((a) => a.nodeId);
    const result = [];
    while (queue.length > 0) {
      const id = queue.shift();
      const action = actions.find((a) => a.nodeId === id);
      if (action) result.push(action);
      for (const neighbor of (edges[id] || [])) {
        inDeg[neighbor] -= 1;
        if (inDeg[neighbor] === 0) queue.push(neighbor);
      }
    }

    if (result.length !== actions.length) {
      throw new Error('cycle detected in iteration actions');
    }
    return result;
  }

  _broadcast(event, payload) {
    // Best-effort WebSocket event emit via platform canvas events API.
    try {
      fetch(`${this.apiBase}/api/canvas/v2/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, payload, projectId: this.projectId }),
      }).catch(() => { /* best-effort */ });
    } catch { /* ignore */ }
  }

  // ─── confirm / discard ─────────────────────────────────────

  async confirm(branchId) {
    // Find the plan that created this branch
    const plans = await this.listPlans();
    const matchPlan = plans.find((p) => p.result && p.result.branchId === branchId)
      || plans.find((p) => p.branchLabel === branchId);

    // Set branch active
    try {
      const resp = await fetch(`${this.apiBase}/api/canvas/v2/branches/${branchId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: this.projectId, status: 'active' }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    } catch (err) {
      throw new Error(`confirm(): 设置分支 active 失败 — ${err.message}`);
    }

    // If the plan has pipelineAdjustment, apply it
    if (matchPlan && this._hasPipelineAdjustment(matchPlan)) {
      await this._applyPipelineAdjustment(matchPlan);
    }

    // Archive prior active branch (best-effort)
    try {
      // We don't know the prior branch id reliably; best-effort no-op.
    } catch { /* ignore */ }
  }

  async discard(branchId, reason = '') {
    try {
      const resp = await fetch(`${this.apiBase}/api/canvas/v2/branches/${branchId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: this.projectId, status: 'rejected', reason }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    } catch (err) {
      throw new Error(`discard(): 设置分支 rejected 失败 — ${err.message}`);
    }

    // Update plan row status to 'discarded'
    const plans = await this.listPlans();
    const matchPlan = plans.find((p) => p.result && p.result.branchId === branchId);
    if (matchPlan) {
      const rows = await this._readJsonlOptional(this.plansPath);
      const idx = rows.findIndex((r) => r.id === matchPlan.id);
      if (idx >= 0) {
        rows[idx].status = 'discarded';
        rows[idx].discardedAt = new Date().toISOString();
        rows[idx].discardReason = reason;
        await this._writeJsonl(this.plansPath, rows);
      }
    }
  }

  async approveAdjustment(planId) {
    const rows = await this._readJsonlOptional(this.plansPath);
    const idx = rows.findIndex((r) => r.id === planId);
    if (idx < 0) throw new Error(`approveAdjustment(): 未找到 plan '${planId}'`);
    rows[idx].adjustmentApproved = true;
    rows[idx].status = 'approved';
    rows[idx].approvedAt = new Date().toISOString();
    await this._writeJsonl(this.plansPath, rows);
  }

  /**
   * Returns effective thresholds by merging defaults with operator-approved
   * overrides from prompt-overrides.json. Used by reflection/iteration flows
   * when evaluating whether quality scores pass the bar.
   *
   * Default thresholds: { total: 65, critical: 40, warning: 75 }
   * Override shape (per threshold_adjustment):
   *   { thresholds: { <target>: { change: <number>, ... } } }
   *
   * @returns {Promise<{total:number, critical:number, warning:number}>}
   */
  async getEffectiveThresholds() {
    const defaults = { total: 65, critical: 40, warning: 75 };
    try {
      const overrides = (await this._readJsonOptional(this.overridesPath)) || {};
      if (!overrides.thresholds) return defaults;
      const merged = { ...defaults };
      for (const [key, val] of Object.entries(overrides.thresholds)) {
        if (val?.change != null && typeof val.change === 'number') {
          merged[key] = val.change;
        }
      }
      return merged;
    } catch {
      return defaults;
    }
  }

  async _applyPipelineAdjustment(planObj) {
    await this._ensureDir();
    let overrides = {};
    if (existsSync(this.overridesPath)) {
      try { overrides = JSON.parse(await readFile(this.overridesPath, 'utf-8')); }
      catch { overrides = {}; }
    }
    for (const action of (planObj.actions || [])) {
      const adj = action.pipelineAdjustment;
      if (!adj) continue;
      if (adj.type === 'prompt_modification') {
        overrides[adj.target] = overrides[adj.target] || [];
        overrides[adj.target].push({
          change: adj.change,
          appliedAt: new Date().toISOString(),
          source: 'iteration-engine',
        });
      } else if (adj.type === 'threshold_adjustment') {
        overrides.thresholds = overrides.thresholds || {};
        overrides.thresholds[adj.target] = {
          change: adj.change,
          appliedAt: new Date().toISOString(),
          source: 'iteration-engine',
        };
      } else if (adj.type === 'parameter_change') {
        // Record only — no source mutation
        overrides.parameterChanges = overrides.parameterChanges || [];
        overrides.parameterChanges.push({
          target: adj.target,
          change: adj.change,
          appliedAt: new Date().toISOString(),
          source: 'iteration-engine',
        });
      }
    }
    await writeFile(this.overridesPath, JSON.stringify(overrides, null, 2), 'utf-8');
  }

  // ─── plan storage ─────────────────────────────────────────

  async _storePlan(planObj) {
    await this._appendJsonl(this.plansPath, planObj);
  }

  async _readPlan(planId) {
    const rows = await this._readJsonlOptional(this.plansPath);
    const row = rows.find((r) => r.id === planId);
    if (!row) throw new Error(`_readPlan(): 未找到 plan '${planId}'`);
    return row;
  }

  async listPlans() {
    return this._readJsonlOptional(this.plansPath);
  }

  async getStatus(planId) {
    const planObj = await this._readPlan(planId);
    return { planId, status: planObj.status, result: planObj.result || null };
  }
}
