/**
 * 竖幅时间轴「精确时长高度 + 重叠分列 + 对白说话人分列」测试（第二批）。
 *
 * 行为契约（StoryboardTimeline.tsx）：
 *  - createTimeToY 精确换算：条块顶边 = start_sec 映射 y、底边 = end_sec 映射 y —— 允许
 *    起止于分镜行中间（亚行级精度）。第一批已覆盖窗内插值；此处补行中间起止断言。
 *  - assignIntervalLanes：区间图着色（贪心 lane 复用）。首尾相接不算重叠（silencedetect
 *    分段恰好相接）；真重叠段异 lane；不重叠复用 lane 0；乱序输入正确。
 *  - assignDialogueLanes：说话人固定 sub-lane（自然排序 spk2 < spk10；无 speaker 回退
 *    纯重叠分列；同 speaker 内重叠段二级深排）。
 *  - extractShots Pass4：raw.speaker_label → track.speakerLabel 透传。
 *
 * 仅测纯函数层（node env），不渲染组件。
 */
import { describe, it, expect } from 'vitest'
import {
  createTimeToY,
  assignIntervalLanes,
  assignDialogueLanes,
  extractShots,
  SPEAKER_LANE_COLORS,
  hexToRgba,
} from '../StoryboardTimeline'
import type { AssetNodeV3, FlowGraphV3, FlowNodeV3 } from '@kais/flowgraph-v3'

/** AudioTrack 是组件内私有接口（未导出）；测试用结构兼容的本地形状。 */
interface AudioTrack {
  clipType: string
  audioType: string
  speaker?: string
  speakerLabel?: string
  durationS: number
  filePath: string
  text?: string
  startSec?: number
  endSec?: number
}

function track(over: Partial<AudioTrack>): AudioTrack {
  return {
    clipType: 'dialogue',
    audioType: '人声',
    durationS: 0,
    filePath: '/oss/p/x.wav',
    ...over,
  }
}

/** 最小合法 AssetNodeV3（同 spanTrack 测试夹具）。 */
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

// ─── 时间 → y：行中间起止（亚行级精度） ─────────────────

describe('createTimeToY 行中间起止（精确时长高度）', () => {
  /** 2 镜各 10s，行高 100px / 200px（非线性）。 */
  const timeToY = createTimeToY(
    [{ startSec: 0, endSec: 10 }, { startSec: 10, endSec: 20 }] as never[],
    (i) => [{ top: 0, height: 100 }, { top: 100, height: 200 }][i]!,
  )

  it('段起止于行中间：t=2.5（镜1 四分位）→ y=25；t=15（镜2 中点）→ y=200', () => {
    expect(timeToY(2.5)).toBeCloseTo(25, 6)
    expect(timeToY(15)).toBeCloseTo(200, 6)
  })

  it('条块顶底=时间起止映射（几何差 = 精确时间跨度换算）', () => {
    // 段 [3, 14]：顶 = y(3)=30、底 = y(14)=100+80=180 → 高度 150（跨 2 镜行中间）
    expect(timeToY(3)).toBeCloseTo(30, 6)
    expect(timeToY(14)).toBeCloseTo(180, 6)
    expect(timeToY(14) - timeToY(3)).toBeCloseTo(150, 6)
  })

  it('极短段（0.02s）顶底仍单调（min-height 兜底在几何层，映射层不塌缩为 NaN）', () => {
    const a = timeToY(7.999)
    const b = timeToY(8.001)
    expect(Number.isFinite(a)).toBe(true)
    expect(Number.isFinite(b)).toBe(true)
    expect(b).toBeGreaterThanOrEqual(a)
  })

  it('跨 3 行的长段（BGM 形态）：两端点分别落首行中间与末行中间', () => {
    const t3 = createTimeToY(
      [{ startSec: 0, endSec: 10 }, { startSec: 10, endSec: 20 }, { startSec: 20, endSec: 30 }] as never[],
      (i) => ({ top: i * 150, height: 100 }),
    )
    // 段 [5, 25]：顶 = 行1 中点 50、底 = 行3 中点 300+50=350
    expect(t3(5)).toBeCloseTo(50, 6)
    expect(t3(25)).toBeCloseTo(350, 6)
  })
})

// ─── assignIntervalLanes：区间图着色 ────────────────────

