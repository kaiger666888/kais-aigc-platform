/**
 * P13 脏传播纯函数（宪法 §3 / §13）。
 *
 * 语义：changed 资产 → 消费它的事件过期 → 事件产物标 stale，
 * 沿因果边（asset→event→asset）级联，无需人工维护。
 *
 * 取舍与边界（注释即契约）：
 *  - `role:'sequence'` 边不参与传播（P11：时间序边不进因果分层，自然不进脏传播）。
 *  - `isInactive:true` 边不参与传播（P12×P13：置灰边 = 非选定变体的下游边，
 *    「选定版接管下游」——改 deprecated 变体不许经置灰边把下游标脏）。
 *  - `curation:'locked'` 资产是传播终点：宪法 §13「locked 资产的 stale 传播到此为止
 *    （它是 DAG 的参考叶子，不是生产中间件）」——locked 资产**自身不标脏、也不向下传**。
 *    （SPEC 模块契约曾写「自身标 stale 但不再向下传」，与宪法冲突时以宪法为准。）
 *  - changed 资产自身不标脏（它是新事实的起点，不是受害者）——有向环输入下同样成立：
 *    环上回指到 changed 资产的 output 边不会把它自标脏（见实现处 changedSet 跳过）。
 *  - 有向环是**非法输入**（因果图应为 DAG）：本函数防御性终止（BFS 去重保证），
 *    但不保证环上业务语义正确——环应由编排层在写入侧拒绝。
 *  - 已 stale 的资产不重复覆盖（保留最早 since），但仍继续向下传播。
 *  - StaleInfo.trigger* 记录**链条起点**：triggerAssetId = 本次变更的源资产，
 *    triggerEventId = 该链条上第一个过期的事件。
 *  - 纯函数：不 mutate 入参，结构化拷贝后返回新对象。
 */
import type { AssetNodeV3, FlowGraphV3, FlowNodeV3 } from './types.js';

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function isAsset(node: FlowNodeV3): node is AssetNodeV3 {
  return node.kind === 'asset';
}

/**
 * 因果边索引（模块私有）——markStaleDownstream 与 getDownstreamIds 共用
 *（GUARD：零逻辑复制，sequence / isInactive 边排除语义单点维护）。
 *   assetConsumedByEvents: assetId → 以它为输入的事件 id 集合（asset→event 边）
 *   eventOutputs:          eventId → 事件产出的资产 id 集合（event→asset 的 output 边）
 */
interface CausalIndex {
  assetConsumedByEvents: Map<string, string[]>;
  eventOutputs: Map<string, string[]>;
}

function buildCausalIndex(graph: FlowGraphV3): CausalIndex {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const assetConsumedByEvents = new Map<string, string[]>();
  const eventOutputs = new Map<string, string[]>();
  for (const link of graph.links) {
    if (link.role === 'sequence') continue; // P11：不参与因果传播
    // P12×P13：置灰边（非选定变体下游边）不参与脏传播——选定版接管下游，
    // 改 deprecated 变体不许经此边把下游标脏。
    if (link.isInactive === true) continue;
    const source = nodeById.get(link.source);
    const target = nodeById.get(link.target);
    if (!source || !target) continue;
    if (source.kind === 'asset' && target.kind === 'event') {
      const list = assetConsumedByEvents.get(link.source) ?? [];
      list.push(link.target);
      assetConsumedByEvents.set(link.source, list);
    } else if (source.kind === 'event' && target.kind === 'asset' && link.role === 'output') {
      const list = eventOutputs.get(link.source) ?? [];
      list.push(link.target);
      eventOutputs.set(link.source, list);
    }
  }
  return { assetConsumedByEvents, eventOutputs };
}

