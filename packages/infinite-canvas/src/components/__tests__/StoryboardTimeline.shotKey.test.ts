/**
 * 分镜时间轴 shotKey 解析 + Pass4 音轨挂载测试。
 *
 * 行为契约（StoryboardTimeline.tsx）：
 *  - shotKeyFromCandidates 两遍扫描：
 *    Pass1 beat 正则（`S01_B01`→`s1_1`，容忍 `S01_SH01` / `S1 1` 空格坏字段）优先扫
 *    **全部**候选 —— 任一命中即返回，管线项目（beat 形式）行为与旧版逐字节一致；
 *    Pass2 仅当全部候选 beat miss 时回退 paddedShotIdOf 场景键（`S001`→`S01`），
 *    修逆推资产集项目（纯场景号 shot_id）storyboard↔audio 挂载断链（竖幅三音轨列恒空）。
 *    beat 键 `s{n}_{m}` 与场景键 `S{NN}` 形制不同，永不相撞；场景号 >99 时
 *    padStart(2) 仍产 3 位（S100 ≠ S10），无碰撞。
 *  - extractShots Pass4：audio 节点（clip_type/audio_type/音频扩展名识别）按 shotKey
 *    挂回分镜行；纯场景号项目（S001 storyboard + a-aud_S001_* audio）同经回退对上；
 *    场景级回挂（仅 frameVariants 折叠行）不生效于无折叠行项目 → 不双挂。
 *  - 交叉保护：场景键 audio（S001）不挂到 beat 键分镜行（s1_1），反之亦然 ——
 *    管线项目不受回退影响。
 *
 * 仅测纯函数层（node env），不渲染组件（渲染级测试见 AssetCardNode.*.test.tsx）。
 */
import { describe, it, expect } from 'vitest'
import { shotKeyFromCandidates, extractShots } from '../StoryboardTimeline'
import type { AssetNodeV3, FlowGraphV3, FlowNodeV3 } from '@kais/flowgraph-v3'

// ─── shotKeyFromCandidates 单元 ──────────────────────────

describe('shotKeyFromCandidates', () => {
  describe('beat 形式（管线项目）—— 行为回归不变', () => {
    it.each([
      ['S01_B01', 's1_1'],
      ['s1_1', 's1_1'],
      ['s01_b01', 's1_1'],
      ['S01_SH01', 's1_1'], // SH 字母前缀被 [a-z]* 吞掉
      ['S1 1', 's1_1'], // video 节点空格坏字段 → 空格转下划线后命中
      ['S12_B07', 's12_7'],
    ])('%s → %s', (input, expected) => {
      expect(shotKeyFromCandidates(input)).toBe(expected)
    })

    it('多候选按顺序取首个命中（与旧版一致）', () => {
      expect(shotKeyFromCandidates('S01_B01', 'S999', 'x')).toBe('s1_1')
      // 候选1 无 beat、候选2 有 beat → 旧版同样在候选2命中
      expect(shotKeyFromCandidates('S001', 'S02_B03', 'y')).toBe('s2_3')
    })

    it('任一候选命中 beat → 不走场景回退（回退零影响 beat 项目）', () => {
      // 候选2 是纯场景号，但候选1 beat 命中优先
      expect(shotKeyFromCandidates('S01_B01', 'S001')).toBe('s1_1')
    })

    it('非字符串 / 空值候选跳过', () => {
      expect(shotKeyFromCandidates(null, undefined, 42, '', 'S03_B02')).toBe('s3_2')
    })
  })

  describe('场景回退（逆推项目）—— 全候选 beat miss 时兜底', () => {
    it.each([
      ['S001', 'S01'],
      ['S12', 'S12'],
      ['s7', 'S07'],
      ['S100', 'S100'], // >99：padStart(2) 仍产 3 位，不与 S10 碰撞
    ])('%s → %s', (input, expected) => {
      expect(shotKeyFromCandidates(input)).toBe(expected)
    })

    it('真实逆推 audio 节点四源候选 → S01', () => {
      // DB 实况：a-aud_S001_dialogue 的 raw.shot_id / label / node.id / filePath
      expect(
        shotKeyFromCandidates('S001', 'S001_dialogue', 'a-aud_S001_dialogue', '/oss/pipeline/a7b3c9d2/S001_dialogue.wav'),
      ).toBe('S01')
    })

    it('真实逆推 storyboard 节点四源候选 → S01', () => {
      expect(shotKeyFromCandidates('S001', 'S001', 'S001', 'a-shot_list-S001')).toBe('S01')
    })

    it('全候选无非空字符串 → null（不产 S00 幽灵键）', () => {
      expect(shotKeyFromCandidates(null, undefined, 42)).toBeNull()
      expect(shotKeyFromCandidates()).toBeNull()
    })

    it('纯数字 label 不再产 S00 幽灵键（"0" 场景序 0 仍产 S00 —— 与 paddedShotIdOf 现状一致，仅记录）', () => {
      // paddedShotIdOf('0') → 'S00'；此形仅出现在非音频节点（scene_images-N 无音频信号，
      // Pass4 早已 continue），不影响音轨挂载
      expect(shotKeyFromCandidates('0')).toBe('S00')
    })
  })
})

