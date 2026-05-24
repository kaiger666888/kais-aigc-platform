/**
 * 姿态参考图生成 hook
 * 调用 kais-blender-pose (v0.3.0) — Mixamo 动画帧截取唯一核心模式
 * 
 * 融入点：
 * - Phase 3 after（DNA卡之后）：为每个角色生成标准姿态骨骼参考图
 * - Phase 6 before（分镜设计前）：为需要特定动作的镜头生成姿态参考
 * 
 * v0.3.0 变更：移除即梦图生图模式，输出骨骼参考图供用户自行喂即梦
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

// Mixamo 搜索关键词映射（动作名 → Mixamo 搜索关键词）
const POSE_KEYWORD_MAP = {
  idle_confident: 'idle, standing',
  idle_menacing: 'idle, villain',
  idle_relaxed: 'idle, breathing',
  thinking: 'thinking, looking_down',
  walking_determined: 'walk, determined',
  standing_power: 'standing, power',
  pointing_accusing: 'pointing',
  nodding: 'nodding',
  reacting_surprised: 'reacting, surprised',
  happy_excited: 'happy, excited',
  angry_yelling: 'angry, yelling',
  sad_melancholic: 'sad, disappointed',
  sitting: 'sitting',
  running: 'run',
  fighting: 'fighting, punch',
  celebrating: 'celebrating, victory',
  dancing: 'dancing',
};

// 默认姿态集：根据角色类型自动选择
const DEFAULT_POSES = {
  protagonist: ['idle_confident', 'thinking', 'walking_determined'],
  antagonist: ['idle_menacing', 'standing_power', 'pointing_accusing'],
  supporting: ['idle_relaxed', 'nodding', 'reacting_surprised'],
};

/**
 * 为角色生成姿态参考图集（骨骼参考图）
 * @param {object} pipeline - Pipeline 实例
 * @param {object[]} characters - 角色列表 [{name, role, personality}]
 * @param {object} options - { poses: string[], frameRatio: number }
 * @returns {Promise<object>} { [characterName]: { poses: [{name, keywords, outputPath, status}] } }
 */
export async function generatePoseReferences(pipeline, characters, options = {}) {
  const { workdir } = pipeline;
  const posesDir = join(workdir, 'assets', 'poses');
  await mkdir(posesDir, { recursive: true });

  const results = {};

  for (const char of characters) {
    const role = char.role || 'supporting';
    const requestedPoses = options.poses || DEFAULT_POSES[role] || DEFAULT_POSES.supporting;

    results[char.name] = { poses: [] };

    for (const poseName of requestedPoses) {
      const keywords = POSE_KEYWORD_MAP[poseName] || poseName.replace(/_/g, ' ');
      const outputPath = join(posesDir, `${char.name}_${poseName}.png`);

      // 记录需求，实际执行由 agent 调用 kais-blender-pose SKILL.md 流程
      results[char.name].poses.push({
        name: poseName,
        keywords,
        outputPath,
        frameRatio: options.frameRatio || 0.5,
        status: 'pending', // pending → rendering → done / failed
      });

      console.log(`[pose] 📋 ${char.name} - ${poseName} (keywords: ${keywords})`);
    }
  }

  // 持久化需求清单
  const poseDataPath = join(workdir, 'pose-references.json');
  await writeFile(poseDataPath, JSON.stringify(results, null, 2));
  console.log(`[pose] ✅ 姿态需求清单已生成: ${characters.length} 角色`);

  return results;
}

/**
 * 为分镜镜头生成特定姿态参考
 * @param {object} pipeline - Pipeline 实例
 * @param {object[]} shots - 分镜列表 [{id, character, action, description}]
 * @param {object} characterPoses - Phase 3 产出的姿态数据
 * @returns {Promise<object>} { [shotId]: { character, action, poseRef, needsGeneration } }
 */
export async function generateShotPoses(pipeline, shots, characterPoses) {
  const { workdir } = pipeline;
  const shotPosesDir = join(workdir, 'assets', 'shot-poses');
  await mkdir(shotPosesDir, { recursive: true });

  const results = {};

  for (const shot of shots) {
    if (!shot.character || !shot.action) continue;

    // 先检查 Phase 3 是否已有匹配的姿态参考
    const actionLower = shot.action.toLowerCase();
    const existing = characterPoses?.[shot.character]?.poses?.find(
      p => p.name.includes(actionLower) || actionLower.includes(p.name)
    );

    if (existing) {
      results[shot.id] = {
        character: shot.character,
        action: shot.action,
        poseRef: existing,
        reused: true,
      };
      continue;
    }

    // 没有现成的，标记需要生成
    const keywords = POSE_KEYWORD_MAP[actionLower] || actionLower;
    results[shot.id] = {
      character: shot.character,
      action: shot.action,
      poseRef: {
        name: actionLower,
        keywords,
        outputPath: join(shotPosesDir, `shot_${shot.id}_${shot.character}_${actionLower}.png`),
        status: 'pending',
      },
      needsGeneration: true,
    };
  }

  const shotPosePath = join(workdir, 'shot-poses.json');
  await writeFile(shotPosePath, JSON.stringify(results, null, 2));
  console.log(`[pose] ✅ 分镜姿态需求清单已生成`);

  return results;
}
