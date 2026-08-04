/**
 * 资产管理中心 — 数据层（细粒度资产类型 + 组合关系）。
 *
 * 数据来源：
 *   - 资产库 / 详情 → 真实 `/api/v1/assets-registry`（assetDetailToItem 映射）。
 *   - 角色衣柜 / 场景管理 → mock 数据集（组合关系 o_asset_composition 未建表，
 *     待后端落地 design.md §3 后接真实 API）。
 *
 * 真实接入路径（TODO，待后端落地 design.md §3 的 o_asset_composition/o_loadout）：
 *   - 组合关系 → 需新增 GET /api/v1/assets/:uuid/composition（TODO）
 *   - 角色衣柜 → 需新增 GET /api/v1/characters/:uuid/wardrobe（TODO）
 * 见 /tmp/asset-manager-design.md §4 API 设计。
 */
import type { AssetDetail } from '../../services/canvasApi'

// ─── 资产类型（细粒度 mock + 粗粒度真实 registry） ─────────
// 细粒度（mock / 未来 o_asset_composition）+ 粗粒度（现网 assets-registry 实际 type）。
export type AssetType =
  // 细粒度
  | 'character' | 'costume' | 'accessory'
  | 'scene' | 'scene_variant'
  | 'prop' | 'prop_key' | 'prop_consumable'
  | 'style' | 'audio'
  // 粗粒度（现网 registry 真实数据）
  | 'clip' | 'voice' | 'video' | 'storyboard' | 'script_phase' | 'outline' | 'topic' | 'delivery'

export type AssetModality = 'image' | 'text' | 'audio' | 'video'
export type AssetScope = 'library' | 'series' | 'project'
/** 装备槽（wears/holds 关系用） */
export type EquipSlot = 'head' | 'body' | 'accessory' | 'hand' | 'feet'

export interface AssetItem {
  uuid: string
  name: string
  type: AssetType
  modality: AssetModality
  emoji: string
  scope: AssetScope
  desc?: string
  /** 复用集数（驱动卡片复用徽标） */
  reuses?: number
  tags?: string[]
  /** 多视图角度（角色/场景） */
  views?: string[]
  model?: string
  seed?: string
  voice?: string
  prompt?: string
  /** 服装/配饰/道具：归属角色 */
  forChar?: string
  /** 装备槽位（可穿戴物品） */
  slot?: EquipSlot
  /** scene_variant 的基底场景 */
  variantOf?: string
  /** scene_variant 的差异参数 */
  diff?: Record<string, string>
  // ── 真实 registry 字段（assetDetailToItem 填充） ──
  /** 真实 o_assets.id（数字主键） */
  id?: number
  /** JOIN o_image 得到的文件路径（缩略图渲染用） */
  filePath?: string
  characterId?: string
  viewAngle?: string
  /** 来源标记：真实 API / mock（驱动详情视图的取数路径） */
  source?: 'real' | 'mock'
  /** 正式使用版本标记（管线下游 P05+ 使用 isPrimaryView=true 的资产） */
  isPrimaryView?: boolean
  /** 原始 meta JSON 字符串（透传给 parseCostumeMeta / parseTurnaroundSheetSize 解析富信息） */
  meta?: string | null
}

// ─── 组合关系 ─────────────────────────────────────────────
export type CompositionRelation = 'variant_of' | 'wears' | 'holds' | 'appears_in'

export interface Composition {
  /** 主体（角色/资产） */
  a: string
  /** 对象（服装/道具/场景） */
  b: string
  rel: CompositionRelation
  /** wears/holds 的槽位 */
  slot?: EquipSlot
  /** 归属的搭配预设名（角色衣柜） */
  loadout?: string
}

/** 跨集出场（关键道具/角色，复用 v1 o_asset_usage 的概念） */
export const EPISODES = [
  { code: 'EP01', t: '相遇' },
  { code: 'EP02', t: '客厅' },
  { code: 'EP03', t: '再会' },
] as const

export const APPEARS: Record<string, string[]> = {
  'prp-bell': ['EP01', 'EP02', 'EP03'],
  'chr-xiaoju': ['EP01', 'EP02', 'EP03'],
  'chr-xiaoyue': ['EP02', 'EP03'],
  'prp-photo': ['EP02'],
}

