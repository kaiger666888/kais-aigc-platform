/**
 * gate-constraints.js — 上游约束注入器
 * 根据 Phase 返回对应的创作约束，让各环节在创作时就遵循质量标准。
 * ES Module
 */

/**
 * 约束定义数据库
 * 每个约束: { dimension, phase, priority, constraint, check, failAction }
 */
const CONSTRAINTS_DB = {
  // ── Phase 2: 剧本 (scenario) ──
  scenario: [
    {
      dimension: 'hook',
      phase: 'scenario',
      priority: 'must',
      constraint: '开头必须设计注意力锚点（悬念/痛点/反差/情绪/价值），禁止片头动画+自我介绍+背景铺垫',
      check: '检查剧本前3句是否有明确的注意力锚点，是否避免了冗长的背景铺垫',
      failAction: 'reject',
    },
    {
      dimension: 'structure',
      phase: 'scenario',
      priority: 'must',
      constraint: '遵循心跳曲线，每20-30秒一个小高潮，结尾高潮收束，禁止"谢谢观看"式结尾',
      check: '检查节奏曲线是否有起伏，结尾是否有高潮收束而非平淡收尾',
      failAction: 'reject',
    },
    {
      dimension: 'title_cover',
      phase: 'scenario',
      priority: 'should',
      constraint: '标题悬念+利益点平衡，包含数字/疑问/冲突元素（不超过2种）',
      check: '检查标题是否同时具备悬念感和利益点，包含但不超过2种吸引元素',
      failAction: 'warn',
    },
    {
      dimension: 'duration',
      phase: 'scenario',
      priority: 'should',
      constraint: '按 {platform} 最佳区间 {duration_optimal} 秒控制内容量',
      check: '根据平台预设的最佳时长区间检查剧本内容量是否匹配',
      failAction: 'warn',
    },
    {
      dimension: 'engagement',
      phase: 'scenario',
      priority: 'should',
      constraint: '设计至少1个互动引导点（提问/投票/争议观点），结尾留开放性讨论空间',
      check: '检查是否包含互动设计，结尾是否引导观众参与讨论',
      failAction: 'suggest',
    },
  ],

  // ── Phase 3: 美术方向 (art-direction) ──
  'art-direction': [
    {
      dimension: 'realism',
      phase: 'art-direction',
      priority: 'must',
      constraint: '避免过度精致化（完美光线/完美构图/完美皮肤），模拟真人随手拍风格（轻微抖动、自然光线），参考 kais-anatomy-guard 的 negative prompt',
      check: '检查视觉风格定义中是否包含真实感要求，是否有去精致化指令',
      failAction: 'reject',
    },
  ],

  // ── Phase 4: 角色设计 (character) ──
  character: [
    {
      dimension: 'realism',
      phase: 'character',
      priority: 'must',
      constraint: '角色需有自然微表情设计，避免塑料感，眼神有流转，肢体语言自然',
      check: '检查角色设定是否包含微表情描述，是否有避免塑料感的指令',
      failAction: 'reject',
    },
  ],

  // ── Phase 5: 场景图生成 (scene) ──
  scene: [
    {
      dimension: 'realism',
      phase: 'scene',
      priority: 'must',
      constraint: '场景模拟自然光线和轻微手持感，避免广告级精致画面',
      check: '检查场景图 prompt 是否包含自然光线和手持感指令',
      failAction: 'reject',
    },
    {
      dimension: 'title_cover',
      phase: 'scene',
      priority: 'should',
      constraint: '标记封面帧候选（高对比度、明确主体、情绪指向）',
      check: '检查场景产出中是否标记了封面帧候选',
      failAction: 'suggest',
    },
  ],

  // ── Phase 6: 分镜板 (storyboard) ──
  storyboard: [
    {
      dimension: 'hook',
      phase: 'storyboard',
      priority: 'must',
      constraint: '第1镜头必须是钩子（视觉冲击/悬念/情绪/反差）',
      check: '检查分镜第1个镜头是否具有强烈的视觉冲击或悬念设计',
      failAction: 'reject',
    },
    {
      dimension: 'structure',
      phase: 'storyboard',
      priority: 'must',
      constraint: '标注节奏曲线（⬆️高潮 ⬇️低谷 →平缓 🏁收束）',
      check: '检查分镜是否标注了节奏曲线标记',
      failAction: 'warn',
    },
    {
      dimension: 'engagement',
      phase: 'storyboard',
      priority: 'should',
      constraint: '结尾设计互动钩子（开放式问题/投票/争议观点）',
      check: '检查分镜结尾是否有互动引导设计',
      failAction: 'suggest',
    },
  ],

  // ── Phase 7: 视频生成 (camera) ──
  camera: [
    {
      dimension: 'hook',
      phase: 'camera',
      priority: 'must',
      constraint: '前3秒必须有视觉冲击（运动/色彩突变/表情夸张）',
      check: '检查生成的视频前3秒是否有明显的视觉冲击元素',
      failAction: 'reject',
    },
    {
      dimension: 'structure',
      phase: 'camera',
      priority: 'should',
      constraint: '验证结尾是否高潮收尾',
      check: '检查视频结尾是否有高潮收束而非平淡收尾',
      failAction: 'warn',
    },
    {
      dimension: 'duration',
      phase: 'camera',
      priority: 'should',
      constraint: '检查总时长是否在最佳区间内',
      check: '对比视频总时长与平台最佳时长区间',
      failAction: 'warn',
    },
  ],
};