// ─── extractShots Pass4 集成 ─────────────────────────────

/** 最小合法 AssetNodeV3（media/meta 按 stage 参数化）。 */
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

function storyboardNode(id: string, shotId: string, durationS = 6.73): AssetNodeV3 {
  return makeNode(id, {
    stage: 'storyboard',
    modality: 'image',
    meta: { stage: 'storyboard', shotId, shotType: 'scene', durationS },
  })
}

/** 逆推项目 audio 节点（DB 实况形态：assetType=voice + clip_type/audio_type/filePath）。 */
function reverseAudioNode(id: string, shotId: string, clipType: string, audioType: string): AssetNodeV3 {
  return makeNode(id, {
    stage: 'voice',
    modality: 'audio',
    meta: { stage: 'voice' },
  })
}

describe('extractShots 音轨挂载 — 逆推项目（纯场景号 S001）', () => {
  it('storyboard S001 + 三轨 audio（dialogue/ambient/bgm）→ 全部挂载', () => {
    const graph = makeGraph([
      storyboardNode('a-shot_list-S001', 'S001'),
      reverseAudioNode('a-aud_S001_dialogue', 'S001', 'dialogue', '人声'),
      reverseAudioNode('a-aud_S001_ambient', 'S001', 'ambient', '环境音'),
      reverseAudioNode('a-aud_S001_bgm', 'S001', 'bgm', '背景音乐'),
    ])
    const raw = new Map<string, Record<string, unknown>>([
      ['a-shot_list-S001', {
        shot_id: 'S001', label: 'S001', assetType: 'storyboard', duration_sec: 6.73,
        filePath: '/oss/pipeline/ffaece43/S001_first_reverse.jpg',
        thumbnailUrl: '/oss/_thumbs/pipeline/ffaece43/S001_first_reverse.webp',
      }],
      ['a-aud_S001_dialogue', {
        shot_id: 'S001', label: 'S001_dialogue', assetType: 'voice',
        clip_type: 'dialogue', audio_type: '人声', duration_sec: 6.73,
        filePath: '/oss/pipeline/a7b3c9d2/S001_dialogue.wav',
        text: '八 七 六 他有一百种方法逗我开心',
      }],
      ['a-aud_S001_ambient', {
        shot_id: 'S001', label: 'S001_ambient', assetType: 'voice',
        clip_type: 'ambient', audio_type: '环境音', duration_sec: 6.73,
        filePath: '/oss/pipeline/a7b3c9d2/S001_ambient.wav',
      }],
      ['a-aud_S001_bgm', {
        shot_id: 'S001', label: 'S001_bgm', assetType: 'voice',
        clip_type: 'bgm', audio_type: '背景音乐', duration_sec: 6.73,
        filePath: '/oss/pipeline/a7b3c9d2/S001_bgm.wav',
      }],
    ])

    const shots = extractShots(graph, raw)
    expect(shots).toHaveLength(1)
    const shot = shots[0]
    // storyboard 侧回退：S001 → S01 场景键
    expect(shot.shotKey).toBe('S01')
    // audio 侧同回退 → 三轨全挂（修竖幅「💬对白/🔊环境/🎵BGM」三列恒空）
    expect(shot.audioTracks).toHaveLength(3)
    expect(shot.audioTracks!.map((t) => t.clipType).sort()).toEqual(['ambient', 'bgm', 'dialogue'])
    // 对白原文透传（竖幅对白轨展示）
    const dia = shot.audioTracks!.find((t) => t.clipType === 'dialogue')
    expect(dia?.text).toBe('八 七 六 他有一百种方法逗我开心')
    expect(dia?.audioType).toBe('人声')
  })

  it('无折叠行项目（无 frameVariants）不双挂：每轨 filePath 恰出现一次', () => {
    const graph = makeGraph([
      storyboardNode('a-shot_list-S001', 'S001'),
      storyboardNode('a-shot_list-S002', 'S002'),
      reverseAudioNode('a-aud_S001_dialogue', 'S001', 'dialogue', '人声'),
      reverseAudioNode('a-aud_S002_dialogue', 'S002', 'dialogue', '人声'),
    ])
    const raw = new Map<string, Record<string, unknown>>([
      ['a-shot_list-S001', { shot_id: 'S001', label: 'S001' }],
      ['a-shot_list-S002', { shot_id: 'S002', label: 'S002' }],
      ['a-aud_S001_dialogue', { shot_id: 'S001', clip_type: 'dialogue', audio_type: '人声', filePath: '/oss/p/S001_dialogue.wav' }],
      ['a-aud_S002_dialogue', { shot_id: 'S002', clip_type: 'dialogue', audio_type: '人声', filePath: '/oss/p/S002_dialogue.wav' }],
    ])

    const shots = extractShots(graph, raw)
    expect(shots.map((s) => s.shotKey)).toEqual(['S01', 'S02'])
    const allPaths = shots.flatMap((s) => s.audioTracks?.map((t) => t.filePath) ?? [])
    // 场景级聚合（audioByScene）不参与非折叠行 → 无重复
    expect(allPaths).toHaveLength(2)
    expect(new Set(allPaths).size).toBe(2)
    // 各轨挂到自己的场景行
    expect(shots[0].audioTracks?.[0].filePath).toBe('/oss/p/S001_dialogue.wav')
    expect(shots[1].audioTracks?.[0].filePath).toBe('/oss/p/S002_dialogue.wav')
  })
})