// ─── 模拟数据集（流浪猫小橘） ─────────────────────────────
export const ASSETS: AssetItem[] = [
  // 角色
  { uuid: 'chr-xiaoju', name: '小橘', type: 'character', modality: 'image', emoji: '🐱', scope: 'series',
    desc: '流浪橘猫 · 主角', reuses: 3, tags: ['主角', '动物'], views: ['front', 'side', 'back'],
    model: 'jimeng-5.0', seed: 'ju-7782', voice: 'voice-xiaoju', prompt: '一只橘色短毛流浪猫,碧绿眼睛,瘦但精神' },
  { uuid: 'chr-xiaoyue', name: '小月', type: 'character', modality: 'image', emoji: '👧', scope: 'series',
    desc: '女孩 · 主角', reuses: 3, tags: ['主角', '人类'], views: ['front', 'side', '3quarter'],
    model: 'jimeng-5.0', seed: 'yue-4419', voice: 'voice-xiaoyue', prompt: '十岁女孩,短发,温柔倔强' },
  // 服装
  { uuid: 'cst-school', name: '校服', type: 'costume', modality: 'image', emoji: '👘', scope: 'series',
    desc: '小月的日常装', reuses: 2, tags: ['小月', '日常'], forChar: 'chr-xiaoyue', slot: 'body' },
  { uuid: 'cst-raincoat', name: '黄色雨衣', type: 'costume', modality: 'image', emoji: '🧥', scope: 'series',
    desc: '雨夜造型', reuses: 1, tags: ['小月', '雨'], forChar: 'chr-xiaoyue', slot: 'body' },
  { uuid: 'cst-pajama', name: '棉布睡衣', type: 'costume', modality: 'image', emoji: '🩱', scope: 'series',
    desc: '客厅场景', reuses: 1, tags: ['小月', '居家'], forChar: 'chr-xiaoyue', slot: 'body' },
  { uuid: 'cst-collar', name: '红项圈 + 铃铛', type: 'costume', modality: 'image', emoji: '🎀', scope: 'series',
    desc: '小橘的标志', reuses: 3, tags: ['小橘', '信物'], forChar: 'chr-xiaoju', slot: 'body' },
  { uuid: 'cst-cape', name: '小斗篷', type: 'costume', modality: 'image', emoji: '🧣', scope: 'series',
    desc: '冬季造型', reuses: 0, tags: ['小橘', '冬季'], forChar: 'chr-xiaoju', slot: 'body' },
  // 配饰
  { uuid: 'acc-glasses', name: '圆框眼镜', type: 'accessory', modality: 'image', emoji: '👓', scope: 'series',
    desc: '小月标志性配饰', reuses: 3, tags: ['小月'], forChar: 'chr-xiaoyue', slot: 'accessory' },
  { uuid: 'acc-necklace', name: '海螺项链', type: 'accessory', modality: 'image', emoji: '📿', scope: 'series',
    desc: '妈妈留下的', reuses: 1, tags: ['小月', '信物'], forChar: 'chr-xiaoyue', slot: 'accessory' },
  // 道具
  { uuid: 'prp-umbrella', name: '透明雨伞', type: 'prop', modality: 'image', emoji: '☂️', scope: 'series',
    desc: '雨夜道具', reuses: 2, tags: ['小月', '雨'], forChar: 'chr-xiaoyue', slot: 'hand' },
  { uuid: 'prp-can', name: '猫粮罐头', type: 'prop_consumable', modality: 'image', emoji: '🥫', scope: 'series',
    desc: '消耗品 · 喂小橘', reuses: 2, tags: ['消耗', '小橘'], forChar: 'chr-xiaoyue', slot: 'hand' },
  { uuid: 'prp-bell', name: '小铃铛', type: 'prop_key', modality: 'image', emoji: '🔔', scope: 'series',
    desc: '关键道具 · 信物,贯穿全剧', reuses: 3, tags: ['关键', '信物'], forChar: 'chr-xiaoju', slot: 'hand' },
  { uuid: 'prp-photo', name: '全家福照片', type: 'prop_key', modality: 'image', emoji: '🖼️', scope: 'series',
    desc: '关键道具 · 催泪', reuses: 1, tags: ['关键', '回忆'], forChar: 'chr-xiaoyue', slot: 'hand' },
  { uuid: 'prp-milk', name: '牛奶盒', type: 'prop_consumable', modality: 'image', emoji: '🥛', scope: 'series',
    desc: '消耗品', reuses: 1, tags: ['消耗'], forChar: 'chr-xiaoyue', slot: 'hand' },
  // 场景 + 变体
  { uuid: 'scn-street', name: '城市街道', type: 'scene', modality: 'image', emoji: '🌆', scope: 'series',
    desc: '主场景 · 相遇之地', reuses: 3, tags: ['室外', '主场景'] },
  { uuid: 'scn-living', name: '小月家客厅', type: 'scene', modality: 'image', emoji: '🛋️', scope: 'series',
    desc: '室内 · 温馨', reuses: 2, tags: ['室内'] },
  { uuid: 'sv-street-day', name: '街道·日', type: 'scene_variant', modality: 'image', emoji: '☀️', scope: 'series',
    variantOf: 'scn-street', desc: '晴朗午后', tags: ['日', '室外'],
    diff: { 光照: '自然光 高', 色温: '5600K 中性', 氛围: '明朗' } },
  { uuid: 'sv-street-night', name: '街道·夜', type: 'scene_variant', modality: 'image', emoji: '🌙', scope: 'series',
    variantOf: 'scn-street', desc: '雨夜霓虹', tags: ['夜', '室外'],
    diff: { 光照: '霓虹+路灯 低', 色温: '3200K 暖', 氛围: '孤寂' } },
  { uuid: 'sv-street-rain', name: '街道·雨', type: 'scene_variant', modality: 'image', emoji: '🌧️', scope: 'series',
    variantOf: 'scn-street', desc: '大雨滂沱', tags: ['雨', '夜'],
    diff: { 光照: '冷蓝 低', 色温: '7500K 冷', 氛围: '压抑→希望' } },
  { uuid: 'sv-living-day', name: '客厅·日', type: 'scene_variant', modality: 'image', emoji: '🔆', scope: 'series',
    variantOf: 'scn-living', desc: '白天', tags: ['日', '室内'],
    diff: { 光照: '窗光 高', 色温: '5500K', 氛围: '温馨' } },
  { uuid: 'sv-living-night', name: '客厅·夜', type: 'scene_variant', modality: 'image', emoji: '🛌', scope: 'series',
    variantOf: 'scn-living', desc: '台灯夜', tags: ['夜', '室内'],
    diff: { 光照: '台灯 中', 色温: '2700K 暖橙', 氛围: '亲密' } },
  // 风格 / 音频
  { uuid: 'sty-warm', name: '暖调电影感', type: 'style', modality: 'text', emoji: '🎨', scope: 'series',
    desc: '全剧美术宪法', reuses: 3, tags: ['风格', '锁定'] },
  { uuid: 'aud-xjvoice', name: '小橘声纹', type: 'audio', modality: 'audio', emoji: '🎙️', scope: 'series',
    desc: '喵叫 + 拟人配音', reuses: 3, tags: ['声纹', '小橘'] },
]

/** 默认装备关系（含两套搭配预设） */
export const COMPOSITIONS: Composition[] = [
  // 默认造型
  { a: 'chr-xiaoyue', b: 'cst-school', rel: 'wears', slot: 'body', loadout: '默认造型' },
  { a: 'chr-xiaoyue', b: 'acc-glasses', rel: 'wears', slot: 'accessory', loadout: '默认造型' },
  { a: 'chr-xiaoyue', b: 'prp-umbrella', rel: 'holds', slot: 'hand', loadout: '默认造型' },
  { a: 'chr-xiaoju', b: 'cst-collar', rel: 'wears', slot: 'body', loadout: '默认造型' },
  // 雨夜造型
  { a: 'chr-xiaoyue', b: 'cst-raincoat', rel: 'wears', slot: 'body', loadout: '雨夜造型' },
  { a: 'chr-xiaoyue', b: 'acc-glasses', rel: 'wears', slot: 'accessory', loadout: '雨夜造型' },
  { a: 'chr-xiaoyue', b: 'prp-umbrella', rel: 'holds', slot: 'hand', loadout: '雨夜造型' },
  // 出场关系
  { a: 'prp-bell', b: 'scn-street', rel: 'appears_in' },
  { a: 'prp-bell', b: 'scn-living', rel: 'appears_in' },
  { a: 'chr-xiaoju', b: 'scn-street', rel: 'appears_in' },
  { a: 'chr-xiaoju', b: 'scn-living', rel: 'appears_in' },
  { a: 'prp-photo', b: 'scn-living', rel: 'appears_in' },
]

