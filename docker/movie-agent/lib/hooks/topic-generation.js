/**
 * 选题发散 hook
 * 从 topic-selector-adapter.js 精简而来
 */
import { callLLMJson } from '../llm.js';

/**
 * 3秒开场钩子的5种类型
 */
export const HOOK_TYPES = {
  visual: {
    label: '视觉冲击',
    description: '用强烈的视觉画面抓住注意力（特写、对比色、动态运镜）',
    best_for: '所有题材，尤其是奇幻/科幻/动作',
  },
  suspense: {
    label: '悬念制造',
    description: '用未完成的信息或反常情境制造好奇（倒计时、未解之谜、反常行为）',
    best_for: '悬疑/推理/剧情',
  },
  emotion: {
    label: '情绪共鸣',
    description: '用强烈的情绪场景引发共情（亲情/离别/重逢/牺牲）',
    best_for: '情感/家庭/治愈',
  },
  question: {
    label: '反常识提问',
    description: '提出一个违反直觉的问题或现象，让人想看解释',
    best_for: '知识科普/反转剧情',
  },
  conflict: {
    label: '即时冲突',
    description: '开场就是矛盾爆发点（争吵/追逐/对峙）',
    best_for: '都市/职场/情感剧',
  },
};

const PLATFORM_CONSTRAINTS = {
  douyin: { optimalDuration: '30-60s', format: '竖屏9:16', avoid: ['慢节奏', '说教'] },
  xiaohongshu: { optimalDuration: '15-45s', format: '竖屏3:4', avoid: ['硬广', '低质'] },
  bilibili: { optimalDuration: '60-180s', format: '横屏16:9', avoid: ['标题党', '内容空洞'] },
};

function buildPrompt(req, opts = {}) {
  const platform = opts.platform || 'douyin';
  const pc = PLATFORM_CONSTRAINTS[platform] || PLATFORM_CONSTRAINTS.douyin;

  return `你是专业的短视频选题策划师。

## 项目需求
${JSON.stringify(req, null, 2)}

## 约束
- 平台：${platform}（${pc.optimalDuration}，${pc.format}）
- 避免：${pc.avoid.join('、')}
- 目标人群：${req.targetAudience || '18-35岁'}

## 四维尺度
- 神经层：前3秒必须制造预测误差（悬念/反差/冲突）
- 情感层：必须能引发情绪锯齿波（焦虑↔释放）
- 叙事层：必须有明确的价值缺口，观众能身份投射
- 社会层：必须包含至少1个可截图瞬间+1个可引用金句

## 输出要求
生成 3-5 个候选选题，每个包含：
1. title, hook, premise, emotionalArc, memePotential
2. scores: { hook, structure, realism, title_cover, duration, engagement } (各1-10)
3. totalScore, feasibility, targetEmotion
4. opening_3s: 3个不同的3秒开场钩子方案，覆盖以下类型：
   - visual（视觉冲击型）：用强烈画面抓住注意力
   - suspense（悬念型）：用未完成信息制造好奇
   - emotion（情绪型）：用共情场景引发共鸣
   每个钩子包含：type / description / hook_emotion / target_audience

按 totalScore 降序。输出 JSON 数组。`;
}

export async function generateTopics(requirement, options = {}) {
  const prompt = buildPrompt(requirement, options);
  try {
    return await callLLMJson(prompt, { model: options.model });
  } catch {
    return [{ raw: 'generation-failed', totalScore: 0 }];
  }
}
