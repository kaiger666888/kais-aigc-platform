/**
 * 竖幅时间轴「波形活动段 + 跨镜渲染」测试。
 *
 * 行为契约（StoryboardTimeline.tsx）：
 *  - hasSpanWindow：start_sec/endSec 均为有限数且 end > start 才算带窗；缺字段 /
 *    非有限数 / 零长度 → false（回退 shotKey 行内挂载 —— 管线项目回归保护）。
 *  - createTimeToY：分镜时间窗 [startSec, endSec] → 实测行几何 [top, top+height]
 *    分段线性插值。行高与时长**非线性**（ShotRow 内容决定），不能 t×PX_PER_SEC。
 *    段内插值 / 行间隙过渡 / 首末段外推 / 零长度窗防除零。
 *  - spanTrackGeometry：绝对时间窗 → { top, height }，height ≥ MIN_SPAN_TRACK_H(6)
 *    （极短段可见可点）。
 *  - extractShots Pass4：raw.start_sec/end_sec 有限数透传为 track.startSec/endSec；
 *    duration_sec 缺失时用窗宽兜底；无字段的管线音频节点 → 两者 undefined（行为不变）。
 *
 * 仅测纯函数层（node env），不渲染组件。
 */
import { describe, it, expect } from 'vitest'
import {
  hasSpanWindow,
  createTimeToY,
  spanTrackGeometry,
  MIN_SPAN_TRACK_H,
  extractShots,
} from '../StoryboardTimeline'
import type { AssetNodeV3, FlowGraphV3, FlowNodeV3 } from '@kais/flowgraph-v3'

/** AudioTrack 是组件内私有接口（未导出）；测试用结构兼容的本地形状。 */
interface AudioTrack {
  clipType: string
  audioType: string
  speaker?: string
  durationS: number
  filePath: string
  text?: string
  windowSec?: [number, number]
  startSec?: number
  endSec?: number
}

// ─── 测试夹具 ────────────────────────────────────────────

/** 带 y 几何的分镜骨架（createTimeToY 只读 startSec/endSec）。 */
function timed(startSec: number, endSec: number): { startSec: number; endSec: number } {
  return { startSec, endSec }
}

function track(over: Partial<AudioTrack>): AudioTrack {
  return {
    clipType: 'bgm',
    audioType: '背景音乐',
    durationS: 0,
    filePath: '/oss/p/x.wav',
    ...over,
  }
}

/** 最小合法 AssetNodeV3（同 shotKey 测试夹具）。 */
function makeNode(id: string, over: Partial<AssetNodeV3>): AssetNodeV3 {
  return {
    id,
    branchId: 'main',
    phaseIndex: 1,
    phaseName: 'p_test',
    position: { x: 0, y: 0 },
    size: { width: 260, height: 180 },
    state: 'success',
    kind: 'asset',
    stage: 'global',
    modality: 'text',
    scope: 'episode',
    media: { original: null, proxy: null, thumbnail: null, waveform: null },
    curation: 'candidate',
    stale: null,
    ...over,
  } as AssetNodeV3
}

function makeGraph(nodes: FlowNodeV3[]): FlowGraphV3 {
  return {
    meta: { version: '3', projectId: 1, episodesId: 1, createdAt: 0, updatedAt: 0 },
    nodes,
    links: [],
    branches: [],
    variantGroups: [],
  } as FlowGraphV3
}

// ─── hasSpanWindow ──────────────────────────────────────

describe('hasSpanWindow', () => {
  it('有限数且 end > start → true', () => {
    expect(hasSpanWindow(track({ startSec: 106.47, endSec: 135.5 }))).toBe(true)
    expect(hasSpanWindow(track({ startSec: 0, endSec: 0.01 }))).toBe(true)
  })

  it('缺任一字段 → false（管线项目无 start_sec，走旧 shotKey 挂载）', () => {
    expect(hasSpanWindow(track({}))).toBe(false)
    expect(hasSpanWindow(track({ startSec: 1 }))).toBe(false)
    expect(hasSpanWindow(track({ endSec: 2 }))).toBe(false)
  })

  it('非有限数 / 零长度 / 负长度 → false', () => {
    expect(hasSpanWindow(track({ startSec: NaN, endSec: 2 }))).toBe(false)
    expect(hasSpanWindow(track({ startSec: 1, endSec: Infinity }))).toBe(false)
    expect(hasSpanWindow(track({ startSec: 2, endSec: 2 }))).toBe(false)
    expect(hasSpanWindow(track({ startSec: 3, endSec: 2 }))).toBe(false)
  })
})

