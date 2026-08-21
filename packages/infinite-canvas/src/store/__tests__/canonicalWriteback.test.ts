/**
 * WRITE-03 canonical 回写 action 测试（Phase 51-02）。
 *
 * 覆盖不变量：
 *  a. 三 action（updateAssetMeta / applySocketNodeState / applySocketNodePreview）
 *     各自经 applyGraphTransform 写 canonical graph（meta 字段 / state / media.thumbnail）；
 *  b. transform-survival：updateAssetMeta 写 framing='wide' 后再触发一次无关
 *     applyGraphTransform，编辑值仍在、派生 nodes 同步——锁死「派生缓存直改被重建冲掉」类 bug；
 *  c. 清空语义：patch 值 undefined/null/'' = 删除字段（「未设置」）；
 *  d. state 归一表与 adapter 同一张（error→failed）；progress 保持派生缓存 ephemeral，
 *     canonical 序列化不含 progress（V3 strict 无槽位，51-02 objective 明写裁定）；
 *  e. 非法 meta key 忽略不 throw；graph === null 时三 action 均静默早退不 throw。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AssetNodeV3, FlowGraphV3 } from '@kais/flowgraph-v3'
import { useCanvasStore } from '../canvasStore'

// ─── fixture 工厂 ───────────────────────────────────────────

function storyboardNode(id: string, overrides: Partial<AssetNodeV3> = {}): AssetNodeV3 {
  return {
    id,
    kind: 'asset',
    branchId: 'br_main',
    phaseIndex: 3,
    phaseName: 'storyboard',
    position: { x: 0, y: 0 },
    size: { width: 240, height: 160 },
    state: 'success',
    stage: 'storyboard',
    modality: 'image',
    scope: 'episode',
    media: {
      original: `/assets/${id}.png`,
      proxy: null,
      thumbnail: null,
      waveform: null,
    },
    meta: { stage: 'storyboard', shotId: 'shot-001', shotType: 'close_up', durationS: 3 },
    curation: 'candidate',
    stale: null,
    ...overrides,
  }
}

function fixtureGraph(): FlowGraphV3 {
  return {
    meta: { version: '3', projectId: 7, episodesId: 101, createdAt: 1, updatedAt: 1 },
    nodes: [storyboardNode('node-sb')],
    links: [],
    branches: [{ id: 'br_main', name: '主线' }],
    variantGroups: [],
  }
}

// ─── harness ────────────────────────────────────────────────

function assetOf(graph: FlowGraphV3 | null, id: string): AssetNodeV3 | undefined {
  const n = graph?.nodes.find((x) => x.id === id)
  return n && n.kind === 'asset' ? n : undefined
}

function metaOf(id: string): Record<string, unknown> {
  return (assetOf(useCanvasStore.getState().graph, id)?.meta ?? {}) as Record<string, unknown>
}

/** 派生 RF 缓存中该节点 data.meta（graphToViewModel 注入）。 */
function derivedMetaOf(id: string): Record<string, unknown> {
  const n = useCanvasStore.getState().nodes.find((x) => x.id === id)
  return (n?.data?.meta ?? {}) as Record<string, unknown>
}

