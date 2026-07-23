/**
 * layout.test.ts — 宪法步骤 4 布局引擎（P7/P8/P9/P11/P12/P19）测试。
 *
 * 覆盖：
 *  - 真实解构样本（99 节点/190 边）：层数 ≤ 4；93 分镜 x 严格递增且与 shot index 完全同序；
 *    泳道归属（storyboard/voice/foley/bgm/composite）；同泳道资产无重叠（x 差 ≥ nodeW）；
 *    sequence 边两端 x 递增（P11）。
 *  - 全要素样本（v3-valid）：因果链 x 严格递增（P7）；global 资产 x=0（P9）；
 *    音频链泳道归属（P8）；deprecated 贴 winner 坐标且 stacked:true（P12）；
 *    事件芯片 x 落在输入与输出之间、y 在产出泳道（P19）。
 *  - 构造用例：因果环降级不死循环；空图/单节点；applyLayout 写回 position 且不 mutate 入参；确定性。
 */
import { describe, it, expect } from 'vitest';
import decomposeJson from '../../fixtures/v3-decompose-import.sample.json';
import validJson from '../../fixtures/v3-valid.sample.json';
import { layoutFlowGraph, applyLayout, STAGE_ORDER, type LayoutBox } from '../src/layout.js';
import type { AssetNodeV3, EventNodeV3, FlowGraphV3, FlowLinkV3 } from '../src/types.js';

const OPTS = { colW: 320, laneH: 200, nodeW: 240, gap: 80 };

const loadDecompose = (): FlowGraphV3 => JSON.parse(JSON.stringify(decomposeJson)) as FlowGraphV3;
const loadValid = (): FlowGraphV3 => JSON.parse(JSON.stringify(validJson)) as FlowGraphV3;

const laneOf = (stage: AssetNodeV3['stage']): number => STAGE_ORDER.indexOf(stage);

