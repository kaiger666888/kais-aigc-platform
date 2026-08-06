import { describe, it, expect } from 'vitest'
import { classifyNode, laneIndexOf, LANE_DEFS, MODALITY_LABELS } from '../lanes'

describe('classifyNode（模态 × 功能子类）', () => {
  it('文字：assetType topic/hook→钩子；outline/script_phase→剧本；其余→描述', () => {
    expect(classifyNode({ id: 'n1', stage: 'script', modality: 'text', raw: { assetType: 'topic' } }))
      .toEqual({ modality: 'text', subClass: 'hook' })
    expect(classifyNode({ id: 'n2', stage: 'script', modality: 'text', raw: { assetType: 'hook' } }))
      .toEqual({ modality: 'text', subClass: 'hook' })
    expect(classifyNode({ id: 'n3', stage: 'script', modality: 'text', raw: { assetType: 'outline' } }))
      .toEqual({ modality: 'text', subClass: 'script' })
    expect(classifyNode({ id: 'n4', stage: 'script', modality: 'text', raw: { assetType: 'script_phase' } }))
      .toEqual({ modality: 'text', subClass: 'script' })
    // 描述类（角色设计/场景生成等 phase 文本产物）
    expect(classifyNode({ id: 'n5', stage: 'script', modality: 'text', raw: { assetType: 'character' } }))
      .toEqual({ modality: 'text', subClass: 'notes' })
    expect(classifyNode({ id: 'n6', stage: 'script', modality: 'text', raw: { assetType: 'delivery' } }))
      .toEqual({ modality: 'text', subClass: 'notes' })
  })

  it('图片：character 按 costume 字段/id→服装；l4_props id→道具；其余 character→角色', () => {
    // l1_anchors / l2_scene_fittings → 角色
    expect(classifyNode({ id: 'a-character_assets-l1_anchors-0', stage: 'global', modality: 'image', raw: { assetType: 'character', archetype: 'protagonist' } }))
      .toEqual({ modality: 'image', subClass: 'character' })
    expect(classifyNode({ id: 'a-character_assets-l2_scene_fittings-0', stage: 'global', modality: 'image', raw: { assetType: 'character', character: 'octopus_worker' } }))
      .toEqual({ modality: 'image', subClass: 'character' })
    // l3_costumes（有 costume 字段）→ 服装
    expect(classifyNode({ id: 'a-character_assets-l3_costumes-0', stage: 'global', modality: 'image', raw: { assetType: 'character', costume: 'suit_intact' } }))
      .toEqual({ modality: 'image', subClass: 'costume' })
    // l4_props → 道具
    expect(classifyNode({ id: 'a-character_assets-l4_props-0', stage: 'global', modality: 'image', raw: { assetType: 'character' } }))
      .toEqual({ modality: 'image', subClass: 'prop' })
    // scene → 场景
    expect(classifyNode({ id: 'a-scene_images-0', stage: 'global', modality: 'image', raw: { assetType: 'scene' } }))
      .toEqual({ modality: 'image', subClass: 'scene' })
    // scene_image（场景图 raw assetType='scene_image'）→ 场景（不落入 character 兜底）
    expect(classifyNode({ id: 'a-scene_refs-S01', stage: 'global', modality: 'image', raw: { assetType: 'scene_image' } }))
      .toEqual({ modality: 'image', subClass: 'scene' })
  })

  it('图片：storyboard stage → 分镜（Eコンテ）', () => {
    expect(classifyNode({ id: 'a-S3_01-10', stage: 'storyboard', modality: 'image', raw: { assetType: 'storyboard', shot_id: 'S3_01' } }))
      .toEqual({ modality: 'image', subClass: 'storyboard' })
  })

  it('视频：phase13/delivery/master → 总视频；其余 → 分镜视频', () => {
    expect(classifyNode({ id: 'a-S1_01', stage: 'video', modality: 'video', phaseIndex: 11, raw: { assetType: 'video', shot_id: 'S1_01' } }))
      .toEqual({ modality: 'video', subClass: 'shot' })
    expect(classifyNode({ id: 'a-master_mp4', stage: 'composite', modality: 'video', phaseIndex: 13, raw: { assetType: 'delivery' } }))
      .toEqual({ modality: 'video', subClass: 'master' })
  })

  it('音频：bgm→背景音乐；mix→混音；其余→对白', () => {
    expect(classifyNode({ id: 'au1', stage: 'bgm', modality: 'audio', raw: { audioType: 'bgm' } }))
      .toEqual({ modality: 'audio', subClass: 'bgm' })
    expect(classifyNode({ id: 'au2', stage: 'mix', modality: 'audio', raw: {} }))
      .toEqual({ modality: 'audio', subClass: 'mix' })
    expect(classifyNode({ id: 'au3', stage: 'voice', modality: 'audio', raw: {} }))
      .toEqual({ modality: 'audio', subClass: 'dialogue' })
  })

  it('modality 缺省时按 stage 兜底；无法判定 → null', () => {
    expect(classifyNode({ id: 'x', stage: 'script', raw: { assetType: 'topic' } }))
      .toEqual({ modality: 'text', subClass: 'hook' })
    expect(classifyNode({ id: 'x', stage: 'video', phaseIndex: 11, raw: {} }))
      .toEqual({ modality: 'video', subClass: 'shot' })
    expect(classifyNode({ id: 'x', raw: {} })).toBeNull()
  })
})

describe('laneIndexOf + LANE_DEFS', () => {
  it('LANE_DEFS 有序且无重复 (modality,subClass)', () => {
    const keys = LANE_DEFS.map((d) => `${d.modality}/${d.subClass}`)
    expect(new Set(keys).size).toBe(keys.length)
    // 模态分块顺序：text → image → video → audio
    const mods = [...new Set(LANE_DEFS.map((d) => d.modality))]
    expect(mods).toEqual(['text', 'image', 'video', 'audio'])
  })

  it('laneIndexOf：已知类返回 ≥0 索引；null/未知 → -1', () => {
    expect(laneIndexOf({ modality: 'image', subClass: 'character' })).toBeGreaterThanOrEqual(0)
    expect(laneIndexOf({ modality: 'text', subClass: 'hook' })).toBeGreaterThanOrEqual(0)
    expect(laneIndexOf(null)).toBe(-1)
    expect(laneIndexOf({ modality: 'text', subClass: 'nope' })).toBe(-1)
  })

  it('MODALITY_LABELS 覆盖四模态', () => {
    expect(MODALITY_LABELS).toEqual({ text: '文字', image: '图片', video: '视频', audio: '音频' })
  })
})
