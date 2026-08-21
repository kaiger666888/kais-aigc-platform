/**
 * stale.test.ts — P13 脏传播：级联、sequence 不传播、locked 终点、纯函数。
 */
import { describe, it, expect } from 'vitest';
import { getDownstreamIds, markStaleDownstream } from '../src/stale.js';
import type {
  AssetNodeV3,
  EventNodeV3,
  FlowGraphV3,
  FlowLinkV3,
} from '../src/types.js';

// 链：a --(in)--> e1 --output--> b --(in)--> e2 --output--> c --(in)--> e3 --output--> d
// 另：b --sequence--> b2（时间序边）；c 下游 locked 资产锁死传播
function asset(id: string, stage: AssetNodeV3['stage'] = 'video'): AssetNodeV3 {
  return {
    id,
    branchId: 'br_main',
    phaseIndex: 0,
    phaseName: stage,
    position: { x: 0, y: 0 },
    size: { width: 240, height: 160 },
    state: 'success',
    kind: 'asset',
    stage,
    modality: 'video',
    scope: 'episode',
    media: { original: null, proxy: null, thumbnail: null, waveform: null },
    meta: { stage: 'video', shotId: 'shot-x' },
    curation: 'candidate',
    stale: null,
  };
}
function evt(id: string): EventNodeV3 {
  return {
    id,
    branchId: 'br_main',
    phaseIndex: 0,
    phaseName: 'video',
    position: { x: 0, y: 0 },
    size: { width: 240, height: 160 },
    state: 'success',
    kind: 'event',
    op: 'wan22_t2v',
    params: {},
    executor: 'gpu0',
  };
}
function link(id: string, source: string, target: string, role: FlowLinkV3['role']): FlowLinkV3 {
  return { id, source, target, branchId: 'br_main', role };
}

function buildGraph(): FlowGraphV3 {
  return {
    meta: { version: '3', projectId: 1, episodesId: 1, createdAt: 0, updatedAt: 0 },
    nodes: [
      asset('a'),
      evt('e1'),
      asset('b'),
      evt('e2'),
      asset('c'),
      evt('e3'),
      asset('d'),
      asset('b2'),
    ],
    links: [
      link('l1', 'a', 'e1', 'prompt_ref'),
      link('l2', 'e1', 'b', 'output'),
      link('l3', 'b', 'e2', 'keyframe'),
      link('l4', 'e2', 'c', 'output'),
      link('l5', 'c', 'e3', 'reference'),
      link('l6', 'e3', 'd', 'output'),
      link('l7', 'b', 'b2', 'sequence'), // P11：时间序边
    ],
    branches: [{ id: 'br_main', name: 'main' }],
    variantGroups: [],
  };
}
const staleOf = (g: FlowGraphV3, id: string) =>
  (g.nodes.find((n) => n.id === id) as AssetNodeV3).stale;

describe('markStaleDownstream（P13）', () => {
  it('沿因果边级联深度 ≥3，trigger 记录链条起点', () => {
    const g = markStaleDownstream(buildGraph(), ['a'], 1000);
    for (const id of ['b', 'c', 'd']) {
      expect(staleOf(g, id), `${id} 应标脏`).not.toBeNull();
      expect(staleOf(g, id)).toEqual({ since: 1000, triggerAssetId: 'a', triggerEventId: 'e1' });
    }
  });

  it('changed 资产自身不标脏（它是新事实的起点）', () => {
    const g = markStaleDownstream(buildGraph(), ['a'], 1000);
    expect(staleOf(g, 'a')).toBeNull();
  });

  it("role:'sequence' 边不参与传播", () => {
    const g = markStaleDownstream(buildGraph(), ['a'], 1000);
    expect(staleOf(g, 'b')).not.toBeNull(); // b 脏
    expect(staleOf(g, 'b2')).toBeNull(); // sequence 邻居不脏
  });

  it("curation:'locked' 资产是传播终点（§13：不标脏、不向下传）", () => {
    const g0 = buildGraph();
    (g0.nodes.find((n) => n.id === 'c') as AssetNodeV3).curation = 'locked';
    const g = markStaleDownstream(g0, ['a'], 1000);
    expect(staleOf(g, 'b')).not.toBeNull();
    expect(staleOf(g, 'c')).toBeNull(); // locked 自身不标脏
    expect(staleOf(g, 'd')).toBeNull(); // 不再向下传
  });

  it('已 stale 的节点不重复覆盖（保留最早 since），但仍向下传播', () => {
    const g0 = buildGraph();
    (g0.nodes.find((n) => n.id === 'b') as AssetNodeV3).stale = {
      since: 500,
      triggerAssetId: 'earlier-x',
      triggerEventId: 'earlier-evt',
    };
    const g = markStaleDownstream(g0, ['a'], 1000);
    expect(staleOf(g, 'b')).toEqual({
      since: 500,
      triggerAssetId: 'earlier-x',
      triggerEventId: 'earlier-evt',
    });
    expect(staleOf(g, 'c')).toEqual({ since: 1000, triggerAssetId: 'a', triggerEventId: 'e1' });
  });

  it('changed 资产无任何下游时输出与输入语义等价', () => {
    const g0 = buildGraph();
    const g = markStaleDownstream(g0, ['d'], 1000);
    expect(staleOf(g, 'd')).toBeNull();
    expect(staleOf(g, 'b')).toBeNull();
  });

  it('纯函数：不 mutate 入参', () => {
    const g0 = buildGraph();
    const before = JSON.stringify(g0);
    markStaleDownstream(g0, ['a'], 1000);
    expect(JSON.stringify(g0)).toBe(before);
  });

  it('isInactive 置灰边不参与传播（F2，P12×P13：选定版接管下游）', () => {
    const g0 = buildGraph();
    // dep = deprecated 变体，经置灰边喂给 e2；sel = selected 变体，经激活边喂给 e2
    g0.nodes.push(asset('dep'), asset('sel'));
    g0.links.push(
      { id: 'l8', source: 'dep', target: 'e2', branchId: 'br_main', role: 'keyframe', isInactive: true },
      { id: 'l9', source: 'sel', target: 'e2', branchId: 'br_main', role: 'keyframe' },
    );
    const g1 = markStaleDownstream(g0, ['dep'], 1000);
    expect(staleOf(g1, 'c')).toBeNull(); // 改 deprecated 变体：下游不脏
    expect(staleOf(g1, 'd')).toBeNull();
    const g2 = markStaleDownstream(g0, ['sel'], 1000);
    expect(staleOf(g2, 'c')).toEqual({ since: 1000, triggerAssetId: 'sel', triggerEventId: 'e2' }); // 改 selected：正常脏
    expect(staleOf(g2, 'd')).not.toBeNull();
  });

  it('有向环（非法输入）防御性终止：changed 资产不自标脏，环上其余正常标脏（F6）', () => {
    // 环：a --in--> e1 --output--> b --in--> e2 --output--> a（回指 changed 资产）
    const g0: FlowGraphV3 = {
      meta: { version: '3', projectId: 1, episodesId: 1, createdAt: 0, updatedAt: 0 },
      nodes: [asset('a'), evt('e1'), asset('b'), evt('e2')],
      links: [
        link('c1', 'a', 'e1', 'prompt_ref'),
        link('c2', 'e1', 'b', 'output'),
        link('c3', 'b', 'e2', 'keyframe'),
        link('c4', 'e2', 'a', 'output'), // 环回指 changed 资产 a
      ],
      branches: [{ id: 'br_main', name: 'main' }],
      variantGroups: [],
    };
    const g = markStaleDownstream(g0, ['a'], 1000); // 必须正常终止（不无限循环）
    expect(staleOf(g, 'a')).toBeNull(); // changed 资产是新事实起点，环上回指也不自标脏
    expect(staleOf(g, 'b')).toEqual({ since: 1000, triggerAssetId: 'a', triggerEventId: 'e1' });
  });
});