export const DEFAULT_LOADOUTS = ['默认造型', '雨夜造型']

// ─── 类型目录（左栏树） ───────────────────────────────────
export interface TypeGroupItem { t: AssetType; ic: string; n: string }
export interface TypeGroup { group: string; items: TypeGroupItem[] }

export const TYPE_GROUPS: TypeGroup[] = [
  { group: '角色相关', items: [
    { t: 'character', ic: '👤', n: '角色' },
    { t: 'costume', ic: '👘', n: '服装' },
    { t: 'accessory', ic: '💍', n: '配饰' },
  ]},
  { group: '场景相关', items: [
    { t: 'scene', ic: '🌆', n: '场景' },
    { t: 'scene_variant', ic: '🌗', n: '场景变体' },
  ]},
  { group: '道具相关', items: [
    { t: 'prop', ic: '📦', n: '道具' },
    { t: 'prop_key', ic: '🗝️', n: '关键道具' },
    { t: 'prop_consumable', ic: '🥫', n: '消耗品' },
  ]},
  { group: '其他', items: [
    { t: 'style', ic: '🎨', n: '风格' },
    { t: 'audio', ic: '🎵', n: '音频' },
  ]},
]

export const TYPE_LABEL: Record<AssetType, string> = {
  character: '角色', costume: '服装', accessory: '配饰',
  scene: '场景', scene_variant: '场景变体',
  prop: '道具', prop_key: '关键道具', prop_consumable: '消耗品',
  style: '风格', audio: '音频',
  // 粗粒度（现网 registry 真实数据）
  clip: '片段', voice: '声纹', video: '视频', storyboard: '分镜',
  script_phase: '剧本', outline: '大纲', topic: '选题', delivery: '交付',
}

export const SLOT_LABEL: Record<EquipSlot, string> = {
  head: '头饰', body: '服装', accessory: '配饰', hand: '手持道具', feet: '足部',
}

/** 作用域 → 中文（资产库 scope 分段用）。 */
export const SCOPE_LOOKUP: Record<AssetScope, string> = {
  library: '全局库', series: '系列', project: '项目',
}

// ─── 纯函数 helper ────────────────────────────────────────
export const assetByUuid = (uuid: string): AssetItem | undefined =>
  ASSETS.find((a) => a.uuid === uuid)

export const allTags = (): string[] =>
  [...new Set(ASSETS.flatMap((a) => a.tags ?? []))].sort()

/** 模态色 CSS 变量名 */
export const modalityVar = (m: AssetModality): string =>
  ({ image: '--cv-mod-image', text: '--cv-mod-text', audio: '--cv-mod-audio', video: '--cv-mod-video' })[m]
export const modalityWeakVar = (m: AssetModality): string => modalityVar(m) + '-weak'

// ─── 真实 API 数据映射（assets-registry → AssetItem） ──────
//
// 现网 /api/v1/assets-registry 返回粗粒度 type + filePath（JOIN o_image）。
// 这里把 AssetDetail 映射成统一的 AssetItem，使资产库/详情视图既能吃真实数据，
// 又复用既有渲染。emoji/modality 由 type 派生（真实资产无 emoji 字段）。

/** 粗/细 type → 模态色。视觉类=青、文本类=金、音频=橙、视频=玫。 */
export function modalityOfType(type: string): AssetModality {
  if (['voice', 'audio'].includes(type)) return 'audio'
  if (['video', 'clip'].includes(type)) return 'video'
  if (['script_phase', 'outline', 'topic', 'style', 'delivery'].includes(type)) return 'text'
  return 'image' // character/scene/prop/costume/accessory/storyboard/...
}

/** type → 展示用 emoji（真实资产无 emoji，按类型给默认图标）。 */
export function emojiOfType(type: string): string {
  const map: Record<string, string> = {
    character: '👤', scene: '🌆', scene_variant: '🌗', prop: '📦', prop_key: '🗝️',
    prop_consumable: '🥫', costume: '👘', accessory: '💍', style: '🎨', audio: '🎵',
    voice: '🎙️', video: '🎬', clip: '🎞️', storyboard: '🎬', script_phase: '📝',
    outline: '🗂️', topic: '💡', delivery: '📦',
  }
  return map[type] ?? '📦'
}

/** 真实资产资产库左栏用的粗粒度类型树（按现网实际 type 分组）。 */
export const REAL_TYPE_GROUPS: TypeGroup[] = [
  { group: '角色 / 场景 / 道具', items: [
    { t: 'character', ic: '👤', n: '角色' },
    { t: 'scene', ic: '🌆', n: '场景' },
    { t: 'prop', ic: '📦', n: '道具' },
  ]},
  { group: '媒体产物', items: [
    { t: 'video', ic: '🎬', n: '视频' },
    { t: 'audio', ic: '🎵', n: '音频' },
    { t: 'voice', ic: '🎙️', n: '声纹' },
    { t: 'storyboard', ic: '🎬', n: '分镜' },
    { t: 'clip', ic: '🎞️', n: '片段' },
  ]},
  { group: '文本产物', items: [
    { t: 'script_phase', ic: '📝', n: '剧本' },
    { t: 'outline', ic: '🗂️', n: '大纲' },
    { t: 'topic', ic: '💡', n: '选题' },
    { t: 'delivery', ic: '📦', n: '交付' },
  ]},
]

/** 真实 registry 的 AssetDetail → 统一 AssetItem（资产库/详情消费）。 */
export function assetDetailToItem(d: AssetDetail): AssetItem {
  const type = (d.type || 'prop') as AssetType
  const tags = d.tags ? d.tags.split(',').map((s) => s.trim()).filter(Boolean) : []
  return {
    uuid: d.uuid || `id-${d.id}`,
    name: d.name || '未命名资产',
    type,
    modality: modalityOfType(type),
    emoji: emojiOfType(type),
    scope: d.projectId == null ? 'library' : 'project',
    desc: d.describe ?? undefined,
    tags,
    model: d.model ?? undefined,
    prompt: d.prompt ?? undefined,
    views: type === 'scene' ? ['overview', 'wide', 'close'] : ['front', 'side', 'back'],
    id: d.id,
    filePath: d.filePath ?? undefined,
    characterId: d.characterId ?? undefined,
    viewAngle: d.viewAngle ?? undefined,
    source: 'real',
    isPrimaryView: d.isPrimaryView ?? false,
    meta: d.meta,
  }
}

/** 取全部真实资产的标签集合（资产库标签筛选用）。 */
export function realTags(items: AssetItem[]): string[] {
  return [...new Set(items.flatMap((a) => a.tags ?? []))].sort()
}

