/**
 * layout.ts — 宪法步骤 4：布局引擎（P7/P8/P9/P11/P12/P19 落地）。
 *
 * 空间语义（宪法 §2，坐标系即语义）：
 *  - P7  x 轴是因果：因果边（role !== 'sequence' 且 isInactive !== true）做最长路分层，
 *        层 = 因果分组依据；资产节点再按槽位单调分配（slot * slotStride），x 向右单调（左因右果）。
 *        【修复·槽位碰撞】旧公式 x = layer*colW + slotIndex*slotStride 在默认 colW == slotStride 时
 *        退化为 (layer+slotIndex)*stride：同泳道内前层 ≥2 槽即与后层槽位撞列（dx=0 完全遮挡），
 *        asset→asset 因果边（reference 等）下 P7 单调性被静默破坏。现改为：
 *        因果约束压平到资产层（asset→event→asset 折叠为 asset→asset，事件作传递介质；
 *        加上直接 asset→asset 因果边），slot(v) = max(组内候选槽, max_{压平前驱 u} slot(u)+1)，
 *        同泳道槽位冲突顺次右移——跨泳道前驱可抬高槽位留出空隙（空隙合法，重叠非法）。
 *  - P8  y 轴是管线阶段：Stage 枚举序即泳道序，一泳道一条水平带，同泳道不换行。
 *  - P9  全局资产锚定第 0 列：scope:'global' 的资产钉死 x=0，不参与拓扑分层；
 *        多个 global 资产在第 0 列内按 id 序沿 y 方向在 global 泳道带内堆叠（不与其他泳道抢道）。
 *  - P11 边语义分流：sequence 边不进因果分层，只做同（泳道, 层）内的横向排序约束
 *        （三级排序：sequence 链序 → createdAt（无则 0）→ id）。
 *  - P12 变体牌堆：curation:'deprecated' 节点坐标 = 组 winner 坐标，标 stacked:true，不占布局面积；
 *        selectMode:'locked' 的组（解构集）整组正常布局。
 *  - P19 事件是边上的小芯片：事件无 stage、不占槽——y = 首个 output 边目标的泳道；
 *        x = (max(压平后资产前驱槽位) + 0.5) * slotStride，落在前驱资产列与产物列之间的边上，
 *        半列偏移保证不撞任何资产列。
 *
 * 纯函数、确定性、不 mutate 入参。
 *
 * 【假设·环防御】因果边成环属非法输入（同 stale.ts 假设 10）：Kahn 分层后剩余成环节点
 * 降级为按 id 序追加层，保证终止、不保证业务语义；压平资产图成环同样按 id 序追加拓扑序。
 * 【假设】无压平资产前驱的事件（import/create 种子，含只产出 global 资产者）
 * 钉在 x = -0.5 * slotStride（第 0 列左侧的入种口）。
 * 【假设】同（泳道, 半列）的多个事件芯片按 id 序加 1/4 槽位子槽位，避免芯片互相重叠。
 */

import type {
  AssetNodeV3,
  FlowGraphV3,
  FlowLinkV3,
  FlowNodeV3,
  Stage,
} from './types.js';

export interface LayoutBox {
  x: number;
  y: number;
  layer: number;
  lane: number;
  stacked?: boolean;
}

export interface LayoutOptions {
  /** @deprecated 槽位单调分配后 x 只由 slot * (nodeW+gap) 决定，列宽参数不再参与计算（保留仅为 API 兼容）。 */
  colW?: number;
  laneH?: number; // 泳道带高
  nodeW?: number; // 节点宽（槽位步进 = nodeW + gap）
  gap?: number; // 节点间隙
}

/** P8：§8 Stage 枚举序 = 泳道序（y 轴）。 */
export const STAGE_ORDER: readonly Stage[] = [
  'global',
  'script',
  'storyboard',
  'keyframe',
  'video',
  'voice',
  'foley',
  'bgm',
  'mix',
  'composite',
];

const DEFAULT_NODE_W = 240;
const DEFAULT_GAP = 80;
const DEFAULT_LANE_H = 200;

/** P11：因果边 = 非 sequence 且未置灰；sequence 只做同泳道横向排序。 */
function isCausal(link: FlowLinkV3): boolean {
  return link.role !== 'sequence' && link.isInactive !== true;
}

function isSequence(link: FlowLinkV3): boolean {
  return link.role === 'sequence' && link.isInactive !== true;
}