// ---------- 构造用例的最小节点工厂（与 stale.test.ts 同款风格） ----------
function asset(id: string, stage: AssetNodeV3['stage'] = 'video', scope: AssetNodeV3['scope'] = 'episode'): AssetNodeV3 {
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
    scope,
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
function graph(nodes: FlowGraphV3['nodes'], links: FlowLinkV3[]): FlowGraphV3 {
  return {
    meta: { version: '3', projectId: 1, episodesId: 1, createdAt: 0, updatedAt: 0 },
    nodes,
    links,
    branches: [],
    variantGroups: [],
  };
}

describe('真实解构样本（99 节点 / 190 边）', () => {
  const g = loadDecompose();
  const boxes = layoutFlowGraph(g, OPTS);
  const storyboards = g.nodes.filter((n): n is AssetNodeV3 => n.kind === 'asset' && n.stage === 'storyboard');

  it('拓扑层数 ≤ 4（P11：sequence 不拉层）', () => {
    const layerCount = Math.max(...[...boxes.values()].map((b) => b.layer)) + 1;
    expect(layerCount).toBeLessThanOrEqual(4);
  });

  it('93 个 storyboard 资产 x 严格递增，顺序与 shot index 完全一致（P11 链序）', () => {
    expect(storyboards).toHaveLength(93);
    const byX = storyboards
      .slice()
      .sort((a, b) => boxes.get(a.id)!.x - boxes.get(b.id)!.x);
    for (let i = 0; i < byX.length; i++) {
      const meta = byX[i]!.meta as { shotId: string };
      expect(Number(meta.shotId)).toBe(i + 1);
      if (i > 0) expect(boxes.get(byX[i]!.id)!.x).toBeGreaterThan(boxes.get(byX[i - 1]!.id)!.x);
    }
  });

  it('93 分镜全部落在 storyboard 泳道且 y 相同（泳道内不换行，P8）', () => {
    for (const n of storyboards) {
      const b = boxes.get(n.id)!;
      expect(b.lane).toBe(laneOf('storyboard'));
      expect(b.y).toBe(laneOf('storyboard') * OPTS.laneH);
    }
  });

  it('voice/foley/bgm stem 各归其泳道，成片在 composite 泳道（P8）', () => {
    expect(boxes.get('asset_stem_vocals')!.lane).toBe(laneOf('voice'));
    expect(boxes.get('asset_stem_other')!.lane).toBe(laneOf('foley'));
    expect(boxes.get('asset_stem_drums')!.lane).toBe(laneOf('bgm'));
    expect(boxes.get('asset_stem_bass')!.lane).toBe(laneOf('bgm'));
    expect(boxes.get('asset_ext_film_01')!.lane).toBe(laneOf('composite'));
  });

  it('同泳道资产无重叠：按 x 排序后相邻差 ≥ nodeW', () => {
    const assets = g.nodes.filter((n): n is AssetNodeV3 => n.kind === 'asset');
    const byLane = new Map<number, AssetNodeV3[]>();
    for (const n of assets) {
      const lane = boxes.get(n.id)!.lane;
      byLane.set(lane, [...(byLane.get(lane) ?? []), n]);
    }
    for (const members of byLane.values()) {
      const sorted = members.slice().sort((a, b) => boxes.get(a.id)!.x - boxes.get(b.id)!.x);
      for (let i = 1; i < sorted.length; i++) {
        const prev = boxes.get(sorted[i - 1]!.id)!;
        const cur = boxes.get(sorted[i]!.id)!;
        if (cur.y === prev.y) expect(cur.x - prev.x).toBeGreaterThanOrEqual(OPTS.nodeW);
      }
    }
  });

  it('sequence 边两端 x 严格递增（P11 时间序可读）', () => {
    const seqs = g.links.filter((l) => l.role === 'sequence');
    expect(seqs).toHaveLength(92);
    for (const l of seqs) {
      expect(boxes.get(l.target)!.x).toBeGreaterThan(boxes.get(l.source)!.x);
    }
  });

  it('事件芯片：y = 首个 output 边目标泳道，x 在半列（P19）', () => {
    const chip = boxes.get('evt_decompose_01')!;
    expect(chip.lane).toBe(laneOf('storyboard')); // 首个 output 边 → asset_decomp_shot_001
    // x = (max(压平资产前驱槽位)+0.5)*stride：前驱 asset_ext_film_01，芯片落在其间的边上
    expect(chip.x).toBeGreaterThan(boxes.get('asset_ext_film_01')!.x);
    expect(chip.x).toBeLessThan(boxes.get('asset_decomp_shot_001')!.x);
  });
});

describe('全要素样本（v3-valid，28 节点）', () => {
  const g = loadValid();
  const boxes = layoutFlowGraph(g, OPTS);

  it('script→storyboard→keyframe→video 因果链 x 严格递增（P7 单调性）', () => {
    const xs = ['asset_script_01', 'asset_sb_01', 'asset_kf_01', 'asset_video_01'].map(
      (id) => boxes.get(id)!.x,
    );
    for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeGreaterThan(xs[i - 1]!);
  });

  it('global 角色资产钉死 x=0、第 0 泳道（P9）', () => {
    const b = boxes.get('asset_role_01')!;
    expect(b.x).toBe(0);
    expect(b.lane).toBe(laneOf('global'));
  });

  it('voice/foley/bgm→mix→composite 链泳道归属正确（P8）', () => {
    expect(boxes.get('asset_voice_01')!.lane).toBe(laneOf('voice'));
    expect(boxes.get('asset_foley_01')!.lane).toBe(laneOf('foley'));
    expect(boxes.get('asset_bgm_01')!.lane).toBe(laneOf('bgm'));
    expect(boxes.get('asset_mix_01')!.lane).toBe(laneOf('mix'));
    expect(boxes.get('asset_composite_01')!.lane).toBe(laneOf('composite'));
    // y = 泳道带基址
    expect(boxes.get('asset_mix_01')!.y).toBe(laneOf('mix') * OPTS.laneH);
    // 音频因果链 x 单调：voice/foley/bgm 都严在 mix 之左，mix 严在 composite 之左
    for (const id of ['asset_voice_01', 'asset_foley_01', 'asset_bgm_01']) {
      expect(boxes.get(id)!.x).toBeLessThan(boxes.get('asset_mix_01')!.x);
    }
    expect(boxes.get('asset_mix_01')!.x).toBeLessThan(boxes.get('asset_composite_01')!.x);
  });

  it('deprecated 变体与 winner 同坐标且 stacked:true，不占槽位（P12）', () => {
    const winner = boxes.get('asset_video_01')!;
    expect(winner.stacked).toBeUndefined();
    // winner 独占 video 泳道槽位：x 对齐槽位网格，且严格在因果前驱 keyframe 之右（P7）
    // （槽位单调分配后 x 由 slot * stride 决定，不再等于 layer * colW，只断言序与网格、不写死绝对值）
    expect(winner.x % (OPTS.nodeW + OPTS.gap)).toBe(0);
    expect(winner.x).toBeGreaterThan(boxes.get('asset_kf_01')!.x);
    for (const id of ['asset_video_02', 'asset_video_03']) {
      const b = boxes.get(id)!;
      expect(b.stacked).toBe(true);
      expect({ x: b.x, y: b.y, layer: b.layer, lane: b.lane }).toEqual({
        x: winner.x,
        y: winner.y,
        layer: winner.layer,
        lane: winner.lane,
      });
    }
  });

  it('selectMode:locked 解构集整组正常布局（不折叠）', () => {
    for (const id of ['asset_d_video_01', 'asset_d_video_02', 'asset_d_voice_01']) {
      expect(boxes.get(id)!.stacked).toBeUndefined();
    }
    // sequence 链：d_video_01 → d_video_02 x 递增
    expect(boxes.get('asset_d_video_02')!.x).toBeGreaterThan(boxes.get('asset_d_video_01')!.x);
  });

  it('事件芯片 x 落在输入与输出之间、y 在产出泳道（P19）', () => {
    // evt_i2v：输入 asset_kf_01 / asset_sb_01，输出 asset_video_01（video 泳道）
    const i2v = boxes.get('evt_i2v')!;
    const maxInX = Math.max(boxes.get('asset_kf_01')!.x, boxes.get('asset_sb_01')!.x);
    expect(i2v.x).toBeGreaterThan(maxInX);
    expect(i2v.x).toBeLessThan(boxes.get('asset_video_01')!.x);
    expect(i2v.y).toBe(laneOf('video') * OPTS.laneH);

    // evt_mix：三路音频输入 → asset_mix_01（mix 泳道）
    const mix = boxes.get('evt_mix')!;
    const maxAudioX = Math.max(
      boxes.get('asset_voice_01')!.x,
      boxes.get('asset_foley_01')!.x,
      boxes.get('asset_bgm_01')!.x,
    );
    expect(mix.x).toBeGreaterThan(maxAudioX);
    expect(mix.x).toBeLessThan(boxes.get('asset_mix_01')!.x);
    expect(mix.y).toBe(laneOf('mix') * OPTS.laneH);

    // evt_import_role：只产出 global 资产的种子事件，钉在第 0 列左侧入种口，y 随产出泳道
    const seed = boxes.get('evt_import_role')!;
    expect(seed.x).toBeLessThan(0);
    expect(seed.y).toBe(laneOf('global') * OPTS.laneH);
  });
});

describe('构造用例', () => {
  it('因果环输入：降级为按 id 序分层，不死循环', () => {
    const g = graph(
      [asset('a'), asset('b'), evt('e1')],
      [link('l1', 'a', 'b', 'reference'), link('l2', 'b', 'a', 'reference'), link('l3', 'e1', 'a', 'output')],
    );
    const boxes = layoutFlowGraph(g, OPTS);
    expect(boxes.size).toBe(3);
    // 成环节点 a/b 按 id 序追加层：a 在 b 左
    expect(boxes.get('a')!.layer).toBeLessThan(boxes.get('b')!.layer);
    expect(Number.isFinite(boxes.get('a')!.x)).toBe(true);
    expect(Number.isFinite(boxes.get('b')!.x)).toBe(true);
  });

  it('空图 / 单节点不 crash', () => {
    expect(layoutFlowGraph(graph([], []), OPTS).size).toBe(0);
    const single = layoutFlowGraph(graph([asset('only', 'video')], []), OPTS);
    const b = single.get('only')!;
    expect(b).toEqual({ x: 0, y: laneOf('video') * OPTS.laneH, layer: 0, lane: laneOf('video') });
  });

  it('多个 global 资产在第 0 列内沿 y 堆叠（P9）', () => {
    const g = graph(
      [asset('ga2', 'global', 'global'), asset('ga1', 'global', 'global'), asset('v1', 'video')],
      [],
    );
    const boxes = layoutFlowGraph(g, OPTS);
    // 按 id 序：ga1 在上、ga2 在下（节点高 160 + gap 80），都不出 global 泳道带、不抢其他泳道
    expect(boxes.get('ga1')!).toMatchObject({ x: 0, y: 0, lane: laneOf('global') });
    expect(boxes.get('ga2')!.x).toBe(0);
    expect(boxes.get('ga2')!.y).toBe(160 + OPTS.gap);
  });

  it('applyLayout 写回 position 且不 mutate 入参', () => {
    const g = loadValid();
    const snapshot = JSON.stringify(g);
    const laid = applyLayout(g, OPTS);
    expect(JSON.stringify(g)).toBe(snapshot); // 入参未被 mutate
    expect(laid).not.toBe(g);
    const boxes = layoutFlowGraph(g, OPTS);
    for (const n of laid.nodes) {
      const b = boxes.get(n.id)!;
      expect(n.position).toEqual({ x: b.x, y: b.y });
    }
  });

  it('确定性：两次调用结果全等（含默认参数）', () => {
    const g = loadDecompose();
    const a = layoutFlowGraph(g);
    const b = layoutFlowGraph(g);
    expect([...a.entries()]).toEqual([...b.entries()]);
    const c = layoutFlowGraph(g, OPTS);
    const d = layoutFlowGraph(g, OPTS);
    expect([...c.entries()]).toEqual([...d.entries()]);
  });

  it('LayoutBox 覆盖全部节点', () => {
    for (const sample of [loadDecompose(), loadValid()]) {
      const boxes: Map<string, LayoutBox> = layoutFlowGraph(sample, OPTS);
      expect(boxes.size).toBe(sample.nodes.length);
      for (const n of sample.nodes) expect(boxes.has(n.id)).toBe(true);
    }
  });
});

describe('槽位单调分配（槽位碰撞修复回归）', () => {
  /** 同泳道资产两两不重叠通用断言。 */
  const assertLaneNoOverlap = (boxes: Map<string, LayoutBox>, ids: string[]): void => {
    const xs = ids.map((id) => boxes.get(id)!.x).sort((p, q) => p - q);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(OPTS.nodeW);
  };

  it('最小复现：s0→a0/a1（reference），a0→a2（reference），a1 与 a2 不撞列且 a0.x < a2.x', () => {
    const g = graph(
      [asset('s0', 'script'), asset('a0', 'storyboard'), asset('a1', 'storyboard'), asset('a2', 'storyboard')],
      [
        link('l1', 's0', 'a0', 'reference'),
        link('l2', 's0', 'a1', 'reference'),
        link('l3', 'a0', 'a2', 'reference'),
      ],
    );
    const boxes = layoutFlowGraph(g, OPTS);
    // 修复前：a1(L1,slot1) 与 a2(L2,slot0) 同为 (640, 400)，dx=0 完全遮挡
    expect({ x: boxes.get('a1')!.x, y: boxes.get('a1')!.y }).not.toEqual({
      x: boxes.get('a2')!.x,
      y: boxes.get('a2')!.y,
    });
    expect(boxes.get('a0')!.x).toBeLessThan(boxes.get('a2')!.x); // P7 单调保持
    expect(boxes.get('s0')!.x).toBeLessThan(boxes.get('a0')!.x);
    expect(boxes.get('s0')!.x).toBeLessThan(boxes.get('a1')!.x);
    assertLaneNoOverlap(boxes, ['a0', 'a1', 'a2']);
  });

  it('撞 L+1 构型：前层 3 槽 + 次层同泳道 2 节点，无碰撞且单调', () => {
    // 旧公式下 b1(L1,slot1)=c0(L2,slot0)=640、b2(L1,slot2)=c1(L2,slot1)=960 两两撞列
    const g = graph(
      [
        asset('s0', 'script'),
        asset('b0', 'storyboard'),
        asset('b1', 'storyboard'),
        asset('b2', 'storyboard'),
        asset('c0', 'storyboard'),
        asset('c1', 'storyboard'),
      ],
      [
        link('l1', 's0', 'b0', 'reference'),
        link('l2', 's0', 'b1', 'reference'),
        link('l3', 's0', 'b2', 'reference'),
        link('l4', 'b0', 'c0', 'reference'),
        link('l5', 'b1', 'c1', 'reference'),
      ],
    );
    const boxes = layoutFlowGraph(g, OPTS);
    assertLaneNoOverlap(boxes, ['b0', 'b1', 'b2', 'c0', 'c1']);
    expect(boxes.get('b0')!.x).toBeLessThan(boxes.get('c0')!.x); // P7 单调保持
    expect(boxes.get('b1')!.x).toBeLessThan(boxes.get('c1')!.x);
    expect(boxes.get('b2')!.x).toBeLessThan(boxes.get('c0')!.x); // 前层 3 槽全部在次层之左
  });

  it('撞 L+2 构型：前层 3 槽 + 链式再下两层，无碰撞且单调', () => {
    // 旧公式下 b1(L1,slot1)=c0(L2,slot0)=640（撞 L+1）、b2(L1,slot2)=d0(L3,slot0)=960（撞 L+2）
    const g = graph(
      [
        asset('s0', 'script'),
        asset('b0', 'storyboard'),
        asset('b1', 'storyboard'),
        asset('b2', 'storyboard'),
        asset('c0', 'storyboard'),
        asset('d0', 'storyboard'),
      ],
      [
        link('l1', 's0', 'b0', 'reference'),
        link('l2', 's0', 'b1', 'reference'),
        link('l3', 's0', 'b2', 'reference'),
        link('l4', 'b0', 'c0', 'reference'),
        link('l5', 'c0', 'd0', 'reference'),
      ],
    );
    const boxes = layoutFlowGraph(g, OPTS);
    assertLaneNoOverlap(boxes, ['b0', 'b1', 'b2', 'c0', 'd0']);
    expect(boxes.get('b0')!.x).toBeLessThan(boxes.get('c0')!.x);
    expect(boxes.get('c0')!.x).toBeLessThan(boxes.get('d0')!.x);
    expect(boxes.get('b2')!.x).toBeLessThan(boxes.get('d0')!.x);
  });

  it('跨泳道扇出后收敛（diamond 构型）：无碰撞且单调', () => {
    const g = graph(
      [
        asset('s0', 'script'),
        asset('kf', 'keyframe'),
        asset('sb', 'storyboard'),
        asset('vid', 'video'),
        asset('w', 'video'), // 无因果边：层 0，与 vid 同泳道跨层，检验槽位不撞
      ],
      [
        link('l1', 's0', 'kf', 'reference'),
        link('l2', 's0', 'sb', 'reference'),
        link('l3', 'kf', 'vid', 'reference'),
        link('l4', 'sb', 'vid', 'reference'),
      ],
    );
    const boxes = layoutFlowGraph(g, OPTS);
    expect(boxes.get('s0')!.x).toBeLessThan(boxes.get('kf')!.x);
    expect(boxes.get('s0')!.x).toBeLessThan(boxes.get('sb')!.x);
    expect(boxes.get('kf')!.x).toBeLessThan(boxes.get('vid')!.x); // 收敛点严格在两路前驱之右
    expect(boxes.get('sb')!.x).toBeLessThan(boxes.get('vid')!.x);
    assertLaneNoOverlap(boxes, ['w', 'vid']);
  });

  it('通用性质（两份 fixture 全图）：同泳道无重叠、因果单调 source.x < target.x', () => {
    for (const sample of [loadDecompose(), loadValid()]) {
      const bx: Map<string, LayoutBox> = layoutFlowGraph(sample, OPTS);
      const nodeById = new Map(sample.nodes.map((n) => [n.id, n]));
      // 同泳道无重叠：global 第 0 列沿 y 堆叠（P9）与 deprecated 牌堆贴 winner（P12）属设计例外
      const assets = sample.nodes.filter(
        (n): n is AssetNodeV3 => n.kind === 'asset' && n.scope !== 'global' && bx.get(n.id)!.stacked !== true,
      );
      const byLane = new Map<number, AssetNodeV3[]>();
      for (const n of assets) {
        const lane = bx.get(n.id)!.lane;
        byLane.set(lane, [...(byLane.get(lane) ?? []), n]);
      }
      for (const members of byLane.values()) {
        assertLaneNoOverlap(bx, members.map((n) => n.id));
      }
      // 因果单调：source.x < target.x（global 源头钉第 0 列、deprecated 牌堆、芯片间边为例外）
      for (const l of sample.links) {
        if (l.role === 'sequence' || l.isInactive === true) continue;
        const sn = nodeById.get(l.source)!;
        const tn = nodeById.get(l.target)!;
        if (sn.kind === 'asset' && (sn as AssetNodeV3).scope === 'global') continue; // P9
        if (bx.get(l.source)!.stacked === true || bx.get(l.target)!.stacked === true) continue; // P12
        if (sn.kind === 'event' && tn.kind === 'event') continue; // 芯片间边：半列+子槽位，非全宽节点
        expect(bx.get(l.target)!.x).toBeGreaterThan(bx.get(l.source)!.x);
      }
    }
  });
});
