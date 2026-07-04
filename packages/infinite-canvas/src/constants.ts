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
    { key: 'ltxPrompt', label: '视频生成Prompt', type: 'text' },
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