/** 节点 createdAt：FlowNodeBase 无此字段（布局决策允许「无则 0」），宽松读取。 */
function createdAtOf(node: FlowNodeV3): number {
  const v = (node as { createdAt?: unknown }).createdAt;
  return typeof v === 'number' ? v : 0;
}

function laneOfStage(stage: Stage): number {
  return STAGE_ORDER.indexOf(stage);
}

/**
 * 最长路分层（longest-path layering）：源点 = 无因果入边的节点，layer[v] = max(layer[u]) + 1。
 * global 资产不入 DAG（P9：不参与拓扑分层），其关联边随之忽略。
 * 返回 null 表示存在成环节点（调用方降级处理）。
 */
function longestPathLayers(
  dagIds: string[],
  causalEdges: Array<[string, string]>,
): { layers: Map<string, number>; cyclic: string[] } {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const id of dagIds) {
    inDegree.set(id, 0);
    adj.set(id, []);
  }
  for (const [u, v] of causalEdges) {
    if (!inDegree.has(u) || !inDegree.has(v)) continue;
    adj.get(u)!.push(v);
    inDegree.set(v, inDegree.get(v)! + 1);
  }

  const layers = new Map<string, number>();
  // id 序入队保证确定性（层取值本身与顺序无关，队列顺序只影响成环检测后的输出稳定性）
  const queue = dagIds.filter((id) => inDegree.get(id) === 0).sort();
  for (const id of queue) layers.set(id, 0);

  for (let head = 0; head < queue.length; head++) {
    const u = queue[head]!;
    const lu = layers.get(u)!;
    for (const v of adj.get(u)!) {
      if (layers.get(v) === undefined || layers.get(v)! < lu + 1) layers.set(v, lu + 1);
      const d = inDegree.get(v)! - 1;
      inDegree.set(v, d);
      if (d === 0) queue.push(v);
    }
  }

  const cyclic = dagIds.filter((id) => inDegree.get(id)! > 0);
  return { layers, cyclic };
}

/**
 * 同（泳道, 层）组内三级排序：sequence 链序 → createdAt（无则 0）→ id（P11）。
 * 实现：以组内 sequence 边为约束做 Kahn 拓扑序，同度可用节点按 (createdAt, id) 取最小，
 * 等价于「链序优先，断链处 createdAt/id 决胜」。组内 sequence 成环（非法输入）时剩余节点按 (createdAt, id) 追加。
 */
function slotOrder(memberIds: string[], seqEdges: Array<[string, string]>, nodeById: Map<string, FlowNodeV3>): string[] {
  const members = new Set(memberIds);
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const id of memberIds) {
    inDegree.set(id, 0);
    adj.set(id, []);
  }
  for (const [u, v] of seqEdges) {
    if (!members.has(u) || !members.has(v)) continue;
    adj.get(u)!.push(v);
    inDegree.set(v, inDegree.get(v)! + 1);
  }
  const key = (id: string): [number, string] => [createdAtOf(nodeById.get(id)!), id];
  const cmp = (a: string, b: string): number => {
    const ka = key(a);
    const kb = key(b);
    return ka[0] - kb[0] || (ka[1] < kb[1] ? -1 : ka[1] > kb[1] ? 1 : 0);
  };
  const ready = memberIds.filter((id) => inDegree.get(id) === 0).sort(cmp);
  const order: string[] = [];
  while (ready.length > 0) {
    const u = ready.shift()!;
    order.push(u);
    for (const v of adj.get(u)!) {
      const d = inDegree.get(v)! - 1;
      inDegree.set(v, d);
      if (d === 0) {
        // 插入保持 ready 按 cmp 有序（组规模小，线性插入足够）
        let i = ready.length;
        while (i > 0 && cmp(ready[i - 1]!, v) > 0) i--;
        ready.splice(i, 0, v);
      }
    }
  }
  // 组内 sequence 成环：剩余节点按 (createdAt, id) 追加，保证终止
  const rest = memberIds.filter((id) => !order.includes(id)).sort(cmp);
  return order.concat(rest);
}

/**
 * 布局主入口：返回 nodeId → LayoutBox。确定性、不 mutate 入参。
 */