// ─── createTimeToY：分段线性 time→y ─────────────────────

describe('createTimeToY 分段线性映射', () => {
  /** 经典非线性布局：3 镜时长 [10, 2, 4]s，行高 [100, 20, 200]px、行顶 [0, 100, 120]。 */
  const shots = [timed(0, 10), timed(10, 12), timed(12, 16)]
  const geoms = [
    { top: 0, height: 100 },
    { top: 100, height: 20 },
    { top: 120, height: 200 },
  ]
  const timeToY = createTimeToY(
    shots as never[],
    (i) => geoms[i]!,
  )

  it('窗内线性插值：t=5（镜1 中点）→ 行1 中点 y=50', () => {
    expect(timeToY(5)).toBeCloseTo(50, 6)
  })

  it('窗边界锚点：各窗 start/end 精确落在行顶/行底', () => {
    expect(timeToY(0)).toBeCloseTo(0, 6)
    expect(timeToY(10)).toBeCloseTo(100, 6)
    expect(timeToY(12)).toBeCloseTo(120, 6)
    expect(timeToY(16)).toBeCloseTo(320, 6)
  })

  it('短镜段斜率正确：镜2 时长 2s 行高 20px（10s/秒）', () => {
    expect(timeToY(11)).toBeCloseTo(110, 6)
  })

  it('非线性验证：镜1 10s 占 100px、镜3 4s 占 200px（同 1s 映射不同 y 距）', () => {
    const dyPerSec1 = timeToY(1) - timeToY(0)
    const dyPerSec3 = timeToY(13) - timeToY(12)
    expect(dyPerSec1).toBeCloseTo(10, 6) // 100px / 10s
    expect(dyPerSec3).toBeCloseTo(50, 6) // 200px / 4s
  })

  it('单调不减', () => {
    let prev = -Infinity
    for (let t = 0; t <= 16; t += 0.25) {
      const y = timeToY(t)
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = y
    }
  })

  it('首窗前 / 末窗后用相邻段斜率外推', () => {
    // 镜1 斜率 10px/s → t=-2 外推 y=-20
    expect(timeToY(-2)).toBeCloseTo(-20, 6)
    // 镜3 斜率 50px/s → t=18 外推 y=320+100
    expect(timeToY(18)).toBeCloseTo(420, 6)
  })

  it('行间隙（top 不衔接）按两侧行边界过渡', () => {
    // 行1 底=40、行2 顶=60（20px 缝，时间窗无缝衔接 4s）→ 缝内线性过渡
    const g2 = createTimeToY(
      [timed(0, 4), timed(4, 8)] as never[],
      (i) => (i === 0 ? { top: 0, height: 40 } : { top: 60, height: 40 }),
    )
    expect(g2(4)).toBeCloseTo(40, 6) // 左窗末端 = 行1 底
    expect(g2(8)).toBeCloseTo(100, 6) // 右窗末端 = 行2 底
    // 缝中点（无时间跨度，t 无法落在 4~4 之间——间隙按 0 宽处理），
    // 但 t=4.001 已属窗 2 起点 → 起于行2 顶附近；此处验证边界归属：t=4 属左窗。
    expect(g2(4.001)).toBeCloseTo(60.01, 3) // 窗2 内插值（斜率 40px/4s = 10px/s）
  })

  it('零长度窗不 NaN（退回行顶）', () => {
    const z = createTimeToY(
      [timed(0, 5), timed(5, 5), timed(5, 9)] as never[],
      (i) => ({ top: i * 30, height: 20 }),
    )
    expect(Number.isFinite(z(5))).toBe(true)
    expect(Number.isFinite(z(7))).toBe(true)
  })

  it('空分镜列表 → 恒 0（不炸）', () => {
    expect(createTimeToY([], () => ({ top: 0, height: 0 }))(42)).toBe(0)
  })
})

// ─── spanTrackGeometry：跨镜条块几何 ─────────────────────

