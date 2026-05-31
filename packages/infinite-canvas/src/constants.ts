/** 节点尺寸 */
export const NODE_SIZES = {
  script: { minWidth: 240, maxWidth: 280 },
  asset: { width: 240, thumbnailHeight: 100 },
  storyboard: { width: 260, thumbnailHeight: 120 },
  video: { width: 240, thumbnailHeight: 130 },
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
