/**
 * 质量门控 hook（从 pipeline.js 提取）
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { QualityGate } from '../quality-gate.js';
import { FirstDirector } from '../1st-director.js';

export async function assessQuality(pipeline) {
  if (!pipeline.blueprint) {
    try {
      const director = new FirstDirector({ workdir: pipeline.workdir });
      pipeline.blueprint = await director.loadBlueprint();
    } catch { /* ignore */ }
  }

  const gate = new QualityGate({ workdir: pipeline.workdir, config: pipeline.config });
  const result = await gate.evaluate({
    scriptPath: join(pipeline.workdir, 'requirement.json'),
    videoPath: join(pipeline.workdir, 'output', 'final.mp4'),
    title: pipeline.config.title,
    platform: pipeline.config.platform || 'douyin',
  }, { blueprint: pipeline.blueprint });

  const decision = gate.decide(result);
  await writeFile(join(pipeline.workdir, 'quality_report.json'), JSON.stringify({ ...result, decision }, null, 2));

  if (decision.action === 'reject' || decision.action === 'veto') {
    const report = gate.generateReport(result);
    throw new Error(
      `质量门控未通过 (${result.totalScore}/100): ${decision.reason}\n\n${report}\n\n改进建议:\n${decision.suggestions.join('\n')}`,
    );
  }
  if (decision.action === 'warn') {
    console.warn(`[quality-gate] ⚠️ 警告放行 (${result.totalScore}/100): ${decision.reason}`);
  }

  return { summary: { score: result.totalScore, action: decision.action }, metrics: { dimensions: result.dimensions } };
}
