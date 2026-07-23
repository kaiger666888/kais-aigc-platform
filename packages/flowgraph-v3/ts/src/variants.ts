/**
 * P12 变体选定联动纯函数（宪法 §3 / §11）。
 *
 * 语义：
 *  - winner 资产 → curation:'selected'；组内其余 → 'deprecated'；
 *  - 非 winner 的下游边 isInactive:true（置灰），winner 的下游边 isInactive 清除（恢复）；
 *    「下游边」= 以该变体节点为 source 的直接出边（与 §11「其下游边置灰」一致）。
 *  - group.winnerNodeId 持久化（用户决策，§11）。
 *
 * 编排责任划清（P13）：切换 winner 后下游资产的 stale 联动由编排层负责调用
 * markStaleDownstream，本纯函数只做选定翻转与置灰，不级联标脏。
 *
 * 校验（任一不满足即抛错，不部分应用）：
 *  - group.selectMode 必须为 'single'（'locked' 是 §11 解构集整组锁定展示，无 winner 语义）；
 *  - winnerNodeId 必须在 group.variantNodeIds 内；
 *  - winnerNodeId 对应的资产节点必须真实存在（不许悬空 winner）；
 *  - 组内任一成员 curation==='locked' → 抛错（§11 参考锁定语义不可被选定覆写）。
 * 纯函数：不 mutate 入参，结构化拷贝后返回新对象。
 */
import type { AssetNodeV3, FlowGraphV3 } from './types.js';

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function selectVariant(
  graph: FlowGraphV3,
  groupId: string,
  winnerNodeId: string,
): FlowGraphV3 {
  const next = clone(graph);
  const group = next.variantGroups.find((g) => g.id === groupId);
  if (!group) {
    throw new Error(`selectVariant: variantGroup 不存在: ${groupId}`);
  }
  if (group.selectMode !== 'single') {
    throw new Error(
      `selectVariant: 组 ${groupId} selectMode='${group.selectMode}'，仅 'single' 组支持选定` +
        `（§11：selectMode:'locked' 为解构集整组锁定展示，无 winner 语义）`,
    );
  }
  if (!group.variantNodeIds.includes(winnerNodeId)) {
    throw new Error(
      `selectVariant: winnerNodeId ${winnerNodeId} 不在组 ${groupId} 的 variantNodeIds 内`,
    );
  }
  const winnerNode = next.nodes.find((n) => n.id === winnerNodeId);
  if (!winnerNode || winnerNode.kind !== 'asset') {
    throw new Error(
      `selectVariant: winnerNodeId ${winnerNodeId} 对应的资产节点不存在（悬空 winner，组 ${groupId}）`,
    );
  }

  const memberSet = new Set(group.variantNodeIds);
  for (const node of next.nodes) {
    if (node.kind !== 'asset' || !memberSet.has(node.id)) continue;
    if (node.curation === 'locked') {
      throw new Error(
        `selectVariant: 组 ${groupId} 成员 ${node.id} curation='locked'，` +
          `§11 参考锁定语义不可被选定覆写（解构集参考资产不走 selectVariant）`,
      );
    }
  }
  for (const node of next.nodes) {
    if (node.kind !== 'asset' || !memberSet.has(node.id)) continue;
    const asset = node as AssetNodeV3;
    asset.curation = asset.id === winnerNodeId ? 'selected' : 'deprecated';
  }

  for (const link of next.links) {
    if (!memberSet.has(link.source)) continue;
    if (link.source === winnerNodeId) {
      delete link.isInactive; // winner 下游边恢复
    } else {
      link.isInactive = true; // 非 winner 下游边置灰
    }
  }

  group.winnerNodeId = winnerNodeId;
  return next;
}