// ─── 层级推断（纯前端，不改后端） ─────────────────────────

/** 资产层级 */
export type AssetLevel = 'show' | 'scene' | 'shot'

/**
 * 资产子类型（从现有数据推断）—— 对应 Kai 管线链条的各阶段产物。
 * 链条：①设定图 → ②灰底Turnaround → ③场景设定 → ④场景三视角 → ⑤分镜
 *       → ⑥场景角度图 → ⑦人物定妆Turnaround → ⑧首帧 → ⑨尾帧
 */
export type AssetSubtype =
  | 'character_concept'    // ① 角色设定图（全剧级，非 turnaround 的 character 资产）
  | 'turnaround_sheet'     // ② 灰底紧身衣 Turnaround 整图（全剧级身份锚点，viewAngle=null）
  | 'turnaround_view'      // Turnaround 拆分视角（全剧级，viewAngle=front/side/back/three_quarter）
  | 'scene_base'           // ③ 场景设定图（场景级，如「宴会厅 v1」）
  // @deprecated 三视角（多视角方案）已废弃，每个场景只保留一张场景设定图。
  // 仅保留联合成员以避免其它引用处报类型错误，前端不再产生此子类型。
  | 'scene_three_view'
  | 'scene_angle_shot'     // ⑥ 场景角度图（分镜级，scene_refs 目录，S0X_front/angle_left/angle_right）
  | 'scene_variant'        // 场景变体（场景级，旧兜底）
  | 'costume_turnaround'   // ⑦ 人物定妆 Turnaround（分镜级，参考②+⑤ —— 管线尚未产出，前端预留识别）
  | 'keyframe_first'       // ⑧ 首帧（分镜级）
  | 'keyframe_last'        // ⑨ 尾帧（分镜级）
  | 'unknown'

/** 从 AssetDetail 推断层级 */
export function inferLevel(d: AssetDetail): AssetLevel {
  if (d.type === 'keyframe') return 'shot'
  if (d.type === 'scene' || d.type === 'scene_variant' || d.type === 'scene_image') return 'scene'
  return 'show'  // character 默认全剧级
}

/** 从 AssetDetail 推断子类型 */
export function inferSubtype(d: AssetDetail): AssetSubtype {
  if (d.type === 'character') {
    const fp = (d.filePath || '').toLowerCase()
    const nm = (d.name || '').toLowerCase()
    const tags = (d.tags || '').toLowerCase()
    // ⑦ 人物定妆 Turnaround（管线尚未产出 → 前端预留识别：路径/名称/标签含 costume_turnaround）
    // 放在最前：定妆 turnaround 是分镜级产物，优先于全剧级 turnaround 整图判定。
    if (
      fp.includes('costume_turnaround') || fp.includes('costume-tr') ||
      nm.includes('costume_turnaround') || nm.includes('定妆turnaround') ||
      tags.includes('costume_turnaround')
    ) {
      return 'costume_turnaround'
    }
    // viewAngle=front/side/back/three_quarter = 从 turnaround 整图裁出的拆分视角图
    if (d.viewAngle && ['front', 'side', 'back', 'three_quarter'].includes(d.viewAngle as string)) {
      return 'turnaround_view'
    }
    // ② 灰底Turnaround（独立产出）：name 含 "灰底Turnaround" 或 filePath 匹配 turnaround_*.png（非 base_ 前缀）
    if (
      nm.includes('灰底turnaround') ||
      (fp.includes('turnaround_sheets/turnaround_') && !fp.includes('base_turnaround'))
    ) {
      return 'turnaround_sheet'
    }
    // 其余 character + viewAngle=null = 角色设定图（①）
    return 'character_concept'
  }
  if (d.type === 'keyframe') {
    return (d.name || '').includes('_first_') || (d.name || '').includes('first') ? 'keyframe_first' : 'keyframe_last'
  }
  if (d.type === 'scene' || d.type === 'scene_variant' || d.type === 'scene_image') {
    const fp = (d.filePath || '').toLowerCase()
    const nm = (d.name || '').toLowerCase()
    // ⑥ 场景角度图（分镜级）：名称含「场景角度图」/ 文件名 S0X_front|angle_*（不含 scene_refs 的）
    if (
      nm.includes('场景角度图') ||
      fp.includes('scene_angle') ||
      /\bs\d+_(front|angle_left|angle_right)\b/.test(fp)
    ) {
      return 'scene_angle_shot'
    }
    // ③ 场景设定图（场景级，如「宴会厅 v1」）
    return 'scene_base'
  }
  return 'unknown'
}

// ─── Turnaround 整图方向检测 ───────────────────────────────
//
// Turnaround（灰底紧身衣4视角合一参考图）有两种布局：
//   - portrait  (竖屏 9:16): 4-panel vertical stack, 典型 1440×2560 ← 竖屏短剧达标
//   - landscape (横屏 16:9): 4-panel horizontal-row, 典型 2560×1440 ← 不达标
// 当前项目是竖屏短剧（9:16），所以 turnaround 应为 portrait。
// 尺寸来源：canvas_nodes / o_assets.meta JSON 中的 sheetWidth / sheetHeight 字段。

/** Turnaround 整图方向（由 sheetWidth/sheetHeight 推断）。 */
export type TurnaroundOrientation = 'portrait' | 'landscape' | 'unknown'

/** 竖屏达标比例（9:16）的容差：aspect 在 [MIN_PORTRAIT_AR, MAX_PORTRAIT_AR] 内视为 portrait 达标。 */
const PORTRAIT_AR = 9 / 16        // 0.5625
const PORTRAIT_AR_TOLERANCE = 0.12 // ±12% 容差（允许 0.495 ~ 0.630）
const MIN_PORTRAIT_AR = PORTRAIT_AR * (1 - PORTRAIT_AR_TOLERANCE)
const MAX_PORTRAIT_AR = PORTRAIT_AR * (1 + PORTRAIT_AR_TOLERANCE)

export interface TurnaroundSheetValidation {
  orientation: TurnaroundOrientation
  /** 当前项目（竖屏短剧）是否达标：portrait=达标, landscape/unknown=不达标。 */
  compliant: boolean
  /** 实际宽高比（width/height），unknown 时为 null。 */
  aspectRatio: number | null
  /** 检测到的尺寸（可能 undefined）。 */
  width?: number
  height?: number
}

