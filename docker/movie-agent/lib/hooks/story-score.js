/**
 * kais-story-score 适配器
 * 通过 Python 子进程调用 kais-story-score 对剧本文本进行量化分析
 * 
 * 融入点：
 * - Phase 4 after: 剧本量化分析（5维度）
 * - Phase 8.5 after: 分析数据注入质量门控
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORY_SCORE_DIR = join(__dirname, '..', '..', 'skills', 'kais-story-score');
const STORY_SCORE_CLI = join(STORY_SCORE_DIR, 'src', 'cli.py');

/**
 * 检查 kais-story-score 运行环境是否可用
 */
export function isAvailable() {
  try {
    execSync('python3 --version', { stdio: 'pipe' });
    if (!existsSync(STORY_SCORE_CLI)) return false;
    // Quick check: can we import the module?
    const result = execSync(`python3 -c "import sys; sys.path.insert(0, '${STORY_SCORE_DIR}'); from src.story_scorer import STORY_TYPES; print('ok')"`, {
      stdio: 'pipe', timeout: 10000,
    });
    return result.toString().trim() === 'ok';
  } catch {
    return false;
  }
}

/**
 * 从剧本数据中提取纯文本
 * @param {object|string} scenario - scenario.json 数据或纯文本
 * @returns {string} 纯文本
 */
function extractPlainText(scenario) {
  if (typeof scenario === 'string') return scenario;
  
  // 从 scenario.json 结构中提取文本
  const parts = [];
  
  // 尝试提取各场景的对话和描写
  if (scenario.scenes) {
    for (const scene of scenario.scenes) {
      if (scene.dialogue) parts.push(scene.dialogue);
      if (scene.description) parts.push(scene.description);
      if (scene.narration) parts.push(scene.narration);
      if (scene.action) parts.push(scene.action);
    }
  }
  
  // 尝试提取故事大纲
  if (scenario.synopsis) parts.push(scenario.synopsis);
  if (scenario.outline) parts.push(JSON.stringify(scenario.outline));
  if (scenario.script) parts.push(scenario.script);
  
  // 降级：JSON 全文
  if (parts.length === 0) {
    parts.push(JSON.stringify(scenario, null, 2));
  }
  
  return parts.join('\n\n');
}

/**
 * 分析剧本文本
 * @param {object|string} scenario - 剧本数据
 * @param {object} options - { language: 'zh'|'en', storyType: 'power_fantasy'|'classic_narrative'|'suspense' }
 * @returns {object|null} 分析报告（5维度分数 + 建议）
 */
export function analyzeScript(scenario, options = {}) {
  if (!isAvailable()) {
    console.warn('[story-score] Python/spacy 环境不可用，跳过分析');
    return null;
  }

  const text = extractPlainText(scenario);
  if (text.length < 100) {
    console.warn('[story-score] 剧本文本过短（<100字），跳过分析');
    return null;
  }

  // 写入临时文件
  const tmpInput = `/tmp/story-score-input-${Date.now()}.txt`;
  const tmpOutput = `/tmp/story-score-output-${Date.now()}`;
  mkdirSync(tmpOutput, { recursive: true });
  writeFileSync(tmpInput, text);

  try {
    const args = [
      'python3', STORY_SCORE_CLI,
      '--input', tmpInput,
      '--output-dir', tmpOutput,
      '--format', 'json',
    ];
    
    if (options.language) args.push('--language', options.language);
    if (options.characters) args.push('--characters', options.characters.join(','));

    const result = execSync(args.join(' '), {
      stdio: 'pipe',
      timeout: 60000,
      cwd: STORY_SCORE_DIR,
    });

    const jsonPath = join(tmpOutput, 'report.json');
    if (!existsSync(jsonPath)) {
      console.warn('[story-score] 未生成 report.json');
      return null;
    }

    const report = JSON.parse(readFileSync(jsonPath, 'utf-8'));
    console.log(`[story-score] ✅ 分析完成: ${report.dimensions?.length || 0} 维度`);

    // 清理临时文件
    try {
      execSync(`rm -f "${tmpInput}" && rm -rf "${tmpOutput}"`);
    } catch {}

    return report;
  } catch (e) {
    console.warn(`[story-score] 分析失败: ${e.message}`);
    // 清理
    try { execSync(`rm -f "${tmpInput}" && rm -rf "${tmpOutput}"`); } catch {}
    return null;
  }
}