export function layoutFlowGraph(graph: FlowGraphV3, opts: LayoutOptions = {}): Map<string, LayoutBox> {
  const nodeW = opts.nodeW ?? DEFAULT_NODE_W;
  const gap = opts.gap ?? DEFAULT_GAP;
  const laneH = opts.laneH ?? DEFAULT_LANE_H;
  const slotStride = nodeW + gap; // 槽位步进：x = slot * slotStride（资产唯一 x 来源）

  const nodeById = new Map<string, FlowNodeV3>(graph.nodes.map((n) => [n.id, n]));
  const isAsset = (n: FlowNodeV3): n is AssetNodeV3 => n.kind === 'asset';

  // ---- P9：global 资产钉死第 0 列，不参与拓扑分层 ----
  const globalAssets = graph.nodes
    .filter((n): n is AssetNodeV3 => isAsset(n) && n.scope === 'global')
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const globalIds = new Set(globalAssets.map((n) => n.id));

  // ---- P12：deprecated 变体不进槽位分配，事后贴 winner 坐标 ----
  // 「组 winner」= variantGroup.winnerNodeId；组缺失或无 winner 的 deprecated 节点退回正常布局。
  const stackedToWinner = new Map<string, string>(); // deprecatedId → winnerId
  for (const grp of graph.variantGroups) {
    if (!grp.winnerNodeId || !nodeById.has(grp.winnerNodeId)) continue;
    for (const vid of grp.variantNodeIds) {
      const n = nodeById.get(vid);
      if (n && isAsset(n) && n.curation === 'deprecated') stackedToWinner.set(vid, grp.winnerNodeId);
    }
  }

  // ---- P7/P11：因果 DAG 最长路分层 ----
  const dagIds = graph.nodes.filter((n) => !globalIds.has(n.id)).map((n) => n.id);
  const causalEdges: Array<[string, string]> = graph.links.filter(isCausal).map((l) => [l.source, l.target]);
  const { layers, cyclic } = longestPathLayers(dagIds, causalEdges);
  if (cyclic.length > 0) {
    // 【环防御】因果环 = 非法输入：成环节点按 id 序在已有最大层之后顺序追加，保证终止
    let next = Math.max(-1, ...layers.values()) + 1;
    for (const id of cyclic.slice().sort()) {
      if (!layers.has(id)) layers.set(id, next++);
    }
  }

  // ---- 泳道归属 ----
  // 资产：stage 即泳道（P8）。事件/结构节点无 stage：y = 首个 output 边目标的泳道（P19），
  // 无 output 边则退回首个因果入边来源的泳道，再无则第 0 泳道。
  const firstOutputTarget = new Map<string, string>(); // eventId → 首个 role:'output' 边的 target（按 links 顺序，确定性）
  for (const l of graph.links) {
    if (l.role === 'output' && !firstOutputTarget.has(l.source)) firstOutputTarget.set(l.source, l.target);
  }
  const laneOfNode = (n: FlowNodeV3): number => {
    if (isAsset(n)) return laneOfStage(n.stage);
    const outId = firstOutputTarget.get(n.id);
    const outNode = outId ? nodeById.get(outId) : undefined;
    if (outNode && isAsset(outNode)) return laneOfStage(outNode.stage);
    const inLink = graph.links.find((l) => isCausal(l) && l.target === n.id);
    const inNode = inLink ? nodeById.get(inLink.source) : undefined;
    if (inNode && isAsset(inNode)) return laneOfStage(inNode.stage);
    return 0;
  };

  const boxes = new Map<string, LayoutBox>();

  // ---- P9 落地：global 资产 x=0，第 0 列内按 id 序沿 y 在 global 泳道带内堆叠 ----
  {
    let cursorY = 0; // global 泳道带顶
    for (const n of globalAssets) {
      boxes.set(n.id, { x: 0, y: cursorY, layer: 0, lane: 0 });
      cursorY += n.size.height + gap;
    }
  }

  // ---- P7/P8/P11：资产槽位单调分配（x = slot * slotStride）----
  const seqEdges: Array<[string, string]> = graph.links.filter(isSequence).map((l) => [l.source, l.target]);

  // 参与槽位分配的资产：排除 global（P9 第 0 列）与 deprecated 牌堆（P12 贴 winner）
  const slotAssetIds: string[] = [];
  for (const n of graph.nodes) {
    if (isAsset(n) && !globalIds.has(n.id) && !stackedToWinner.has(n.id)) slotAssetIds.push(n.id);
  }
  const slotAssetSet = new Set(slotAssetIds);

  // 因果约束压平到资产层：asset→event→asset 折叠为 asset→asset（事件作为传递介质），
  // 加上直接 asset→asset 因果边（reference 等）；sequence/isInactive 沿用 isCausal 排除。
  const flatPreds = new Map<string, string[]>(); // assetId → 压平因果前驱资产
  const flatTopo: string[] = []; // 资产节点按压平因果 DAG 的拓扑序（确定性）
  {
    const causalOut = new Map<string, string[]>();
    for (const l of graph.links) {
      if (!isCausal(l)) continue;
      const arr = causalOut.get(l.source);
      if (arr) arr.push(l.target);
      else causalOut.set(l.source, [l.target]);
    }
    const adj = new Map<string, string[]>();
    const inDeg = new Map<string, number>();
    for (const id of slotAssetIds) {
      adj.set(id, []);
      inDeg.set(id, 0);
      flatPreds.set(id, []);
    }
    for (const id of slotAssetIds) {
      // 从 id 沿因果边穿过事件节点，到达的全部下游资产 = 压平后继（seen 防事件环死循环）
      const reached = new Set<string>();
      const seen = new Set<string>([id]);
      const stack = [id];
      while (stack.length > 0) {
        const cur = stack.pop()!;
        for (const t of causalOut.get(cur) ?? []) {
          if (slotAssetSet.has(t)) reached.add(t);
          else if (!seen.has(t) && nodeById.get(t)?.kind === 'event') {
            seen.add(t);
            stack.push(t);
          }
        }
      }
      reached.delete(id);
      for (const t of [...reached].sort()) {
        adj.get(id)!.push(t);
        flatPreds.get(t)!.push(id);
        inDeg.set(t, inDeg.get(t)! + 1);
      }
    }
    // Kahn（就绪集按 id 有序）：确定性；压平图成环（非法输入）时剩余按 id 序追加，保证终止
    const ready = slotAssetIds.filter((id) => inDeg.get(id) === 0).sort();
    while (ready.length > 0) {
      const u = ready.shift()!;
      flatTopo.push(u);
      for (const v of adj.get(u)!) {
        const d = inDeg.get(v)! - 1;
        inDeg.set(v, d);
        if (d === 0) {
          let i = ready.length;
          while (i > 0 && ready[i - 1]! > v) i--;
          ready.splice(i, 0, v);
        }
      }
    }
    for (const id of slotAssetIds.slice().sort()) {
      if (!flatTopo.includes(id)) flatTopo.push(id);
    }
  }

  // 候选槽：每泳道按层分组，candidate(v) = lane 内前层累计槽数 + 组内序
  // （组内序沿用 P11 三级排序：sequence 链序 → createdAt → id）
  const candidate = new Map<string, number>();
  const laneOfId = new Map<string, number>();
  {
    const groups = new Map<string, string[]>(); // `${lane}|${layer}` → member ids（资产 + 结构节点）
    for (const n of graph.nodes) {
      if (n.kind === 'event') continue; // 事件芯片单独摆（P19）
      if (globalIds.has(n.id)) continue; // 第 0 列已摆
      if (stackedToWinner.has(n.id)) continue; // 牌堆不占面积（P12）
      const lane = laneOfNode(n);
      laneOfId.set(n.id, lane);
      const key = `${lane}|${layers.get(n.id) ?? 0}`;
      const arr = groups.get(key);
      if (arr) arr.push(n.id);
      else groups.set(key, [n.id]);
    }
    const sortedGroups = [...groups.entries()]
      .map(([key, ids]) => {
        const [lane, layer] = key.split('|').map(Number);
        return { lane: lane!, layer: layer!, ids };
      })
      .sort((a, b) => a.lane - b.lane || a.layer - b.layer);
    let prevLane = -1;
    let base = 0; // 当前 lane 内前层累计槽数
    for (const grp of sortedGroups) {
      if (grp.lane !== prevLane) {
        base = 0;
        prevLane = grp.lane;
      }
      const order = slotOrder(grp.ids, seqEdges, nodeById);
      order.forEach((id, i) => candidate.set(id, base + i));
      base += order.length;
    }
  }

  // 因果抬升（按拓扑序处理）：slot(v) = max(candidate(v), max_{压平前驱 u} slot(u) + 1)；
  // 同泳道槽位已被占则顺次右移（同泳道重叠非法；跨泳道前驱抬高造成的空隙合法）。
  const slotOf = new Map<string, number>();
  const laneUsed = new Map<number, Set<number>>();
  for (const id of flatTopo) {
    let s = candidate.get(id) ?? 0;
    for (const u of flatPreds.get(id) ?? []) {
      const su = slotOf.get(u);
      if (su !== undefined && su + 1 > s) s = su + 1;
    }
    const lane = laneOfId.get(id)!;
    const used = laneUsed.get(lane) ?? new Set<number>();
    laneUsed.set(lane, used);
    while (used.has(s)) s++;
    used.add(s);
    slotOf.set(id, s);
  }

  for (const n of graph.nodes) {
    if (n.kind === 'event') continue;
    if (globalIds.has(n.id) || stackedToWinner.has(n.id)) continue;
    const lane = laneOfId.get(n.id)!;
    const layer = layers.get(n.id) ?? 0;
    let s: number;
    if (isAsset(n)) {
      s = slotOf.get(n.id)!;
    } else {
      // 结构节点（kind 非 asset/event）不占因果槽：从 candidate 序位起右移避开已占槽位
      const used = laneUsed.get(lane) ?? new Set<number>();
      laneUsed.set(lane, used);
      s = candidate.get(n.id) ?? 0;
      while (used.has(s)) s++;
      used.add(s);
    }
    boxes.set(n.id, { x: s * slotStride, y: lane * laneH, layer, lane });
  }

  // ---- P12 落地：deprecated 贴 winner 坐标 ----
  for (const [depId, winId] of stackedToWinner) {
    const win = boxes.get(winId);
    if (win) boxes.set(depId, { x: win.x, y: win.y, layer: win.layer, lane: win.lane, stacked: true });
  }

  // ---- P19 落地：事件芯片（不占资产槽位）----
  // x = (max(压平后资产前驱槽位) + 0.5) * slotStride：落在前驱资产列与产物列之间的边上，
  // 半列偏移保证不撞任何资产列；无压平资产前驱的种子芯片沿用 -0.5 槽入种口。
  const causalIn = new Map<string, string[]>();
  for (const l of graph.links) {
    if (!isCausal(l)) continue;
    const arr = causalIn.get(l.target);
    if (arr) arr.push(l.source);
    else causalIn.set(l.target, [l.source]);
  }
  const chipGroups = new Map<string, string[]>(); // `${lane}|${halfColKey}` → event ids（子槽位去重叠）
  const chipBase = new Map<string, { x: number; y: number; layer: number; lane: number }>();
  for (const n of graph.nodes) {
    if (n.kind !== 'event') continue;
    const lane = laneOfNode(n);
    const layer = layers.get(n.id) ?? 0;
    // 压平后资产前驱：沿因果入边穿过事件节点回溯到资产（事件作为传递介质；seen 防事件环）
    let maxPredSlot: number | null = null;
    const seen = new Set<string>([n.id]);
    const stack = [n.id];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (const s of causalIn.get(cur) ?? []) {
        const su = slotOf.get(s);
        if (su !== undefined) {
          if (maxPredSlot === null || su > maxPredSlot) maxPredSlot = su;
        } else if (!seen.has(s) && nodeById.get(s)?.kind === 'event') {
          seen.add(s);
          stack.push(s);
        }
      }
    }
    let halfColKey: string;
    let x: number;
    if (maxPredSlot !== null) {
      x = (maxPredSlot + 0.5) * slotStride;
      halfColKey = `in${maxPredSlot}`;
    } else {
      x = -0.5 * slotStride; // 入种口：第 0 列左侧半列（沿用现状）
      halfColKey = 'seed';
    }
    chipBase.set(n.id, { x, y: lane * laneH, layer, lane });
    const key = `${lane}|${halfColKey}`;
    const arr = chipGroups.get(key);
    if (arr) arr.push(n.id);
    else chipGroups.set(key, [n.id]);
  }
  for (const ids of chipGroups.values()) {
    ids.sort();
    ids.forEach((id, i) => {
      const base = chipBase.get(id)!;
      // 同（泳道, 半列）多芯片按 id 序加 1/4 槽位子槽位，避免芯片互相重叠
      boxes.set(id, { x: base.x + i * (slotStride / 4), y: base.y, layer: base.layer, lane: base.lane });
    });
  }

  return boxes;
}

/**
 * P17：position 是布局引擎计算缓存。applyLayout 把布局结果写回 position，
 * 返回新图（不 mutate 入参；节点浅拷贝 + 新 position 对象）。
 */
export function applyLayout(graph: FlowGraphV3, opts: LayoutOptions = {}): FlowGraphV3 {
  const boxes = layoutFlowGraph(graph, opts);
  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      const b = boxes.get(n.id);
      return b ? { ...n, position: { x: b.x, y: b.y } } : { ...n };
    }),
  };
}
