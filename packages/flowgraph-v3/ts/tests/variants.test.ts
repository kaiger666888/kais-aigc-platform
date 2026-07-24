/**
 * variants.test.ts — P12 变体选定联动：选定/置灰/恢复/非法 winner/纯函数。
 * 基于 fixtures/v3-valid.sample.json 的 vg_01（winner=asset_video_01，
 * asset_video_02/03 已 deprecated 且其 compose 入边已 isInactive）。
 */
import { describe, it, expect } from 'vitest';
import validSample from '../../fixtures/v3-valid.sample.json';
import { selectVariant } from '../src/variants.js';
import { validateFlowGraphV3 } from '../src/zod.js';
import type { AssetNodeV3, FlowGraphV3 } from '../src/types.js';

const graph = validSample as unknown as FlowGraphV3;
const curation = (g: FlowGraphV3, id: string) =>
  (g.nodes.find((n) => n.id === id) as AssetNodeV3).curation;
const linkById = (g: FlowGraphV3, id: string) => g.links.find((l) => l.id === id);

describe('selectVariant（§11 / P12）', () => {
  it('换选 winner：curation 翻转 + winnerNodeId 持久化', () => {
    const g = selectVariant(graph, 'vg_01', 'asset_video_02');
    expect(curation(g, 'asset_video_02')).toBe('selected');
    expect(curation(g, 'asset_video_01')).toBe('deprecated');
    expect(curation(g, 'asset_video_03')).toBe('deprecated');
    expect(g.variantGroups.find((x) => x.id === 'vg_01')!.winnerNodeId).toBe('asset_video_02');
  });

  it('下游边联动：非 winner 置灰，新 winner 恢复（isInactive 清除）', () => {
    const g = selectVariant(graph, 'vg_01', 'asset_video_02');
    expect(linkById(g, 'l_compose_in_video_v2')!.isInactive).toBeUndefined(); // 恢复
    expect(linkById(g, 'l_compose_in_video')!.isInactive).toBe(true); // 旧 winner 置灰
    expect(linkById(g, 'l_compose_in_video_v3')!.isInactive).toBe(true);
  });

  it('重选同一 winner：状态幂等', () => {
    const g = selectVariant(graph, 'vg_01', 'asset_video_01');
    expect(curation(g, 'asset_video_01')).toBe('selected');
    expect(linkById(g, 'l_compose_in_video')!.isInactive).toBeUndefined();
    expect(linkById(g, 'l_compose_in_video_v2')!.isInactive).toBe(true);
  });

  it('winnerNodeId 不在 variantNodeIds 内 → 抛错', () => {
    expect(() => selectVariant(graph, 'vg_01', 'asset_video_99')).toThrow(/variantNodeIds/);
  });

  it('groupId 不存在 → 抛错', () => {
    expect(() => selectVariant(graph, 'vg_99', 'asset_video_01')).toThrow(/vg_99/);
  });

  it('输出仍通过 Zod 校验', () => {
    const g = selectVariant(graph, 'vg_01', 'asset_video_02');
    const result = validateFlowGraphV3(g);
    if (!result.ok) console.error(result.errors);
    expect(result.ok).toBe(true);
  });

  it('纯函数：不 mutate 入参', () => {
    const before = JSON.stringify(graph);
    selectVariant(graph, 'vg_01', 'asset_video_02');
    expect(JSON.stringify(graph)).toBe(before);
  });
});

describe('selectVariant 输入校验（F1：locked 覆写与悬空 winner 不许静默）', () => {
  function clone<T>(v: T): T {
    return JSON.parse(JSON.stringify(v)) as T;
  }

  it("selectMode!=='single' → 抛错（locked 解构集无 winner 语义，§11）", () => {
    // fixture 的 vg_decompose：shot_decompose 解构集，selectMode:'locked'
    expect(() => selectVariant(graph, 'vg_decompose', 'asset_d_video_01')).toThrow(/selectMode/);
    // multi 组同样不支持单选定语义
    const g = clone(graph);
    g.variantGroups.find((x) => x.id === 'vg_01')!.selectMode = 'multi';
    expect(() => selectVariant(g, 'vg_01', 'asset_video_01')).toThrow(/selectMode/);
  });

  it("组内任一成员 curation='locked' → 抛错（§11 参考锁定语义不可覆写）", () => {
    const g = clone(graph);
    // 把解构集组伪装成 single 模式，锁定成员仍必须拦住覆写
    g.variantGroups.find((x) => x.id === 'vg_decompose')!.selectMode = 'single';
    expect(() => selectVariant(g, 'vg_decompose', 'asset_d_video_01')).toThrow(/locked/);
    expect(() => selectVariant(g, 'vg_decompose', 'asset_d_video_01')).toThrow(/§11/);
  });

  it('winnerNodeId 对应节点不存在（悬空 winner）→ 抛错', () => {
    const g = clone(graph);
    g.nodes = g.nodes.filter((n) => n.id !== 'asset_video_02'); // 节点缺失但仍在 variantNodeIds 内
    expect(() => selectVariant(g, 'vg_01', 'asset_video_02')).toThrow(/不存在/);
  });
});
