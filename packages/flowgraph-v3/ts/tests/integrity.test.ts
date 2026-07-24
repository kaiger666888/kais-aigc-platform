/**
 * integrity.test.ts — 引用完整性检查（F5）：
 * 边端点悬空 / 节点 id 重复 / 变体组三类悬空 / TimelineShot 资产引用悬空；
 * fixtures 两个 V3 样本与迁移输出必须 0 issue。
 */
import { describe, it, expect } from 'vitest';
import validSample from '../../fixtures/v3-valid.sample.json';
import unknownFieldsSample from '../../fixtures/v3-unknown-fields.sample.json';
import v2Sample from '../../fixtures/v2-export.sample.json';
import { checkReferentialIntegrity } from '../src/integrity.js';
import { migrateV2toV3 } from '../src/migrate.js';
import type { AssetNodeV3, FlowGraphV3 } from '../src/types.js';
import type { FlowGraphV2Export } from '../src/v2types.js';

const graph = validSample as unknown as FlowGraphV3;

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
const kinds = (issues: ReturnType<typeof checkReferentialIntegrity>) =>
  issues.map((i) => i.kind);

describe('checkReferentialIntegrity（F5）', () => {
  it('fixtures 两个 V3 样本 0 issue', () => {
    expect(checkReferentialIntegrity(graph)).toEqual([]);
    expect(checkReferentialIntegrity(unknownFieldsSample as unknown as FlowGraphV3)).toEqual([]);
  });

  it('V2 fixture 迁移输出 0 issue', () => {
    const { graph: out } = migrateV2toV3(v2Sample as FlowGraphV2Export);
    expect(checkReferentialIntegrity(out)).toEqual([]);
  });

  it('边 source/target 悬空被检出', () => {
    const g = clone(graph);
    g.links[0]!.source = 'ghost_source';
    g.links[1]!.target = 'ghost_target';
    const issues = checkReferentialIntegrity(g);
    expect(kinds(issues)).toContain('dangling_link_source');
    expect(kinds(issues)).toContain('dangling_link_target');
    expect(issues.some((i) => i.message.includes('ghost_source'))).toBe(true);
    expect(issues.some((i) => i.message.includes('ghost_target'))).toBe(true);
  });

  it('节点 id 重复被检出', () => {
    const g = clone(graph);
    g.nodes.push(clone(g.nodes[0]!));
    const issues = checkReferentialIntegrity(g);
    expect(kinds(issues)).toContain('duplicate_node_id');
    expect(issues.find((i) => i.kind === 'duplicate_node_id')!.message).toContain(g.nodes[0]!.id);
  });

  it('变体组 sourceEventId / variantNodeIds / winnerNodeId 悬空被检出', () => {
    const g = clone(graph);
    const vg = g.variantGroups.find((x) => x.id === 'vg_01')!;
    vg.sourceEventId = 'ghost_event';
    vg.variantNodeIds.push('ghost_member');
    vg.winnerNodeId = 'ghost_winner';
    const issues = checkReferentialIntegrity(g);
    expect(kinds(issues)).toContain('dangling_variant_source_event');
    expect(kinds(issues)).toContain('dangling_variant_node');
    expect(kinds(issues)).toContain('dangling_variant_winner');
  });

  it('TimelineShot 的 video/keyframes/voice/foley/bgm 悬空引用被检出', () => {
    const g = clone(graph);
    const composite = g.nodes.find((n) => n.id === 'asset_composite_01') as AssetNodeV3;
    const shot = composite.timeline!.shots[0]!;
    shot.video = 'ghost_video';
    shot.keyframes = ['ghost_kf'];
    shot.voice = 'ghost_voice';
    shot.foley = 'ghost_foley';
    shot.bgm = 'ghost_bgm';
    const issues = checkReferentialIntegrity(g);
    const timelineIssues = issues.filter((i) => i.kind === 'dangling_timeline_ref');
    expect(timelineIssues.length).toBe(5);
    expect(timelineIssues.some((i) => i.path.endsWith('/video'))).toBe(true);
    expect(timelineIssues.some((i) => i.path.includes('/keyframes[0]'))).toBe(true);
    expect(timelineIssues.some((i) => i.path.endsWith('/voice'))).toBe(true);
    expect(timelineIssues.some((i) => i.path.endsWith('/foley'))).toBe(true);
    expect(timelineIssues.some((i) => i.path.endsWith('/bgm'))).toBe(true);
  });
});
