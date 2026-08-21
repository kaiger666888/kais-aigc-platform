/** 节点尺寸（旧五类型渲染器契约，保留） */
export const NODE_SIZES = {
  script: { minWidth: 240, maxWidth: 280 },
  asset: { width: 240, thumbnailHeight: 100 },
  storyboard: { width: 260, thumbnailHeight: 120 },
  video: { width: 240, thumbnailHeight: 130 },
  audio: { width: 240 },
  /** 持久化时使用的默认节点尺寸 */
  defaultPersistSize: { width: 260, height: 180 },
} as const

/**
 * Step 5 — V3 节点尺寸（step5-design-tokens.md §1「节点尺寸/角标/芯片/牌堆」逐值收编）。
 * 旧 NODE_SIZES 各 key 保留给 legacy 渲染器；V3 AssetCardNode/EventChipNode 一律读这里。
 */
export const V3_NODE_SIZES = {
  /** L2 标准资产卡 */
  card: { width: 240, height: 212, radius: 8, modBarW: 3, titleH: 24, coverH: 140, metaH: 20 },
  /** global 第 0 列小卡 */
  globalCard: { width: 168, height: 120, coverH: 64 },
  /** composite 成片卡（封面下加迷你胶片条） */
  compositeCard: { width: 280, height: 180, filmstripH: 24 },
  /** text 模态卡（内容自适应） */
  textCard: { minH: 96, maxH: 220 },
  /** LOD1 中景卡 / LOD0 全景色块 */
  l1: { width: 160, height: 100 },
  l0: { width: 24, height: 14 },
  /** 事件芯片（P19） */
  chip: { size: 26, radius: 6, icon: 14, maxW: 80, l1Size: 18 },
  /** 角标（四角产权制） */
  badge: { size: 16, dot: 10, tri: 14, shieldH: 18, offset: -6 },
  /** 变体牌堆 chrome */
  stack: { layers: 3, dx: 4, dy: 4, dimStep: 0.85, countSize: 18 },
} as const

/**
 * Step 5 — 泳道/布局几何（§3.1 带高表 + §3.4 第 0 列，tokens 逐值）。
 * 包内 layoutFlowGraph 用统一 laneH 语义产出「泳道序号 × 带内偏移」，
 * 这里的每泳道带高/间隙由 useLayout 桥接时逐值套用（设计权威在 tokens，布局权威在包）。
 */
export const V3_LAYOUT = {
  /** 十泳道带高（px, zoom=1），序 = 包内 STAGE_ORDER：global→composite */
  LANE_HEIGHTS: [200, 280, 240, 240, 240, 180, 180, 180, 180, 280] as readonly number[],
  /** 带间凹槽（露画布底 #0A0B0E） */
  LANE_GAP: 48,
  /** 带内顶部留白（给 sticky 泳道标签留位） */
  LANE_TOP_INSET: 16,
  /** 第 0 列 global 锚定区：列宽 / 右分隔线 / 间隙 / 列内边距 */
  GLOBAL_COL_WIDTH: 200,
  GLOBAL_COL_DIVIDER: 2,
  GLOBAL_COL_GAP: 12,
  GLOBAL_COL_PAD: 16,
  /** 主区 x 起点 = 列宽 + 分隔线 + 间隙 */
  MAIN_X: 200 + 2 + 12,
  /** 包内布局节点水平间隙（4px 网格内最大档；x 槽位步进 = 240 + 48） */
  NODE_GAP_X: 48,
  /**
   * 泳道换行列数（P8 opt-in 换行）：同泳道超过此列数按 restart-left 折行。
   * 真实数据（项目 1784044301156）实测：主区宽 ≈ 28×288+214 ≈ 8374px，宽高比 ≈1.81:1
   * （落在 1.5–2.5 目标，且接近视口 1.78:1 → fitView scale 最优）。
   * 调参规律：值↑ → 更宽更矮、宽高比↑；偏离视口比例越远 scale 越低。
   */
  WRAP_COLS: 28,
  /** 换行行高：资产卡高 212 + 垂直间隙 16。换行时 y = lane*laneH + row*ROW_HEIGHT。 */
  ROW_HEIGHT: 228,
  /**
   * 阶段网格带内目标最大行数（自适应带宽）：每个阶段带的列数 = ceil(该阶段最密泳道节点数 / 此值)，
   * 使同一阶段内任一泳道不超过 ~此值 行（节点多的阶段自动加宽带、少则收窄），平衡宽高比与可读性。
   * 真实数据（项目 1784044301156）实测 maxRows=4 → 主区 ≈35 槽×288≈10080px、最高泳道 ~4 行，
   * fitView scale 优于定宽带。调参：值↑→更窄更高、scale↓；值↓→更宽更矮。
   */
  PHASE_MAX_ROWS_PER_BAND: 4,
  /** 阶段带宽上限（槽位）：防单阶段节点极多时带过宽。 */
  PHASE_MAX_BAND_COLS: 8,
} as const

