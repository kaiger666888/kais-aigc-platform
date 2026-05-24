/**
 * 四维蓝图生成 hook（从 pipeline.js 提取）
 */
import { FirstDirector } from '../1st-director.js';

export async function generateBlueprint(pipeline, requirement) {
  const director = new FirstDirector({ workdir: pipeline.workdir });
  const { blueprint } = await director.generateBlueprint(requirement);
  pipeline.blueprint = blueprint;
  await director.saveBlueprint(blueprint);
  return blueprint;
}