export function markStaleDownstream(
  graph: FlowGraphV3,
  changedAssetIds: string[],
  now: number,
): FlowGraphV3 {
  const next = clone(graph);
  const nodeById = new Map(next.nodes.map((n) => [n.id, n]));
  const { assetConsumedByEvents, eventOutputs } = buildCausalIndex(next);

  // BFS 级联。队列元素：当前过期事件 + 链条起点（trigger）。
  interface DirtyEvent {
    eventId: string;
    triggerAssetId: string;
    triggerEventId: string; // 链条上第一个过期的事件
  }
  const queue: DirtyEvent[] = [];
  const enqueuedEvents = new Set<string>(); // 同一 (event,triggerChain) 只处理一次
  const changedSet = new Set(changedAssetIds); // 新事实起点：环上回指也不许自标脏

  for (const assetId of changedAssetIds) {
    for (const eventId of assetConsumedByEvents.get(assetId) ?? []) {
      const key = `${assetId}→${eventId}`;
      if (enqueuedEvents.has(key)) continue;
      enqueuedEvents.add(key);
      queue.push({ eventId, triggerAssetId: assetId, triggerEventId: eventId });
    }
  }

  while (queue.length > 0) {
    const { eventId, triggerAssetId, triggerEventId } = queue.shift()!;
    for (const outputAssetId of eventOutputs.get(eventId) ?? []) {
      const node = nodeById.get(outputAssetId);
      if (!node || !isAsset(node)) continue;
      // changed 资产是新事实起点：有向环（非法输入，防御性处理）回指到它时
      // 不自标脏、也不再从环上二次级联（其下游已在初始播种时入队）。
      if (changedSet.has(outputAssetId)) continue;
      // §13：locked 资产是传播终点——不标脏、不向下传。
      if (node.curation === 'locked') continue;
      // 已 stale 不覆盖（保留最早 since / 原 trigger）。
      if (node.stale === null) {
        node.stale = { since: now, triggerAssetId, triggerEventId };
      }
      // 继续级联：该资产的产物身份下游事件随之过期，trigger 保持链条起点。
      for (const downstreamEventId of assetConsumedByEvents.get(outputAssetId) ?? []) {
        const key = `${triggerAssetId}→${downstreamEventId}`;
        if (enqueuedEvents.has(key)) continue;
        enqueuedEvents.add(key);
        queue.push({ eventId: downstreamEventId, triggerAssetId, triggerEventId });
      }
    }
  }

  return next;
}

/**
 * REGEN-03（Phase 52-01）：重跑链下游计算引擎。
 *
 * 从 nodeId（**资产或事件 id 皆可作起点**）沿因果边 BFS，返回**下游资产 id 集**
 *（orchestrate nodeIds 只收资产 id，事件 id 不进结果）。
 *
 * 语义与 markStaleDownstream 同级（共用 buildCausalIndex，零逻辑复制）：
 *  - `role:'sequence'` 边与 `isInactive:true` 置灰边不参与（索引已保证）；
 *  - `curation:'locked'` 资产是传播终点——**自身计入结果**（它仍是下游资产，
 *    只是不再越过它向下延伸；与 §13「locked 自身不标脏」不冲突：stale 标记
 *    与下游集合是两个问题）；
 *  - 有向环（非法输入）防御性终止：visited Set 去重，结果集天然去重；
 *  - nodeId 不存在返回 []（不 throw；与 store 守卫早退范式对齐）；
 *  - 纯函数：不 mutate 入参，不做结构化拷贝（只读遍历）。
 */
export function getDownstreamIds(graph: FlowGraphV3, nodeId: string): string[] {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  if (!nodeById.has(nodeId)) return [];
  const { assetConsumedByEvents, eventOutputs } = buildCausalIndex(graph);

  const visited = new Set<string>([nodeId]); // 起点不入结果；环上回指去重
  const result = new Set<string>();
  const queue: string[] = [nodeId];

  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = nodeById.get(id);
    if (!node) continue;
    if (node.kind === 'event') {
      for (const assetId of eventOutputs.get(id) ?? []) {
        if (visited.has(assetId)) continue;
        visited.add(assetId);
        const asset = nodeById.get(assetId);
        if (!asset || !isAsset(asset)) continue;
        result.add(assetId);
        // §13：locked 资产为终点——自身计入结果，但不越过它继续延伸。
        if (asset.curation === 'locked') continue;
        queue.push(assetId);
      }
    } else {
      for (const eventId of assetConsumedByEvents.get(id) ?? []) {
        if (visited.has(eventId)) continue;
        visited.add(eventId);
        queue.push(eventId);
      }
    }
  }
  return [...result];
}