/**
 * Phase ID 到约束 key 的映射
 */
const PHASE_ID_MAP = {
  'scenario': 'scenario',
  'art-direction': 'art-direction',
  'character': 'character',
  'scene': 'scene',
  'storyboard': 'storyboard',
  'camera': 'camera',
};

/**
 * 获取指定 Phase 的约束条件
 * @param {string} phaseId - Phase ID（scenario / art-direction / character / scene / storyboard / camera）
 * @param {object} options - 可选参数
 * @param {string} [options.platform] - 平台预设（douyin/bilibili/xiaohongshu/youtube_shorts）
 * @param {string} [options.contentType] - 内容类型（短剧/知识/娱乐/广告）
 * @param {string} [options.priority] - 过滤优先级（must/should/nice）
 * @returns {Array} 约束条件数组
 */
export function getPhaseConstraints(phaseId, options = {}) {
  const key = PHASE_ID_MAP[phaseId] || phaseId;
  let constraints = CONSTRAINTS_DB[key] || [];

  // 按优先级过滤
  if (options.priority) {
    const priorityOrder = { must: 0, should: 1, nice: 2 };
    const minOrder = priorityOrder[options.priority] ?? 0;
    constraints = constraints.filter(c => priorityOrder[c.priority] <= minOrder);
  }

  // 替换模板变量
  if (options.platform) {
    const presets = {
      douyin: { duration_optimal: '15-60' },
      bilibili: { duration_optimal: '30-180' },
      xiaohongshu: { duration_optimal: '15-90' },
      youtube_shorts: { duration_optimal: '15-60' },
    };
    const preset = presets[options.platform] || {};
    constraints = constraints.map(c => ({
      ...c,
      constraint: c.constraint
        .replace('{platform}', options.platform)
        .replace('{duration_optimal}', preset.duration_optimal || '15-60'),
    }));
  }

  return constraints;
}

/**
 * 将约束条件注入到已有 prompt 中
 * @param {string} prompt - 原始 prompt
 * @param {string} phaseId - Phase ID
 * @param {object} options - 可选参数（同 getPhaseConstraints）
 * @returns {string} 注入约束后的 prompt
 */
export function injectConstraints(prompt, phaseId, options = {}) {
  const constraints = getPhaseConstraints(phaseId, options);
  if (!constraints.length) return prompt;

  // 按优先级分组
  const mustConstraints = constraints.filter(c => c.priority === 'must');
  const shouldConstraints = constraints.filter(c => c.priority === 'should');
  const niceConstraints = constraints.filter(c => c.priority === 'nice');

  let section = '\n\n--- 质量门控约束（创作时必须遵循）---\n';

  if (mustConstraints.length) {
    section += '\n🚫 强制要求（违反将导致质量门控拒绝）:\n';
    for (const c of mustConstraints) {
      section += `  [${c.dimension}] ${c.constraint}\n`;
    }
  }

  if (shouldConstraints.length) {
    section += '\n⚠️ 重要建议（违反将收到警告）:\n';
    for (const c of shouldConstraints) {
      section += `  [${c.dimension}] ${c.constraint}\n`;
    }
  }

  if (niceConstraints.length) {
    section += '\n💡 可选优化:\n';
    for (const c of niceConstraints) {
      section += `  [${c.dimension}] ${c.constraint}\n`;
    }
  }

  section += '--- 约束结束 ---\n';

  return prompt + section;
}