describe('assignIntervalLanes 区间 lane 分配', () => {
  it('不重叠（首尾相接）→ 全部 lane 0（Demucs 切段相接不该被推开）', () => {
    const lanes = assignIntervalLanes([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
      { start: 4, end: 6.5 },
    ])
    expect(lanes).toEqual([0, 0, 0])
  })

  it('真重叠段异 lane；错开后新段复用 lane 0', () => {
    // [0,5] 与 [3,8] 重叠 → 异 lane；[6,9] 与 lane0 的 [0,5] 不重叠但与 lane1 [3,8] 重叠 → lane 0
    const lanes = assignIntervalLanes([
      { start: 0, end: 5 },
      { start: 3, end: 8 },
      { start: 6, end: 9 },
    ])
    expect(lanes[0]).toBe(0)
    expect(lanes[1]).toBe(1)
    expect(lanes[2]).toBe(0)
  })

  it('链式重叠（每段与下一段重叠、任意三元组不共点）→ 2 lane 足够', () => {
    // [0,4][3,7][6,10]：1×2 重叠、2×3 重叠、1×3 不重叠 → lane 0/1/0
    const lanes = assignIntervalLanes([
      { start: 0, end: 4 },
      { start: 3, end: 7 },
      { start: 6, end: 10 },
    ])
    expect(lanes).toEqual([0, 1, 0])
  })

  it('一点互嵌（三段共点）→ 3 lane', () => {
    const lanes = assignIntervalLanes([
      { start: 0, end: 6 },
      { start: 1, end: 4 },
      { start: 2, end: 8 },
    ])
    expect(new Set(lanes).size).toBe(3)
    expect(lanes).toEqual([0, 1, 2])
  })

  it('乱序输入 → 与排序输入同结果（按原下标回填）', () => {
    const sorted = assignIntervalLanes([
      { start: 0, end: 5 },
      { start: 3, end: 8 },
      { start: 6, end: 9 },
    ])
    const shuffled = assignIntervalLanes([
      { start: 6, end: 9 },
      { start: 0, end: 5 },
      { start: 3, end: 8 },
    ])
    // 段标识按 start：6→sorted[2] / 0→sorted[0] / 3→sorted[1]
    expect(shuffled).toEqual([sorted[2], sorted[0], sorted[1]])
  })

  it('BGM 长段跨镜 + 对白同时重叠形态：长段占 lane 0、短重叠段进 lane 1', () => {
    const lanes = assignIntervalLanes([
      { start: 0, end: 29 },   // BGM 106.5-135.5 形态（长跨）
      { start: 10, end: 12 },  // 与长段重叠
      { start: 11, end: 13 },  // 与上两条都重叠
    ])
    expect(lanes[0]).toBe(0)
    expect(lanes[1]).toBe(1)
    expect(lanes[2]).toBe(2)
  })

  it('空输入 → []；边界（end==start 零长段）不炸', () => {
    expect(assignIntervalLanes([])).toEqual([])
    const lanes = assignIntervalLanes([{ start: 5, end: 5 }, { start: 5, end: 6 }])
    // 零长段 [5,5] 与 [5,6]：b.start(5) < a.end(5) 为假 → 同 lane 0
    expect(lanes).toEqual([0, 0])
  })
})

// ─── assignDialogueLanes：说话人分列 ────────────────────

describe('assignDialogueLanes 说话人 lane 映射', () => {
  it('不同 speaker 各占固定 sub-lane；lane 号 = 自然排序序号', () => {
    // spk0/spk2/spk4 → lane 0/1/2（首说话人占 0，不浪费左缘）
    const spans = [
      track({ speaker: 'spk4', startSec: 0, endSec: 2 }),
      track({ speaker: 'spk0', startSec: 0.5, endSec: 2.5 }),
      track({ speaker: 'spk2', startSec: 1, endSec: 3 }),
    ]
    const a = assignDialogueLanes(spans)
    expect(a.map((x) => x.col)).toEqual([2, 0, 1])
    expect(a[0]!.cols).toBe(3)
  })

  it('自然排序：spk2 排在 spk10 之前（非字典序）', () => {
    const spans = [
      track({ speaker: 'spk10', startSec: 0, endSec: 1 }),
      track({ speaker: 'spk2', startSec: 0, endSec: 1 }),
      track({ speaker: 'spk1', startSec: 0, endSec: 1 }),
    ]
    const a = assignDialogueLanes(spans)
    expect(a.map((x) => x.col)).toEqual([2, 1, 0])
  })

  it('同一 speaker 时间不重叠 → 同 lane（说话人流连续）', () => {
    const spans = [
      track({ speaker: 'spk0', startSec: 0, endSec: 2.16 }),
      track({ speaker: 'spk0', startSec: 2.16, endSec: 4.06 }),
      track({ speaker: 'spk0', startSec: 4.06, endSec: 5.9 }),
    ]
    const a = assignDialogueLanes(spans)
    expect(a.map((x) => x.col)).toEqual([0, 0, 0])
    expect(a[0]!.cols).toBe(1)
  })

  it('同一 speaker 内重叠段（脏数据）→ 二级深排', () => {
    const spans = [
      track({ speaker: 'spk0', startSec: 0, endSec: 5 }),
      track({ speaker: 'spk0', startSec: 3, endSec: 8 }),
      track({ speaker: 'spk1', startSec: 0, endSec: 1 }),
    ]
    const a = assignDialogueLanes(spans)
    // spk0 组内：[0,5]→0、[3,8]→1（占 2 列）；spk1 → 起始列 2
    expect(a.map((x) => x.col)).toEqual([0, 1, 2])
    expect(a[0]!.cols).toBe(3)
  })

  it('无 speaker 字段 → 回退纯重叠分列（与 assignIntervalLanes 一致）', () => {
    const spans = [
      track({ startSec: 0, endSec: 5 }),
      track({ startSec: 3, endSec: 8 }),
      track({ startSec: 6, endSec: 9 }),
    ]
    const a = assignDialogueLanes(spans)
    const lanes = assignIntervalLanes(spans.map((t) => ({ start: t.startSec!, end: t.endSec! })))
    expect(a.map((x) => x.col)).toEqual(lanes)
    expect(a[0]!.cols).toBe(2)
  })

  it('无 speaker 回退时不重叠 → 单列满宽（cols=1）', () => {
    const spans = [
      track({ startSec: 0, endSec: 2 }),
      track({ startSec: 2, endSec: 4 }),
    ]
    const a = assignDialogueLanes(spans)
    expect(a.every((x) => x.col === 0 && x.cols === 1)).toBe(true)
  })

  it('5 说话人（规格上限）→ 5 列；列内序与自然排序一致', () => {
    const spans = Array.from({ length: 5 }, (_, i) =>
      track({ speaker: `spk${i}`, startSec: 0, endSec: 1 }))
    const a = assignDialogueLanes(spans)
    expect(a.map((x) => x.col)).toEqual([0, 1, 2, 3, 4])
    expect(a[0]!.cols).toBe(5)
  })

  it('空输入 → []', () => {
    expect(assignDialogueLanes([])).toEqual([])
  })
})

