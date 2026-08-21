/**
 * scoreVocabulary 单测(56-01 / D-14/D-15)。
 * 中文期望值逐一列(非快照);未知回退/量纲钳制全组。
 */
import { describe, it, expect } from 'vitest'
import { dimLabel, viewLabel, verdictLabel, normalizeScore, DIM_LABELS } from '../scoreVocabulary'

describe('dimLabel(56-01 维度中文映射)', () => {
  it('p03 五维全覆盖', () => {
    expect(dimLabel('drama')).toBe('戏剧性')
    expect(dimLabel('rhythm')).toBe('节奏')
    expect(dimLabel('character')).toBe('人物')
    expect(dimLabel('reversal_depth')).toBe('反转深度')
    expect(dimLabel('social_resonance')).toBe('社会共鸣')
  })

  it('p14 八维 + 整体项全覆盖', () => {
    expect(dimLabel('hook_quality')).toBe('钩子质量')
    expect(dimLabel('narrative_design')).toBe('叙事设计')
    expect(dimLabel('shot_breakdown')).toBe('分镜拆解')
    expect(dimLabel('scene_planning')).toBe('场景规划')
    expect(dimLabel('character_consistency')).toBe('角色一致性')
    expect(dimLabel('audio_voice')).toBe('音频配音')
    expect(dimLabel('visual_rendering')).toBe('视觉渲染')
    expect(dimLabel('master')).toBe('整体')
  })

  it('未知 key 原样返回(fail-soft,khs 改维度不炸前端)', () => {
    expect(dimLabel('unknown_dim_2077')).toBe('unknown_dim_2077')
    expect(DIM_LABELS['unknown_dim_2077']).toBeUndefined()
  })
})

describe('viewLabel(56-01 视角中文映射)', () => {
  it('四命名视图 + p07 views 实际 key 集', () => {
    expect(viewLabel('front')).toBe('正面')
    expect(viewLabel('angle_left')).toBe('左侧斜角')
    expect(viewLabel('angle_right')).toBe('右侧斜角')
  })

  it('同义 key 均命中(back/rear; top_down/top-down)', () => {
    expect(viewLabel('back')).toBe('背面')
    expect(viewLabel('rear')).toBe('背面')
    expect(viewLabel('top_down')).toBe('俯视')
    expect(viewLabel('top-down')).toBe('俯视')
  })

  it('three_quarter → 3/4 侧;未知原样', () => {
    expect(viewLabel('three_quarter')).toBe('3/4 侧')
    expect(viewLabel('mystery_view')).toBe('mystery_view')
  })
})

describe('verdictLabel(56-01 verdict 三值)', () => {
  it('PASS/WARN/FAIL 中文;小写亦命中;未知原样', () => {
    expect(verdictLabel('PASS')).toBe('通过')
    expect(verdictLabel('WARN')).toBe('留意')
    expect(verdictLabel('FAIL')).toBe('不过')
    expect(verdictLabel('pass')).toBe('通过')
    expect(verdictLabel('weird')).toBe('weird')
  })
})

describe('normalizeScore(56-01 量纲归一)', () => {
  it('unit 原样;percent /100', () => {
    expect(normalizeScore(0.82, 'unit')).toBe(0.82)
    expect(normalizeScore(78, 'percent')).toBe(0.78)
  })

  it('越界钳制 [0,1];NaN/非 number → 0', () => {
    expect(normalizeScore(120, 'percent')).toBe(1)
    expect(normalizeScore(-3, 'unit')).toBe(0)
    expect(normalizeScore(NaN)).toBe(0)
    expect(normalizeScore('0.5' as unknown)).toBe(0)
    expect(normalizeScore(undefined, 'percent')).toBe(0)
  })
})
