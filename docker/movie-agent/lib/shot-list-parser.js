/**
 * ShotListParser — 结构化运镜指令解析器 (V2)
 *
 * 将 shot-list.json 中的枚举运镜参数映射为 GPU 任务参数
 */

const SHOT_SIZE_MAP = {
  extreme_wide: { width: 1024, height: 576 },
  wide: { width: 960, height: 540 },
  medium: { width: 832, height: 480 },
  medium_close_up: { width: 768, height: 480 },
  close_up: { width: 640, height: 480 },
  extreme_close_up: { width: 512, height: 512 },
};

const MOVEMENT_MAP = {
  static: { camera_motion: 'none' },
  push_in: { camera_motion: 'zoom_in', motion_strength: 0.6 },
  pull_out: { camera_motion: 'zoom_out', motion_strength: 0.6 },
  pan_left: { camera_motion: 'pan_left', motion_strength: 0.5 },
  pan_right: { camera_motion: 'pan_right', motion_strength: 0.5 },
  orbit_cw: { camera_motion: 'orbit', motion_strength: 0.4 },
  dolly_left: { camera_motion: 'dolly', motion_strength: 0.5 },
  crane_up: { camera_motion: 'tilt_up', motion_strength: 0.4 },
};

const ANGLE_PROMPT = {
  eye_level: 'eye level camera',
  low_angle: 'low angle shot looking up',
  high_angle: 'high angle shot looking down',
  dutch_tilt: 'dutch angle tilted composition',
};

const LENS_FOV = {
  '24mm': 'ultra wide 24mm lens',
  '35mm': 'wide 35mm lens',
  '50mm': 'normal 50mm lens',
  '85mm': 'telephoto 85mm lens shallow depth of field',
  '135mm': 'telephoto 135mm lens bokeh',
};

export function parseShotToGpuParams(shot) {
  const sizeParams = SHOT_SIZE_MAP[shot.shot_size] || SHOT_SIZE_MAP.medium;
  const moveParams = MOVEMENT_MAP[shot.movement] || MOVEMENT_MAP.static;
  const anglePrompt = ANGLE_PROMPT[shot.angle] || '';
  const lensPrompt = LENS_FOV[shot.lens] || '';

  const cameraParts = [anglePrompt, lensPrompt].filter(Boolean);
  const prompt = shot.description
    ? `${shot.description}, ${cameraParts.join(', ')}`
    : cameraParts.join(', ');

  return {
    width: sizeParams.width,
    height: sizeParams.height,
    prompt,
    extra: {
      video_gen: {
        ...moveParams,
      },
    },
    shotId: shot.id,
    durationSec: shot.duration_sec || 5,
  };
}

export function parseShotList(shotList) {
  return (shotList?.shots || []).map(parseShotToGpuParams);
}

export function deduplicateSceneNeeds(shotList) {
  const sceneIds = new Set();
  for (const shot of shotList?.shots || []) {
    if (shot.scene_id) sceneIds.add(shot.scene_id);
  }
  return [...sceneIds];
}

export default { parseShotToGpuParams, parseShotList, deduplicateSceneNeeds };
