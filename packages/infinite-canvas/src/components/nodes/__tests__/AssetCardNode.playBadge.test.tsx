// @vitest-environment jsdom
/**
 * AssetCardNode ▶ 播放徽章（LOD≤1 视频卡显式播放入口）渲染级测试。
 *
 * 行为契约（AssetCardNode.tsx / Cover / PlayBadge）：
 *  - lod≤1 + mod=video + 有 videoSrc → 渲染 [data-testid="asset-card-play-badge"]；
 *    两条封面分支（有缩略图 img / 无缩略图 mp4 首帧兜底）都出徽章。
 *  - 点击徽章 → stopPropagation + 从 useCanvasStore.getState().nodes 找到本 node，
 *    setSelectedNode + setDetailNode（打开右详情面板的 controls 播放器）。
 *  - lod=2（保留 hover 内联播放）/ 非 video 模态（image/audio）/ 无 videoSrc → 不渲染徽章。
 *  - lod=0 → 整卡早退为 L0 色块（无封面区，徽章不适用）。
 *
 * 测试策略：真实 zustand store（setState 种 nodes，断言 getState()），不 mock store；
 * 仅 mock useLodLevel（LodContext 未导出，且真实 LodProvider 需 ReactFlow viewport）。
 * DOM 用 jsdom（本文件级 @vitest-environment 指令），渲染走 react-dom/client + React 19 act。
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ReactFlowProvider, type Node } from '@xyflow/react'
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

/** 最小节点 props（NodeProps 的 position 等运行时用不到的字段省略；data 全为可选字段）。 */
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

const queryBadge = (): HTMLButtonElement | null =>
  container?.querySelector<HTMLButtonElement>('[data-testid="asset-card-play-badge"]') ?? null
const queryCover = (): HTMLElement | null =>
  container?.querySelector<HTMLElement>('[data-testid="asset-card-cover"]') ?? null

/** 种入 store 的节点（openDetail 用 getState().nodes 按 id 找）。 */
function seedNode(id: string, data: Record<string, unknown> = {}): Node {
  const node: Node = { id, type: 'video', position: { x: 0, y: 0 }, data }
  useCanvasStore.setState({ nodes: [node] })
  return node
}

