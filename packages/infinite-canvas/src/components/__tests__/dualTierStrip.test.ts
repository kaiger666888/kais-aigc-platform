/** DualTierStrip — computeTierLayout 纯函数单测（漂移几何与诚实空态）。 */
import { describe, expect, it } from 'vitest'
import { computeTierLayout } from '../DualTierStrip'
import type { TimedShot } from '../StoryboardTimeline'
import type { AssetNodeV3 } from '@kais/flowgraph-v3'

function mkShot(id: string, dur: number, finalDur?: number, i = 0): TimedShot {
  const node = {
    id: `a-${id}`, kind: 'asset', stage: 'storyboard',
    media: {}, reviewStatus: null,
  } as unknown as AssetNodeV3
  return {
    node, shotId: id, durationS: dur, thumbnail: null,
    layoutDur: dur,
    startSec: i * 10, endSec: i * 10 + dur,
    ...(finalDur != null ? { finalDurationS: finalDur } : {}),
  } as TimedShot
}

describe('computeTierLayout', () => {
  it('漂移 = 终渲 - 分镜；成品带=实测+预估连续时间轴', () => {
    const shots = [
      mkShot('S01_B01', 3.0, 3.042),
      mkShot('S01_B02', 10.0, 10.125),
      mkShot('S01_B03', 8.0, undefined),   // 未终渲 → 预估占位（=预演宽，贡献 0 漂移）
    ]
    const l = computeTierLayout(shots)
    expect(l.totalPreview).toBeCloseTo(21.0, 5)
    expect(l.totalFinal).toBeCloseTo(3.042 + 10.125 + 8.0, 2)  // 已渲实测 + 未渲预估
    expect(l.finalCount).toBe(2)
    expect(l.shots[0].delta).toBeCloseTo(0.042, 4)
    expect(l.shots[1].delta).toBeCloseTo(0.125, 4)
    expect(l.shots[2].delta).toBeUndefined()
    expect(l.shots[2].bandStart).toBeCloseTo(13.167, 2)   // 未渲段从已渲累计处接续
    expect(l.shots[2].rendered).toBe(false)
    expect(l.totalDrift).toBeCloseTo(0.167, 2)            // 只有实测段贡献漂移
  })

  it('显著漂移计数阈值 0.3s', () => {
    const shots = [
      mkShot('A', 5.0, 5.1),    // +0.1 不计
      mkShot('B', 5.0, 5.45),   // +0.45 计
      mkShot('C', 5.0, 4.6),    // -0.4 计（绝对值）
    ]
    const l = computeTierLayout(shots)
    expect(l.driftBig).toBe(2)
  })

  it('全部未终渲 → 空态（finalCount=0；成品带=纯预估，与预演同长）', () => {
    const l = computeTierLayout([mkShot('A', 5.0), mkShot('B', 3.0)])
    expect(l.finalCount).toBe(0)
    expect(l.totalFinal).toBeCloseTo(8.0, 6)
    expect(l.totalDrift).toBeCloseTo(0, 6)
    expect(l.shots.every((s) => s.delta === undefined && !s.rendered)).toBe(true)
  })

  it('layoutDur=0 的镜不产生 NaN 起点', () => {
    const l = computeTierLayout([mkShot('A', 0), mkShot('B', 4.0, 4.2, 1)])
    expect(Number.isFinite(l.shots[0].previewStart)).toBe(true)
    expect(l.shots[1].previewStart).toBe(0)
  })
})
