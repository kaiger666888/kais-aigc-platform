/**
 * sceneGrouping 单测(Phase 55-02 / NAV-02)——全仓场景口径唯一实现的行为表。
 * 覆盖:sceneNumOf 数字段提取与边界(两位数/前导零/无数字)、sceneColorOf
 * 循环与钳负、formatTotalDuration 边界与进位。
 */
import { describe, it, expect } from 'vitest'
import { SCENE_COLORS, sceneNumOf, sceneColorOf, formatTotalDuration } from '../sceneGrouping'

describe('sceneNumOf(55-02 口径:首个数字段)', () => {
  it.each([
    ['S03_012', 3],
    ['s1', 1],
    ['shot_004', 4],
    ['B02', 2],
    ['S10', 10], // 两位数不被 0* 吃掉
    ['无数字', 0],
  ])('sceneNumOf(%j) === %i', (input, expected) => {
    expect(sceneNumOf(input)).toBe(expected)
  })
})

describe('sceneColorOf(4 色循环)', () => {
  it.each([
    [1, SCENE_COLORS[0]],
    [2, SCENE_COLORS[1]],
    [4, SCENE_COLORS[3]],
    [5, SCENE_COLORS[0]], // 循环
    [0, SCENE_COLORS[0]], // 钳负/零
  ])('sceneColorOf(%i) === SCENE_COLORS 对应项', (input, expected) => {
    expect(sceneColorOf(input)).toBe(expected)
  })
})

describe('formatTotalDuration(MM:SS)', () => {
  it.each([
    [0, '00:00'],
    [NaN, '00:00'],
    [-5, '00:00'],
    // 逐字迁移的既有行为:秒位四舍五入不进位到分(59.6 → 00:60,历史展示瑕疵
    // 非本 plan 修复对象;锁定现状防意外变化)。
    [59.6, '00:60'],
    [125, '02:05'],
    [3600, '60:00'],
  ])('formatTotalDuration(%i) === %s', (input, expected) => {
    expect(formatTotalDuration(input)).toBe(expected)
  })
})