// ─── getDownstreamIds（52-01 REGEN-03 重跑链下游计算引擎）────
// 语义：从 nodeId（资产/事件皆可）沿因果边 BFS，只收**资产 id**；
// sequence / isInactive 边排除（buildCausalIndex 单点保证）；locked 资产
// 为终点（自身计入结果、不再向下延伸——裁定见实现注释）；visited 防环；
// nodeId 不存在返回 [] 不 throw。
describe('getDownstreamIds（52-01）', () => {
  it('线性链：从 A 得下游资产 [b, c, d]（事件 id 不进结果）', () => {
    const ids = getDownstreamIds(buildGraph(), 'a');
    expect(ids).toEqual(['b', 'c', 'd']);
    expect(ids).not.toContain('e1');
    expect(ids).not.toContain('a'); // 起点自身不入结果
  });

  it("role:'sequence' 边不传播（sequence 相连的下游不进结果）", () => {
    const ids = getDownstreamIds(buildGraph(), 'a');
    expect(ids).toContain('b');
    expect(ids).not.toContain('b2'); // b --sequence--> b2 时间序边排除
  });

  it('isInactive:true 置灰边不传播', () => {
    const g0 = buildGraph();
    g0.nodes.push(asset('dep'), asset('sel'));
    g0.links.push(
      { id: 'l8', source: 'dep', target: 'e2', branchId: 'br_main', role: 'keyframe', isInactive: true },
      { id: 'l9', source: 'sel', target: 'e2', branchId: 'br_main', role: 'keyframe' },
    );
    expect(getDownstreamIds(g0, 'dep')).toEqual([]); // 置灰边不延伸
    expect(getDownstreamIds(g0, 'sel')).toEqual(['c', 'd']); // 激活边正常
  });

  it("curation:'locked' 资产为终点：自身计入结果、不再向下延伸", () => {
    const g0 = buildGraph();
    (g0.nodes.find((n) => n.id === 'c') as AssetNodeV3).curation = 'locked';
    const ids = getDownstreamIds(g0, 'a');
    expect(ids).toContain('b');
    expect(ids).toContain('c'); // locked 自身仍是下游资产 → 计入
    expect(ids).not.toContain('d'); // 不越过 locked 延伸
  });

  it('有向环防御：不死循环、结果集去重', () => {
    // 环：a --in--> e1 --output--> b --in--> e2 --output--> a（回指起点）
    const g0: FlowGraphV3 = {
      meta: { version: '3', projectId: 1, episodesId: 1, createdAt: 0, updatedAt: 0 },
      nodes: [asset('a'), evt('e1'), asset('b'), evt('e2')],
      links: [
        link('c1', 'a', 'e1', 'prompt_ref'),
        link('c2', 'e1', 'b', 'output'),
        link('c3', 'b', 'e2', 'keyframe'),
        link('c4', 'e2', 'a', 'output'),
      ],
      branches: [{ id: 'br_main', name: 'main' }],
      variantGroups: [],
    };
    const ids = getDownstreamIds(g0, 'a'); // 必须正常终止
    expect(ids).toEqual(['b']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('事件节点 id 作起点：返回其产出资产的下游链', () => {
    const ids = getDownstreamIds(buildGraph(), 'e1');
    expect(ids).toEqual(['b', 'c', 'd']);
  });

  it('nodeId 不存在返回 []（不 throw）', () => {
    expect(() => getDownstreamIds(buildGraph(), 'ghost')).not.toThrow();
    expect(getDownstreamIds(buildGraph(), 'ghost')).toEqual([]);
  });
});
