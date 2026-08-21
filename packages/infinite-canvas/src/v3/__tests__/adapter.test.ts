/**
 * SPEC-step5 A.5 用例清单：
 *  1. _recon V2 结构合成 payload → 适配 → zod 过；
 *  2. 残缺 payload 不崩 + warnings；
 *  3. graphToViewModel 对两个 fixture 产出 RF 模型
 *     （deprecated 无独立节点、事件 chip 26×26、sequence 边 role 在 data）；
 *  4. fixtureSource 两模式加载成功。
 */
import { describe, it, expect } from 'vitest'
import { validateFlowGraphV3, checkReferentialIntegrity, type FlowGraphV3 } from '@kais/flowgraph-v3'
import {
  adaptV2Graph,
  graphToViewModel,
  getViewModel,
  RF_TYPE_EVENT_CHIP,
} from '../adapter'
import { getFixtureMode, loadFixtureGraph } from '../fixtureSource'

// ─── 合成后端 V2 payload（形状对齐 _recon/flowgraph-v2.ts） ───

function syntheticBackendV2() {
  return {
    meta: {
      version: '2',
      projectId: 7,
      episodesId: 101,
      pipelineId: 'pipe_shortdrama_v1',
      // orchestrator 裁定：ISO string → number(ms)
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T01:00:00.000Z',
      lastEventId: 42,
      viewport: { x: 10, y: 20, zoom: 0.8 },
    },
    nodes: [
      {
        id: 'n_script', type: 'script', branchId: 'br_main', phaseIndex: 1, phaseName: 'script',
        position: { x: 0, y: 0 }, size: { width: 240, height: 160 }, state: 'success',
        data: { prompt: '雨夜天台', hookType: '悬念', hookIntensity: 0.8 },
      },
      {
        id: 'n_sb', type: 'storyboard', branchId: 'br_main', phaseIndex: 2, phaseName: 'storyboard',
        position: { x: 320, y: 0 }, size: { width: 240, height: 160 }, state: 'success',
        data: {
          filePath: '/assets/sb/shot-001.png', thumbnailUrl: '/assets/sb/t.jpg',
          shotId: 'shot-001', shotType: 'close-up', durationS: 4,
          // 叙事线枚举（orchestrator 裁定：无合法槽位 → warnings，不私建字段）
          timeline: '1975',
        },
      },
      {
        // cached → success + 非 stale（裁定）
        id: 'n_video', type: 'video', branchId: 'br_main', phaseIndex: 4, phaseName: 'video',
        position: { x: 640, y: 0 }, size: { width: 240, height: 160 }, state: 'cached',
        data: {
          filePath: '/assets/v/shot-001.mp4', shotId: 'shot-001', durationS: 4,
          prompt: '她垂眸', seed: 88421, engine: 'wan2.2-i2v',
        },
        reviewStatus: 'approved', aiScore: 0.86,
      },
      {
        // skipped → failed（裁定）
        id: 'n_audio', type: 'audio', branchId: 'br_main', phaseIndex: 5, phaseName: 'voice',
        position: { x: 960, y: 0 }, size: { width: 240, height: 160 }, state: 'skipped',
        data: { filePath: '/assets/a/shot-001.wav', audioType: 'voice', speaker: '林晚' },
      },
      {
        id: 'n_role', type: 'asset', branchId: 'br_main', phaseIndex: 0, phaseName: 'P04 角色',
        position: { x: -300, y: 0 }, size: { width: 240, height: 160 }, state: 'idle',
        data: { filePath: '/assets/role/nvzhu.png', assetType: 'role' },
      },
      // 变体候选（无 type:'variant' 节点，仅后端 variantGroups 数组）
      {
        id: 'n_cand_a', type: 'video', branchId: 'br_main', phaseIndex: 4, phaseName: 'video',
        position: { x: 640, y: 200 }, size: { width: 240, height: 160 }, state: 'success',
        data: { filePath: '/assets/v/v1.mp4', shotId: 'shot-002', prompt: 'p', seed: 1001, engine: 'wan2.2-i2v' },
      },
      {
        id: 'n_cand_b', type: 'video', branchId: 'br_main', phaseIndex: 4, phaseName: 'video',
        position: { x: 680, y: 200 }, size: { width: 240, height: 160 }, state: 'success',
        data: { filePath: '/assets/v/v2.mp4', shotId: 'shot-002', prompt: 'p', seed: 1002, engine: 'wan2.2-i2v' },
        variantGroupId: 'vg_backend_1', variantOf: 'n_cand_a',
      },
      // 后端超集类型：zone/phase/suggestion/3d → 跳过 + warning
      { id: 'n_zone', type: 'zone', branchId: 'br_main', phaseIndex: 2, phaseName: 'z',
        position: { x: 0, y: 0 }, size: { width: 1, height: 1 }, state: 'success', data: {} },
      { id: 'n_phase', type: 'phase', branchId: 'br_main', phaseIndex: 2, phaseName: 'p',
        position: { x: 0, y: 0 }, size: { width: 1, height: 1 }, state: 'success', data: {} },
      { id: 'n_sugg', type: 'suggestion', branchId: 'br_main', phaseIndex: 2, phaseName: 's',
        position: { x: 0, y: 0 }, size: { width: 1, height: 1 }, state: 'success', data: {} },
      { id: 'n_3d', type: '3d', branchId: 'br_main', phaseIndex: 3, phaseName: '3d',
        position: { x: 0, y: 0 }, size: { width: 1, height: 1 }, state: 'success', data: {} },
    ],
    links: [
      { id: 'l1', source: 'n_script', target: 'n_sb', branchId: 'br_main', dataType: 'text' },
      { id: 'l2', source: 'n_sb', target: 'n_video', branchId: 'br_main', dataType: 'output' },
      { id: 'l3', source: 'n_sb', target: 'n_audio', branchId: 'br_main', dataType: 'audio' },
      { id: 'l4', source: 'n_role', target: 'n_video', branchId: 'br_main', dataType: 'image', isExplore: true },
      { id: 'l5', source: 'n_cand_a', target: 'n_audio', branchId: 'br_main', dataType: 'video', isInactive: true },
    ],
    branches: [
      {
        id: 'br_main', label: '主线', parentId: null, parentNodeId: null, status: 'active',
        forkReason: '', createdAt: '2026-06-01T00:00:00.000Z', updatedAt: 1748733600000,
        metadata: { note: 'x' },
      },
    ],
    variantGroups: [
      {
        id: 'vg_backend_1', phaseIndex: 4, branchId: 'br_main',
        variantNodeIds: ['n_cand_a', 'n_cand_b'], winnerNodeId: 'n_cand_a', selectMode: 'multi',
      },
    ],
  }
}

