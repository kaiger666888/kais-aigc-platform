/**
 * src/v3/lanes.ts — 模态泳道分类（文字/图片/视频/音频 × 功能子类）。
 *
 * Kai 设计：纵向泳道按**资产属性（模态）**分（取代旧的 type/script/asset/video），
 * 模态内部按**功能**分子类（角色/场景/服装/…；钩子/剧本/…）。横向仍是阶段（P01→P14，
 * phase-grid 不变）。分类为纯函数、可单测；后端 API 不动，仅前端映射。
 *
 * 模态权威 = migrate 嗅探的 node.modality（script→text / asset·storyboard→image /
 * video→video / audio→audio）；子类按 raw 字段（assetType/costume/audioType）+ phase + id 判定。
 */
import type { Modality } from '../theme/catppuccin'

export type LaneModality = 'text' | 'image' | 'video' | 'audio'

export interface LaneDef {
  modality: LaneModality
  subClass: string
  /** 子类中文标签（LaneBands 渲染）。 */
  label: string
}

/** 有序泳道定义：模态 × 功能子类。index = 该 (模态,子类) 的全序泳道号。 */
export const LANE_DEFS: readonly LaneDef[] = [
  // 文字
  { modality: 'text', subClass: 'hook', label: '钩子' },
  { modality: 'text', subClass: 'script', label: '剧本' },
  { modality: 'text', subClass: 'notes', label: '描述' },
  // 图片
  { modality: 'image', subClass: 'character', label: '角色' },
  { modality: 'image', subClass: 'scene', label: '场景' },
  { modality: 'image', subClass: 'costume', label: '服装' },
  { modality: 'image', subClass: 'prop', label: '道具' },
  { modality: 'image', subClass: 'storyboard', label: '分镜' },
  // 视频
  { modality: 'video', subClass: 'shot', label: '分镜视频' },
  { modality: 'video', subClass: 'master', label: '总视频' },
  // 音频（预留）
  { modality: 'audio', subClass: 'dialogue', label: '对白' },
  { modality: 'audio', subClass: 'bgm', label: '背景音乐' },
  { modality: 'audio', subClass: 'mix', label: '混音' },
]

export const MODALITY_LABELS: Record<LaneModality, string> = {
  text: '文字',
  image: '图片',
  video: '视频',
  audio: '音频',
}

export interface NodeClassInput {
  id: string
  /** migrate stage（global/script/storyboard/video/...）。 */
  stage?: string
  /** migrate 嗅探模态（text/image/video/audio）—— 模态权威。 */
  modality?: Modality
  phaseIndex?: number
  /** adapter sidecar 穿透的原始 data 袋（assetType/costume/audioType 等）。 */
  raw?: Record<string, unknown> | undefined
}

export interface NodeClass {
  modality: LaneModality
  subClass: string
}

/** stage → 模态兜底（node.modality 缺省时）。 */
function stageToModality(stage: string | undefined): LaneModality | undefined {
  switch (stage) {
    case 'script': return 'text'
    case 'video': case 'composite': return 'video'
    case 'voice': case 'foley': case 'bgm': case 'mix': return 'audio'
    case 'global': case 'storyboard': case 'keyframe': return 'image'
    default: return undefined
  }
}

/**
 * 节点 → (模态, 功能子类)。纯函数、确定性、可单测。
 *  - 文字：assetType topic/hook→钩子；outline/script_phase→剧本；其余→描述。
 *  - 图片：stage=storyboard→分镜；assetType scene/scene_image→场景；character 按 costume 字段/id→服装，
 *    prop id→道具，否则→角色。
 *  - 视频：phase13/delivery/master id→总视频；否则→分镜视频。
 *  - 音频：bgm→背景音乐；mix→混音；否则→对白。
 * 无法判定模态 → null（调用方跳过/兜底）。
 */
export function classifyNode(input: NodeClassInput): NodeClass | null {
  const { id, stage, modality, phaseIndex, raw } = input
  const r = raw ?? {}
  const assetType = typeof r.assetType === 'string' ? r.assetType : undefined
  const mod = (modality as LaneModality | undefined) ?? stageToModality(stage)
  if (!mod) return null

  if (mod === 'text') {
    if (assetType === 'topic' || assetType === 'hook') return { modality: 'text', subClass: 'hook' }
    if (assetType === 'outline' || assetType === 'script_phase' || assetType === 'script') {
      return { modality: 'text', subClass: 'script' }
    }
    return { modality: 'text', subClass: 'notes' }
  }
  if (mod === 'image') {
    if (stage === 'storyboard') return { modality: 'image', subClass: 'storyboard' }
    // scene / scene_image（场景图 raw assetType='scene_image'）→ 场景
    if (assetType === 'scene' || assetType === 'scene_image') return { modality: 'image', subClass: 'scene' }
    if (assetType === 'character') {
      if (r.costume != null || /costume/i.test(id)) return { modality: 'image', subClass: 'costume' }
      if (/l4_prop|\/props\b|\bprops\b/i.test(id)) return { modality: 'image', subClass: 'prop' }
      return { modality: 'image', subClass: 'character' }
    }
    // 无 assetType 的图片资产兜底为角色（如 character 子类缺 assetType）
    return { modality: 'image', subClass: 'character' }
  }
  if (mod === 'video') {
    if (phaseIndex === 13 || assetType === 'delivery' || /\bmaster\b/i.test(id)) {
      return { modality: 'video', subClass: 'master' }
    }
    return { modality: 'video', subClass: 'shot' }
  }
  // audio
  if (stage === 'mix' || assetType === 'mix') return { modality: 'audio', subClass: 'mix' }
  if (stage === 'bgm' || assetType === 'bgm' || r.audioType === 'bgm') return { modality: 'audio', subClass: 'bgm' }
  return { modality: 'audio', subClass: 'dialogue' }
}

/** (模态,子类) → LANE_DEFS 全序索引；未定义返回 -1。 */
export function laneIndexOf(c: NodeClass | null): number {
  if (!c) return -1
  const i = LANE_DEFS.findIndex((d) => d.modality === c.modality && d.subClass === c.subClass)
  return i < 0 ? -1 : i
}
