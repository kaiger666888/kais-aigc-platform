/**
 * Phase 51 WRITE-01 — serializeGraphToV2 round-trip / 合规断言组：
 *  a. round-trip 不变量：adapt∘serialize 保资产 id 集、storyboard meta 字段、audio audioType；
 *  b. audio 必填参数存活（rawDataByNodeId 合并，地雷 #1 直接防线）；
 *  c. 输出过服务端 FlowGraphV2Schema.safeParse（直接 import 根 src/types/flowgraph-v2-schema.ts）；
 *  d. failed→error 状态映射；reviewStatus/aiScore/isWinner 落顶层；
 *  e. selectMode 'locked' → 'single' 且产生 warning（地雷 #3）；
 *  f. rawDataByNodeId === null 不 throw，输出仍 safeParse 通过（地雷 #6）；
 *  g. event 节点 + role:'output' 边不出现在输出 nodes/links（折叠语义）。
 */
import { describe, it, expect } from 'vitest'
import type {
  FlowGraphV3,
  AssetNodeV3,
  EventNodeV3,
  FlowLinkV3,
  AssetStageMeta,
  Stage,
} from '@kais/flowgraph-v3'
import { serializeGraphToV2 } from '../serialize'
import { adaptV2Graph } from '../adapter'
// 服务端契约 SSOT（优先直接 import；仅依赖 zod，包内可解析）
import { FlowGraphV2Schema } from '../../../../../src/types/flowgraph-v2-schema'

// ─── V3 图构造 ───────────────────────────────────────────

function asset(partial: {
  id: string
  stage: Stage
  meta: AssetStageMeta
  modality?: AssetNodeV3['modality']
  scope?: AssetNodeV3['scope']
  state?: AssetNodeV3['state']
  content?: string
  original?: string | null
  thumbnail?: string | null
  durationS?: number
  phaseIndex?: number
  reviewStatus?: AssetNodeV3['reviewStatus']
  aiScore?: AssetNodeV3['aiScore']
  curation?: AssetNodeV3['curation']
  variantGroupId?: string
}): AssetNodeV3 {
  return {
    kind: 'asset',
    id: partial.id,
    branchId: 'br_main',
    phaseIndex: partial.phaseIndex ?? 1,
    phaseName: partial.stage,
    position: { x: 0, y: 0 },
    size: { width: 240, height: 160 },
    state: partial.state ?? 'success',
    stage: partial.stage,
    modality: partial.modality ?? 'image',
    scope: partial.scope ?? 'episode',
    media: {
      original: partial.original ?? null,
      proxy: null,
      thumbnail: partial.thumbnail ?? null,
      waveform: null,
      ...(partial.durationS != null ? { durationS: partial.durationS } : {}),
    },
    ...(partial.content != null ? { content: partial.content } : {}),
    meta: partial.meta,
    ...(partial.reviewStatus != null ? { reviewStatus: partial.reviewStatus } : {}),
    ...(partial.aiScore != null ? { aiScore: partial.aiScore } : {}),
    curation: partial.curation ?? 'candidate',
    stale: null,
    ...(partial.variantGroupId != null ? { variantGroupId: partial.variantGroupId } : {}),
  }
}