// ─── 1. 合成 payload → 适配 → zod 过 ───

describe('adaptV2Graph：_recon V2 结构合成 payload', () => {
  const { graph, warnings, rawDataByNodeId, phaseCatalog } = adaptV2Graph(syntheticBackendV2())

  it('产出过包内 zod', () => {
    const result = validateFlowGraphV3(graph)
    expect(result.ok).toBe(true)
  })

  it('引用完整性 0 issue', () => {
    expect(checkReferentialIntegrity(graph)).toEqual([])
  })

  it('meta 时间戳 ISO string → number(ms)，version 升 3', () => {
    expect(graph.meta.version).toBe('3')
    expect(graph.meta.createdAt).toBe(Date.parse('2026-06-01T00:00:00.000Z'))
    expect(graph.meta.updatedAt).toBe(Date.parse('2026-06-01T01:00:00.000Z'))
    expect(graph.meta.viewport).toEqual({ x: 10, y: 20, zoom: 0.8 })
  })

  it('NodeState 裁定：cached→success 且非 stale；skipped→failed；idle→pending', () => {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]))
    const video = byId.get('n_video')
    expect(video?.state).toBe('success')
    expect(video?.kind === 'asset' && video.stale).toBe(null)
    expect(byId.get('n_audio')?.state).toBe('failed')
    expect(byId.get('n_role')?.state).toBe('pending')
  })

  it('zone/phase/suggestion/3d 跳过 + warning', () => {
    const ids = new Set(graph.nodes.map((n) => n.id))
    for (const dropped of ['n_zone', 'n_phase', 'n_sugg', 'n_3d']) {
      expect(ids.has(dropped)).toBe(false)
    }
    expect(warnings.some((w) => w.includes('n_zone'))).toBe(true)
    expect(warnings.some((w) => w.includes('n_3d'))).toBe(true)
  })

  it('叙事线 timeline 不私建字段 → warnings', () => {
    expect(warnings.some((w) => w.includes('timeline') && w.includes('n_sb'))).toBe(true)
    const sb = graph.nodes.find((n) => n.id === 'n_sb')
    expect(sb && sb.kind === 'asset' && !('timeline' in sb.meta)).toBe(true)
  })

  it('后端 variantGroups → VariantGroupV3（winner/deprecated/selectMode 保留）', () => {
    expect(graph.variantGroups).toHaveLength(1)
    const g = graph.variantGroups[0]!
    expect(g.variantNodeIds.sort()).toEqual(['n_cand_a', 'n_cand_b'])
    expect(g.winnerNodeId).toBe('n_cand_a')
    expect(g.selectMode).toBe('multi') // 后端 multi 透传（migrate 默认 single，适配层后处理）
    const byId = new Map(graph.nodes.map((n) => [n.id, n]))
    const a = byId.get('n_cand_a')
    const b = byId.get('n_cand_b')
    expect(a?.kind === 'asset' && a.curation).toBe('selected')
    expect(b?.kind === 'asset' && b.curation).toBe('deprecated')
    // 非 winner 下游边 isInactive
    const l5 = graph.links.find((l) => l.source === 'n_cand_b')
    if (l5) expect(l5.isInactive).toBe(true)
    // sourceEventId 指向合成事件（P12 SSOT）
    expect(graph.nodes.some((n) => n.id === g.sourceEventId && n.kind === 'event')).toBe(true)
  })

  it('每资产 P2 闭环：均有产出事件 + output 边', () => {
    const assetIds = graph.nodes.filter((n) => n.kind === 'asset').map((n) => n.id)
    for (const id of assetIds) {
      const out = graph.links.find((l) => l.role === 'output' && l.target === id)
      expect(out, `资产 ${id} 缺 output 边`).toBeTruthy()
      const evt = graph.nodes.find((n) => n.id === out!.source)
      expect(evt?.kind).toBe('event')
    }
  })

  it('分支字段收敛（label→name，时间戳 ms）', () => {
    expect(graph.branches).toHaveLength(1)
    expect(graph.branches[0]).toMatchObject({ id: 'br_main', name: '主线' })
    expect(typeof (graph.branches[0] as { createdAt?: number }).createdAt).toBe('number')
  })

  it('rawDataByNodeId 穿透 migrate 白名单外字段（卡片/详情面板消费）', () => {
    // video 节点的配方字段（migrate 进 params）+ 描述字段都应在原始袋里
    const videoRaw = rawDataByNodeId.get('n_video')
    expect(videoRaw).toBeTruthy()
    expect(videoRaw).toMatchObject({ shotId: 'shot-001', durationS: 4, seed: 88421, engine: 'wan2.2-i2v' })
    // script 节点富字段（hookType/hookIntensity 在 V3 meta 白名单内，但仍穿透原始袋）
    const scriptRaw = rawDataByNodeId.get('n_script')
    expect(scriptRaw).toMatchObject({ hookType: '悬念', hookIntensity: 0.8 })
    // 被丢弃的 zone 节点不进 rawDataByNodeId（无 V3 实体）
    expect(rawDataByNodeId.has('n_zone')).toBe(false)
  })

  it('phaseCatalog：zone 阶段目录提取 + 资产/超集阶段补全，zone 名胜出', () => {
    const indices = phaseCatalog.map((c) => c.index)
    // 资产阶段 0/1/2/4/5 + zone 阶段 2 + 被丢弃超集节点(3d→3/suggestion→2)的阶段 → 合并去重升序
    expect(indices).toEqual([0, 1, 2, 3, 4, 5])
    // index 2 同时来自 zone（phaseName 'z'）/ phase('p') / 资产 n_sb('storyboard') / suggestion('s') → zone 胜
    const p2 = phaseCatalog.find((c) => c.index === 2)
    expect(p2?.name).toBe('z')
  })
})