function clickBadge(badge: HTMLButtonElement) {
  act(() => {
    badge.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
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

// 抑制 jsdom 下 <video>/<img> 的 "Not implemented: HTMLMediaElement" 类噪音由 vitest 吸收；
// 本测试不断言媒体加载，只断言 DOM 结构与 store 副作用。

describe('AssetCardNode ▶ 播放徽章（LOD≤1 视频卡）', () => {
  it('LOD1 + video + 有 videoSrc + 有缩略图 → 渲染徽章（img 分支）；点击 → setSelectedNode + setDetailNode', () => {
    lodState.lod = 1
    const node = seedNode('shot-001')
    render(
      <AssetCardNode
        {...makeProps('shot-001', {
          stage: 'video',
          thumbnailUrl: '/oss/demo/shot-001.webp',
          filePath: '/oss/demo/shot-001.mp4',
        })}
      />,
    )

    const badge = queryBadge()
    expect(badge).not.toBeNull()
    expect(badge!.getAttribute('aria-label')).toContain('播放')
    expect(queryCover()).not.toBeNull()
    // 缩略图分支：img 存在（徽章叠在缩略图上，而非替换模态图标路径）
    expect(container!.querySelector('img')).not.toBeNull()

    // 点击前 store 干净
    expect(useCanvasStore.getState().selectedNode).toBeNull()
    expect(useCanvasStore.getState().detailNode).toBeNull()

    clickBadge(badge!)

    // 点击 → 选中 + 打开右详情面板（同一 store 节点引用）
    const s = useCanvasStore.getState()
    expect(s.selectedNode).toBe(node)
    expect(s.detailNode).toBe(node)
  })

  it('LOD1 + video + 有 videoSrc + 无缩略图 → mp4 首帧兜底分支同样渲染徽章且点击开详情', () => {
    lodState.lod = 1
    const node = seedNode('shot-002')
    render(<AssetCardNode {...makeProps('shot-002', { stage: 'video', filePath: '/oss/demo/shot-002.mp4' })} />)

    const badge = queryBadge()
    expect(badge).not.toBeNull()
    // 首帧兜底分支：封面内是 <video preload=metadata>（#t=0.1 取首帧）
    const video = container!.querySelector('video')
    expect(video).not.toBeNull()
    expect(video!.getAttribute('src')).toContain('#t=0.1')

    clickBadge(badge!)
    expect(useCanvasStore.getState().selectedNode).toBe(node)
    expect(useCanvasStore.getState().detailNode).toBe(node)
  })

  it('LOD2 + video → 不渲染徽章（保留 hover 内联播放路径）', () => {
    lodState.lod = 2
    seedNode('shot-003')
    render(
      <AssetCardNode
        {...makeProps('shot-003', {
          stage: 'video',
          thumbnailUrl: '/oss/demo/shot-003.webp',
          filePath: '/oss/demo/shot-003.mp4',
        })}
      />,
    )

    expect(queryBadge()).toBeNull()
    expect(queryCover()).not.toBeNull() // 卡片本体照常渲染
  })

  it('LOD1 + image 模态 → 不渲染徽章', () => {
    lodState.lod = 1
    seedNode('kf-001')
    render(
      <AssetCardNode
        {...makeProps('kf-001', { stage: 'keyframe', thumbnailUrl: '/oss/demo/kf-001.webp', filePath: '/oss/demo/kf-001.png' })}
      />,
    )

    expect(queryBadge()).toBeNull()
    expect(queryCover()).not.toBeNull()
  })

  it('LOD1 + audio 模态 → 不渲染徽章（波形封面，播放键仅 LOD2 且为 audio 自己的 toggle）', () => {
    lodState.lod = 1
    seedNode('vo-001')
    render(<AssetCardNode {...makeProps('vo-001', { stage: 'voice', filePath: '/oss/demo/vo-001.wav' })} />)

    expect(queryBadge()).toBeNull()
    expect(queryCover()).not.toBeNull()
    // audio 的播放 toggle（asset-card-audio-toggle）在 LOD1 也不出现（enabled = lod===2）
    expect(container!.querySelector('[data-testid="asset-card-audio-toggle"]')).toBeNull()
  })

  it('LOD1 + video 但无 videoSrc（无 media/filePath）→ 不渲染徽章（showPlayBadge 需 !!videoSrc）', () => {
    lodState.lod = 1
    seedNode('shot-empty')
    render(<AssetCardNode {...makeProps('shot-empty', { stage: 'video' })} />)

    expect(queryBadge()).toBeNull()
    expect(queryCover()).not.toBeNull() // 缺封面常态路径（弱色底 + 模态图标）
  })

  it('LOD0 → 整卡早退为 L0 色块：无徽章、无封面区', () => {
    lodState.lod = 0
    seedNode('shot-004')
    render(
      <AssetCardNode
        {...makeProps('shot-004', { stage: 'video', thumbnailUrl: '/oss/demo/shot-004.webp', filePath: '/oss/demo/shot-004.mp4' })}
      />,
    )

    expect(container!.querySelector('[data-testid="asset-card-l0"]')).not.toBeNull()
    expect(queryBadge()).toBeNull()
    expect(queryCover()).toBeNull()
  })

  it('节点不在 store.nodes（canvas sync 未到）→ 点击徽章无操作、不崩溃', () => {
    lodState.lod = 1
    // 不 seedNode：data 有 videoSrc 所以徽章渲染，但 store.nodes 找不到该 id
    render(<AssetCardNode {...makeProps('ghost-001', { stage: 'video', filePath: '/oss/demo/ghost-001.mp4' })} />)

    const badge = queryBadge()
    expect(badge).not.toBeNull()
    clickBadge(badge!)

    expect(useCanvasStore.getState().selectedNode).toBeNull()
    expect(useCanvasStore.getState().detailNode).toBeNull()
  })
})
