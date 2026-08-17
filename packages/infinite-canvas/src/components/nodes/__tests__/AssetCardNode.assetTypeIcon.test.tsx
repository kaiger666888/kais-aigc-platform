// @vitest-environment jsdom
/**
 * AssetCardNode assetType 子类型图标（v1.1 character/prop + v1.2 dialogue/music/sfx）渲染级测试。
 *
 * 行为契约（AssetCardNode.tsx / icons.tsx AssetTypeIcon）：
 *  - raw 袋（rawDataByNodeId）assetType 命中五 kind 之一 → 标题行模态图标后渲染
 *    12px [data-testid="asset-type-icon"][data-kind=...]（色 = 模态色，不另开色相）。
 *  - 缺封面占位（无 thumb / original）→ 32px 占位图标由模态图标替换为子类型图标
 *    （对白/音乐/音效等无封面子节点的类型信号主载体）。
 *  - 有封面的 character/prop（representative_image）→ 仅标题行 1 枚，封面照常渲染图。
 *  - 已知 modality（image keyframe / audio voice）与未知 assetType（scene 等）→
 *    不渲染子类型图标，标题行模态图标不受影响（回退纯模态图标）。
 *  - legacy 非 graph 路径：data.assetType 直挂 data（rawDataByNodeId = null）同样生效。
 *  - LOD0 → 整卡早退为 L0 色块，无任何图标；LOD1 → 标题行图标仍可见。
 *
 * 测试策略照抄 AssetCardNode.playBadge.test.tsx：真实 zustand store（setState 种
 * rawDataByNodeId / nodes），仅 mock useLodLevel；jsdom + react-dom/client + React 19 act。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ReactFlowProvider } from '@xyflow/react'
import AssetCardNode from '../AssetCardNode'
import { useCanvasStore } from '../../../store/canvasStore'
import type { LodLevel } from '../../../hooks/useLod'

// ─── LOD 注入：mock useLodLevel 为可控值（保留模块其余导出） ───
const lodState = vi.hoisted(() => ({ lod: 2 as LodLevel }))
vi.mock('../../../hooks/useLod', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../hooks/useLod')>()
  return { ...actual, useLodLevel: () => lodState.lod }
})

// React 19：act 需显式声明测试环境，否则每次渲染都告警
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type AssetCardProps = React.ComponentProps<typeof AssetCardNode>

function makeProps(id: string, data: Partial<AssetCardProps['data']>): AssetCardProps {
  return { id, data, selected: false } as unknown as AssetCardProps
}

let root: Root | null = null
let container: HTMLElement | null = null

function render(ui: React.ReactNode) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(<ReactFlowProvider>{ui}</ReactFlowProvider>))
}

const queryCard = (): HTMLElement | null =>
  container?.querySelector<HTMLElement>('[data-testid="asset-card"]') ?? null
const queryCover = (): HTMLElement | null =>
  container?.querySelector<HTMLElement>('[data-testid="asset-card-cover"]') ?? null

/** 全部子类型图标（标题行 + 封面占位）。 */
function allTypeIcons(): NodeListOf<SVGSVGElement> {
  return container!.querySelectorAll('svg[data-testid="asset-type-icon"]')
}

/** 种 raw 袋（graph 路径 assetType 权威源）。rawDataByNodeId=null 表示 legacy 非 graph。 */
function seedRaw(id: string, raw: Record<string, unknown> | null) {
  useCanvasStore.setState({
    nodes: [{ id, type: 'global', position: { x: 0, y: 0 }, data: {} }],
    rawDataByNodeId: raw === null ? null : new Map([[id, raw]]),
  })
}

beforeEach(() => {
  lodState.lod = 2
  useCanvasStore.setState({ nodes: [], selectedNode: null, detailNode: null, rawDataByNodeId: null })
})

afterEach(() => {
  const r = root // 闭包内捕获非空引用（let 收窄不穿透闭包）
  if (r) act(() => r.unmount())
  root = null
  container?.remove()
  container = null
})

const FIVE_KINDS = ['character', 'prop', 'dialogue', 'music', 'sfx'] as const

