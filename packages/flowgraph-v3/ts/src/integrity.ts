/**
 * 引用完整性检查（纯函数，只读不报写）。
 *
 * schema 是结构契约（SSOT），但「id 引用是否悬空」是图级语义约束，schema 不强制
 * （见 TimelineShot $comment「schema 不强制引用完整性」）——由本模块统一承载，
 * 供迁移层（migrate.ts 尾部 drop+warning）、py harness lint 模式与测试断言复用。
 *
 * 检测项：
 *  - 边 source/target 悬空（指向不存在的节点）；
 *  - 节点 id 重复；
 *  - VariantGroupV3 的 sourceEventId / variantNodeIds / winnerNodeId 悬空；
 *  - TimelineShot 的 video / keyframes / voice / foley / bgm assetId 悬空。
 */
import type { FlowGraphV3 } from './types.js';

export type IntegrityIssueKind =
  | 'duplicate_node_id'
  | 'dangling_link_source'
  | 'dangling_link_target'
  | 'dangling_variant_source_event'
  | 'dangling_variant_node'
  | 'dangling_variant_winner'
  | 'dangling_timeline_ref';

export interface IntegrityIssue {
  kind: IntegrityIssueKind;
  /** JSON 指针风格定位（如 /links[3]、/nodes[5]/timeline/shots[0]/video）。 */
  path: string;
  message: string;
}

export function checkReferentialIntegrity(graph: FlowGraphV3): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];

  // 节点 id 唯一性 + 索引
  const nodeIds = new Set<string>();
  graph.nodes.forEach((n, i) => {
    if (nodeIds.has(n.id)) {
      issues.push({
        kind: 'duplicate_node_id',
        path: `/nodes[${i}]`,
        message: `节点 id 重复: ${n.id}`,
      });
    }
    nodeIds.add(n.id);
  });

  // 边端点悬空
  graph.links.forEach((l, i) => {
    if (!nodeIds.has(l.source)) {
      issues.push({
        kind: 'dangling_link_source',
        path: `/links[${i}]`,
        message: `边 ${l.id} source 悬空: ${l.source}（无此节点）`,
      });
    }
    if (!nodeIds.has(l.target)) {
      issues.push({
        kind: 'dangling_link_target',
        path: `/links[${i}]`,
        message: `边 ${l.id} target 悬空: ${l.target}（无此节点）`,
      });
    }
  });

  // 变体组引用悬空
  graph.variantGroups.forEach((g, i) => {
    if (!nodeIds.has(g.sourceEventId)) {
      issues.push({
        kind: 'dangling_variant_source_event',
        path: `/variantGroups[${i}]`,
        message: `变体组 ${g.id} sourceEventId 悬空: ${g.sourceEventId}（无此事件节点）`,
      });
    }
    g.variantNodeIds.forEach((id, j) => {
      if (!nodeIds.has(id)) {
        issues.push({
          kind: 'dangling_variant_node',
          path: `/variantGroups[${i}]/variantNodeIds[${j}]`,
          message: `变体组 ${g.id} 成员悬空: ${id}（无此节点）`,
        });
      }
    });
    if (g.winnerNodeId != null && !nodeIds.has(g.winnerNodeId)) {
      issues.push({
        kind: 'dangling_variant_winner',
        path: `/variantGroups[${i}]/winnerNodeId`,
        message: `变体组 ${g.id} winnerNodeId 悬空: ${g.winnerNodeId}（无此节点）`,
      });
    }
  });

  // TimelineShot 资产引用悬空
  graph.nodes.forEach((n, i) => {
    if (n.kind !== 'asset' || !n.timeline) return;
    n.timeline.shots.forEach((shot, j) => {
      const base = `/nodes[${i}]/timeline/shots[${j}]`;
      const singles: Array<[string, string | undefined]> = [
        ['video', shot.video],
        ['voice', shot.voice],
        ['foley', shot.foley],
        ['bgm', shot.bgm],
      ];
      for (const [field, ref] of singles) {
        if (ref != null && !nodeIds.has(ref)) {
          issues.push({
            kind: 'dangling_timeline_ref',
            path: `${base}/${field}`,
            message: `节点 ${n.id} 镜头 ${shot.shotId} 的 ${field} 引用悬空: ${ref}（无此资产）`,
          });
        }
      }
      shot.keyframes?.forEach((kf, k) => {
        if (!nodeIds.has(kf)) {
          issues.push({
            kind: 'dangling_timeline_ref',
            path: `${base}/keyframes[${k}]`,
            message: `节点 ${n.id} 镜头 ${shot.shotId} 的 keyframes 引用悬空: ${kf}（无此资产）`,
          });
        }
      });
    });
  });

  return issues;
}