/**
 * 校验 Turnaround 整图方向是否达标（竖屏短剧需 portrait）。
 *
 * 判定逻辑：
 *   - width/height 缺失或非正数 → unknown（无法判定）
 *   - width < height → portrait（竖屏，达标）
 *   - width > height → landscape（横屏，不达标）
 *   - width === height → 按 aspectRatio 进一步判定，方图归 unknown
 *
 * @example
 *   validateTurnaroundSheet(1440, 2560) // → portrait, compliant=true
 *   validateTurnaroundSheet(2560, 1440) // → landscape, compliant=false
 *   validateTurnaroundSheet(undefined, undefined) // → unknown, compliant=false
 */
export function validateTurnaroundSheet(
  width?: number,
  height?: number,
): TurnaroundSheetValidation {
  // 尺寸缺失或非法 → 无法判定
  if (
    typeof width !== 'number' || typeof height !== 'number' ||
    !Number.isFinite(width) || !Number.isFinite(height) ||
    width <= 0 || height <= 0
  ) {
    return { orientation: 'unknown', compliant: false, aspectRatio: null }
  }

  const ar = width / height

  // 宽 < 高 → 竖屏（portrait），达标
  if (width < height) {
    return { orientation: 'portrait', compliant: true, aspectRatio: ar, width, height }
  }
  // 宽 > 高 → 横屏（landscape），不达标
  if (width > height) {
    return { orientation: 'landscape', compliant: false, aspectRatio: ar, width, height }
  }
  // 宽 === 高（方图）：若 aspectRatio 落在 portrait 容差内算达标，否则 unknown
  // 实际上方图 ar=1 不可能落在 [0.495, 0.630]，所以归 unknown
  if (ar >= MIN_PORTRAIT_AR && ar <= MAX_PORTRAIT_AR) {
    return { orientation: 'portrait', compliant: true, aspectRatio: ar, width, height }
  }
  return { orientation: 'unknown', compliant: false, aspectRatio: ar, width, height }
}

/**
 * 从 AssetDetail.meta（JSON 字符串）解析 turnaround 整图的 sheetWidth/sheetHeight。
 *
 * canvas_nodes / o_assets.meta JSON 中 turnaround sheet 节点形如：
 *   { "sheetWidth": 1440, "sheetHeight": 2560, "isTurnaroundSheet": true, ... }
 *
 * 兼容多种字段命名（sheetWidth/sheet_width/sheetW）以应对后端命名差异。
 * 返回 [width, height]，无法解析时返回 [undefined, undefined]。
 */
export function parseTurnaroundSheetSize(meta?: string | null): [number | undefined, number | undefined] {
  if (!meta) return [undefined, undefined]
  let parsed: unknown
  try {
    parsed = JSON.parse(meta)
  } catch {
    return [undefined, undefined]
  }
  if (!parsed || typeof parsed !== 'object') return [undefined, undefined]
  const obj = parsed as Record<string, unknown>
  // 宽：sheetWidth / sheet_width / sheetW / width
  const w = obj.sheetWidth ?? obj.sheet_width ?? obj.sheetW ?? obj.width
  // 高：sheetHeight / sheet_height / sheetH / height
  const h = obj.sheetHeight ?? obj.sheet_height ?? obj.sheetH ?? obj.height
  const width = typeof w === 'number' ? w : (typeof w === 'string' ? Number(w) : undefined)
  const height = typeof h === 'number' ? h : (typeof h === 'string' ? Number(h) : undefined)
  return [
    Number.isFinite(width) ? width : undefined,
    Number.isFinite(height) ? height : undefined,
  ]
}

// ─── 服装变体（Costume Variants） ───────────────────────────
//
// 同一角色在不同分场/场景穿不同服装（如沈知意：宴会基线 / 日常基线 / 闪回）。
// 不新建表 —— 服装信息存在 o_assets.meta JSON：
//   {
//     "costume_set":   "daily_baseline",          // 套系 ID（同一角色内唯一）
//     "costume_label": "日常基线",                  // 显示名
//     "costume_desc":  "白丝质衬衫+黑高腰西裤",      // 服装描述
//     "scene_refs":    ["S02", "S03", "S07"]       // 适用场景 ID 列表
//   }
// meta.costume_set 区分同一角色的不同套系；scene_refs 建立服装→场景映射，
// 驱动「角色 → 服装套系 → 适用场景 → 分镜镜头」的关系链。
//
// 后端无需改动：POST /api/v1/assets/update-meta 端点会合并 meta（非整体替换），
// 适合增量写入服装字段。meta 字段也已在 PATCH /:id 的允许列表中。

/** 默认套系 ID：无 meta.costume_set 的 turnaround 资产归入此套系（label='基线'）。 */
export const DEFAULT_COSTUME_SET_ID = '__default__'

/** 从 AssetDetail.meta 解析出的服装变体信息。 */
export interface CostumeMeta {
  /** 套系 ID（缺失 → null，归入默认套系）。 */
  costumeSet: string | null
  /** 显示名（如「日常基线」）。 */
  costumeLabel: string | null
  /** 服装描述（如「白丝质衬衫+黑高腰西裤」）。 */
  costumeDesc: string | null
  /** 适用场景 ID 列表（如 ["S02","S03"]）。 */
  sceneRefs: string[]
}

/**
 * 从 o_assets.meta（JSON 字符串）解析服装变体信息。
 *
 * 兼容驼峰 / 下划线两种字段命名（costume_set / costumeSet 等）。
 * 无法解析或字段缺失时返回空值（costumeSet=null, sceneRefs=[]）。
 */
export function parseCostumeMeta(meta?: string | null): CostumeMeta {
  const empty: CostumeMeta = { costumeSet: null, costumeLabel: null, costumeDesc: null, sceneRefs: [] }
  if (!meta) return empty
  let parsed: unknown
  try {
    parsed = JSON.parse(meta)
  } catch {
    return empty
  }
  if (!parsed || typeof parsed !== 'object') return empty
  const o = parsed as Record<string, unknown>
  const cs = o.costume_set ?? o.costumeSet
  const cl = o.costume_label ?? o.costumeLabel
  const cd = o.costume_desc ?? o.costumeDesc
  const sr = o.scene_refs ?? o.sceneRefs
  return {
    costumeSet: typeof cs === 'string' && cs.trim() ? cs.trim() : null,
    costumeLabel: typeof cl === 'string' && cl.trim() ? cl.trim() : null,
    costumeDesc: typeof cd === 'string' && cd.trim() ? cd.trim() : null,
    sceneRefs: Array.isArray(sr) ? sr.filter((s): s is string => typeof s === 'string' && !!s.trim()).map((s) => s.trim()) : [],
  }
}

