/**
 * phaseRegistry.ts — 22-phase 单一注册表(Phase 55-01 / NAV-01,D-01 镜像 + D-04 单源)。
 *
 * khs 三真相源(契约测试 scripts/verify-phase-55.ts 守护,任一漂移即红):
 *   - canvas_sync.py _PHASE_INDEX_MAP —— phaseIndex 编号
 *   - canvas_graph.py ZONE_PHASES —— lane 顺序 + group 归组 + zone 标签
 *   - pipeline/phases/__init__.py PHASE_REGISTRY —— 22 活跃 id 集
 *
 * 自包含常量模块(零 import):前端 packages tsconfig 与 kap 根 src tsconfig
 * 双根共同编译;后端以相对路径跨界引用(import-from-dir 先例)。
 * 消费方迁移(删 model.ts 旧 19 条内联表)在 55-03;本模块是唯一词汇源。
 *
 * 前缀语义:khsPrefix = 契约键(p11a0 独立);prefix = lane/目录前缀
 * (p11a0 折叠进 'p11a',A2 裁定:advisory micro-gate 不独立占 lane)。
 */

export type PhaseGroup = 'research' | 'story' | 'production' | 'post'

export interface PipelinePhaseDef {
  /** 全局排序键,决定横向流水线顺序与依赖链(子相位可 .5 插入)。 */
  sortKey: number
  /** 阶段码:P01 / P09b / P11a0 …(UI 序号,英文) */
  code: string
  /** 中文名 */
  name: string
  /** 所属分组(ZONE_PHASES group 字段为权威,契约断言 C 强制) */
  group: PhaseGroup
  /** 图数据整数 phaseIndex(_PHASE_INDEX_MAP 同值;sub 相位共享宿主 lane) */
  phaseIndex: number
  /** 审计/预览/质检 gate:不承载独立资产槽位,不重复计入资产 */
  sub?: boolean
  /** khs 契约键(_PHASE_INDEX_MAP / PHASE_REGISTRY id 前缀;p11a0 独立) */
  khsPrefix: string
  /** lane/目录前缀(p11a0 → 'p11a';其余等于 khsPrefix) */
  prefix: string
  /** 画布节点类型(canvas_sync canvas_type 域) */
  canvasType: string
  /** 资产类型(canvas_sync asset_type 域) */
  assetType: string
  /** 后端 zone 标签(khs ZONE_PHASES 文案;p11a0 无 zone 条目,合成) */
  label: string
  /** 55-03 预留:「未映射」兜底条目标记;注册表本体不使用 */
  unmapped?: boolean
}

/**
 * 22 条(管线序)。sortKey 承载 ZONE_PHASES lane 内权威顺序
 * (p09 < p09b < p09c < p10;p11a < p11b < p11c < p12a < p12b)。
 * p11c sortKey 由旧表 11.5 修正为 13.5:旧值在 p12 拆分(p12a/p12b)后
 * 破坏了 p11*<p12* 的 ZONE 可见顺序(契约断言 D);13.5 恢复全局成立。
 */