describe('extractShots 音轨挂载 — 管线项目（beat S01_B01）回归', () => {
  it('beat 形式 storyboard+audio 挂载行为不变（shotKey=s1_1）', () => {
    const graph = makeGraph([
      storyboardNode('a-shot_list-S01_B01', 'S01_B01'),
      makeNode('a-aud_S01_B01_dia', { stage: 'voice', modality: 'audio', meta: { stage: 'voice' } }),
    ])
    const raw = new Map<string, Record<string, unknown>>([
      ['a-shot_list-S01_B01', { shot_id: 'S01_B01', label: 'S01_B01' }],
      ['a-aud_S01_B01_dia', {
        shot_id: 'S01_B01', clip_type: 'dialogue', audio_type: '人声',
        filePath: '/oss/p/S01_B01.wav', duration_sec: 3.2, speaker: '沈知意',
      }],
    ])

    const shots = extractShots(graph, raw)
    expect(shots).toHaveLength(1)
    expect(shots[0].shotKey).toBe('s1_1')
    expect(shots[0].audioTracks).toHaveLength(1)
    expect(shots[0].audioTracks![0].speaker).toBe('沈知意')
  })

  it('交叉保护：场景键 audio（S001）不挂到 beat 键分镜行（s1_1 ≠ S01）', () => {
    const graph = makeGraph([
      storyboardNode('a-shot_list-S01_B01', 'S01_B01'),
      makeNode('a-aud_S001_dialogue', { stage: 'voice', modality: 'audio', meta: { stage: 'voice' } }),
    ])
    const raw = new Map<string, Record<string, unknown>>([
      ['a-shot_list-S01_B01', { shot_id: 'S01_B01', label: 'S01_B01' }],
      ['a-aud_S001_dialogue', { shot_id: 'S001', clip_type: 'dialogue', audio_type: '人声', filePath: '/oss/p/S001_dialogue.wav' }],
    ])

    const shots = extractShots(graph, raw)
    // beat 行不被场景回退污染
    expect(shots[0].shotKey).toBe('s1_1')
    expect(shots[0].audioTracks).toBeUndefined()
  })

  it('同一场景多 beat 分镜各自挂载（去重键 s{n}_{m} 互不干扰）', () => {
    const graph = makeGraph([
      storyboardNode('a-shot_list-S01_B01', 'S01_B01'),
      storyboardNode('a-shot_list-S01_B02', 'S01_B02'),
      makeNode('a-aud_1_1', { stage: 'voice', modality: 'audio', meta: { stage: 'voice' } }),
      makeNode('a-aud_1_2', { stage: 'voice', modality: 'audio', meta: { stage: 'voice' } }),
    ])
    const raw = new Map<string, Record<string, unknown>>([
      ['a-shot_list-S01_B01', { shot_id: 'S01_B01' }],
      ['a-shot_list-S01_B02', { shot_id: 'S01_B02' }],
      ['a-aud_1_1', { shot_id: 'S01_B01', clip_type: 'dialogue', filePath: '/oss/p/1_1.wav' }],
      ['a-aud_1_2', { shot_id: 'S01_B02', clip_type: 'dialogue', filePath: '/oss/p/1_2.wav' }],
    ])

    const shots = extractShots(graph, raw)
    expect(shots).toHaveLength(2)
    expect(shots.every((s) => s.audioTracks?.length === 1)).toBe(true)
  })
})