/**
 * 布局坐标常量。
 * ⚠️ tokens §2.4 裁决：SCRIPT/ASSET/SB/VIDEO/AUDIO_* 手工网格分区**已废止**——
 * V3 由「拓扑分层 × 泳道 × 第 0 列 × role 分流」布局引擎接管（包内 layoutFlowGraph
 * + useLayout 桥接，泳道几何见 V3_LAYOUT）。保留仅为 legacy 非 graph 路径编译兼容，
 * 新代码禁止引用；CONTEXT_MENU 交互偏移保留(新资产落点走 placeNewAsset)。
 */
export const LAYOUT = {
  /** 剧本节点起始位置 @deprecated V3 布局引擎接管 */
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
  // 55-07:新建节点随机散布常量已删(55-04 引用清零;有界落点 =
  // utils/placeNewAsset,视口中心 8px 网格 / 事件源旁 4px 网格)。
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

// ═══════════════════════════════════════════════════════════════
// Phase 42 — 全节点类型结构化 Schema 常量
// 每种节点类型对应一个 expert 的 output schema 枚举映射。
// 来源: movie-experts/*/SKILL.md Output Format sections.
// ═══════════════════════════════════════════════════════════════

/** ─── Storyboard 扩展字段 (cinematographer P09) ─── */
export const SHOT_METADATA_LABELS = {
  timeline: {
    '1975': '1975 过去', '2000': '2000 过渡', '2025': '2025 现在',
    'dream': '梦境', 'flashback': '闪回',
  } as Record<string, string>,
  axisLine: {
    'L2R': '左→右', 'R2L': '右→左', 'Up': '上升', 'Down': '下降', 'neutral': '中立',
  } as Record<string, string>,
  audioCueType: {
    'dialogue': '对白', 'narration': '旁白', 'sfx': '音效', 'music': '音乐',
    'silence': '静默', 'ambient': '环境音',
  } as Record<string, string>,
} as const

/** ─── Script 结构化字段 (screenplay P03 + hook_retention P01) ─── */
export const SCRIPT_METADATA_LABELS = {
  mcmahonArc: {
    'Cinderella': '灰姑娘（双升型）', 'Tragedy': '悲剧（双降型）',
    'Man_in_a_Hole': '落井回升（先降后升）', 'Icarus': '伊卡洛斯（先升后降）',
    'Rags_to_Riches': '白手起家（一路上升）', 'Kafkaesque': '卡夫卡式（持续下降）',
    'Two_Halves': '两半式（前半建立后半反转）',
  } as Record<string, string>,
  hookType: {
    '情感钩': '情感钩', '悬念钩': '悬念钩', '冲突钩': '冲突钩',
    '反差钩': '反差钩', '情绪爆点钩': '情绪爆点钩',
  } as Record<string, string>,
  markerType: {
    '钩子': '钩子', '爽点': '爽点', '卡点': '卡点',
  } as Record<string, string>,
} as const

/** ─── Asset 结构化字段 — 角色设计 (character_designer P04) ─── */
export const CHARACTER_METADATA_LABELS = {
  archetype: {
    'protagonist': '主角', 'deuteragonist': '第二主角', 'antagonist': '反派',
    'mentor': '导师', 'catalyst': '催化者', 'guardian': '守护者',
    'sidekick': '伙伴', 'love_interest': '恋人', 'narrator': '旁白者',
  } as Record<string, string>,
  ageRange: {
    'child': '儿童', 'teen': '少年', 'young_adult': '青年',
    'middle_aged': '中年', 'elderly': '老年', 'ageless': '无年龄',
  } as Record<string, string>,
} as const

/** ─── Asset 结构化字段 — 风格基因 (style_genome P07) ─── */
export const STYLE_DIMENSIONS = [
  { key: 'composition', label: '构图', min: '居中/浅景深', max: '极端不对称/深焦' },
  { key: 'color', label: '色彩', min: '低饱和/冷调', max: '高饱和/暖调' },
  { key: 'rhythm', label: '节奏', min: '慢/长镜头', max: '快/碎片化' },
  { key: 'light_shadow', label: '光影', min: '柔光/平光', max: '硬光/高反差' },
  { key: 'sound', label: '声音', min: '对白驱动/安静', max: '音乐驱动/嘈杂' },
] as const

/** ─── Asset 结构化字段 — 色彩意图 (colorist P07) ─── */
export const COLOR_EMOTION_LABELS = {
  'C01': '暖晨/希望', 'C02': '舒适/安全', 'C03': '怀旧/温暖',
  'C05': '忧郁黄昏/失去', 'C07': '孤独/疏离', 'C09': '冷酷恐惧',
  'C11': '神秘/不确定', 'C14': '浪漫柔光', 'C16': '温暖亲密',
  'C18': '自然生机', 'C21': '动作高潮/紧张', 'C23': '权力/奢华',
  'C25': '冷酷科技', 'C28': '末日绝望',
} as Record<string, string>

/** ─── Video 结构化字段 (visual_executor/editor P11) ─── */
export const VIDEO_METADATA_LABELS = {
  engine: {
    'ltx': 'LTX-Video', 'wan': 'Wan 2.2', 'jimeng': '即梦', 'seedance': 'Seedance',
    'runway': 'Runway Gen-3', 'kling': 'Kling', 'veo': 'Veo', 'sora': 'Sora',
  } as Record<string, string>,
  resolution: {
    '360p': '360p', '480p': '480p', '540p': '540p', '720p': '720p',
    '1080p': '1080p', '512': '512×512', '1024': '1024×1024',
  } as Record<string, string>,
  murchGrade: {
    'excellent': '优秀 (≥7.0)', 'pass': '合格 (5.0-6.9)',
    'weak': '弱 (3.0-4.9)', 'fail': '不合格 (<3.0)',
  } as Record<string, string>,
} as const

/** ─── Audio 结构化字段 (audio_pipeline P10) ─── */
export const AUDIO_METADATA_LABELS = {
  emotion: {
    'neutral': '中性', 'happy': '快乐', 'sad': '悲伤', 'angry': '愤怒',
    'fearful': '恐惧', 'surprised': '惊讶', 'contempt': '轻蔑',
    'tender': '温柔', 'nostalgic': '怀旧', 'determined': '坚定',
  } as Record<string, string>,
  engine: {
    'indextts2': 'IndexTTS2', 'cosyvoice': 'CosyVoice', 'minimax': 'MiniMax T2A',
    'elevenlabs': 'ElevenLabs', 'edge': 'Edge TTS', 'chattts': 'ChatTTS',
    'acestep': 'ACE-Step', 'suno': 'Suno',
  } as Record<string, string>,
  audioType: {
    'voice': '人声', 'bgm': '背景音乐', 'sfx': '音效',
    'ambient': '环境音', 'stem': '音轨',
  } as Record<string, string>,
} as const

/** 通用结构化字段渲染器配置 */
export interface StructuredField {
  key: string
  label: string
  type: 'enum' | 'text' | 'number' | 'tags' | 'bar'
  options?: Record<string, string>
  unit?: string
  min?: number
  max?: number
}

/** 每种节点类型的结构化字段定义 */
export const NODE_SCHEMA: Record<string, StructuredField[]> = {
  storyboard: [
    { key: 'cameraMovement', label: '运镜', type: 'enum', options: METADATA_LABELS.cameraMovement as Record<string, string> },
    { key: 'framing', label: '景别', type: 'enum', options: METADATA_LABELS.framing as Record<string, string> },
    { key: 'composition', label: '构图', type: 'enum', options: METADATA_LABELS.composition as Record<string, string> },
    { key: 'pacing', label: '节奏', type: 'enum', options: METADATA_LABELS.pacing as Record<string, string> },
    { key: 'timeline', label: '时间线', type: 'enum', options: SHOT_METADATA_LABELS.timeline },
    { key: 'axisLine', label: '轴线', type: 'enum', options: SHOT_METADATA_LABELS.axisLine },
    { key: 'emotion', label: '情感意图', type: 'text' },
    { key: 'audioCue', label: '声音提示', type: 'text' },
    { key: 'videoPrompt', label: '视频生成Prompt', type: 'text' },
    { key: 'ltxPrompt', label: '视频生成Prompt(旧字段)', type: 'text' },
  ],
  script: [
    { key: 'mcmahonArc', label: '叙事弧', type: 'enum', options: SCRIPT_METADATA_LABELS.mcmahonArc },
    { key: 'genre', label: '类型', type: 'text' },
    { key: 'format', label: '格式', type: 'text' },
    { key: 'totalDuration', label: '总时长', type: 'text' },
    { key: 'hookType', label: '钩子类型', type: 'enum', options: SCRIPT_METADATA_LABELS.hookType },
    { key: 'hookIntensity', label: '钩子强度', type: 'number', min: 1, max: 5 },
  ],
  asset: [
    // 角色 (assetType === 'role')
    { key: 'archetype', label: '角色原型', type: 'enum', options: CHARACTER_METADATA_LABELS.archetype },
    { key: 'ageRange', label: '年龄段', type: 'enum', options: CHARACTER_METADATA_LABELS.ageRange },
    { key: 'clipITarget', label: 'CLIP-i 一致性', type: 'text' },
    // 风格 (assetType === 'scene' && style node)
    { key: 'style_composition', label: '构图维度', type: 'bar', min: 0, max: 1 },
    { key: 'style_color', label: '色彩维度', type: 'bar', min: 0, max: 1 },
    { key: 'style_rhythm', label: '节奏维度', type: 'bar', min: 0, max: 1 },
    { key: 'style_light', label: '光影维度', type: 'bar', min: 0, max: 1 },
    { key: 'style_sound', label: '声音维度', type: 'bar', min: 0, max: 1 },
  ],
  video: [
    { key: 'engine', label: '引擎', type: 'enum', options: VIDEO_METADATA_LABELS.engine },
    { key: 'resolution', label: '分辨率', type: 'enum', options: VIDEO_METADATA_LABELS.resolution },
    { key: 'clipModel', label: 'CLIP模型', type: 'text' },
    { key: 'duration', label: '时长(秒)', type: 'number', unit: 's' },
    { key: 'murchGrade', label: 'Murch评级', type: 'enum', options: VIDEO_METADATA_LABELS.murchGrade },
  ],
  audio: [
    { key: 'audioType', label: '音频类型', type: 'enum', options: AUDIO_METADATA_LABELS.audioType },
    { key: 'engine', label: '引擎', type: 'enum', options: AUDIO_METADATA_LABELS.engine },
    { key: 'emotion', label: '情感标签', type: 'enum', options: AUDIO_METADATA_LABELS.emotion },
    { key: 'speaker', label: '说话人', type: 'text' },
    { key: 'duration', label: '时长(秒)', type: 'number', unit: 's' },
  ],
}

// ═══════════════════════════════════════════════════════════════
// 创作阶段（P01–P13 管线维度）与后端 raw 字段展示常量
// 后端 src/routes/canvas/v2/import-from-dir.ts 的 PHASE_DEFS 是权威；
// V3 迁移只把白名单字段进 meta 严格联合（types.ts AssetStageMeta），其余富字段
// 在 migrate.buildMeta 丢弃。富字段经 adapter sidecar（rawDataByNodeId）穿透到
// 前端，卡片/详情面板按下列标签·分组·噪音表渲染。字段名以后端 snake_case 为准。
// ═══════════════════════════════════════════════════════════════

// ─── 创作阶段分组(55-03 D-04:由 phaseRegistry 派生,字面量表已删) ──
// 类型与词汇真值源 = ./phaseRegistry(khs ZONE_PHASES 契约守护,55-01)。
// 类型与词汇真值源 = ./constants/phaseRegistry(khs 契约守护,55-01)。
export type { PhaseGroup } from './constants/phaseRegistry'
import type { PhaseGroup } from './constants/phaseRegistry'
import { PHASE_REGISTRY } from './constants/phaseRegistry'

/** phaseIndex → 分组(注册表派生;无 sidecar 时的兜底分组与配色依据)。
 * 注销 lane(5/13)不再映射——未注册索引节点走 derivePipelineModels
 * 「未映射」兜底,消费方 laneGeometry 有 ?? 'production' 兜底。 */
export const PHASE_GROUPS: Record<number, PhaseGroup> = Object.fromEntries(
  PHASE_REGISTRY.map((e) => [e.phaseIndex, e.group]),
)

/**
 * 后端 raw data 字段（snake_case 为主）→ 中文展示标签。
 * V3 meta 白名单之外的字段（scene_id/shot_scale/duration_sec/…）经 sidecar 穿透后按此翻译。
 */
export const RAW_FIELD_LABELS: Record<string, string> = {
  // 身份与场景
  scene_id: '场景', scene_number: '场景号', shot_id: '镜头', shot_type: '景别',
  shot_scale: '景别规格', framing: '景别', scene: '场景', subject: '主体',
  character_id: '角色ID', characterId: '角色ID', role: '角色', name: '名称',
  // 运镜与构图
  camera_movement: '运镜', cameraMovement: '运镜', cameraMovementType: '运镜',
  axis_line: '轴线', axisLine: '轴线', composition: '构图', framing_rule: '构图',
  // 叙事节拍
  beat: '节拍', snyder_beat: 'Snyder节拍', shot_intent: '镜头意图',
  conflict_intensity: '冲突强度', intensity: '强度', emotion: '情绪', mood: '情绪',
  hook_type: '钩子类型', hookType: '钩子类型', premise: '前提', theme: '主题',
  // 音频
  speaker: '说话人', audio_path: '音频路径', audioPath: '音频路径',
  audio_type: '音频类型', audioType: '音频类型', sfx_notes: '音效备注',
  dialogue: '对白', voice: '人声', music: '音乐',
  // 时长与规格
  duration_sec: '时长', duration: '时长', durationS: '时长', resolution: '分辨率',
  fps: '帧率', num_frames: '帧数', total_duration_sec: '总时长',
  // 生成配方
  ltx_prompt: '生成提示词', ltxPrompt: '生成提示词', video_prompt: '生成提示词', videoPrompt: '生成提示词', prompt: '提示词',
  negative: '反向提示词', negative_prompt: '反向提示词',
  style_prefix: '风格前缀', color_guidance: '色彩引导', color_palette: '色彩',
  seed: '种子', guidance_scale: '引导系数', cfg: 'CFG', steps: '步数',
  // 审计评分
  murch_score: 'Murch分', murchScore: 'Murch分', audit_grade: '审计评级',
  auditGrade: '审计评级', clip_i: 'CLIP-i', clipi_target: 'CLIP-i一致性',
  // 资产描述
  archetype: '原型', age_range: '年龄段', ageRange: '年龄段',
  asset_type: '资产类型', assetType: '资产类型', turnaround_sheet: '转面表',
  tags: '标签', layers: '图层', crops: '裁切', view_angle: '视角', viewAngle: '视角',
  // 来源与其它
  provenance: '来源', description: '描述', text: '台词', label_text: '标签文本',
  engine: '引擎', model_version: '模型版本',
}

/**
 * 不在详情面板 raw 区重复展示的键：已映射到 media/params/标题，或无展示意义。
 * （media.original ← filePath/file_path；media.thumbnail ← thumbnailUrl/thumbnail；
 *  params.prompt/seed/modelVersion ← prompt/seed/engine；标题 ← label/phaseName）
 */
export const RAW_FIELD_NOISE: ReadonlySet<string> = new Set([
  'filePath', 'file_path', 'thumbnailUrl', 'thumbnail', 'thumb',
  'prompt', 'seed', 'engine',
  'id', 'nodeId', 'node_id', 'label', 'phaseName', 'phaseIndex', 'phase',
  '__synthetic_fields', 'position', 'size', 'state', 'branchId', 'branch_id',
  'type', 'stage', 'modality', 'scope', 'curation', 'reviewStatus', 'aiScore',
])

/** 详情面板 raw 字段分组顺序；未命中分组的键归入「其他」。 */
export const RAW_FIELD_GROUPS: ReadonlyArray<{ title: string; keys: ReadonlySet<string> }> = [
  { title: '身份与场景', keys: new Set(['scene_id', 'scene_number', 'shot_id', 'shot_type', 'shot_scale', 'framing', 'scene', 'subject', 'character_id', 'characterId', 'role', 'name']) },
  { title: '运镜与构图', keys: new Set(['camera_movement', 'cameraMovement', 'cameraMovementType', 'axis_line', 'axisLine', 'composition', 'framing_rule']) },
  { title: '叙事节拍', keys: new Set(['beat', 'snyder_beat', 'shot_intent', 'conflict_intensity', 'intensity', 'emotion', 'mood', 'hook_type', 'hookType', 'premise', 'theme']) },
  { title: '音频', keys: new Set(['speaker', 'audio_path', 'audioPath', 'audio_type', 'audioType', 'sfx_notes', 'dialogue', 'voice', 'music']) },
  { title: '时长与规格', keys: new Set(['duration_sec', 'duration', 'durationS', 'resolution', 'fps', 'num_frames', 'total_duration_sec']) },
  { title: '生成配方', keys: new Set(['ltx_prompt', 'ltxPrompt', 'video_prompt', 'videoPrompt', 'negative', 'negative_prompt', 'style_prefix', 'color_guidance', 'color_palette', 'guidance_scale', 'cfg', 'steps', 'model_version']) },
  { title: '审计评分', keys: new Set(['murch_score', 'murchScore', 'audit_grade', 'auditGrade', 'clip_i', 'clipi_target']) },
  { title: '资产描述', keys: new Set(['archetype', 'age_range', 'ageRange', 'asset_type', 'assetType', 'turnaround_sheet', 'tags', 'layers', 'crops', 'view_angle', 'viewAngle']) },
]