export const PHASE_REGISTRY: readonly PipelinePhaseDef[] = [
  { sortKey: 1, code: 'P01', name: '选题/钩子', group: 'research', phaseIndex: 1, khsPrefix: 'p01', prefix: 'p01', canvasType: 'script', assetType: 'topic', label: 'P01 · 选题+钩子' },
  { sortKey: 2, code: 'P02', name: '大纲', group: 'research', phaseIndex: 2, khsPrefix: 'p02', prefix: 'p02', canvasType: 'script', assetType: 'outline', label: 'P02 · 大纲' },
  { sortKey: 3, code: 'P03', name: '剧本审计', group: 'story', phaseIndex: 3, khsPrefix: 'p03', prefix: 'p03', canvasType: 'script', assetType: 'script_phase', label: 'P03 · 剧本+审计' },
  { sortKey: 3.5, code: 'P03.5', name: '戏剧事件打磨', group: 'story', phaseIndex: 3, sub: true, khsPrefix: 'p035', prefix: 'p035', canvasType: 'script', assetType: 'script_phase', label: 'P03.5 · 戏剧事件打磨' },
  { sortKey: 4, code: 'P04', name: '角色设计', group: 'story', phaseIndex: 4, khsPrefix: 'p04', prefix: 'p04', canvasType: 'asset', assetType: 'character', label: 'P04 · 角色设计' },
  { sortKey: 5, code: 'P06', name: '时空剧本', group: 'production', phaseIndex: 6, khsPrefix: 'p06', prefix: 'p06', canvasType: 'script', assetType: 'script_phase', label: 'P06 · 运镜+终审' },
  { sortKey: 6, code: 'P07', name: '场景图生成', group: 'production', phaseIndex: 7, khsPrefix: 'p07', prefix: 'p07', canvasType: 'asset', assetType: 'scene', label: 'P07 · 视觉+风格化' },
  { sortKey: 7, code: 'P08', name: '场景选择', group: 'production', phaseIndex: 8, sub: true, khsPrefix: 'p08', prefix: 'p08', canvasType: 'asset', assetType: 'scene', label: 'P08 · 场景选择' },
  { sortKey: 8, code: 'P09', name: '分镜拆解', group: 'production', phaseIndex: 9, khsPrefix: 'p09', prefix: 'p09', canvasType: 'storyboard', assetType: 'storyboard', label: 'P09 · 分镜拆解' },
  { sortKey: 9, code: 'P09b', name: '镜头审计', group: 'production', phaseIndex: 10, sub: true, khsPrefix: 'p09b', prefix: 'p09b', canvasType: 'storyboard', assetType: 'storyboard', label: 'P09b · 分镜审计' },
  { sortKey: 9.5, code: 'P09c', name: '分镜故事板', group: 'production', phaseIndex: 10, sub: true, khsPrefix: 'p09c', prefix: 'p09c', canvasType: 'storyboard', assetType: 'storyboard', label: 'P09c · 分镜故事板' },
  { sortKey: 10, code: 'P10', name: '语音合成', group: 'post', phaseIndex: 11, khsPrefix: 'p10', prefix: 'p10', canvasType: 'audio', assetType: 'voice', label: 'P10 · 语音' },
  { sortKey: 11, code: 'P10c', name: '语音审计', group: 'post', phaseIndex: 12, sub: true, khsPrefix: 'p10c', prefix: 'p10c', canvasType: 'audio', assetType: 'voice', label: 'P10c · 语音审计' },
  // p11a0(A2 折叠):prefix='p11a' 共 lane;sortKey 12.5 落 p11a 与 p11b 之间;
  // 无 ZONE_PHASES 条目 → label 合成(契约断言 C 对无 zone 条目的跳过)。
  { sortKey: 12.5, code: 'P11a0', name: '条件帧审核', group: 'post', phaseIndex: 14, sub: true, khsPrefix: 'p11a0', prefix: 'p11a', canvasType: 'video', assetType: 'video', label: 'P11a0 · 条件帧审核' },
  { sortKey: 12, code: 'P11a', name: '片段预览', group: 'post', phaseIndex: 14, khsPrefix: 'p11a', prefix: 'p11a', canvasType: 'video', assetType: 'video', label: 'P11a · 预览片段' },
  { sortKey: 13, code: 'P11b', name: '片段生成', group: 'post', phaseIndex: 14, khsPrefix: 'p11b', prefix: 'p11b', canvasType: 'video', assetType: 'video', label: 'P11b · 最终渲染' },
  { sortKey: 13.5, code: 'P11c', name: '视频质检', group: 'post', phaseIndex: 14, sub: true, khsPrefix: 'p11c', prefix: 'p11c', canvasType: 'video', assetType: 'video', label: 'P11c · 视频质检' },
  // P12 拆分(2026-08-09):p12a/p12b 共 phaseIndex 15 lane 但不设 sub——
  // 各自承载资产(EDL/混音),P11a/P11b 共 lane 先例。
  { sortKey: 14, code: 'P12a', name: '时间线合成', group: 'post', phaseIndex: 15, khsPrefix: 'p12a', prefix: 'p12a', canvasType: 'video', assetType: 'clip', label: 'P12a · 时间线合成' },
  { sortKey: 14.5, code: 'P12b', name: '音频合成', group: 'post', phaseIndex: 15, khsPrefix: 'p12b', prefix: 'p12b', canvasType: 'audio', assetType: 'mix', label: 'P12b · 音频合成' },
  { sortKey: 15, code: 'P13', name: '交付', group: 'post', phaseIndex: 16, khsPrefix: 'p13', prefix: 'p13', canvasType: 'video', assetType: 'delivery', label: 'P13 · 交付' },
  { sortKey: 16, code: 'P14', name: '质量审计', group: 'post', phaseIndex: 17, khsPrefix: 'p14', prefix: 'p14', canvasType: 'script', assetType: 'script_phase', label: 'P14 · 质量审计' },
  { sortKey: 17, code: 'P15', name: '反馈', group: 'post', phaseIndex: 18, khsPrefix: 'p15', prefix: 'p15', canvasType: 'script', assetType: 'script_phase', label: 'P15 · 跨集反思' },
]

/** khs 保留编号但已注销的单体 phase(W6 后无节点写入)。 */
export const DEREGISTERED_PHASE_PREFIXES = ['p05', 'p10b', 'p11', 'p12'] as const

/**
 * prefix → 条目快查。p11a0 与 p11a 同 prefix('p11a'):数组中 p11a 后写
 * 覆盖 → lane 级查找取 p11a 主条目;逐条目(p11a0 本体)查找走
 * PHASE_REGISTRY 本体。
 */
export const phaseByPrefix: Record<string, PipelinePhaseDef> = Object.fromEntries(
  PHASE_REGISTRY.map((p) => [p.prefix, p]),
)