// ─── extractShots Pass5 首尾帧挂载（时间轴仅展示已选定条件帧） ──

/** 条件帧变体节点（DB 实况形态：a-flf-S01_B01-first-v1，格式 A 四字段齐）。 */
function flfNode(id: string, shotId: string, frameType: 'first' | 'last', variant: string): AssetNodeV3 {
  return makeNode(id, { stage: 'keyframe', modality: 'image', meta: { stage: 'keyframe', shotId } })
}

describe('extractShots 首尾帧挂载 — beat 级条件帧（管线项目）', () => {
  it('beat 级帧组按 shotKey 精确挂到同 beat 行：不折叠、不改名、不双行', () => {
    const graph = makeGraph([
      storyboardNode('a-shot_list-S01_B01', 'S01_B01'),
      storyboardNode('a-shot_list-S01_B02', 'S01_B02'),
      flfNode('a-flf-S01_B01-first-v1', 'S01_B01', 'first', 'v1'),
      flfNode('a-flf-S01_B01-first-v2', 'S01_B01', 'first', 'v2'),
      flfNode('a-flf-S01_B01-last-v1', 'S01_B01', 'last', 'v1'),
    ])
    const raw = new Map<string, Record<string, unknown>>([
      ['a-shot_list-S01_B01', { shot_id: 'S01_B01' }],
      ['a-shot_list-S01_B02', { shot_id: 'S01_B02' }],
      ...['a-flf-S01_B01-first-v1', 'a-flf-S01_B01-first-v2'].map((id, i) => [id, {
        assetType: 'keyframe', shot_id: 'S01_B01', frame_type: 'first',
        variant: `v${i + 1}`, groupKey: 'S01_B01_first', filePath: `/oss/p/${id}.png`,
      }]),
      ['a-flf-S01_B01-last-v1', {
        assetType: 'keyframe', shot_id: 'S01_B01', frame_type: 'last',
        variant: 'v1', groupKey: 'S01_B01_last', filePath: '/oss/p/last.png',
      }],
    ] as [string, Record<string, unknown>][])

    const shots = extractShots(graph, raw)
    // 不双行：两行 storyboard，帧组挂载后不追加合成行
    expect(shots).toHaveLength(2)
    const b01 = shots.find((s) => s.shotId === 'S01_B01')
    const b02 = shots.find((s) => s.shotId === 'S01_B02')
    expect(b01?.frameVariants?.first).toHaveLength(2)
    expect(b01?.frameVariants?.last).toHaveLength(1)
    // beat 行不改名（场景折叠只发生在场景级帧组的回退路径）
    expect(b01?.shotId).toBe('S01_B01')
    // 同场景兄弟 beat 不被过滤、不被折叠挂载
    expect(b02?.frameVariants).toBeUndefined()
    expect(b02?.shotId).toBe('S01_B02')
  })
})

describe('extractShots 首尾帧挂载 — 场景级条件帧（逆推项目回退）', () => {
  it('场景级帧组挂到该场景第一个 beat 行并改名折叠，废弃子行过滤', () => {
    const graph = makeGraph([
      storyboardNode('a-shot_list-S01_B01', 'S01_B01'),
      storyboardNode('a-shot_list-S01_B02', 'S01_B02'),
      flfNode('a-flf-S001-first-v1', 'S001', 'first', 'v1'),
    ])
    const raw = new Map<string, Record<string, unknown>>([
      ['a-shot_list-S01_B01', { shot_id: 'S01_B01' }],
      ['a-shot_list-S01_B02', { shot_id: 'S01_B02' }],
      ['a-flf-S001-first-v1', {
        assetType: 'keyframe', shot_id: 'S001', frame_type: 'first',
        variant: 'v1', groupKey: 'S001_first', filePath: '/oss/p/S001_first_v1.png',
      }],
    ])

    const shots = extractShots(graph, raw)
    // 折叠：S01_B01 → S01 场景行，S01_B02 废弃子行被过滤，无合成行
    expect(shots).toHaveLength(1)
    expect(shots[0].shotId).toBe('S01')
    expect(shots[0].frameVariants?.first).toHaveLength(1)
  })
})
