/**
 * Phase Registry — V6.0 Phase 0~7 定义
 *
 * 将 8 个 V6 Phase 映射到现有 11 Phase system。
 * 不修改 lib/phases/index.js 的 phaseHandlers，
 * 仅在编排层做逻辑合并。
 */

export const PHASES_V6 = [
  {
    id: 'requirement',
    name: '需求确认与预研',
    order: 0,
    stages: ['requirement'],
    review: false,
  },
  {
    id: 'art-character',
    name: '美术方向与角色',
    order: 1,
    stages: ['art-direction', 'character'],
    review: true,
  },
  {
    id: 'script-voice',
    name: '剧本与配音',
    order: 2,
    stages: ['scenario', 'voice'],
    review: true,
  },
  {
    id: 'storyboard-scene',
    name: '分镜与场景',
    order: 3,
    stages: ['storyboard', 'scene'],
    review: true,
  },
  {
    id: 'video',
    name: '视频生成',
    order: 4,
    stages: ['camera-preview', 'camera-final'],
    review: true,
  },
  {
    id: 'post-production',
    name: '后期合成',
    order: 5,
    stages: ['post-production'],
    review: false,
  },
  {
    id: 'quality-gate',
    name: '质量审核',
    order: 6,
    stages: ['quality-gate'],
    review: false,
    autoEvaluate: true,
  },
  {
    id: 'delivery',
    name: '导出交付',
    order: 7,
    stages: ['delivery'],
    review: false,
  },
];

/**
 * Legacy 11 Phase 执行顺序
 */
export const PHASES_ORDER = [
  'requirement', 'art-direction', 'character', 'scenario',
  'voice', 'storyboard', 'scene', 'camera-preview', 'camera-final',
  'post-production', 'quality-gate',
];

/**
 * 将 V6 Phase ID 映射到 legacy stage IDs
 */
export function mapV6ToLegacy(v6PhaseId) {
  const phase = PHASES_V6.find(p => p.id === v6PhaseId);
  return phase ? phase.stages : [];
}

/**
 * 根据 V6 Phase ID 列表生成 legacy phasesConfig
 */
export function buildLegacyConfig(v6PhaseIds) {
  const stages = [];
  for (const id of v6PhaseIds) {
    const phase = PHASES_V6.find(p => p.id === id);
    if (phase) stages.push(...phase.stages);
  }
  return stages;
}