describe('AssetCardNode assetType 子类型图标（v3 渲染层）', () => {
  it.each(FIVE_KINDS)('LOD2 + raw.assetType=%s + 无封面 → 标题行 12px + 封面占位 32px 双落点', (kind) => {
    seedRaw('sub-001', { assetType: kind })
    render(<AssetCardNode {...makeProps('sub-001', { stage: 'global' })} />)

    const icons = allTypeIcons()
    // 标题行（模态图标后）+ 缺封面占位（32px 替换模态图标）= 2 处
    expect(icons.length).toBe(2)
    for (const icon of Array.from(icons)) {
      expect(icon.getAttribute('data-kind')).toBe(kind)
    }

    // 尺寸分工：标题行 12px，封面占位 32px
    const sizes = Array.from(icons).map((i) => i.getAttribute('width')).sort()
    expect(sizes).toEqual(['12', '32'])

    // 封面占位内只有子类型图标（模态图标被替换，不叠加）
    const cover = queryCover()
    expect(cover).not.toBeNull()
    expect(cover!.querySelectorAll('svg').length).toBe(1)
    expect(cover!.querySelector('svg[data-testid="asset-type-icon"]')).not.toBeNull()
  })

  it('LOD2 + character 有封面（representative_image）→ 仅标题行 1 枚，封面照常渲染图', () => {
    seedRaw('char-001', { assetType: 'character' })
    render(
      <AssetCardNode
        {...makeProps('char-001', {
          stage: 'global',
          thumbnailUrl: '/oss/demo/char_001.webp',
          filePath: '/oss/demo/char_001.png',
        })}
      />,
    )

    const icons = allTypeIcons()
    expect(icons.length).toBe(1)
    expect(icons[0].getAttribute('data-kind')).toBe('character')
    expect(icons[0].getAttribute('width')).toBe('12')
    // 封面是 <img>（缩略图），不是图标占位
    const cover = queryCover()
    expect(cover!.querySelector('img')).not.toBeNull()
    expect(cover!.querySelector('svg')).toBeNull()
  })

  it('dialogue 生产形态（stage=global + modality=video 嗅探 + master video filePath）→ 标题行图标照常 + 封面走 mp4 首帧兜底', () => {
    seedRaw('audio_dia_s012', { assetType: 'dialogue' })
    render(
      <AssetCardNode
        {...makeProps('audio_dia_s012', {
          stage: 'global',
          modality: 'video',
          filePath: '/oss/demo/master.mp4',
        })}
      />,
    )

    // 视频模态封面分支（<video> 首帧 + 模态播放 overlay）不受影响；子类型图标只在标题行
    const icons = allTypeIcons()
    expect(icons.length).toBe(1)
    expect(icons[0].getAttribute('data-kind')).toBe('dialogue')
    const cover = queryCover()
    expect(cover!.querySelector('video')).not.toBeNull()
  })

  it('LOD1 → 标题行子类型图标仍可见（小卡不丢类型信号）', () => {
    lodState.lod = 1
    seedRaw('sub-002', { assetType: 'music' })
    render(<AssetCardNode {...makeProps('sub-002', { stage: 'global' })} />)

    const icons = allTypeIcons()
    expect(icons.length).toBeGreaterThanOrEqual(1)
    expect(icons[0].getAttribute('data-kind')).toBe('music')
    expect(icons[0].getAttribute('width')).toBe('12')
  })

  it('LOD0 → 整卡早退为 L0 色块：无子类型图标、无封面区', () => {
    lodState.lod = 0
    seedRaw('sub-003', { assetType: 'sfx' })
    render(<AssetCardNode {...makeProps('sub-003', { stage: 'global' })} />)

    expect(container!.querySelector('[data-testid="asset-card-l0"]')).not.toBeNull()
    expect(container!.querySelectorAll('svg[data-testid="asset-type-icon"]').length).toBe(0)
    expect(queryCover()).toBeNull()
  })

  it('已知 image modality（keyframe，无 assetType）→ 不渲染子类型图标；标题行模态图标不受影响', () => {
    useCanvasStore.setState({
      nodes: [{ id: 'kf-001', type: 'keyframe', position: { x: 0, y: 0 }, data: {} }],
      rawDataByNodeId: new Map([['kf-001', { shot_scale: 'MS' }]]),
    })
    render(
      <AssetCardNode
        {...makeProps('kf-001', { stage: 'keyframe', thumbnailUrl: '/oss/demo/kf-001.webp', filePath: '/oss/demo/kf-001.png' })}
      />,
    )

    expect(queryCard()).not.toBeNull()
    expect(container!.querySelectorAll('svg[data-testid="asset-type-icon"]').length).toBe(0)
    // 模态图标照常在标题行（无 data-testid 的 svg）
    const titleSvgs = queryCard()!.querySelectorAll('svg:not([data-testid])')
    expect(titleSvgs.length).toBeGreaterThanOrEqual(1)
  })

  it('已知 audio modality（voice，audioType 路径）→ 不渲染子类型图标', () => {
    seedRaw('vo-001', { audioType: 'voice' })
    render(<AssetCardNode {...makeProps('vo-001', { stage: 'voice', modality: 'audio', filePath: '/oss/demo/vo-001.wav' })} />)

    expect(queryCard()).not.toBeNull()
    expect(container!.querySelectorAll('svg[data-testid="asset-type-icon"]').length).toBe(0)
    // audio 封面 = 波形（无图标占位）
    expect(queryCover()).not.toBeNull()
  })

  it('未知 assetType（scene，legacy 枚举）→ 回退纯模态图标，不渲染子类型图标', () => {
    seedRaw('scene-001', { assetType: 'scene' })
    render(<AssetCardNode {...makeProps('scene-001', { stage: 'global' })} />)

    expect(container!.querySelectorAll('svg[data-testid="asset-type-icon"]').length).toBe(0)
    // 缺封面占位仍是模态图标（未被替换）
    const cover = queryCover()
    expect(cover!.querySelectorAll('svg').length).toBe(1)
    expect(cover!.querySelector('svg[data-testid="asset-type-icon"]')).toBeNull()
  })

  it('legacy 非 graph 路径（rawDataByNodeId=null，data.assetType 直挂 data）→ 标题行图标同样生效', () => {
    seedRaw('legacy-prop', null)
    render(<AssetCardNode {...makeProps('legacy-prop', { stage: 'global', assetType: 'prop' })} />)

    const icons = allTypeIcons()
    expect(icons.length).toBeGreaterThanOrEqual(1)
    expect(icons[0].getAttribute('data-kind')).toBe('prop')
  })
})