/** 一套服装造型（同一角色的一个 costume_set）。 */
export interface CostumeSet {
  /** 套系 ID（meta.costume_set，或 DEFAULT_COSTUME_SET_ID）。 */
  setId: string
  /** 显示名（meta.costume_label，或默认套系='基线'，否则=setId）。 */
  label: string
  /** 服装描述（meta.costume_desc）。 */
  desc: string | null
  /** 是否为默认套系（无 costume_set 的资产）。 */
  isDefault: boolean
  /** 适用场景 ID 列表（合并该套系所有资产的 meta.scene_refs）。 */
  sceneRefs: string[]
  /** 该套系的 Turnaround 整图（灰底 turnaround_sheet 或 costume_turnaround）。 */
  sheet: AssetItem | null
  /** 该套系的拆分视角（turnaround_view：front/side/back/three_quarter）。 */
  views: AssetItem[]
}

/**
 * 按角色 ID 把 turnaround 相关资产分组成若干「服装套系」。
 *
 * 参与分组的资产子类型：
 *   - turnaround_sheet  ② 灰底整图（套系的代表图 / hero image）
 *   - turnaround_view   拆分视角（front/side/back/three_quarter → 四宫格）
 *   - costume_turnaround ⑦ 人物定妆（未来管线产物，按套系归入 sheet）
 *
 * 无 meta.costume_set 的资产归入默认套系（label='基线'）。返回数组默认套系在最前，
 * 其余按 label 排序；空套系（无 sheet 且无拆分视角）会被过滤掉。
 *
 * @param assets      项目级全部资产（useRealAssets 已按 projectId 拉取）
 * @param characterId 角色 ID
 */
export function groupCharacterCostumes(assets: AssetDetail[], characterId: string): CostumeSet[] {
  const bySet = new Map<string, CostumeSet>()
  const ensure = (setId: string, isDefault: boolean): CostumeSet => {
    let s = bySet.get(setId)
    if (!s) {
      s = {
        setId,
        label: isDefault ? '基线' : setId,
        desc: null,
        isDefault,
        sceneRefs: [],
        sheet: null,
        views: [],
      }
      bySet.set(setId, s)
    }
    return s
  }

  for (const a of assets) {
    if (a.type !== 'character') continue
    if ((a.characterId ?? null) !== characterId) continue
    if ((a.state ?? 'active') === 'eliminated') continue
    const subtype = inferSubtype(a)
    // 仅 turnaround 相关资产参与服装分组（概念图①是角色身份锚点，不属服装）
    if (subtype !== 'turnaround_sheet' && subtype !== 'turnaround_view' && subtype !== 'costume_turnaround') continue

    const cm = parseCostumeMeta(a.meta)
    const isDefault = cm.costumeSet == null
    const set = ensure(cm.costumeSet ?? DEFAULT_COSTUME_SET_ID, isDefault)
    if (cm.costumeLabel) set.label = cm.costumeLabel
    if (cm.costumeDesc && !set.desc) set.desc = cm.costumeDesc
    for (const r of cm.sceneRefs) if (!set.sceneRefs.includes(r)) set.sceneRefs.push(r)

    if ((subtype === 'turnaround_sheet' || subtype === 'costume_turnaround') && !set.sheet) {
      set.sheet = assetDetailToItem(a)
    }
    if (subtype === 'turnaround_view') {
      set.views.push(assetDetailToItem(a))
    }
  }

  const sets = [...bySet.values()].filter((s) => s.sheet || s.views.length > 0)
  sets.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
    return a.label.localeCompare(b.label, 'zh')
  })
  return sets
}

/** 角色身份（左栏角色列表用，每角色一条代表图）。 */
export interface CharacterIdentity {
  characterId: string
  item: AssetItem
}

/**
 * 按角色 ID 聚合身份代表图（左栏角色列表用）。
 *
 * 每个角色取一张代表图，优先级：
 *   1. character_concept（isPrimaryView 优先）—— 角色设定图，定义长相/气质
 *   2. turnaround_sheet —— 灰底整图（无概念图时兜底）
 *   3. 该角色的任意一张资产
 *
 * 这样左栏每角色只显示一条（修复旧逻辑把概念图 + 灰底整图都当作独立角色的问题）。
 */
export function groupCharacterIdentities(assets: AssetDetail[]): CharacterIdentity[] {
  const byChar = new Map<string, AssetDetail[]>()
  for (const a of assets) {
    if (a.type !== 'character') continue
    if ((a.state ?? 'active') === 'eliminated') continue
    if (!a.characterId) continue
    if (!byChar.has(a.characterId)) byChar.set(a.characterId, [])
    byChar.get(a.characterId)!.push(a)
  }

  const out: CharacterIdentity[] = []
  for (const [characterId, list] of byChar) {
    const byPv = (a: AssetDetail) => (a.isPrimaryView ? 1 : 0)
    const concept = list
      .filter((a) => inferSubtype(a) === 'character_concept')
      .sort((a, b) => byPv(b) - byPv(a))[0]
    const sheet = list.find((a) => inferSubtype(a) === 'turnaround_sheet')
    const rep = concept ?? sheet ?? list[0]
    out.push({ characterId, item: assetDetailToItem(rep) })
  }
  out.sort((a, b) => a.item.name.localeCompare(b.item.name, 'zh'))
  return out
}

/** 从 AssetDetail 提取 sceneId（场景设定图按场景名分组，分镜按 S 编号） */
export function inferSceneId(d: AssetDetail): string | null {
  // keyframe: name 形如 "S01_first_v1" → 按分镜 S 编号分组
  if (d.type === 'keyframe') {
    const m = (d.name || '').match(/^(S\d+)/i)
    if (m) return m[1]
  }
  // scene: 优先用场景名分组（「宴会厅 v1」→「宴会厅」），便于层级树显示可读场景名；
  //        name 缺失时回退到 filePath 里的 S 编号。
  if (d.type === 'scene' || d.type === 'scene_variant' || d.type === 'scene_image') {
    const nm = (d.name || '').replace(/\s*v\d+$/i, '').trim()
    if (nm) return nm
    const fn = (d.filePath || '').split('/').pop() || ''
    const m = fn.match(/S(\d+)/i)
    if (m) return `S${m[1].padStart(2, '0')}`
    return null
  }
  return null
}

/** 从 AssetDetail 提取 shotId */
export function inferShotId(d: AssetDetail): string | null {
  if (d.type !== 'keyframe') return null
  const m = (d.name || '').match(/^(S\d+)/i)
  return m ? m[1] : null
}