function buildGraph(): FlowGraphV3 {
  const evtVideo: EventNodeV3 = {
    kind: 'event',
    id: 'evt_n_video',
    branchId: 'br_main',
    phaseIndex: 4,
    phaseName: 'video',
    position: { x: -160, y: 0 },
    size: { width: 240, height: 160 },
    state: 'success',
    op: 'wan22_i2v',
    params: { seed: 88421 },
    executor: 'gpu0',
  }
  const nodes: FlowGraphV3['nodes'] = [
    asset({
      id: 'n_script', stage: 'script', modality: 'text', phaseIndex: 1,
      content: '雨夜天台',
      meta: { stage: 'script', hookType: '悬念', hookIntensity: 0.8, premise: '复仇' },
      reviewStatus: 'approved', aiScore: { overall: 0.9 },
    }),
    asset({
      id: 'n_sb', stage: 'storyboard', phaseIndex: 2,
      original: '/oss/sb/shot-001.png', thumbnail: '/oss/sb/t.jpg', durationS: 4,
      meta: {
        stage: 'storyboard', shotId: 'shot-001', shotType: 'close-up', durationS: 4,
        cameraMovement: 'zoom_in', framing: 'wide', composition: 'rule_of_thirds', pacing: 'fast',
      },
    }),
    asset({
      id: 'n_kf', stage: 'keyframe', phaseIndex: 3,
      original: '/oss/kf/shot-001.png',
      meta: { stage: 'keyframe', shotId: 'shot-001' },
    }),
    asset({
      id: 'n_global', stage: 'global', scope: 'global', phaseIndex: 0,
      original: '/oss/role/nvzhu.png',
      meta: { stage: 'global', assetType: 'role' },
    }),
    asset({
      id: 'n_video', stage: 'video', modality: 'video', phaseIndex: 4,
      state: 'failed', // → wire 'error'（断言组 d）
      original: '/oss/v/shot-001.mp4', durationS: 4,
      meta: { stage: 'video', shotId: 'shot-001' },
      curation: 'selected', variantGroupId: 'vg_1',
    }),
    asset({
      id: 'n_comp', stage: 'composite', modality: 'video', phaseIndex: 9,
      original: '/oss/v/master.mp4',
      meta: { stage: 'composite', edlRef: '/oss/edl/master.json' },
    }),
    asset({
      id: 'n_voice', stage: 'voice', modality: 'audio', phaseIndex: 5,
      original: '/oss/a/shot-001.wav', durationS: 3.5,
      meta: { stage: 'voice', shotId: 'shot-001', emotion: 'calm', speaker: '林晚' },
    }),
    asset({
      id: 'n_foley', stage: 'foley', modality: 'audio', phaseIndex: 6,
      original: '/oss/a/foley.wav',
      meta: { stage: 'foley', shotId: 'shot-001' },
    }),
    asset({
      id: 'n_mix', stage: 'mix', modality: 'audio', phaseIndex: 8,
      original: '/oss/a/mix.wav',
      meta: { stage: 'mix' },
    }),
    evtVideo,
  ]
  const links: FlowLinkV3[] = [
    // event 闭环边（不落盘）
    { id: 'l_out', source: 'evt_n_video', target: 'n_video', branchId: 'br_main', role: 'output' },
    // asset→event 输入边（序列化时折叠为 asset→asset）
    { id: 'l_in_kf', source: 'n_kf', target: 'evt_n_video', branchId: 'br_main', role: 'keyframe' },
    { id: 'l_in_ref', source: 'n_global', target: 'evt_n_video', branchId: 'br_main', role: 'lora_ref' },
    // asset→asset 时间序边
    { id: 'l_seq', source: 'n_sb', target: 'n_kf', branchId: 'br_main', role: 'sequence', isExplore: true },
    { id: 'l_seq2', source: 'n_voice', target: 'n_mix', branchId: 'br_main', role: 'sequence', isInactive: true },
  ]
  return {
    meta: { version: '3', projectId: 7, episodesId: 101, createdAt: 1000, updatedAt: 2000 },
    nodes,
    links,
    branches: [{ id: 'br_main', name: '主线', createdAt: 900 }],
    variantGroups: [
      {
        id: 'vg_1', branchId: 'br_main', phaseIndex: 4, sourceEventId: 'evt_n_video',
        variantNodeIds: ['n_video'], winnerNodeId: 'n_video', selectMode: 'single',
      },
      {
        // shot_decompose 解构集（locked 无 V2 槽位 → 'single' + warning，断言组 e）
        id: 'vg_locked', branchId: 'br_main', phaseIndex: 2, sourceEventId: 'evt_decompose',
        variantNodeIds: ['n_sb'], selectMode: 'locked',
      },
    ],
  }
}

