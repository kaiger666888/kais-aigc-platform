/** 节点尺寸 */
export const NODE_SIZES = {
  script: { minWidth: 240, maxWidth: 280 },
  asset: { width: 240, thumbnailHeight: 100 },
  storyboard: { width: 260, thumbnailHeight: 120 },
  video: { width: 240, thumbnailHeight: 130 },
  audio: { width: 240 },
  /** 持久化时使用的默认节点尺寸 */
  defaultPersistSize: { width: 260, height: 180 },
} as const

/** 布局坐标常量 */
export const LAYOUT = {
  /** 剧本节点起始位置 */
  SCRIPT_X: 50,
  SCRIPT_Y: 50,
  /** 资产网格起始位置 */
  ASSET_START_X: 400,
  ASSET_Y: 50,
  ASSET_GAP_X: 280,
  ASSET_GAP_Y: 220,
  /** 分镜横向排列起始位置 */
  SB_START_X: 400,
  SB_START_Y: 500,
  SB_GAP_X: 300,
  /** 视频横向排列起始位置 */
  VIDEO_START_Y: 850,
  /** 音频横向排列起始位置 */
  AUDIO_START_Y: 1100,
  /** 右键添加节点的偏移量 */
  CONTEXT_MENU_ADD_OFFSET_X: 400,
  /** 新建资产节点随机位置范围 */
  NEW_NODE_X_MIN: 400,
  NEW_NODE_X_RANGE: 600,
  NEW_NODE_Y_MIN: 50,
  NEW_NODE_Y_RANGE: 400,
} as const

/** 视口常量 */
export const VIEWPORT = {
  /** fitView 内边距 */
  fitViewPadding: 0.2,
} as const

/**
 * Phase 35 — 分镜镜头意图元数据中文标签映射 (借鉴小云雀)。
 * 用于 StoryboardNode 渲染器 chip 显示 + NodeDetailPanel 下拉编辑器选项。
 */
import type { CameraMovement, Framing, Composition, Pacing } from './types/canvas'

export const METADATA_LABELS = {
  cameraMovement: {
    static: '固定', zoom_in: '推近', zoom_out: '拉远',
    pan_left: '左摇', pan_right: '右摇',
    tilt_up: '上仰', tilt_down: '下俯',
    dolly: '推移', tracking: '跟随',
  } as Record<CameraMovement, string>,
  framing: {
    wide: '远景', medium: '中景', close_up: '近景',
    extreme_close_up: '特写', over_the_shoulder: '过肩', aerial: '航拍',
  } as Record<Framing, string>,
  composition: {
    rule_of_thirds: '三分法', centered: '居中',
    golden_ratio: '黄金比', symmetrical: '对称', leading_lines: '引导线',
  } as Record<Composition, string>,
  pacing: {
    slow: '慢速', medium: '中速', fast: '快速', montage: '蒙太奇',
  } as Record<Pacing, string>,
} as const

/** 渲染顺序 (chip 排序) */
export const METADATA_FIELD_ORDER = ['cameraMovement', 'framing', 'composition', 'pacing'] as const