/**
 * 将 story-score 分析结果映射为门控补充数据
 * @param {object|null} report - story-score 分析报告
 * @returns {object} 门控补充数据
 */
export function toGateSupplement(report) {
  if (!report) return null;

  const arcResult = report.narrative_arc || {};
  const pacingResult = report.pacing || {};
  const emotionResult = report.emotional_depth || {};
  const qualityResult = report.text_quality || {};

  return {
    source: 'story-score',
    // 弧线匹配度（0-1）→ 补充 structure 维度
    arcMatch: {
      bestShape: arcResult.best_match_shape || 'unknown',
      dtwScore: arcResult.best_match_score || 0,
      gateSupplement: {
        dimension: 'structure',
        detail: `弧线模板: ${arcResult.best_match_shape || 'unknown'} (DTW: ${(arcResult.best_match_score || 0).toFixed(2)})`,
        boostReason: '剧本弧线形状与经典模板匹配度',
      },
    },
    // 情感覆盖率 → 补充 audience 维度
    emotionCoverage: {
      dominantEmotions: emotionResult.dominant_emotions?.slice(0, 3) || [],
      coverageScore: emotionResult.coverage_score || 0,
      gateSupplement: {
        dimension: 'engagement',
        detail: `情感覆盖: ${emotionResult.coverage_score || 0}/1, 主导情绪: ${(emotionResult.dominant_emotions || []).join(', ')}`,
        boostReason: '情绪丰富度影响观众共鸣潜力',
      },
    },
    // 节奏张力 → 补充 structure 维度
    pacingTension: {
      meanTension: pacingResult.mean_tension || 0,
      amplitude: pacingResult.tension_amplitude || 0,
      changeRate: pacingResult.pacing_change_rate || 0,
      gateSupplement: {
        dimension: 'structure',
        detail: `节奏张力: 均值${(pacingResult.mean_tension || 0).toFixed(2)}, 振幅${(pacingResult.tension_amplitude || 0).toFixed(2)}`,
        boostReason: '节奏起伏度影响内容结构质量',
      },
    },
    // 文本质量 → 补充 realism 维度
    textQuality: {
      ttr: qualityResult.ttr || 0,
      readability: qualityResult.readability_score || 0,
      lexicalRichness: qualityResult.lexical_richness || 0,
      gateSupplement: {
        dimension: 'realism',
        detail: `TTR: ${(qualityResult.ttr || 0).toFixed(3)}, 可读性: ${(qualityResult.readability_score || 0).toFixed(2)}`,
        boostReason: '文本质量影响真实感（过于精致=不真实）',
      },
    },
    // 编剧建议
    advice: (report.advice || []).map(a => ({
      rule: a.rule,
      severity: a.severity,
      message: a.message,
    })),
  };
}

/**
 * 生成评估摘要（用于日志和持久化）
 */
export function summarizeReport(report) {
  if (!report) return null;
  const arc = report.narrative_arc || {};
  const quality = report.text_quality || {};
  const emotions = report.emotional_depth || {};
  
  return {
    totalScore: report.overall_score || 0,
    storyType: report.story_type || 'unknown',
    arcShape: arc.best_match_shape || 'unknown',
    arcScore: arc.best_match_score || 0,
    emotionCoverage: emotions.coverage_score || 0,
    dominantEmotions: emotions.dominant_emotions?.slice(0, 3) || [],
    textQuality: {
      ttr: quality.ttr || 0,
      readability: quality.readability_score || 0,
    },
    pacing: {
      mean: (report.pacing || {}).mean_tension || 0,
      amplitude: (report.pacing || {}).tension_amplitude || 0,
    },
    adviceCount: (report.advice || []).length,
    advice: (report.advice || []).slice(0, 5).map(a => a.message),
  };
}
