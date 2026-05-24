/**
 * quality-gate.js — AIGC 质量门控引擎
 * 对成品进行 6 维度评分，基于完播率策略体系。
 * ES Module
 *
 * API 调用失败时默认通过，不阻塞管线。
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

// ─── 维度定义 ────────────────────────────────────────────

const DIMENSION_META = {
  hook:        { label: '黄金3秒钩子', emoji: '🪝', max: 25 },
  structure:   { label: '内容结构节奏', emoji: '🎼', max: 20 },
  realism:     { label: 'AIGC真实感',   emoji: '🎭', max: 20 },
  title_cover: { label: '标题与封面',   emoji: '🖼️', max: 15 },
  duration:    { label: '时长适配',     emoji: '⏱️', max: 10 },
  engagement:  { label: '互动潜力',     emoji: '💬', max: 10 },
};

// ─── 评分 Prompt 模板 ────────────────────────────────────

const SCORING_PROMPTS = {
  hook: `你是一个短视频质量评审专家。请评估以下内容的"黄金3秒钩子"维度（满分{max}分）。

评分标准：
- 是否有明确的注意力锚点（悬念/痛点/反差/情绪/价值）
- 钩子类型与内容类型的匹配度
- 是否避免"片头动画+自我介绍+背景铺垫"（零延迟原则）
- 前3秒是否有视觉冲击（运动/色彩突变/表情夸张）

扣分参考：
- 开头平淡无明确钩子 → -8~10分
- 钩子与内容不匹配（标题党）→ -5~8分
- 有片头logo/自我介绍等冗余 → -3~5分

请以 JSON 格式返回：
{"score": 数字, "reasons": ["扣分原因1", "扣分原因2"], "highlights": ["亮点1"], "suggestions": ["建议1"]}

内容摘要：
{content}`,

  structure: `你是一个短视频质量评审专家。请评估以下内容的"内容结构与节奏"维度（满分{max}分）。

评分标准：
- 是否遵循"心跳曲线"（每20-30秒有小高潮）
- 信息密度是否动态变化（非平铺直叙）
- 是否剔除了无关场景和冗余内容
- 结尾是否"高潮收尾"（避免"谢谢观看"式结尾）

请以 JSON 格式返回：
{"score": 数字, "reasons": ["扣分原因1"], "highlights": ["亮点1"], "suggestions": ["建议1"]}

内容摘要：
{content}`,

  realism: `你是一个短视频质量评审专家。请评估以下内容的"AIGC真实感"维度（满分{max}分）。

评分标准：
- 是否避免"过度精致化"（完美光线、完美构图、完美皮肤）
- 是否模拟"真人随手拍"风格（轻微抖动、自然光线）
- 语言是否自然（口语化、有语气词、避免书面腔）
- 情感表达是否到位（微表情、眼神流转、肢体语言）

扣分参考：
- 明显AI痕迹（塑料感、游戏动画感）→ -8~12分
- 广告感强（过度精致画面、商业腔调）→ -6~10分
- 恐怖谷效应（表情僵硬、眼神空洞）→ -8~12分

请以 JSON 格式返回：
{"score": 数字, "reasons": ["扣分原因1"], "highlights": ["亮点1"], "suggestions": ["建议1"]}

内容描述：
{content}`,

  title_cover: `你是一个短视频质量评审专家。请评估以下内容的"标题与封面"维度（满分{max}分）。

评分标准：
- 标题是否有悬念+利益点的平衡
- 标题是否包含数字/疑问/冲突元素（不超过2种）
- 封面是否有高冲击力（高对比度、明确主体、情绪指向）
- 标题-封面-内容三者是否一致（非标题党）

请以 JSON 格式返回：
{"score": 数字, "reasons": ["扣分原因1"], "highlights": ["亮点1"], "suggestions": ["建议1"]}

标题: {title}
内容摘要: {content}`,

  duration: `你是一个短视频质量评审专家。请评估以下内容的"时长适配"维度（满分{max}分）。

最佳时长参考：
- 短剧: 30-90秒/集（完播率峰值45-60秒）
- 知识/教程: 30-60秒（峰值30-45秒）
- 娱乐/搞笑: 15-30秒（峰值15-25秒）
- 广告/带货: 15-30秒（峰值15-20秒）
- 情感/故事: 30-90秒（峰值45-75秒）

扣分参考：
- 时长超出最佳区间2倍以上 → -5~8分
- 内容被拖长填充 → -3~5分

请以 JSON 格式返回：
{"score": 数字, "reasons": ["扣分原因1"], "highlights": ["亮点1"], "suggestions": ["建议1"]}

内容类型: {contentType}
预估时长: {durationSec}秒
内容摘要: {content}`,

  engagement: `你是一个短视频质量评审专家。请评估以下内容的"互动潜力"维度（满分{max}分）。

评分标准：
- 是否设置互动引导点（提问、投票、争议观点）
- 是否有收藏价值（干货、清单、工具推荐）
- 是否有转发动机（社交货币、身份认同、情感共鸣）
- 是否有评论引导（开放性问题、争议话题）

请以 JSON 格式返回：
{"score": 数字, "reasons": ["扣分原因1"], "highlights": ["亮点1"], "suggestions": ["建议1"]}

内容摘要：
{content}`,
};

// ─── QualityGate 类 ──────────────────────────────────────

export class QualityGate {
  /**
   * @param {object} options
   * @param {string} options.workdir - 项目工作目录
   * @param {object} [options.config] - 管线配置
   * @param {string} [options.configPath] - 自定义配置文件路径
   * @param {string} [options.platform] - 平台预设
   * @param {string} [options.contentType] - 内容类型
   * @param {string} [options.apiBase] - OpenAI 兼容 API 地址
   * @param {string} [options.apiKey] - API Key
   * @param {string} [options.visionModel] - 视觉模型名称
   * @param {string} [options.textModel] - 文本模型名称
   */
  constructor(options = {}) {
    this.workdir = options.workdir || process.cwd();
    this.config = options.config || {};
    this.configPath = options.configPath || join(import.meta.dirname, 'gate-config.yaml');
    this.platform = options.platform || this.config.platform || 'douyin';
    this.contentType = options.contentType || this.config.genre || '短剧';
    this.apiBase = options.apiBase || process.env.OPENAI_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4';
    this.apiKey = options.apiKey || process.env.ZHIPU_API_KEY || process.env.OPENAI_API_KEY || '';
    this.visionModel = options.visionModel || 'glm-4.6v-flash';
    this.textModel = options.textModel || 'glm-4-flash';

    this._gateConfig = null;
    this._loadConfig(); // 构造时立即加载
  }

  /** 当前阈值 */
  get threshold() { return this._gateConfig?.threshold || { total: 65, critical: 40, warning: 75 }; }
  /** 当前维度权重 */
  get weights() { return this._gateConfig?.dimensions || { hook: 25, structure: 20, realism: 20, title_cover: 15, duration: 10, engagement: 10 }; }

  /**
   * 加载门控配置
   */
  _loadConfig() {
    if (this._gateConfig) return this._gateConfig;
    try {
      const raw = readFileSync(this.configPath, 'utf-8');
      this._gateConfig = this._parseYaml(raw);
    } catch {
      // 配置加载失败使用默认值
      this._gateConfig = {
        threshold: { total: 65, critical: 40, warning: 75 },
        dimensions: { hook: 25, structure: 20, realism: 20, title_cover: 15, duration: 10, engagement: 10 },
      };
    }
    return this._gateConfig;
  }

  /**
   * 简易 YAML 解析（仅支持本配置文件的扁平结构）
   */
  _parseYaml(raw) {
    const config = { threshold: {}, dimensions: {}, platform_presets: {}, content_type_presets: {} };
    let currentSection = null;
    let currentPreset = null;

    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // 顶层 section
      if (trimmed === 'threshold:') { currentSection = 'threshold'; currentPreset = null; continue; }
      if (trimmed === 'dimensions:') { currentSection = 'dimensions'; currentPreset = null; continue; }
      if (trimmed === 'platform_presets:') { currentSection = 'platform_presets'; currentPreset = null; continue; }
      if (trimmed === 'content_type_presets:') { currentSection = 'content_type_presets'; currentPreset = null; continue; }

      // 预设 key（2空格缩进）
      const presetMatch = trimmed.match(/^(\w+):\s*$/);
      if (presetMatch && currentSection && ['platform_presets', 'content_type_presets'].includes(currentSection)) {
        currentPreset = presetMatch[1];
        config[currentSection][currentPreset] = {};
        continue;
      }

      // 键值对
      const kvMatch = trimmed.match(/^(\w[\w_]*):\s*(.+)$/);
      if (kvMatch) {
        const [, key, value] = kvMatch;
        const parsed = this._parseValue(value);
        if (currentPreset && config[currentSection]) {
          config[currentSection][currentPreset][key] = parsed;
        } else if (config[currentSection] !== undefined) {
          config[currentSection][key] = parsed;
        }
      }
    }
    return config;
  }

  _parseValue(val) {
    val = val.trim();
    // 去掉行内注释
    const commentIdx = val.indexOf(' #');
    if (commentIdx > 0) val = val.slice(0, commentIdx).trim();
    // 数组 [a, b]
    if (val.startsWith('[') && val.endsWith(']')) {
      return val.slice(1, -1).split(',').map(v => {
        const n = Number(v.trim());
        return isNaN(n) ? v.trim() : n;
      });
    }
    const n = Number(val);
    return isNaN(n) ? val : n;
  }

  /**
   * 获取有效阈值（平台预设覆盖默认）
   */
  _getThresholds() {
    const cfg = this._loadConfig();
    const platformPreset = cfg.platform_presets?.[this.platform];
    return {
      total: platformPreset?.total ?? cfg.threshold.total,
      critical: platformPreset?.critical ?? cfg.threshold.critical,
      warning: platformPreset?.warning ?? cfg.threshold.warning,
    };
  }

  /**
   * 调用 LLM 进行评分
   */
  async _callLLM(prompt) {
    if (!this.apiKey) {
      console.warn('[quality-gate] 无 API Key，跳过评分');
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
          model: this.textModel,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 1024,
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!resp.ok) {
        console.warn(`[quality-gate] API 返回 ${resp.status}`);
        return null;
      }
      const data = await resp.json();
      const content = data.choices?.[0]?.message?.content || '';
      // 提取 JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      return JSON.parse(jsonMatch[0]);
    } catch (err) {
      console.warn(`[quality-gate] LLM 调用失败: ${err.message}`);
      return null;
    }
  }

  /**
   * 对成品进行全面评分
   * @param {object} inputs - { script?, images?, videoPath?, title?, coverPath? }
   * @param {object} options - { platform?, contentType? }
   * @returns {Promise<object>} { passed, totalScore, dimensions, report, suggestions }
   */
  async evaluate(inputs, options = {}) {
    const platform = options.platform || this.platform;
    const contentType = options.contentType || this.contentType;
    const blueprint = options.blueprint || null;

    // 如果有蓝图，使用蓝图映射的权重和阈值
    let blueprintWeights = null;
    let blueprintThresholds = null;
    let cognitiveResult = null;
    if (blueprint) {
      try {
        const { FirstDirector } = await import('./1st-director.js');
        const director = new FirstDirector({ workdir: this.workdir });
        const mapped = director.mapToGateDimensions(blueprint);
        blueprintWeights = mapped.weights;
        blueprintThresholds = mapped.thresholds;

        // 认知走查
        cognitiveResult = await director.cognitiveWalkthrough(inputs);
      } catch (err) {
        console.warn(`[quality-gate] 蓝图集成失败: ${err.message}`);
      }
    }

    const thresholds = blueprintThresholds || this._getThresholds();

    // 读取脚本内容
    let scriptContent = '';
    let title = inputs.title || this.config.title || '';
    let durationSec = inputs.durationSec || this.config.duration_sec || 60;

    if (inputs.script) {
      try {
        const scriptPath = join(this.workdir, inputs.script);
        const raw = await readFile(scriptPath, 'utf-8');
        const parsed = JSON.parse(raw);
        // 提取摘要
        scriptContent = this._extractScriptSummary(parsed);
        title = title || parsed.title || '';
        durationSec = durationSec || parsed.duration_sec || 60;
      } catch {
        // 非JSON，当文本处理
        try {
          scriptContent = await readFile(join(this.workdir, inputs.script), 'utf-8');
        } catch { /* ignore */ }
      }
    }

    // 逐维度评分
    const dimensions = {};
    const allSuggestions = [];
    const allReasons = [];
    const allHighlights = [];

    for (const [dimKey, meta] of Object.entries(DIMENSION_META)) {
      try {
        const score = await this.scoreDimension(dimKey, {
          scriptContent,
          title,
          durationSec,
          contentType,
          images: inputs.images,
          coverPath: inputs.coverPath,
        });

        if (score) {
          dimensions[dimKey] = {
            score: Math.min(score.score, meta.max),
            max: meta.max,
            reasons: score.reasons || [],
            highlights: score.highlights || [],
            suggestions: score.suggestions || [],
          };
          allReasons.push(...(score.reasons || []).map(r => `[${meta.label}] ${r}`));
          allHighlights.push(...(score.highlights || []).map(h => `[${meta.label}] ${h}`));
          allSuggestions.push(...(score.suggestions || []).map(s => `[${meta.label}] ${s}`));
        } else {
          // API 失败，给默认分
          dimensions[dimKey] = {
            score: Math.round(meta.max * 0.8),
            max: meta.max,
            reasons: ['API 调用失败，使用默认分'],
            highlights: [],
            suggestions: [],
          };
        }
      } catch (err) {
        console.warn(`[quality-gate] ${dimKey} 评分失败: ${err.message}`);
        dimensions[dimKey] = {
          score: Math.round(meta.max * 0.8),
          max: meta.max,
          reasons: ['评分异常，使用默认分'],
          highlights: [],
          suggestions: [],
        };
      }
    }

    // 计算加权总分（蓝图权重或默认满分制）
    let totalScore;
    if (blueprintWeights && Object.keys(blueprintWeights).length > 0) {
      // 使用蓝图权重加权
      totalScore = 0;
      for (const [dimKey, dim] of Object.entries(dimensions)) {
        const weight = blueprintWeights[dimKey] || (dim.max);
        totalScore += Math.round(dim.score * (weight / dim.max));
      }
    } else {
      totalScore = Object.values(dimensions).reduce((sum, d) => sum + d.score, 0);
    }

    // 门控决策
    const decision = this.decide({ totalScore, dimensions, thresholds });

    // 生成报告
    const report = this.generateReport({
      totalScore,
      dimensions,
      decision,
      reasons: allReasons,
      highlights: allHighlights,
      suggestions: allSuggestions,
      cognitiveResult,
    });

    return {
      passed: decision.action !== 'reject' && decision.action !== 'veto',
      totalScore,
      dimensions,
      report,
      suggestions: allSuggestions,
      decision,
      thresholds,
    };
  }

  /**
   * 单维度评分
   */
  async scoreDimension(dimension, inputs) {
    const meta = DIMENSION_META[dimension];
    if (!meta) throw new Error(`未知维度: ${dimension}`);

    const template = SCORING_PROMPTS[dimension];
    if (!template) throw new Error(`无评分模板: ${dimension}`);

    let prompt = template
      .replace('{max}', meta.max)
      .replace('{content}', (inputs.scriptContent || '（无内容）').slice(0, 3000))
      .replace('{title}', inputs.title || '（无标题）')
      .replace('{contentType}', inputs.contentType || '短剧')
      .replace('{durationSec}', inputs.durationSec || 60);

    return this._callLLM(prompt);
  }

  /**
   * 门控决策
   * @param {object} result - { totalScore, dimensions, thresholds }
   * @returns {{ action: 'approve'|'warn'|'reject'|'veto', reason: string, suggestions: string[] }}
   */
  decide(result) {
    const { totalScore, dimensions, thresholds } = result;
    const t = thresholds || this._getThresholds();

    // 一票否决：任一维度 < critical
    for (const [dimKey, dim] of Object.entries(dimensions)) {
      const percentage = (dim.score / dim.max) * 100;
      if (percentage < t.critical) {
        const meta = DIMENSION_META[dimKey];
        return {
          action: 'veto',
          reason: `${meta.emoji} ${meta.label} 得分 ${dim.score}/${dim.max}（${Math.round(percentage)}%），低于临界值 ${t.critical}%，一票否决`,
          suggestions: dim.suggestions?.length ? dim.suggestions : [`请重点改进「${meta.label}」维度`],
        };
      }
    }

    // 总分判断
    if (totalScore >= t.warning) {
      return { action: 'approve', reason: `总分 ${totalScore} ≥ 警告线 ${t.warning}，放行`, suggestions: [] };
    }
    if (totalScore >= t.total) {
      return { action: 'warn', reason: `总分 ${totalScore} 在 ${t.total}-${t.warning - 1} 区间，警告放行`, suggestions: [] };
    }
    return {
      action: 'reject',
      reason: `总分 ${totalScore} < 门槛 ${t.total}，驳回`,
      suggestions: Object.entries(dimensions)
        .sort(([, a], [, b]) => (a.score / a.max) - (b.score / b.max))
        .slice(0, 3)
        .map(([k, d]) => `[${DIMENSION_META[k].label}] ${d.suggestions?.[0] || '需改进'}`),
    };
  }

  /**
   * 生成评分报告
   */
  generateReport(result) {
    const { totalScore, dimensions, decision, reasons = [], highlights = [], suggestions = [] } = result;
    const actionMap = { approve: '🟢放行', warn: '⚠️警告放行', reject: '🔴驳回', veto: '🚫一票否决' };

    let report = `🎬 kais-movie-gate 质量门控报告\n\n`;
    report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    report += `📊 总分: ${totalScore}/100  ${actionMap[decision.action] || decision.action}\n`;
    report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    report += `维度评分:\n`;

    for (const [dimKey, dim] of Object.entries(dimensions)) {
      const meta = DIMENSION_META[dimKey];
      const percentage = (dim.score / dim.max) * 100;
      let status = '✅';
      if (percentage < 60) status = '❌';
      else if (percentage < 75) status = '⚠️';
      report += `  ${meta.emoji} ${meta.label.padEnd(8, '　')}: ${String(dim.score).padStart(2)}/${dim.max}  ${status}\n`;
    }

    if (reasons.length) {
      report += `\n❌ 扣分项:\n`;
      reasons.forEach((r, i) => { report += `  ${i + 1}. ${r}\n`; });
    }

    if (highlights.length) {
      report += `\n✅ 亮点:\n`;
      highlights.forEach((h, i) => { report += `  ${i + 1}. ${h}\n`; });
    }

    if (suggestions.length) {
      report += `\n🔧 改进建议（按优先级排序）:\n`;
      suggestions.forEach((s, i) => { report += `  ${i + 1}. ${s}\n`; });
    }

    // 认知走查报告
    if (result.cognitiveResult) {
      const cr = result.cognitiveResult;
      report += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      report += `🧠 认知走查（1st-director）  得分: ${cr.walkScore}/100\n`;
      report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

      if (cr.断裂点?.length) {
        report += `\n💥 断裂点（归因失败）:\n`;
        cr.断裂点.forEach((p, i) => { report += `  ${i + 1}. [${p.timestamp}] ${p.description} (${p.severity})\n`; });
      }

      if (cr.冗余点?.length) {
        report += `\n🔄 冗余点（预测误差过低）:\n`;
        cr.冗余点.forEach((p, i) => { report += `  ${i + 1}. [${p.timestamp}] ${p.description} (${p.severity})\n`; });
      }

      if (cr.建议?.length) {
        report += `\n💡 走查建议:\n`;
        cr.建议.forEach((s, i) => { report += `  ${i + 1}. ${s}\n`; });
      }
    }

    return report;
  }

  /**
   * 从脚本 JSON 提取摘要
   */
  _extractScriptSummary(parsed) {
    if (typeof parsed === 'string') return parsed.slice(0, 3000);

    const parts = [];
    if (parsed.title) parts.push(`标题: ${parsed.title}`);
    if (parsed.logline) parts.push(`一句话: ${parsed.logline}`);
    if (parsed.genre) parts.push(`类型: ${parsed.genre}`);

    if (Array.isArray(parsed.scenes)) {
      parts.push(`场景数: ${parsed.scenes.length}`);
      for (const scene of parsed.scenes.slice(0, 5)) {
        if (scene.description) parts.push(`场景: ${scene.description.slice(0, 200)}`);
        if (Array.isArray(scene.dialogues)) {
          for (const d of scene.dialogues.slice(0, 3)) {
            parts.push(`${d.character || '?'}: ${d.line || d.text || ''}`.slice(0, 150));
          }
        }
      }
    }

    if (Array.isArray(parsed.shots)) {
      parts.push(`镜头数: ${parsed.shots.length}`);
      for (const shot of parsed.shots.slice(0, 5)) {
        parts.push(`镜头${shot.id || ''}: ${shot.description || shot.visual || ''}`.slice(0, 200));
      }
    }

    return parts.join('\n').slice(0, 3000) || JSON.stringify(parsed).slice(0, 3000);
  }
}