// ─── 2. 残缺 payload 不崩 + warnings ───

describe('adaptV2Graph：Gate B 降级恢复 + audit 接纳（2026-08-19）', () => {
  it('type=script + data._original_type=video → 恢复 video stage，media.original 可播', () => {
    const { graph } = adaptV2Graph({
      meta: { projectId: 1, episodesId: 2 },
      nodes: [
        {
          // canvas-sync Gate B 降级产物（duration_sec=0 曾被 falsy 误杀）
          id: 'a-video_clips-S01_B01', type: 'script', branchId: 'br_main',
          phaseIndex: 14, phaseName: 'p11b_final_render', state: 'success',
          data: {
            label: 'S01_B01', description: 'S01_B01',
            _original_type: 'video',
            filePath: '/oss/pipeline/611772d2/S01_B01.mp4',
            shot_id: 'S01_B01', engine: 'h3', duration_sec: 0,
            resolution: '768x1344',
          },
        },
      ],
      links: [],
      branches: [],
    })
    const asset = graph.nodes.find((n) => n.id === 'a-video_clips-S01_B01')
    expect(asset).toBeDefined()
    expect(asset && asset.kind === 'asset' ? asset.stage : undefined).toBe('video')
    expect(asset && asset.kind === 'asset' ? asset.media.original : undefined)
      .toBe('/oss/pipeline/611772d2/S01_B01.mp4')
  })

  it('_original_type 仅在四种媒体类型内恢复；其它值保持 script', () => {
    const { graph } = adaptV2Graph({
      meta: { projectId: 1, episodesId: 2 },
      nodes: [
        {
          id: 'n_fake', type: 'script', branchId: 'br_main', state: 'success',
          data: { _original_type: 'hologram', description: 'x', prompt: 'y' },
        },
      ],
      links: [],
      branches: [],
    })
    const asset = graph.nodes.find((n) => n.id === 'n_fake')
    expect(asset && asset.kind === 'asset' ? asset.stage : undefined).toBe('script')
  })

  it("type='audit'（p06 物理预检等）→ script 资产保留，不再整节点丢弃", () => {
    const { graph, warnings } = adaptV2Graph({
      meta: { projectId: 1, episodesId: 2 },
      nodes: [
        {
          id: 'p06_blackboard/physics-precheck-report', type: 'audit',
          branchId: 'br_main', phaseIndex: 6, state: 'success',
          data: { description: '物理预检：3 处疑似穿帮', prompt: '报告' },
        },
      ],
      links: [],
      branches: [],
    })
    const ids = new Set(graph.nodes.map((n) => n.id))
    expect(ids.has('p06_blackboard/physics-precheck-report')).toBe(true)
    expect(warnings.some((w) => w.includes("type 'audit'"))).toBe(false)
  })
})

