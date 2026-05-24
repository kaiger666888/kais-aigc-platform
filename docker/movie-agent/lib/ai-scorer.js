/**
 * AIScorer — 剧本 AI 五维评分 (V2)
 *
 * 评分维度: 结构/情绪/台词/一致性/可拍摄性
 * 总分 < 60 强制阻断管线
 */
export class AIScorer {
  constructor(llmFn) {
    this._llm = llmFn;
  }

  async score(scenarioData, config = {}) {
    const threshold = config.threshold || 60;
    const script = typeof scenarioData === 'string'
      ? scenarioData
      : scenarioData?.script || JSON.stringify(scenarioData, null, 2);

    const prompt = `你是专业的短片剧本评审。对以下剧本进行五维评分，每个维度 0-100 分：

1. **结构** (structure): 起承转合完整性、节奏把控
2. **情绪** (emotion): 情感弧线、冲突张力
3. **台词** (dialogue): 自然度、信息密度、角色区分度
4. **一致性** (consistency): 逻辑自洽、前后呼应
5. **可拍摄性** (filmability): 场景可行性、镜头可实现性

请严格按以下 JSON 格式返回，不要任何其他文字：
{"structure":85,"emotion":72,"dialogue":68,"consistency":80,"filmability":75,"total":76,"advice":"简短改进建议"}

--- 剧本 ---
${script}`;

    const response = await this._llm(prompt, { response_format: 'json' });

    let scores;
    try {
      const jsonStr = response.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      scores = JSON.parse(jsonStr);
    } catch {
      throw new Error(`AI 评分解析失败: ${response.substring(0, 200)}`);
    }

    const total = scores.total || Math.round(
      (scores.structure + scores.emotion + scores.dialogue + scores.consistency + scores.filmability) / 5
    );

    const passed = total >= threshold;
    const dimensions = {
      structure: scores.structure || 0,
      emotion: scores.emotion || 0,
      dialogue: scores.dialogue || 0,
      consistency: scores.consistency || 0,
      filmability: scores.filmability || 0,
    };

    return {
      total,
      dimensions,
      advice: scores.advice || '',
      threshold,
      passed,
    };
  }
}

export function createAIScorer(llmFn) {
  return new AIScorer(llmFn);
}

export default AIScorer;
