/**
 * 1st-director.js — 四维蓝图生成器（元层）
 * 基于预测编码理论，在四个时间尺度上精密控制观众大脑的预测编码过程。
 *
 * 四维尺度：
 *   神经尺度（0.1-1s）：预测误差、注意力锚点、归因闭环窗口
 *   情绪尺度（3-10s）：锯齿循环、张力递进、无平淡期
 *   叙事尺度（10-30s）：价值缺口、身份投射、价值兑现
 *   社交尺度（30-60s）：截图时刻、引用候选、模因密度
 *
 * 作为元层注入 pipeline，不替代任何现有模块。
 * API 调用失败时返回空蓝图/空建议，不阻塞管线。
 * ES Module
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// ─── 默认空蓝图 ─────────────────────────────────────────

const EMPTY_BLUEPRINT = {
  title: '',
  duration_sec: 60,
  audience_profile: {},
  timeline: [],
  constraints: {
    neuro: { errorRange: [0.15, 0.30], attributionWindow: 5, captureInterval: 8 },
    emotion: { sawtoothCycle: true, tensionEscalation: true, noFlatPeriod: 15 },
    narrative: { valueGap: true, identityProjection: true, valueFulfillment: true },
    social: { screenshotMoment: 1, quoteCandidate: 1, memeComplexity3s: true, memeDensity: 'per60s' },
  },
  entropyPoints: [],
};

// ─── FirstDirector 类 ───────────────────────────────────

export class FirstDirector {
  /**
   * @param {object} options
   * @param {string} [options.workdir] - 项目工作目录
   * @param {string} [options.apiBase] - OpenAI 兼容 API 地址
   * @param {string} [options.apiKey] - API Key
   * @param {string} [options.model] - 模型名称
   * @param {string} [options.blueprintPath] - 蓝图保存路径
   */
  constructor(options = {}) {
    this.workdir = options.workdir || process.cwd();
    this.apiBase = options.apiBase || process.env.OPENAI_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4';
    this.apiKey = options.apiKey || process.env.ZHIPU_API_KEY || process.env.OPENAI_API_KEY || '';
    this.model = options.model || 'glm-4-flash';
    this.blueprintPath = options.blueprintPath || 'blueprint.json';
  }

  // ─── LLM 调用 ─────────────────────────────────────────

  async _callLLM(prompt) {
    if (!this.apiKey) {
      console.warn('[1st-director] 无 API Key，返回空蓝图');
      return null;
    }
    try {
      const resp = await fetch(`${this.apiBase}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          max_tokens: 4096,
        }),
        signal: AbortSignal.timeout(60000),
      });
      if (!resp.ok) {
        console.warn(`[1st-director] API 返回 ${resp.status}`);
        return null;
      }
      const data = await resp.json();
      const content = data.choices?.[0]?.message?.content || '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      return JSON.parse(jsonMatch[0]);
    } catch (err) {
      console.warn(`[1st-director] LLM 调用失败: ${err.message}`);
      return null;
    }
  }

  // ─── 四维蓝图生成 ─────────────────────────────────────

  /**
   * 根据需求生成四维约束蓝图
   * @param {object} requirement - 需求确认结果
   * @param {object} [options]
   * @returns {Promise<object>} { blueprint, dimensions, timeline, checklists }
   */
  async generateBlueprint(requirement, options = {}) {
    const durationSec = requirement.duration_sec || 60;
    const title = requirement.title || '';
    const genre = requirement.genre || '短剧';

    const prompt = `你是一个基于预测编码理论的AI短剧总导演。请为以下短片需求生成四维约束蓝图。

## 需求
- 片名: ${title}
- 类型: ${genre}
- 时长: ${durationSec}秒
- 主题: ${requirement.theme || ''}
- 角色: ${(requirement.characters || []).map(c => c.name).join(', ') || '未定'}
- 风格偏好: ${requirement.style_preference || ''}

## 四维尺度说明
1. **神经尺度**（0.1-1s）：预测误差幅度、注意力锚点设计、归因闭环窗口（≤5s）、注意力重捕获间隔（≤8s）
2. **情绪尺度**（3-10s）：锯齿循环（情绪不能单调）、张力递进、无平淡期（≤15s）
3. **叙事尺度**（10-30s）：价值缺口建立、身份投射、价值兑现
4. **社交尺度**（30-60s）：截图时刻（高视觉冲击帧）、引用候选（金句）、模因密度（每60s至少1个可传播模因）

请严格按以下 JSON 格式返回：
{
  "title": "片名",
  "duration_sec": ${durationSec},
  "audience_profile": {
    "primary_emotion": "主要情绪",
    "age_range": "目标年龄段",
    "viewing_context": "观看场景",
    "attention_budget": 8,
    "threshold": 65
  },
  "timeline": [
    {"timestamp": "0-3s", "neuro": "高预测误差，注意力锚点", "emotion": "好奇/惊讶", "narrative": "建立价值缺口", "social": "hook模因"},
    {"timestamp": "3-10s", "neuro": "归因闭环中", "emotion": "焦虑↑", "narrative": "悬念深化", "social": ""},
    {"timestamp": "10-20s", "neuro": "新预测误差", "emotion": "期待/紧张", "narrative": "身份投射", "social": ""},
    {"timestamp": "20-30s", "neuro": "部分归因", "emotion": "释然/反转", "narrative": "转折点", "social": ""},
    {"timestamp": "30-45s", "neuro": "持续误差", "emotion": "高潮/震撼", "narrative": "价值兑现", "social": "截图时刻"},
    {"timestamp": "45-${durationSec}s", "neuro": "归因闭环完成", "emotion": "满足/余韵", "narrative": "收束+余味", "social": "引用候选"}
  ],
  "constraints": {
    "neuro": {"errorRange": [0.15, 0.30], "attributionWindow": 5, "captureInterval": 8},
    "emotion": {"sawtoothCycle": true, "tensionEscalation": true, "noFlatPeriod": 15},
    "narrative": {"valueGap": true, "identityProjection": true, "valueFulfillment": true},
    "social": {"screenshotMoment": 1, "quoteCandidate": 1, "memeComplexity3s": true, "memeDensity": "per60s"}
  },
  "entropyPoints": []
}`;

    const result = await this._callLLM(prompt);
    const blueprint = result || { ...EMPTY_BLUEPRINT, title, duration_sec: durationSec };

    // 补充熵注入点
    if (blueprint.entropyPoints.length === 0) {
      blueprint.entropyPoints = this.generateEntropyInjectionPoints(blueprint.timeline || []);
    }

    // 生成检查清单
    const checklists = this._buildChecklists(blueprint);

    return {
      blueprint,
      dimensions: ['neuro', 'emotion', 'narrative', 'social'],
      timeline: blueprint.timeline || [],
      checklists,
    };
  }

  // ─── 四维 → 六维门控映射 ─────────────────────────────

  /**
   * 将蓝图约束映射为 quality-gate 的权重和阈值
   * @param {object} blueprint
   * @returns {{ weights: object, thresholds: object, customChecks: string[] }}
   */
  mapToGateDimensions(blueprint) {
    if (!blueprint || !blueprint.constraints) {
      return { weights: {}, thresholds: {}, customChecks: [] };
    }

    const c = blueprint.constraints;
    const weights = {
      hook: (c.neuro.errorRange?.[1] || 0.30) * 83,
      structure: (c.emotion.sawtoothCycle ? 1 : 0.5) * 67,
      realism: (c.emotion.tensionEscalation ? 1 : 0.5) * 67,
      title_cover: ((c.narrative.valueGap ? 1 : 0) + (c.social.screenshotMoment || 0)) * 75,
      duration: (c.neuro.captureInterval || 8) * 33,
      engagement: 100, // memeDensity 不直接是数字，给满分
    };

    // 归一化权重到满分100
    const total = Object.values(weights).reduce((s, v) => s + v, 0);
    if (total > 0 && total !== 100) {
      for (const k of Object.keys(weights)) {
        weights[k] = Math.round((weights[k] / total) * 100);
      }
    }

    const thresholds = {
      total: blueprint.audience_profile?.threshold || 65,
      critical: 40,
      warning: 75,
    };

    const customChecks = [];
    if (c.neuro.attributionWindow) {
      customChecks.push(`归因闭环窗口 ≤ ${c.neuro.attributionWindow}s`);
    }
    if (c.emotion.noFlatPeriod) {
      customChecks.push(`无平淡期 ≤ ${c.emotion.noFlatPeriod}s`);
    }
    if (c.social.screenshotMoment) {
      customChecks.push(`至少 ${c.social.screenshotMoment} 个截图时刻`);
    }

    return { weights, thresholds, customChecks };
  }

  // ─── 认知走查 ─────────────────────────────────────────

  /**
   * 模拟观众走查，发现断裂点和冗余点
   * @param {object} inputs - { script?, images?, videoPath? }
   * @param {object} [options]
   * @returns {Promise<object>} { 断裂点, 冗余点, 建议, walkScore }
   */
  async cognitiveWalkthrough(inputs, options = {}) {
    let scriptContent = '';
    if (inputs.script) {
      try {
        scriptContent = typeof inputs.script === 'string'
          ? inputs.script
          : await readFile(join(this.workdir, inputs.script), 'utf-8');
      } catch { /* ignore */ }
    }

    if (!scriptContent && !this.apiKey) {
      return { 断裂点: [], 冗余点: [], 建议: [], walkScore: 80 };
    }

    const prompt = `你是一个基于预测编码理论的认知走查专家。请模拟观众观看以下内容时的认知过程，找出断裂点和冗余点。

## 走查维度
1. **断裂点**：观众预期被打破但未得到解释的时刻（归因失败）
2. **冗余点**：信息重复或节奏拖沓的时刻（预测误差过低）
3. **建议**：具体的改进方向

## 内容
${scriptContent.slice(0, 4000)}

请严格按以下 JSON 格式返回：
{
  "断裂点": [{"timestamp": "时间", "description": "描述", "severity": "high/medium/low"}],
  "冗余点": [{"timestamp": "时间", "description": "描述", "severity": "high/medium/low"}],
  "建议": ["建议1", "建议2"],
  "walkScore": 80
}`;

    const result = await this._callLLM(prompt);
    if (!result) {
      return { 断裂点: [], 冗余点: [], 建议: [], walkScore: 80 };
    }

    return {
      断裂点: result.断裂点 || [],
      冗余点: result.冗余点 || [],
      建议: result.建议 || [],
      walkScore: typeof result.walkScore === 'number' ? result.walkScore : 80,
    };
  }

  // ─── 模因提取（纯代码逻辑） ─────────────────────────

  /**
   * 从脚本中提取高情感密度句子作为模因候选
   * @param {string} script - 脚本文本或 JSON 路径
   * @param {Array} [timeline] - 蓝图时间线（可选，用于匹配时间戳）
   * @returns {{ screenshotMoments: string[], quoteCandidates: string[], memeDensity: number }}
   */
  extractMemes(script, timeline) {
    let text = '';
    if (typeof script === 'string') {
      try {
        const parsed = JSON.parse(script);
        text = this._flattenScript(parsed);
      } catch {
        text = script;
      }
    } else if (typeof script === 'object') {
      text = this._flattenScript(script);
    }

    if (!text) return { screenshotMoments: [], quoteCandidates: [], memeDensity: 0 };

    // 高情感密度特征：短句 + 感叹/问号 + 对比/反转词
    const emotionalPatterns = /(.{5,40}[！？…]|[！？…].{0,40})/g;
    const quotePatterns = /([""「」].{8,50}[""「」])/g;
    const contrastPatterns = /(但是|然而|却|没想到|原来|竟然|居然|偏偏|偏偏).{5,30}/g;

    const quoteCandidates = [];
    const seen = new Set();

    for (const match of text.matchAll(quotePatterns)) {
      const q = match[1].trim();
      if (!seen.has(q) && q.length >= 8) {
        quoteCandidates.push(q);
        seen.add(q);
      }
    }
    for (const match of text.matchAll(emotionalPatterns)) {
      const q = match[1].trim();
      if (!seen.has(q) && q.length >= 6 && quoteCandidates.length < 10) {
        quoteCandidates.push(q);
        seen.add(q);
      }
    }

    // 截图时刻：从 timeline 中标记了 social 的节点
    const screenshotMoments = (timeline || [])
      .filter(t => t.social && t.social !== '')
      .map(t => `${t.timestamp}: ${t.social}`);

    const durationSec = 60; // 默认
    const memeDensity = quoteCandidates.length / (durationSec / 60);

    return { screenshotMoments, quoteCandidates, memeDensity: Math.round(memeDensity * 10) / 10 };
  }

  // ─── 熵注入（防僵化） ────────────────────────────────

  /**
   * 在时间线上注入变化点，防止视觉/时序/路径僵化
   * @param {Array} timeline - 蓝图时间线
   * @param {object} [options]
   * @returns {Array<{ timestamp: string, type: string, intensity: number, description: string }>}
   */
  generateEntropyInjectionPoints(timeline, options = {}) {
    if (!timeline || timeline.length === 0) return [];

    const points = [];
    const intensity = options.intensity || 0.3;
    const types = ['visual_mutation', 'timing_shift', 'path_branch'];

    // 在时间线中点附近注入
    const midIdx = Math.floor(timeline.length / 2);
    if (midIdx > 0 && midIdx < timeline.length) {
      points.push({
        timestamp: timeline[midIdx].timestamp,
        type: 'visual_mutation',
        intensity,
        description: '在中段注入视觉突变，打破单调预期',
      });
    }

    // 在结尾前注入路径分支
    if (timeline.length > 2) {
      points.push({
        timestamp: timeline[timeline.length - 2].timestamp,
        type: 'path_branch',
        intensity: intensity * 0.8,
        description: '在收束前提供短暂的路径分支悬念',
      });
    }

    // 在开头后注入时序微调
    if (timeline.length > 1) {
      points.push({
        timestamp: timeline[1].timestamp,
        type: 'timing_shift',
        intensity: intensity * 0.5,
        description: '在钩子后微调节奏，避免节奏可预测',
      });
    }

    return points;
  }

  // ─── 因果闭环（发布后数据回填） ───────────────────────

  /**
   * 记录发布后的表现数据，生成因果洞察
   * @param {object} publishMetrics - { completionRate, shareRate, commentCount, likeCount, ... }
   * @param {object} blueprint - 使用的蓝图
   * @returns {{ causalInsights: string[], parameterUpdates: object }}
   */
  recordCausalData(publishMetrics, blueprint) {
    if (!publishMetrics || !blueprint) {
      return { causalInsights: [], parameterUpdates: {} };
    }

    const insights = [];
    const updates = {};

    const completionRate = publishMetrics.completionRate || 0;
    if (completionRate < 0.3) {
      insights.push('完播率极低，神经尺度预测误差可能过高或过低');
      updates.neuro_error_adjust = -0.05;
    } else if (completionRate < 0.5) {
      insights.push('完播率偏低，检查归因闭环窗口是否过长');
      updates.neuro_attribution_adjust = -1;
    } else if (completionRate > 0.7) {
      insights.push('完播率优秀，当前神经尺度参数有效');
    }

    if (publishMetrics.shareRate > 0.05) {
      insights.push('分享率高，社交尺度模因设计有效');
    }

    if (publishMetrics.commentCount > (publishMetrics.likeCount || 0) * 0.1) {
      insights.push('评论率高，互动设计有效');
    }

    return { causalInsights: insights, parameterUpdates: updates };
  }

  // ─── 蓝图持久化 ──────────────────────────────────────

  /**
   * 保存蓝图到文件
   * @param {object} blueprint
   */
  async saveBlueprint(blueprint) {
    const path = join(this.workdir, this.blueprintPath);
    await writeFile(path, JSON.stringify(blueprint, null, 2));
    return path;
  }

  /**
   * 加载蓝图
   * @returns {Promise<object|null>}
   */
  async loadBlueprint() {
    try {
      const path = join(this.workdir, this.blueprintPath);
      const raw = await readFile(path, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  // ─── 内部方法 ─────────────────────────────────────────

  _buildChecklists(blueprint) {
    const checklists = {
      neuro: [],
      emotion: [],
      narrative: [],
      social: [],
    };

    const c = blueprint.constraints || {};
    if (c.neuro?.errorRange) checklists.neuro.push(`预测误差范围: ${c.neuro.errorRange[0]}-${c.neuro.errorRange[1]}`);
    if (c.neuro?.attributionWindow) checklists.neuro.push(`归因闭环窗口: ≤${c.neuro.attributionWindow}s`);
    if (c.neuro?.captureInterval) checklists.neuro.push(`注意力重捕获间隔: ≤${c.neuro.captureInterval}s`);

    if (c.emotion?.sawtoothCycle) checklists.emotion.push('情绪锯齿循环: 情绪不能单调递增');
    if (c.emotion?.tensionEscalation) checklists.emotion.push('张力递进: 整体张力逐步上升');
    if (c.emotion?.noFlatPeriod) checklists.emotion.push(`无平淡期: ≤${c.emotion.noFlatPeriod}s`);

    if (c.narrative?.valueGap) checklists.narrative.push('价值缺口: 前10s建立价值缺口');
    if (c.narrative?.identityProjection) checklists.narrative.push('身份投射: 让观众代入角色');
    if (c.narrative?.valueFulfillment) checklists.narrative.push('价值兑现: 结尾必须兑现价值缺口');

    if (c.social?.screenshotMoment) checklists.social.push(`截图时刻: ≥${c.social.screenshotMoment}个`);
    if (c.social?.quoteCandidate) checklists.social.push(`引用候选: ≥${c.social.quoteCandidate}个金句`);
    if (c.social?.memeComplexity3s) checklists.social.push('模因3秒原则: 模因必须3秒内理解');

    return checklists;
  }

  _flattenScript(parsed) {
    const parts = [];
    if (parsed.logline) parts.push(parsed.logline);
    if (Array.isArray(parsed.scenes)) {
      for (const scene of parsed.scenes) {
        if (scene.description) parts.push(scene.description);
        if (Array.isArray(scene.dialogues)) {
          for (const d of scene.dialogues) {
            parts.push(`${d.character || '?'}: ${d.line || d.text || ''}`);
          }
        }
      }
    }
    if (Array.isArray(parsed.shots)) {
      for (const shot of parsed.shots) {
        parts.push(shot.description || shot.visual || '');
      }
    }
    return parts.join('\n');
  }
}

export default FirstDirector;