// ─── 生成链路推断（纯前端，不改后端） ─────────────────────
//
// 复现 Kai 的管线因果链：①设定图 → ②灰底Turnaround → ③场景设定 → ④场景三视角
//   → ⑤分镜 → ⑥场景角度图 → ⑦人物定妆Turnaround → ⑧首帧 → ⑨尾帧。
// 仅依据资产现有字段（name/characterId/filePath/shotId）做「软」关联——
// 能用共享键（shotId / characterId）精确匹配的给可点击跳转节点；
// 无法精确匹配的（如 shot→character 无映射）以非可点击的「管线说明」条目呈现，
// 避免给出虚假精确链接。

/** 链路节点方向：up=参考来源（本资产被它生成），down=被引用（下游消费了本资产） */
export type ChainDirection = 'up' | 'down'

export interface ChainLink {
  direction: ChainDirection
  /** 节点子类型（决定 emoji / 标签）；'prompt' 为文本说明节点 */
  kind: AssetSubtype | 'prompt' | 'pipeline_note'
  emoji: string
  /** 显示名（资产名 / 说明） */
  label: string
  /** 副标题（子类型标签 / 关系说明） */
  detail?: string
  /** 真实资产 → 可点击跳转详情；无则不可点击 */
  uuid?: string
}

/** 从 AssetItem.name/filePath 提取 shotId（S0X），用于 keyframe ↔ 场景角度图关联。 */
function shotIdOfItem(a: AssetItem): string | null {
  const m = (a.name || '').match(/(S\d+)/i) || (a.filePath || '').match(/(S\d+)/i)
  return m ? m[1] : null
}

/**
 * 计算某资产的生成链路（参考来源 + 被引用）。
 *
 * @param item 当前资产（AssetItem）
 * @param all  同项目全部资产（用于跨资产关联）
 * @returns ChainLink[] —— up 在前、down 在后；空数组表示无链路
 */
export function computeGenerationChain(item: AssetItem, all: AssetItem[]): ChainLink[] {
  const subtype = inferSubtypeFromItem(item)
  const up: ChainLink[] = []
  const down: ChainLink[] = []

  // —— 首帧 / 尾帧（⑧⑨）：按 shotId 关联场景角度图 + Turnaround + 配对帧 ——
  if (subtype === 'keyframe_first' || subtype === 'keyframe_last') {
    const shotId = shotIdOfItem(item)

    // 参考来源 ↑：⑥ 场景角度图（同 shotId）
    if (shotId) {
      const angles = all.filter((x) => inferSubtypeFromItem(x) === 'scene_angle_shot' && shotIdOfItem(x) === shotId)
      angles.slice(0, 3).forEach((x) => up.push({
        direction: 'up', kind: 'scene_angle_shot', emoji: SUBTYPE_EMOJI.scene_angle_shot,
        label: x.name, detail: '场景角度图', uuid: x.uuid,
      }))
      // 参考来源 ↑：① 角色设定图（角色身份锚点 —— 全剧级，无 shot→character 映射，列全部角色设定）
      const turns = all.filter((x) => inferSubtypeFromItem(x) === 'character_concept')
      turns.slice(0, 4).forEach((x) => up.push({
        direction: 'up', kind: 'character_concept', emoji: SUBTYPE_EMOJI.character_concept,
        label: x.name, detail: '角色设定图参考', uuid: x.uuid,
      }))
    }

    // 参考来源 ↑：⑦ 人物定妆 Turnaround（同 shotId —— 若管线已产出则精确匹配）
    if (shotId) {
      const costumes = all.filter((x) => inferSubtypeFromItem(x) === 'costume_turnaround' && shotIdOfItem(x) === shotId)
      costumes.forEach((x) => up.push({
        direction: 'up', kind: 'costume_turnaround', emoji: SUBTYPE_EMOJI.costume_turnaround,
        label: x.name, detail: '人物定妆参考', uuid: x.uuid,
      }))
    }

    // 参考来源 ↑：Prompt（文本说明节点，不可点击）
    if (item.prompt) {
      up.push({
        direction: 'up', kind: 'prompt', emoji: '📝',
        label: subtype === 'keyframe_first' ? '首帧生成 Prompt' : '尾帧生成 Prompt',
        detail: item.prompt.length > 60 ? item.prompt.slice(0, 60) + '…' : item.prompt,
      })
    }

    // 被引用 ↓：⑧首帧 → 配对的⑨尾帧（同 shotId）；尾帧无下游
    if (subtype === 'keyframe_first' && shotId) {
      const last = all.find((x) => inferSubtypeFromItem(x) === 'keyframe_last' && shotIdOfItem(x) === shotId && x.uuid !== item.uuid)
      if (last) down.push({
        direction: 'down', kind: 'keyframe_last', emoji: SUBTYPE_EMOJI.keyframe_last,
        label: last.name, detail: '尾帧 · 参考本首帧', uuid: last.uuid,
      })
    }
  }

  // —— 场景角度图（⑥）：上游=场景设定+分镜(说明)，下游=使用它的首尾帧 ——
  if (subtype === 'scene_angle_shot') {
    const shotId = shotIdOfItem(item)
    // 参考来源 ↑：③ 场景设定图 + ⑤ 分镜设计（无精确资产键，管线说明节点）
    up.push({
      direction: 'up', kind: 'pipeline_note', emoji: '🏠',
      label: '③ 场景设定图 + ⑤ 分镜设计', detail: '管线参考来源（无可点击资产）',
    })
    // 被引用 ↓：使用本场景角度的首/尾帧（同 shotId）
    if (shotId) {
      const kfs = all.filter((x) =>
        (inferSubtypeFromItem(x) === 'keyframe_first' || inferSubtypeFromItem(x) === 'keyframe_last') &&
        shotIdOfItem(x) === shotId)
      kfs.slice(0, 6).forEach((x) => down.push({
        direction: 'down', kind: inferSubtypeFromItem(x), emoji: SUBTYPE_EMOJI[inferSubtypeFromItem(x) as AssetSubtype],
        label: x.name, detail: '引用了本场景角度', uuid: x.uuid,
      }))
    }
  }

  // —— 灰底 Turnaround（②）：上游=角色设定，下游=人物定妆(⑦) ——
  if (subtype === 'turnaround_sheet') {
    // 参考来源 ↑：① 角色设定图（同 characterId）
    if (item.characterId) {
      const concept = all.find((x) => inferSubtypeFromItem(x) === 'character_concept' && x.characterId === item.characterId)
      if (concept) up.push({
        direction: 'up', kind: 'character_concept', emoji: SUBTYPE_EMOJI.character_concept,
        label: concept.name, detail: '角色设定图', uuid: concept.uuid,
      })
    }
    // 被引用 ↓：⑦ 人物定妆 Turnaround（同 characterId —— 管线产出后精确匹配）
    if (item.characterId) {
      const costumes = all.filter((x) => inferSubtypeFromItem(x) === 'costume_turnaround' && x.characterId === item.characterId)
      costumes.forEach((x) => down.push({
        direction: 'down', kind: 'costume_turnaround', emoji: SUBTYPE_EMOJI.costume_turnaround,
        label: x.name, detail: '人物定妆 · 参考本灰底', uuid: x.uuid,
      }))
    }
  }

  // —— 人物定妆 Turnaround（⑦）：上游=灰底Turnaround(同角色) + 场景角度(同shot) ——
  if (subtype === 'costume_turnaround') {
    if (item.characterId) {
      const base = all.find((x) => inferSubtypeFromItem(x) === 'character_concept' && x.characterId === item.characterId)
      if (base) up.push({
        direction: 'up', kind: 'character_concept', emoji: SUBTYPE_EMOJI.character_concept,
        label: base.name, detail: '角色设定图参考', uuid: base.uuid,
      })
    }
    up.push({
      direction: 'up', kind: 'pipeline_note', emoji: '🏠',
      label: '⑤ 分镜设计 服化道', detail: '管线参考来源（无可点击资产）',
    })
    // 被引用 ↓：首/尾帧（同 shotId）
    const shotId = shotIdOfItem(item)
    if (shotId) {
      const kfs = all.filter((x) => inferSubtypeFromItem(x) === 'keyframe_first' && shotIdOfItem(x) === shotId)
      kfs.slice(0, 3).forEach((x) => down.push({
        direction: 'down', kind: 'keyframe_first', emoji: SUBTYPE_EMOJI.keyframe_first,
        label: x.name, detail: '引用了本定妆', uuid: x.uuid,
      }))
    }
  }

  // —— 角色设定图（①）：下游=首尾帧/场景角度图（管线说明，无精确键） ——
  if (subtype === 'character_concept' && item.characterId) {
    down.push({
      direction: 'down', kind: 'pipeline_note', emoji: '🎬',
      label: '⑧⑨ 首尾帧 / ⑥ 场景角度图', detail: '作为角色身份锚点被下游引用',
    })
  }

  // —— 场景设定图（③）：下游=场景角度图（说明，无精确键） ——
  if (subtype === 'scene_base') {
    down.push({
      direction: 'down', kind: 'pipeline_note', emoji: '🎥',
      label: '⑥ 场景角度图', detail: '选定后生成多视角（分镜级）',
    })
  }

  return [...up, ...down]
}