// ─── extractShots Pass4：speaker_label 透传 ─────────────

describe('extractShots speaker_label 透传', () => {
  it('raw.speaker_label → track.speakerLabel；speaker 原样', () => {
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
        speaker: 'spk4', speaker_label: '说话人4',
        filePath: '/oss/p/wave/dlg_001.wav', text: '八 七 六',
      }],
    ])
    const t = extractShots(graph, raw)[0]!.audioTracks![0]!
    expect(t.speaker).toBe('spk4')
    expect(t.speakerLabel).toBe('说话人4')
  })

  it('speaker_label 缺失 / 空串 / 非串 → undefined（不透传）', () => {
    const graph = makeGraph([
      makeNode('a-shot_list-S001', {
        stage: 'storyboard', modality: 'image',
        meta: { stage: 'storyboard', shotId: 'S001', shotType: 'scene', durationS: 6 },
      }),
      makeNode('a-1', { stage: 'voice', modality: 'audio', meta: { stage: 'voice' } }),
      makeNode('a-2', { stage: 'voice', modality: 'audio', meta: { stage: 'voice' } }),
    ])
    const raw = new Map<string, Record<string, unknown>>([
      ['a-shot_list-S001', { shot_id: 'S001' }],
      ['a-1', { shot_id: 'S001', clip_type: 'dialogue', audio_type: '人声', speaker: 'spk0', speaker_label: '   ', start_sec: 0, end_sec: 1, filePath: '/oss/p/1.wav' }],
      ['a-2', { shot_id: 'S001', clip_type: 'dialogue', audio_type: '人声', speaker: 'spk0', speaker_label: 42, start_sec: 1, end_sec: 2, filePath: '/oss/p/2.wav' }],
    ])
    const tracks = extractShots(graph, raw)[0]!.audioTracks!
    expect(tracks[0]!.speakerLabel).toBeUndefined()
    expect(tracks[1]!.speakerLabel).toBeUndefined()
  })

  it("speaker='none' 规范化为 undefined（normalizeSpeaker 既有行为不变）", () => {
    const graph = makeGraph([
      makeNode('a-shot_list-S001', {
        stage: 'storyboard', modality: 'image',
        meta: { stage: 'storyboard', shotId: 'S001', shotType: 'scene', durationS: 6 },
      }),
      makeNode('a-1', { stage: 'voice', modality: 'audio', meta: { stage: 'voice' } }),
    ])
    const raw = new Map<string, Record<string, unknown>>([
      ['a-shot_list-S001', { shot_id: 'S001' }],
      ['a-1', { shot_id: 'S001', clip_type: 'dialogue', audio_type: '人声', speaker: 'none', speaker_label: '无', start_sec: 0, end_sec: 1, filePath: '/oss/p/1.wav' }],
    ])
    const t = extractShots(graph, raw)[0]!.audioTracks![0]!
    expect(t.speaker).toBeUndefined()
  })
})

// ─── 说话人色板 ─────────────────────────────────────────

describe('SPEAKER_LANE_COLORS / hexToRgba', () => {
  it('色板 5 色、全部 dialogue 蓝系邻近色相、互不相同', () => {
    expect(SPEAKER_LANE_COLORS).toHaveLength(5)
    expect(new Set(SPEAKER_LANE_COLORS).size).toBe(5)
    for (const c of SPEAKER_LANE_COLORS) expect(c).toMatch(/^#[0-9A-F]{6}$/i)
  })

  it('hexToRgba：#89B4FA alpha 0.3 → rgba(137,180,250,0.3)；非 hex 原样返回', () => {
    expect(hexToRgba('#89B4FA', 0.3)).toBe('rgba(137,180,250,0.3)')
    expect(hexToRgba('#7AA2F7', 0.5)).toBe('rgba(122,162,247,0.5)')
    expect(hexToRgba('not-a-color', 0.5)).toBe('not-a-color')
  })
})