describe('adaptV2Graph：error→failed 状态归一（51-01 伴随修复，地雷 #2）', () => {
  it("state='error' → 'failed'，不产生未知状态 warning；success/running/pending 回归不变", () => {
    const { graph, warnings } = adaptV2Graph({
      meta: { projectId: 1, episodesId: 2 },
      nodes: [
        { id: 'n_err', type: 'video', branchId: 'br_main', state: 'error', data: {} },
        { id: 'n_ok', type: 'video', branchId: 'br_main', state: 'success', data: {} },
        { id: 'n_run', type: 'video', branchId: 'br_main', state: 'running', data: {} },
        { id: 'n_pend', type: 'video', branchId: 'br_main', state: 'pending', data: {} },
      ],
      links: [],
      branches: [],
    })
    const byId = new Map(graph.nodes.map((n) => [n.id, n]))
    // 失败节点保存-重载往返状态守恒（serializeGraphToV2 的 failed→error 逆映射）
    expect(byId.get('n_err')?.state).toBe('failed')
    // 既有映射回归
    expect(byId.get('n_ok')?.state).toBe('success')
    expect(byId.get('n_run')?.state).toBe('running')
    expect(byId.get('n_pend')?.state).toBe('pending')
    // 不再落 default→success + 未知状态 warning
    expect(warnings.some((w) => w.includes('n_err') && w.includes('无法识别'))).toBe(false)
  })
})