describe('spanTrackGeometry', () => {
  /** 3 镜：[0,10]s→[0,100]px、[10,12]s→[100,120]px、[12,16]s→[120,320]px。 */
  const timeToY = createTimeToY(
    [timed(0, 10), timed(10, 12), timed(12, 16)] as never[],
    (i) => [{ top: 0, height: 100 }, { top: 100, height: 20 }, { top: 120, height: 200 }][i]!,
  )

  it('跨镜 BGM（106.5-135.5s 形态 → 此处 5-14s 跨全 3 镜）：top/height = 时间跨度映射', () => {
    const g = spanTrackGeometry(track({ startSec: 5, endSec: 14 }), timeToY)
    expect(g.top).toBeCloseTo(50, 6) // t=5 → 镜1 中点
    // t=14 在镜3 [12,16]s 的中点 → y=120+100=220；高度 = 220-50=170
    expect(g.height).toBeCloseTo(220 - 50, 6)
  })

  it('极短段（0.05s）：height 夹到 MIN_SPAN_TRACK_H=6（可见可点）', () => {
    const g = spanTrackGeometry(track({ startSec: 3, endSec: 3.05 }), timeToY)
    expect(g.height).toBe(MIN_SPAN_TRACK_H)
    expect(MIN_SPAN_TRACK_H).toBe(6)
  })

  it('反序窗口（脏数据）仍产正高度', () => {
    const g = spanTrackGeometry(track({ startSec: 8, endSec: 4 }), timeToY)
    expect(g.height).toBeGreaterThan(0)
    expect(g.top).toBeCloseTo(40, 6) // min(y(8), y(4))
  })

  it('无窗 track（startSec 兜底 0）不炸、高度 ≥ MIN', () => {
    const g = spanTrackGeometry(track({}), timeToY)
    expect(g.height).toBeGreaterThanOrEqual(MIN_SPAN_TRACK_H)
  })
})

// ─── extractShots Pass4：时间窗透传 ──────────────────────