/** AssetItem → AssetSubtype（computeGenerationChain 内部用，避免重复映射 AssetDetail）。 */
function inferSubtypeFromItem(a: AssetItem): AssetSubtype {
  // 与 inferSubtype(AssetDetail) 保持等价：AssetItem 已含 type/characterId/viewAngle/filePath/name/tags。
  // 注意：AssetItem.type 是 AssetType 联合（不含 'keyframe'/'scene_image'），但 assetDetailToItem
  // 把 registry 的 string type 强制 as AssetType —— 运行时仍是 'keyframe' 等，故这里按 string 比较。
  const t = a.type as string
  if (t === 'character') {
    const fp = (a.filePath || '').toLowerCase()
    const nm = (a.name || '').toLowerCase()
    const tags = (a.tags ?? []).join(',').toLowerCase()
    if (
      fp.includes('costume_turnaround') || fp.includes('costume-tr') ||
      nm.includes('costume_turnaround') || nm.includes('定妆turnaround') ||
      tags.includes('costume_turnaround')
    ) return 'costume_turnaround'
    if (['front', 'side', 'back', 'three_quarter'].includes(a.viewAngle ?? '')) return 'turnaround_view'
    // ② 灰底Turnaround（独立产出）
    if (
      nm.includes('灰底turnaround') ||
      (fp.includes('turnaround_sheets/turnaround_') && !fp.includes('base_turnaround'))
    ) return 'turnaround_sheet'
    // 其余 = 角色设定图（①）
    return 'character_concept'
  }
  if (t === 'keyframe') {
    return (a.name || '').includes('_first_') || (a.name || '').includes('first') ? 'keyframe_first' : 'keyframe_last'
  }
  if (t === 'scene' || t === 'scene_variant' || t === 'scene_image') {
    const fp = (a.filePath || '').toLowerCase()
    const nm = (a.name || '').toLowerCase()
    // 场景角度图：含 scene_angle 或文件名含角度关键词的
    if (
      nm.includes('场景角度图') ||
      fp.includes('scene_angle') ||
      /\bs\d+_(front|angle_left|angle_right)\b/.test(fp)
    ) return 'scene_angle_shot'
    return 'scene_base'
  }
  return 'unknown'
}

/**
 * 子类型中文标签。
 * 注意：scene_three_view 已废弃，但 AssetSubtype 联合保留该成员以避免其它引用报类型错误，
 * 故本 Record 仍保留占位条目（不再在 UI 中使用）。
 */
export const SUBTYPE_LABEL: Record<AssetSubtype, string> = {
  character_concept: '角色设定图',
  turnaround_sheet: '灰色紧身衣Turnaround',
  turnaround_view: '视角拆分',
  scene_base: '场景设定图',
  scene_three_view: '三视角场景（已废弃）',
  scene_angle_shot: '场景角度图',
  scene_variant: '场景变体',
  costume_turnaround: '分镜级Turnaround',
  keyframe_first: '首帧',
  keyframe_last: '尾帧',
  unknown: '其他',
}

/**
 * 子类型 emoji。
 * 注意：scene_three_view 已废弃，占位条目保留以满足 Record<AssetSubtype> 类型约束。
 */
export const SUBTYPE_EMOJI: Record<AssetSubtype, string> = {
  character_concept: '🎨',
  turnaround_sheet: '👕',
  turnaround_view: '📐',
  scene_base: '🏠',
  scene_three_view: '📐',
  scene_angle_shot: '🎥',
  scene_variant: '🌗',
  costume_turnaround: '🎭',
  keyframe_first: '▶️',
  keyframe_last: '⏹️',
  unknown: '📦',
}

/** 层级中文标签 */
export const LEVEL_LABEL: Record<AssetLevel, string> = {
  show: '全剧级',
  scene: '场景级',
  shot: '分镜级',
}