function buildRawData(): Map<string, Record<string, unknown>> {
  return new Map([
    // 地雷 #1：audio 必填结构化参数（服务端 save-v2 强制 shot_id/engine/duration_sec）
    ['n_voice', { shot_id: 'S01', engine: 'index-tts2', duration_sec: 3.5, audioType: 'voice', extraField: 'keep' }],
    ['n_foley', { shot_id: 'S01', engine: 'foley-gen', duration_sec: 1.2, audioType: 'foley' }],
    ['n_video', { shot_id: 'shot-001', engine: 'wan2.2-i2v', duration_sec: 4, resolution: '1280x704', prompt: '她垂眸', seed: 88421 }],
    ['n_sb', { shot_id: 'shot-001', shot_type: 'close-up', duration_sec: 4, label: 'S01 分镜' }],
  ])
}

const assetIdsOf = (g: FlowGraphV3) =>
  new Set(g.nodes.filter((n) => n.kind === 'asset').map((n) => n.id))

// ─── 断言组 ──────────────────────────────────────────────

describe('serializeGraphToV2', () => {
  const graph = buildGraph()
  const raw = buildRawData()
  const warnings: string[] = []
  const wire = serializeGraphToV2(graph, raw, { x: 1, y: 2, zoom: 0.5 }, warnings)

  it('a. round-trip：adapt∘serialize 保资产 id 集 / storyboard meta 字段 / audio audioType', () => {
    const back = adaptV2Graph(wire)
    expect(assetIdsOf(back.graph)).toEqual(assetIdsOf(graph))

    const sb = back.graph.nodes.find((n) => n.id === 'n_sb')
    expect(sb && sb.kind === 'asset' ? sb.meta : null).toMatchObject({
      shotId: 'shot-001', shotType: 'close-up', durationS: 4,
      cameraMovement: 'zoom_in', framing: 'wide', composition: 'rule_of_thirds', pacing: 'fast',
    })

    const voice = back.graph.nodes.find((n) => n.id === 'n_voice')
    expect(voice && voice.kind === 'asset' ? voice.stage : null).toBe('voice')
    const foley = back.graph.nodes.find((n) => n.id === 'n_foley')
    expect(foley && foley.kind === 'asset' ? foley.stage : null).toBe('foley')
    // composite 靠 data.edlRef round-trip
    const comp = back.graph.nodes.find((n) => n.id === 'n_comp')
    expect(comp && comp.kind === 'asset' ? comp.stage : null).toBe('composite')
  })

  it('b. audio 必填参数存活：rawDataByNodeId 合并 shot_id/engine/duration_sec（地雷 #1）', () => {
    const voice = wire.nodes.find((n) => n.id === 'n_voice')!
    expect(voice.data).toMatchObject({ shot_id: 'S01', engine: 'index-tts2', duration_sec: 3.5 })
    expect(voice.data.audioType).toBe('voice') // flattenMeta 补轨线索
    expect(voice.data.extraField).toBe('keep') // 白名单外字段经 rawData 穿透
    expect(voice.data.filePath).toBe('/oss/a/shot-001.wav')
    expect(voice.data.speaker).toBe('林晚')
    const foley = wire.nodes.find((n) => n.id === 'n_foley')!
    expect(foley.data).toMatchObject({ shot_id: 'S01', engine: 'foley-gen', duration_sec: 1.2, audioType: 'foley' })
  })

  it('c. 输出过服务端 FlowGraphV2Schema.safeParse', () => {
    const result = FlowGraphV2Schema.safeParse(wire)
    expect(result.success).toBe(true)
    expect(wire.meta.version).toBe('2')
    expect(wire.meta.viewport).toEqual({ x: 1, y: 2, zoom: 0.5 })
  })

  it("d. failed→'error' 状态映射；reviewStatus/aiScore/isWinner/variantGroupId 落顶层", () => {
    const video = wire.nodes.find((n) => n.id === 'n_video')!
    expect(video.state).toBe('error')
    expect(video.isWinner).toBe(true)
    expect(video.variantGroupId).toBe('vg_1')
    const script = wire.nodes.find((n) => n.id === 'n_script')!
    expect(script.reviewStatus).toBe('approved')
    expect(script.aiScore).toEqual({ overall: 0.9 })
    expect(script.data.prompt).toBe('雨夜天台') // content→data.prompt（§14 逆）
    expect(script.data).toMatchObject({ hookType: '悬念', hookIntensity: 0.8, premise: '复仇' })
    // media.durationS 回写 data.durationS（video 非 storyboard，靠它 round-trip 时长）
    expect(video.data.durationS).toBe(4)
  })

  it("e. selectMode 'locked' → 'single' 且产生 warning（地雷 #3）", () => {
    const locked = wire.variantGroups.find((g) => g.id === 'vg_locked')!
    expect(locked.selectMode).toBe('single')
    expect(warnings.some((w) => w.includes('vg_locked') && w.includes('locked'))).toBe(true)
    // single 组原样透传 + winner 保留
    const g1 = wire.variantGroups.find((g) => g.id === 'vg_1')!
    expect(g1.selectMode).toBe('single')
    expect(g1.winnerNodeId).toBe('n_video')
  })

  it('f. rawDataByNodeId === null 不 throw，输出仍 safeParse 通过（地雷 #6）', () => {
    expect(() => serializeGraphToV2(graph, null)).not.toThrow()
    const bare = serializeGraphToV2(graph, null)
    expect(FlowGraphV2Schema.safeParse(bare).success).toBe(true)
    // 退化纯 flattenMeta：audioType 仍在（canonical meta 供给）
    const voice = bare.nodes.find((n) => n.id === 'n_voice')!
    expect(voice.data.audioType).toBe('voice')
  })

  it("g. event 节点 + role:'output' 边不落盘；输入边折叠为 asset→asset", () => {
    expect(wire.nodes.some((n) => n.id === 'evt_n_video')).toBe(false)
    expect(wire.nodes.some((n) => n.id.startsWith('evt_'))).toBe(false)
    expect(wire.links.some((l) => l.id === 'l_out')).toBe(false)
    // asset→event 输入边折叠：target 替换为 event 的产出资产
    const inKf = wire.links.find((l) => l.id === 'l_in_kf')!
    expect(inKf).toMatchObject({ source: 'n_kf', target: 'n_video', dataType: 'keyframe' })
    const inRef = wire.links.find((l) => l.id === 'l_in_ref')!
    expect(inRef).toMatchObject({ source: 'n_global', target: 'n_video', dataType: 'lora_ref' })
    // role→dataType + isExplore/isInactive 透传
    const seq = wire.links.find((l) => l.id === 'l_seq')!
    expect(seq).toMatchObject({ dataType: 'sequence', isExplore: true })
    const seq2 = wire.links.find((l) => l.id === 'l_seq2')!
    expect(seq2.isInactive).toBe(true)
  })

  it("mix stage → type 'audio' audioType 缺省 + 有损 warning（research 裁定）", () => {
    const mix = wire.nodes.find((n) => n.id === 'n_mix')!
    expect(mix.type).toBe('audio')
    expect(mix.data.audioType).toBeUndefined()
    expect(warnings.some((w) => w.includes('n_mix') && w.includes('mix'))).toBe(true)
  })

  it('branches shim：label=name，status active，createdAt/updatedAt 必填', () => {
    expect(wire.branches).toHaveLength(1)
    expect(wire.branches[0]).toMatchObject({
      id: 'br_main', label: '主线', status: 'active', forkReason: '', createdAt: 900,
    })
    expect(typeof wire.branches[0]!.updatedAt).toBe('number')
  })
})