/**
 * 获取所有 Phase 的约束摘要（用于调试/日志）
 * @returns {object} { phaseId: constraintCount }
 */
export function getConstraintsSummary() {
  const summary = {};
  for (const [key, constraints] of Object.entries(CONSTRAINTS_DB)) {
    summary[key] = {
      total: constraints.length,
      must: constraints.filter(c => c.priority === 'must').length,
      should: constraints.filter(c => c.priority === 'should').length,
      nice: constraints.filter(c => c.priority === 'nice').length,
    };
  }
  return summary;
}

/**
 * Phase ID 到蓝图时间段的映射
 */
const PHASE_TIME_RANGE = {
  scenario: [0, 1.0],        // 全程
  'art-direction': [0, 0.5],  // 前半段视觉参考
  character: [0, 0.3],       // 角色出场期
  scene: [0, 0.8],           // 大部分场景
  storyboard: [0, 1.0],      // 全程
  camera: [0, 1.0],          // 全程
};

/**
 * 从蓝图中提取指定 Phase 的精确约束
 * @param {object} blueprint - 四维蓝图对象
 * @param {string} phaseId - Phase ID
 * @returns {Array} 约束条件数组（与 CONSTRAINTS_DB 格式兼容）
 */
export function getConstraintsFromBlueprint(blueprint, phaseId) {
  if (!blueprint || !blueprint.timeline || !blueprint.constraints) return [];

  const constraints = [];
  const range = PHASE_TIME_RANGE[phaseId];
  if (!range) return [];

  const c = blueprint.constraints;

  // 神经尺度约束
  if (c.neuro?.errorRange) {
    constraints.push({
      dimension: 'hook',
      phase: phaseId,
      priority: 'must',
      constraint: `预测误差控制在 ${c.neuro.errorRange[0]}-${c.neuro.errorRange[1]} 范围内，避免误差过高（观众困惑）或过低（无聊）`,
      check: '评估内容是否在合适的预测误差范围内',
      failAction: 'warn',
    });
  }
  if (c.neuro?.attributionWindow) {
    constraints.push({
      dimension: 'structure',
      phase: phaseId,
      priority: 'should',
      constraint: `归因闭环窗口 ≤ ${c.neuro.attributionWindow}s，任何悬念/疑问必须在此时限内给出部分解释`,
      check: '检查悬念是否在规定时间内得到回应',
      failAction: 'warn',
    });
  }

  // 情绪尺度约束
  if (c.emotion?.noFlatPeriod) {
    constraints.push({
      dimension: 'structure',
      phase: phaseId,
      priority: 'must',
      constraint: `无平淡期 ≤ ${c.emotion.noFlatPeriod}s，任何连续 ${c.emotion.noFlatPeriod}s 内必须有情绪变化`,
      check: '检查是否存在超过规定时间的平淡区间',
      failAction: 'reject',
    });
  }

  // 叙事尺度约束
  if (c.narrative?.valueGap && range[0] === 0) {
    constraints.push({
      dimension: 'hook',
      phase: phaseId,
      priority: 'must',
      constraint: '前10s必须建立价值缺口（让观众想知道"接下来会怎样"）',
      check: '检查内容开头是否建立了明确的价值缺口',
      failAction: 'reject',
    });
  }

  // 社交尺度约束
  if (c.social?.screenshotMoment && range[1] > 0.5) {
    constraints.push({
      dimension: 'engagement',
      phase: phaseId,
      priority: 'should',
      constraint: `设计至少 ${c.social.screenshotMoment} 个截图时刻（高视觉冲击帧，让观众想截图分享）`,
      check: '检查是否标记了截图时刻候选帧',
      failAction: 'suggest',
    });
  }

  // 从 timeline 中提取当前阶段对应的精确约束
  const phaseTimeline = blueprint.timeline.filter(t => {
    // 简单的时间戳匹配
    return true; // 返回全部，由调用方根据 phase 进一步过滤
  });

  if (phaseTimeline.length > 0) {
    constraints.push({
      dimension: 'structure',
      phase: phaseId,
      priority: 'should',
      constraint: `遵循四维蓝图时间线: ${phaseTimeline.map(t => `${t.timestamp}(${t.neuro})`).join(' → ')}`,
      check: '对比内容节奏与蓝图时间线是否匹配',
      failAction: 'warn',
    });
  }

  return constraints;
}