describe('extractShots 波形活动段透传', () => {
  it('raw.start_sec/end_sec → track.startSec/endSec；无 duration_sec 用窗宽兜底', () => {
    const graph = makeGraph([
      makeNode('a-shot_list-S001', {
        stage: 'storyboard', modality: 'image',
        meta: { stage: 'storyboard', shotId: 'S001', shotType: 'scene', durationS: 6.73 },
      }),
      makeNode('a-aud_wave_bgm_000', { stage: 'voice', modality: 'audio', meta: { stage: 'voice' } }),
    ])
    const raw = new Map<string, Record<string, unknown>>([
      ['a-shot_list-S001', { shot_id: 'S001', label: 'S001', duration_sec: 6.73 }],
      ['a-aud_wave_bgm_000', {
        shot_id: 'S001', clip_type: 'bgm', audio_type: '背景音乐',
        start_sec: 106.47, end_sec: 135.5, // 无 duration_sec
        filePath: '/oss/pipeline/a7b3c9d2/wave/bgm_006.wav',
      }],
    ])
    const shots = extractShots(graph, raw)
    const t = shots[0]!.audioTracks![0]!
    expect(t.startSec).toBe(106.47)
    expect(t.endSec).toBe(135.5)
    expect(t.durationS).toBeCloseTo(135.5 - 106.47, 6)
    expect(hasSpanWindow(t)).toBe(true)
  })

  it('raw duration_sec 存在时不被窗宽覆盖', () => {
    const graph = makeGraph([
      makeNode('a-shot_list-S001', {
        stage: 'storyboard', modality: 'image',
        meta: { stage: 'storyboard', shotId: 'S001', shotType: 'scene', durationS: 6.73 },
      }),
      makeNode('a-aud_wave_dialogue_000', { stage: 'voice', modality: 'audio', meta: { stage: 'voice' } }),
    ])
    const raw = new Map<string, Record<string, unknown>>([
      ['a-shot_list-S001', { shot_id: 'S001', duration_sec: 6.73 }],
      ['a-aud_wave_dialogue_000', {
        shot_id: 'S001', clip_type: 'dialogue', audio_type: '人声',
        start_sec: 0, end_sec: 2.16, duration_sec: 2.16,
        filePath: '/oss/p/wave/dlg_001.wav', text: '八 七 六',
      }],
    ])
    const t = extractShots(graph, raw)[0]!.audioTracks![0]!
    expect(t.durationS).toBe(2.16)
    expect(t.text).toBe('八 七 六')
  })

  it('非有限数 start_sec（脏数据）→ 不透传（回退旧渲染路径）', () => {
    const graph = makeGraph([
      makeNode('a-shot_list-S001', {
        stage: 'storyboard', modality: 'image',
        meta: { stage: 'storyboard', shotId: 'S001', shotType: 'scene', durationS: 6.73 },
      }),
      makeNode('a-aud_S001_dialogue', { stage: 'voice', modality: 'audio', meta: { stage: 'voice' } }),
    ])
    const raw = new Map<string, Record<string, unknown>>([
      ['a-shot_list-S001', { shot_id: 'S001' }],
      ['a-aud_S001_dialogue', {
        shot_id: 'S001', clip_type: 'dialogue', audio_type: '人声',
        start_sec: 'not-a-number', end_sec: null, duration_sec: 2.2,
        filePath: '/oss/p/S001_dialogue.wav',
      }],
    ])
    const t = extractShots(graph, raw)[0]!.audioTracks![0]!
    expect(t.startSec).toBeUndefined()
    expect(t.endSec).toBeUndefined()
    expect(hasSpanWindow(t)).toBe(false)
  })

  it('管线项目音频节点（无 start_sec/end_sec 键）→ 两者 undefined，行为不变', () => {
    const graph = makeGraph([
      makeNode('a-shot_list-S01_B01', {
        stage: 'storyboard', modality: 'image',
        meta: { stage: 'storyboard', shotId: 'S01_B01', shotType: 'beat', durationS: 3.2 },
      }),
      makeNode('a-aud_S01_B01_dia', { stage: 'voice', modality: 'audio', meta: { stage: 'voice' } }),
    ])
    const raw = new Map<string, Record<string, unknown>>([
      ['a-shot_list-S01_B01', { shot_id: 'S01_B01', label: 'S01_B01' }],
      ['a-aud_S01_B01_dia', {
        shot_id: 'S01_B01', clip_type: 'dialogue', audio_type: '人声',
        duration_sec: 3.2, speaker: '沈知意', filePath: '/oss/p/S01_B01.wav',
      }],
    ])
    const t = extractShots(graph, raw)[0]!.audioTracks![0]!
    expect(t.startSec).toBeUndefined()
    expect(t.endSec).toBeUndefined()
    expect(hasSpanWindow(t)).toBe(false)
    expect(t.durationS).toBe(3.2)
    expect(t.speaker).toBe('沈知意')
  })

  it('同 filePath 跨镜段在多镜重复挂载时（场景级回挂）桶层只渲一条（VerticalTimeline 去重前提：挂载数≠渲改数）', () => {
    // 逆推项目实况：bgm 段挂到起始镜（shotKey），又经 audioByScene 回挂折叠行。
    // 此处验证 extractShots 层挂载仍可能 >1（回挂逻辑保留），去重属渲染层契约
    // （buckets.seenSpan）—— 用纯函数模拟该去重规则。
    const graph = makeGraph([
      makeNode('a-shot_list-S001', {
        stage: 'storyboard', modality: 'image',
        meta: { stage: 'storyboard', shotId: 'S001', shotType: 'scene', durationS: 6 },
      }),
      makeNode('a-shot_list-S002', {
        stage: 'storyboard', modality: 'image',
        meta: { stage: 'storyboard', shotId: 'S002', shotType: 'scene', durationS: 6 },
      }),
      makeNode('a-aud_wave_bgm_000', { stage: 'voice', modality: 'audio', meta: { stage: 'voice' } }),
    ])
    const raw = new Map<string, Record<string, unknown>>([
      ['a-shot_list-S001', { shot_id: 'S001' }],
      ['a-shot_list-S002', { shot_id: 'S002' }],
      ['a-aud_wave_bgm_000', {
        shot_id: 'S001', clip_type: 'bgm', audio_type: '背景音乐',
        start_sec: 3, end_sec: 9, duration_sec: 6,
        filePath: '/oss/p/wave/bgm_001.wav',
      }],
    ])
    const shots = extractShots(graph, raw)
    const all = shots.flatMap((s) => s.audioTracks ?? [])
    expect(all.length).toBe(1) // shotKey 只挂 S001；S002 无该 key
    // 渲染层去重规则（VerticalTimeline buckets 同源逻辑）
    const seen = new Set<string>()
    const unique = all.filter((t) => (seen.has(t.filePath) ? false : (seen.add(t.filePath), true)))
    expect(unique).toHaveLength(1)
  })
})