describe('adaptV2Graph：残缺 payload（P22 消费端宽松）', () => {
  it('完全垃圾输入 → 空图 + warnings，不 throw', () => {
    expect(() => adaptV2Graph(null)).not.toThrow()
    expect(() => adaptV2Graph(42)).not.toThrow()
    const { graph, warnings } = adaptV2Graph('garbage')
    expect(validateFlowGraphV3(graph).ok).toBe(true)
    expect(graph.nodes).toEqual([])
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('残缺节点/边逐条跳过，其余照常迁移', () => {
    const { graph, warnings } = adaptV2Graph({
      meta: { projectId: 1, episodesId: 2 },
      nodes: [
        null,
        { type: 'script' }, // 缺 id
        { id: 'ok1', type: 'script', branchId: 'br_main', state: 'success', data: { prompt: 'x' } },
        { id: 'bad_state', type: 'video', branchId: 'br_main', state: 'exploded', data: {} },
        { id: 'weird', type: 'hologram', branchId: 'br_main', data: {} },
      ],
      links: [
        { source: 'ok1' }, // 缺 target
        { id: 'l_ok', source: 'ok1', target: 'bad_state', branchId: 'br_main', dataType: 'text' },
        { id: 'l_dangling', source: 'ok1', target: 'ghost', branchId: 'br_main' },
      ],
      variantGroups: [{ id: 'vg_x', variantNodeIds: [] }, 'junk'],
      branches: [{ id: 'br_main' }], // 缺 label/name
    })
    expect(validateFlowGraphV3(graph).ok).toBe(true)
    expect(checkReferentialIntegrity(graph)).toEqual([])
    const ids = new Set(graph.nodes.map((n) => n.id))
    expect(ids.has('ok1')).toBe(true)
    expect(ids.has('bad_state')).toBe(true) // 非法 state → 默认 success + warning
    expect(ids.has('weird')).toBe(false)
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings.some((w) => w.includes('exploded'))).toBe(true)
    expect(warnings.some((w) => w.includes('hologram'))).toBe(true)
  })

  it('meta 缺 projectId/episodesId → 默认 0 + warning', () => {
    const { graph, warnings } = adaptV2Graph({ nodes: [], links: [] })
    expect(validateFlowGraphV3(graph).ok).toBe(true)
    expect(graph.meta.projectId).toBe(0)
    expect(warnings.some((w) => w.includes('projectId'))).toBe(true)
  })
})

// ─── 3. graphToViewModel 对两个 fixture ───

function assetNode(graph: FlowGraphV3, id: string) {
  return graph.nodes.find((n) => n.id === id && n.kind === 'asset')
}

describe('graphToViewModel：v3-valid fixture', () => {
  const { graph } = loadFixtureGraph('valid')
  const vm = graphToViewModel(graph)

  it('deprecated 变体无独立 RF 节点，牌堆挂 winner data', () => {
    const deprecated = graph.nodes.filter(
      (n) => n.kind === 'asset' && n.curation === 'deprecated',
    )
    expect(deprecated.length).toBeGreaterThan(0)
    const rfIds = new Set(vm.rfNodes.map((n) => n.id))
    for (const d of deprecated) expect(rfIds.has(d.id)).toBe(false)

    // winner 节点带 variantStack
    const group = graph.variantGroups.find((g) => g.selectMode !== 'locked' && g.winnerNodeId)!
    const winnerRf = vm.rfNodes.find((n) => n.id === group.winnerNodeId)!
    const stack = (winnerRf.data as { variantStack?: { groupId: string; count: number; candidates: Array<{ id: string }> } }).variantStack
    expect(stack).toBeTruthy()
    expect(stack!.groupId).toBe(group.id)
    expect(stack!.count).toBe(group.variantNodeIds.length)
    expect(stack!.candidates.some((c) => deprecated.some((d) => d.id === c.id))).toBe(true)
    // 指向 deprecated 的边随之折叠
    for (const e of vm.rfEdges) {
      expect(deprecated.some((d) => d.id === e.source || d.id === e.target)).toBe(false)
    }
  })

  it('事件节点不渲染：无 eventChip，因果边直连 asset→asset', () => {
    // 视图层不再合成 eventChip 节点
    const chips = vm.rfNodes.filter((n) => n.type === RF_TYPE_EVENT_CHIP)
    expect(chips).toHaveLength(0)
    // 因果边端点不经过任何 event 节点（asset→event→asset 已折叠为 asset→asset）
    const eventIds = new Set(graph.nodes.filter((n) => n.kind === 'event').map((n) => n.id))
    for (const e of vm.rfEdges) {
      expect(eventIds.has(e.source)).toBe(false)
      expect(eventIds.has(e.target)).toBe(false)
    }
  })

  it('sequence 边 role 进 data 通道（isInactive/isExplore 同在）', () => {
    const seq = vm.rfEdges.filter((e) => (e.data as { role: string }).role === 'sequence')
    expect(seq.length).toBeGreaterThan(0)
    for (const e of seq) {
      const d = e.data as { role: string; isInactive: boolean; branchId: string }
      expect(d.role).toBe('sequence')
      expect(typeof d.isInactive).toBe('boolean')
      expect(typeof d.branchId).toBe('string')
    }
  })

  it('位置来自 layoutFlowGraph（数值 + P9 global 锚定第 0 列）', () => {
    for (const n of vm.rfNodes) {
      expect(Number.isFinite(n.position.x)).toBe(true)
      expect(Number.isFinite(n.position.y)).toBe(true)
    }
    const globals = vm.rfNodes.filter(
      (n) => (n.data as { scope?: string }).scope === 'global',
    )
    expect(globals.length).toBeGreaterThan(0)
    for (const g of globals) expect(g.position.x).toBe(0)
  })

  it('memo：同一 graph 引用 → 同一 ViewModel 引用', () => {
    expect(getViewModel(graph)).toBe(getViewModel(graph))
  })
})

describe('graphToViewModel：v3-decompose fixture（99 节点解构集）', () => {
  const { graph } = loadFixtureGraph('decompose')
  const vm = graphToViewModel(graph)

  it('locked 组整组渲染（不折叠），sequence 边 role 在 data', () => {
    const lockedAssets = graph.nodes.filter(
      (n) => n.kind === 'asset' && n.curation === 'locked',
    )
    const rfIds = new Set(vm.rfNodes.map((n) => n.id))
    for (const a of lockedAssets) expect(rfIds.has(a.id)).toBe(true)
    // 无 deprecated → 不折叠；事件不渲染 → rfNodes = 非事件节点数
    expect(vm.rfNodes.length).toBe(graph.nodes.filter((n) => n.kind !== 'event').length)
    const seq = vm.rfEdges.filter((e) => (e.data as { role: string }).role === 'sequence')
    expect(seq.length).toBe(92) // 93 镜头 92 条 sequence 边
  })

  it('shot_decompose 事件在数据层保留，但视图层不渲染为芯片', () => {
    // 数据层：解构事件仍是图的一等实体（变体组/完整性契约依赖它）
    const evt = graph.nodes.find((n) => n.kind === 'event' && n.op === 'shot_decompose')
    expect(evt).toBeTruthy()
    // 视图层：不渲染任何 eventChip
    const chip = vm.rfNodes.find((n) => n.type === RF_TYPE_EVENT_CHIP)
    expect(chip).toBeUndefined()
  })

  it('composite 资产带 TimelineStructure 进 data', () => {
    const composite = vm.rfNodes.find(
      (n) => (n.data as { stage?: string }).stage === 'composite',
    )
    expect(composite).toBeTruthy()
    const timeline = (composite!.data as { timeline?: { shots: unknown[] } }).timeline
    expect(timeline && timeline.shots.length > 0).toBe(true)
    expect(assetNode(graph, composite!.id)).toBeTruthy()
  })
})

// ─── 4. fixtureSource 两模式加载 ───

describe('fixtureSource', () => {
  it('?fixture= 解析', () => {
    expect(getFixtureMode('?fixture=decompose')).toBe('decompose')
    expect(getFixtureMode('?projectId=7&fixture=valid&x=1')).toBe('valid')
    expect(getFixtureMode('?fixture=nope')).toBe(null)
    expect(getFixtureMode('')).toBe(null)
  })

  it('decompose / valid 两模式加载成功且过 zod', () => {
    for (const mode of ['decompose', 'valid'] as const) {
      const loaded = loadFixtureGraph(mode)
      expect(loaded.source).toBe('fixture')
      expect(loaded.fallbackUsed).toBe(false)
      expect(loaded.warnings).toEqual([])
      expect(validateFlowGraphV3(loaded.graph).ok).toBe(true)
    }
    const d = loadFixtureGraph('decompose')
    expect(d.graph.nodes.length).toBe(99)
    const v = loadFixtureGraph('valid')
    expect(v.graph.nodes.length).toBe(28)
  })

  it('resolveInitialGraph：fixture 优先 / 后端成功 / 后端失败自动 fallback', async () => {
    const { resolveInitialGraph } = await import('../fixtureSource')

    // fixture 模式绕过 loadBackend
    const fx = await resolveInitialGraph({
      fixtureMode: 'valid',
      loadBackend: () => Promise.reject(new Error('不应被调用')),
    })
    expect(fx.source).toBe('fixture')

    // 后端成功 → V2 适配
    const ok = await resolveInitialGraph({
      fixtureMode: null,
      loadBackend: () => Promise.resolve(syntheticBackendV2()),
    })
    expect(ok.source).toBe('backend')
    expect(ok.fallbackUsed).toBe(false)
    expect(validateFlowGraphV3(ok.graph).ok).toBe(true)

    // 后端不可达 → 自动 fallback decompose + fallbackUsed（toast 由调用方发）
    const down = await resolveInitialGraph({
      fixtureMode: null,
      loadBackend: () => Promise.reject(new Error('ECONNREFUSED')),
    })
    expect(down.source).toBe('fixture-fallback')
    expect(down.fallbackUsed).toBe(true)
    expect(down.graph.nodes.length).toBe(99)
    expect(validateFlowGraphV3(down.graph).ok).toBe(true)
  })
})