function resetStore(partial: Record<string, unknown> = {}): void {
  useCanvasStore.setState(
    {
      graph: null,
      nodes: [],
      edges: [],
      variantGroups: [],
      branches: [],
      warnings: [],
      ...partial,
    },
    false,
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
  // console.warn 静默（早退/非法 key 告警路径会被断言行为而非日志）
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

// ─── a/b/c：updateAssetMeta ─────────────────────────────────

describe('updateAssetMeta — MetaEditor canonical 回写', () => {
  it('写 storyboard 可选字段 → canonical meta 更新 + 派生 nodes 同步', () => {
    resetStore()
    useCanvasStore.getState().setGraph(fixtureGraph())

    useCanvasStore.getState().updateAssetMeta('node-sb', { framing: 'wide', cameraMovement: 'zoom_in' })

    expect(metaOf('node-sb')).toMatchObject({
      stage: 'storyboard',
      framing: 'wide',
      cameraMovement: 'zoom_in',
    })
    expect(derivedMetaOf('node-sb').framing).toBe('wide')
  })

  it('transform-survival：编辑后触发无关 applyGraphTransform，编辑值仍在且派生同步', () => {
    resetStore()
    useCanvasStore.getState().setGraph(fixtureGraph())
    useCanvasStore.getState().updateAssetMeta('node-sb', { framing: 'wide' })

    // 无关 transform（恒等改 updatedAt，模拟 applyLayout 一类重建派生缓存的变换）
    useCanvasStore.getState().applyGraphTransform((g) => ({
      ...g,
      meta: { ...g.meta, updatedAt: Date.now() },
    }))

    expect(metaOf('node-sb').framing).toBe('wide')
    expect(derivedMetaOf('node-sb').framing).toBe('wide')
  })

  it('清空语义：patch {cameraMovement: undefined} 后字段不存在', () => {
    resetStore()
    useCanvasStore.getState().setGraph(fixtureGraph())
    useCanvasStore.getState().updateAssetMeta('node-sb', { cameraMovement: 'zoom_in' })
    expect(metaOf('node-sb').cameraMovement).toBe('zoom_in')

    useCanvasStore.getState().updateAssetMeta('node-sb', { cameraMovement: undefined })
    expect('cameraMovement' in metaOf('node-sb')).toBe(false)

    // '' 与 null 同为清空语义
    useCanvasStore.getState().updateAssetMeta('node-sb', { framing: 'wide' })
    useCanvasStore.getState().updateAssetMeta('node-sb', { framing: '' })
    expect('framing' in metaOf('node-sb')).toBe(false)
  })

  it('非法 key / stage 判别字段：忽略不 throw，meta 其余字段不动', () => {
    resetStore()
    useCanvasStore.getState().setGraph(fixtureGraph())

    expect(() =>
      useCanvasStore.getState().updateAssetMeta('node-sb', { stage: 'video', evilKey: 1 }),
    ).not.toThrow()

    const meta = metaOf('node-sb')
    expect(meta.stage).toBe('storyboard')
    expect('evilKey' in meta).toBe(false)
    expect(meta.shotId).toBe('shot-001')
  })
})

// ─── a/d：applySocketNodeState ──────────────────────────────

describe('applySocketNodeState — socket node:state 回写', () => {
  it("state 'error' → canonical 'failed'（与 adapter 同一张归一表）", () => {
    resetStore()
    useCanvasStore.getState().setGraph(fixtureGraph())

    useCanvasStore.getState().applySocketNodeState('node-sb', 'error')

    expect(assetOf(useCanvasStore.getState().graph, 'node-sb')?.state).toBe('failed')
    // 派生缓存同步（graphToViewModel 注入 data.state）
    const derived = useCanvasStore.getState().nodes.find((n) => n.id === 'node-sb')
    expect(derived?.data?.state).toBe('failed')
  })

  it('progress ephemeral：canonical 序列化不含 progress，派生缓存可见', () => {
    resetStore()
    useCanvasStore.getState().setGraph(fixtureGraph())

    useCanvasStore.getState().applySocketNodeState('node-sb', 'running', 42)

    expect(assetOf(useCanvasStore.getState().graph, 'node-sb')?.state).toBe('running')
    // progress 不落 canonical（V3 strict 无槽位，瞬态量不持久化）
    expect(JSON.stringify(useCanvasStore.getState().graph)).not.toContain('progress')
    // 派生缓存 ephemeral 通道保留现状行为
    const derived = useCanvasStore.getState().nodes.find((n) => n.id === 'node-sb')
    expect(derived?.data?.progress).toBe(42)
  })

  it('未知 state：console.warn 忽略，canonical 不变', () => {
    resetStore()
    useCanvasStore.getState().setGraph(fixtureGraph())

    useCanvasStore.getState().applySocketNodeState('node-sb', 'bogus_state')

    expect(assetOf(useCanvasStore.getState().graph, 'node-sb')?.state).toBe('success')
    expect(console.warn).toHaveBeenCalled()
  })
})

// ─── a：applySocketNodePreview ──────────────────────────────

describe('applySocketNodePreview — socket node:preview 回写', () => {
  it('thumbnailUrl 写 asset.media.thumbnail + 派生 data.thumbnailUrl 同步', () => {
    resetStore()
    useCanvasStore.getState().setGraph(fixtureGraph())

    useCanvasStore.getState().applySocketNodePreview('node-sb', 'http://cdn/thumb.png')

    expect(assetOf(useCanvasStore.getState().graph, 'node-sb')?.media.thumbnail).toBe('http://cdn/thumb.png')
    const derived = useCanvasStore.getState().nodes.find((n) => n.id === 'node-sb')
    expect(derived?.data?.thumbnailUrl).toBe('http://cdn/thumb.png')
  })
})

// ─── e：graph === null 静默早退 ─────────────────────────────

describe('graph === null / 节点不存在 — 静默早退', () => {
  it('graph 为空时三 action 均不 throw', () => {
    resetStore()

    expect(() => {
      useCanvasStore.getState().updateAssetMeta('node-sb', { framing: 'wide' })
      useCanvasStore.getState().applySocketNodeState('node-sb', 'running', 10)
      useCanvasStore.getState().applySocketNodePreview('node-sb', 'http://cdn/t.png')
    }).not.toThrow()
    expect(useCanvasStore.getState().graph).toBeNull()
  })

  it('节点不存在时三 action 均不 throw 且图不变', () => {
    resetStore()
    useCanvasStore.getState().setGraph(fixtureGraph())
    const before = useCanvasStore.getState().graph

    expect(() => {
      useCanvasStore.getState().updateAssetMeta('ghost', { framing: 'wide' })
      useCanvasStore.getState().applySocketNodeState('ghost', 'running')
      useCanvasStore.getState().applySocketNodePreview('ghost', 'http://cdn/t.png')
    }).not.toThrow()
    expect(useCanvasStore.getState().graph).toBe(before)
  })
})
