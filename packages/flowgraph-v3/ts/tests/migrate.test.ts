/**
 * migrate.test.ts — §14 映射表逐行断言 + P2 闭环 + 补种清单 + Zod 校验。
 */
import { describe, it, expect } from 'vitest';
import v2Sample from '../../fixtures/v2-export.sample.json';
import { migrateV2toV3 } from '../src/migrate.js';
import { checkReferentialIntegrity } from '../src/integrity.js';
import { validateFlowGraphV3 } from '../src/zod.js';
import type {
  AssetNodeV3,
  EventNodeV3,
  FlowGraphV3,
  FlowLinkV3,
  PromptFacets,
} from '../src/types.js';
import type { FlowGraphV2Export, FlowNodeV2, FlowNodeV2Data } from '../src/v2types.js';

const v2 = v2Sample as FlowGraphV2Export;
const { graph, report } = migrateV2toV3(v2);

function asset(graph: FlowGraphV3, id: string): AssetNodeV3 {
  const n = graph.nodes.find((x) => x.id === id);
  expect(n?.kind).toBe('asset');
  return n as AssetNodeV3;
}
function event(graph: FlowGraphV3, id: string): EventNodeV3 {
  const n = graph.nodes.find((x) => x.id === id);
  expect(n?.kind).toBe('event');
  return n as EventNodeV3;
}
function linksBetween(graph: FlowGraphV3, source: string, target: string): FlowLinkV3[] {
  return graph.links.filter((l) => l.source === source && l.target === target);
}

describe('§14 映射表逐行', () => {
  it("type:'script' → kind:asset, stage:script, modality:text, prompt→content（不进 params）", () => {
    const a = asset(graph, 'n_script_01');
    expect(a.stage).toBe('script');
    expect(a.modality).toBe('text');
    expect(a.content).toBe('雨夜，林晚站在天台边缘，手机里是最后一条未发送的语音。');
    expect(a.meta).toMatchObject({ stage: 'script', hookType: '悬念', hookIntensity: 0.85 });
    const e = event(graph, 'evt_n_script_01');
    expect(e.op).toBe('create');
    expect(e.params.prompt).toBeUndefined(); // P4：同一参数不抄两处
  });

  it("type:'storyboard' → stage:storyboard, modality:image, data 字段进 meta", () => {
    const a = asset(graph, 'n_sb_01');
    expect(a.stage).toBe('storyboard');
    expect(a.modality).toBe('image');
    expect(a.meta).toMatchObject({
      stage: 'storyboard',
      shotId: 'shot-001',
      shotType: 'close-up',
      durationS: 4.0,
      cameraMovement: 'dolly-in',
    });
  });

  it("type:'video' → 普通产物 stage:video（P11），op 按 engine 推断，配方进 params", () => {
    const a = asset(graph, 'n_video_01');
    expect(a.stage).toBe('video');
    expect(a.modality).toBe('video');
    expect(a.meta).toMatchObject({ stage: 'video', shotId: 'shot-001' });
    const e = event(graph, 'evt_n_video_01');
    expect(e.op).toBe('wan22_i2v'); // engine wan2.2-i2v → i2v
    expect(e.params).toMatchObject({ prompt: expect.any(String), seed: 88421, modelVersion: 'wan2.2-i2v' });
  });

  it("type:'video' + master-timeline 线索 → stage:composite（P12）", () => {
    const a = asset(graph, 'n_master_01');
    expect(a.stage).toBe('composite');
    expect(a.meta).toMatchObject({ stage: 'composite', edlRef: 'edl://ep101/v1' });
    expect(event(graph, 'evt_n_master_01').op).toBe('compose');
  });

  it("type:'audio' → 按 audioType 拆 voice/foley/bgm（op 同步拆 tts/foley_gen/bgm_gen）", () => {
    expect(asset(graph, 'n_audio_voice').stage).toBe('voice');
    expect(asset(graph, 'n_audio_foley').stage).toBe('foley');
    expect(asset(graph, 'n_audio_bgm').stage).toBe('bgm');
    expect(asset(graph, 'n_audio_voice').modality).toBe('audio');
    expect(asset(graph, 'n_audio_voice').meta).toMatchObject({ stage: 'voice', speaker: '林晚' });
    expect(event(graph, 'evt_n_audio_voice').op).toBe('tts');
    expect(event(graph, 'evt_n_audio_foley').op).toBe('foley_gen');
    expect(event(graph, 'evt_n_audio_bgm').op).toBe('bgm_gen');
  });

  it("type:'audio' + audioType:'mix' → stage:mix（P12b 混音母带，不再错标 voice）", () => {
    const a = asset(graph, 'n_audio_mix');
    expect(a.stage).toBe('mix');
    expect(a.modality).toBe('audio');
    expect(a.meta).toMatchObject({ stage: 'mix' });
    expect(event(graph, 'evt_n_audio_mix').op).toBe('mix');
  });

  it("type:'asset'（P04 角色 / P07 风格）→ scope:'global' 第 0 列", () => {
    const role = asset(graph, 'n_asset_role');
    expect(role.scope).toBe('global');
    expect(role.stage).toBe('global');
    expect(role.meta).toMatchObject({ stage: 'global', assetType: 'role' }); // phaseName "P04 角色" 推断
    expect(asset(graph, 'n_asset_style').meta).toMatchObject({ stage: 'global', assetType: 'lora' });
    expect(event(graph, 'evt_n_asset_role').op).toBe('import');
  });

  it("type:'scene_image' → global/image，assetType 归一为 'scene'（不丢弃、不误报、不 throw）", () => {
    // 真实后端形状：canvas_nodes.type='scene_image'，phase_index=0，data.assetType='scene_image'
    const v2si: FlowGraphV2Export = {
      meta: { projectId: 1, episodesId: 1, createdAt: 0, updatedAt: 0 },
      nodes: [
        {
          id: 'a-scene_refs-S01',
          type: 'scene_image',
          branchId: 'br_main',
          phaseIndex: 0,
          phaseName: 'P07 场景图',
          state: 'success',
          data: { assetType: 'scene_image', filePath: '/oss/proj/p07/scene_S01.png' },
        },
      ],
      links: [],
    };
    const { graph: g, report: rep } = migrateV2toV3(v2si);
    const a = asset(g, 'a-scene_refs-S01');
    expect(a.stage).toBe('global');
    expect(a.modality).toBe('image');
    expect(a.scope).toBe('global');
    expect(a.meta).toMatchObject({ stage: 'global', assetType: 'scene' }); // 'scene_image' 归一为 'scene'
    expect(a.media.original).toBe('/oss/proj/p07/scene_S01.png');
    expect(event(g, 'evt_a-scene_refs-S01').op).toBe('import');
    // buildMeta 归一为 'scene' → 不应产生 assetType 无法判定的告警
    expect(rep.warnings.some((w) => w.includes('assetType 无法判定'))).toBe(false);
  });

  it("type:'upscale'/'face_restore' → 事件 op，原节点改为普通资产 + output 边", () => {
    const up = asset(graph, 'n_upscale_01');
    expect(up.kind).toBe('asset');
    expect(up.stage).toBe('video'); // 继承因果入边源（n_video_01）stage
    const upEvt = event(graph, 'evt_n_upscale_01');
    expect(upEvt.op).toBe('upscale');
    expect(upEvt.params.modelVersion).toBe('realesrgan-x4');
    // output 边 + 输入边（源资产 → 事件）
    expect(linksBetween(graph, 'evt_n_upscale_01', 'n_upscale_01').some((l) => l.role === 'output')).toBe(true);
    expect(linksBetween(graph, 'n_video_01', 'evt_n_upscale_01').length).toBe(1);
    const frEvt = event(graph, 'evt_n_face_01');
    expect(frEvt.op).toBe('face_restore');
    expect(linksBetween(graph, 'n_upscale_01', 'evt_n_face_01').length).toBe(1);
    expect(nodeMapAction('n_upscale_01')).toBe('event_op_plus_asset');
  });

  it("type:'variant' → 废弃，由 VariantGroupV3.sourceEventId 表达（同事件多输出归组）", () => {
    expect(graph.nodes.find((n) => n.id === 'n_var_01')).toBeUndefined(); // 节点废弃
    expect(graph.nodes.find((n) => n.id === 'evt_n_cand_b')).toBeUndefined(); // 非 winner 事件被合并
    const g = graph.variantGroups.find((x) => x.id === 'vg_n_var_01');
    expect(g).toBeDefined();
    expect(g!.sourceEventId).toBe('evt_n_cand_a'); // winner 事件为多输出源
    expect(g!.variantNodeIds).toEqual(['n_cand_a', 'n_cand_b']);
    expect(g!.winnerNodeId).toBe('n_cand_a');
    expect(g!.selectMode).toBe('single');
    // 两候选均由同一事件产出
    expect(linksBetween(graph, 'evt_n_cand_a', 'n_cand_a').some((l) => l.role === 'output')).toBe(true);
    expect(linksBetween(graph, 'evt_n_cand_a', 'n_cand_b').some((l) => l.role === 'output')).toBe(true);
    // 重复输入边（sb_01→两候选事件）合并去重为一条
    expect(linksBetween(graph, 'n_sb_01', 'evt_n_cand_a').length).toBe(1);
    // 非 winner 配方留存（§9 开放扩展点）
    const params = event(graph, 'evt_n_cand_a').params;
    expect(params.variantRecipes).toEqual([
      { assetId: 'n_cand_b', prompt: '她转身离开，镜头定格背影', seed: 1002, modelVersion: 'wan2.2-i2v' },
    ]);
    // 非 winner 下游边置灰，winner 不置灰
    expect(linksBetween(graph, 'n_cand_b', 'evt_n_master_01')[0]?.isInactive).toBe(true);
    expect(linksBetween(graph, 'n_cand_a', 'evt_n_master_01')[0]?.isInactive).toBeUndefined();
  });

  it("type:'reference' / ensure_reference_link → 统一为边 role:'reference'", () => {
    expect(graph.nodes.find((n) => n.id === 'n_ref_01')).toBeUndefined(); // reference 节点废弃
    const refEdges = linksBetween(graph, 'n_asset_role', 'evt_n_cand_a').filter(
      (l) => l.role === 'reference',
    );
    expect(refEdges.length).toBe(1); // 节点重接：role→evt(cand_a)
    const ensure = linksBetween(graph, 'n_asset_role', 'evt_n_video_02').filter(
      (l) => l.role === 'reference',
    );
    expect(ensure.length).toBe(1); // ensure_reference_link 边 → role:'reference'
    // dataType 'reference' 的普通边同样归一
    expect(
      linksBetween(graph, 'n_sb_01', 'evt_n_audio_voice').some((l) => l.role === 'reference'),
    ).toBe(true);
  });

  it('sequence 边（import-from-dir 产物）→ 边 role:\'sequence\'（asset→asset，不过事件）', () => {
    const seq = linksBetween(graph, 'n_sb_01', 'n_sb_02');
    expect(seq.length).toBe(1);
    expect(seq[0]!.role).toBe('sequence');
  });

  it('data.filePath → media.original', () => {
    expect(asset(graph, 'n_video_01').media.original).toBe('/assets/video/shot-001.mp4');
  });

  it('data.thumbnailUrl → media.thumbnail', () => {
    expect(asset(graph, 'n_sb_01').media.thumbnail).toBe('/assets/sb/shot-001_thumb.jpg');
    expect(asset(graph, 'n_sb_02').media.thumbnail).toBeNull();
  });

  // storyboard 画面兜底：filePath 缺失时回退 scene_ref/turnaround_path。
  // 仅 /oss/ 或绝对路径形态回退（相对路径前端无法解析，留 null 由补数据脚本处理）。
  const migrateStoryboard = (data: FlowNodeV2Data): AssetNodeV3 => {
    const g = migrateV2toV3({
      meta: { projectId: 1, episodesId: 1 },
      nodes: [{
        id: 'sb_t', type: 'storyboard', branchId: 'br_main', phaseIndex: 2,
        phaseName: 'storyboard', position: { x: 0, y: 0 }, size: { width: 240, height: 160 },
        state: 'success', data,
      }],
      links: [],
    }).graph;
    return asset(g, 'sb_t');
  };

  it('filePath 缺失 + scene_ref 是 /oss/ 路径 → media.original 回退 scene_ref', () => {
    const a = migrateStoryboard({ shotId: 'S1', shotType: 'MCU', durationS: 3, scene_ref: '/oss/pipeline/abc/S1_front.png' });
    expect(a.media.original).toBe('/oss/pipeline/abc/S1_front.png');
  });

  it('filePath 缺失 + scene_ref 是相对路径 → 不回退（前端无法解析，留 null）', () => {
    const a = migrateStoryboard({ shotId: 'S1', shotType: 'MCU', durationS: 3, scene_ref: 'assets/S07/S1_front.png' });
    expect(a.media.original).toBeNull();
  });

  it('filePath 缺失 + character_refs[].turnaround_path（/oss/）→ 回退', () => {
    const a = migrateStoryboard({ shotId: 'S1', shotType: 'MCU', durationS: 3, character_refs: [{ name: '主角', turnaround_path: '/oss/pipeline/abc/protag.png' }] });
    expect(a.media.original).toBe('/oss/pipeline/abc/protag.png');
  });

  it('filePath 存在 → scene_ref 不覆盖（filePath 优先）', () => {
    const a = migrateStoryboard({ shotId: 'S1', shotType: 'MCU', durationS: 3, filePath: '/oss/x.mp4', scene_ref: '/oss/y.png' });
    expect(a.media.original).toBe('/oss/x.mp4');
  });

  it('节点 data 上的 prompt/seed/engine → 生成事件 params', () => {
    const e = event(graph, 'evt_n_video_02');
    expect(e.params.prompt).toBe('城市夜景，天台远景，雨渐停');
    expect(e.params.seed).toBe(90001);
    expect(e.params.modelVersion).toBe('wan2.2-t2v');
  });

  it("isWinner → curation:'selected'（组内其余 deprecated）", () => {
    expect(asset(graph, 'n_cand_a').curation).toBe('selected');
    expect(asset(graph, 'n_cand_b').curation).toBe('deprecated');
    expect(asset(graph, 'n_cand_a').variantGroupId).toBe('vg_n_var_01');
  });
});

function nodeMapAction(v2NodeId: string): string | undefined {
  return report.nodeMap.find((e) => e.v2NodeId === v2NodeId)?.action;
}

describe('P2 闭环与补种（一个不许漏）', () => {
  it('输出图中每个资产节点都有事件 output 入边', () => {
    const assets = graph.nodes.filter((n) => n.kind === 'asset');
    expect(assets.length).toBeGreaterThan(0);
    for (const a of assets) {
      const inbound = graph.links.filter((l) => l.target === a.id && l.role === 'output');
      expect(inbound.length, `资产 ${a.id} 缺事件 output 入边`).toBeGreaterThan(0);
      const src = graph.nodes.find((n) => n.id === inbound[0]!.source);
      expect(src?.kind).toBe('event');
    }
  });

  it('孤儿资产（无配方无因果入边）补 import 种子事件并列入 report', () => {
    const orphan = report.importedSeedEvents.find((e) => e.assetNodeId === 'n_orphan_bgm');
    expect(orphan).toBeDefined();
    expect(orphan!.reason).toBe('orphan_no_recipe_no_causal_input');
    const e = event(graph, orphan!.eventId);
    expect(e.op).toBe('import');
    expect(e.executor).toBe('human');
    expect(e.params.sourcePath).toBe('/assets/bgm/legacy_unknown.wav');
    expect(linksBetween(graph, e.id, 'n_orphan_bgm').some((l) => l.role === 'output')).toBe(true);
    // global 资产的自然 import 种子也入册
    expect(report.importedSeedEvents.some((x) => x.assetNodeId === 'n_asset_role')).toBe(true);
  });

  it('有配方/有入边的节点不补 import（用类型默认 op）', () => {
    expect(report.importedSeedEvents.some((e) => e.assetNodeId === 'n_video_01')).toBe(false);
    expect(report.importedSeedEvents.some((e) => e.assetNodeId === 'n_upscale_01')).toBe(false);
  });
});

describe('MigrationReport 完整性', () => {
  it('每个 V2 节点都有去向映射', () => {
    for (const n of v2.nodes) {
      expect(report.nodeMap.some((e) => e.v2NodeId === n.id), `节点 ${n.id} 无去向`).toBe(true);
    }
    expect(nodeMapAction('n_var_01')).toBe('dropped_variant_grouped');
    expect(nodeMapAction('n_ref_01')).toBe('rewired_to_reference_edges');
  });

  it('每条 V2 边都有去向映射', () => {
    for (const l of v2.links) {
      expect(report.linkMap.some((e) => e.v2LinkId === l.id), `边 ${l.id} 无去向`).toBe(true);
    }
    expect(report.linkMap.find((e) => e.v2LinkId === 'vl_04')!.action).toBe('role_sequence');
    expect(report.linkMap.find((e) => e.v2LinkId === 'vl_09')!.action).toBe(
      'consumed_by_variant_group',
    );
  });
});

describe('输出合法性', () => {
  it('迁移输出通过 Zod 校验（对齐 SSOT 严格面）', () => {
    const result = validateFlowGraphV3(graph);
    if (!result.ok) console.error(result.errors);
    expect(result.ok).toBe(true);
  });

  it('迁移是纯函数：不 mutate V2 入参', () => {
    const before = JSON.stringify(v2Sample);
    migrateV2toV3(JSON.parse(before) as FlowGraphV2Export);
    expect(JSON.stringify(v2Sample)).toBe(before);
  });

  it('meta/branches 继承（FlowBranchV2 原样保留）', () => {
    expect(graph.meta).toMatchObject({ version: '3', projectId: 7, episodesId: 101 });
    expect(graph.branches).toEqual([{ id: 'br_main', name: 'main', createdAt: 1753200000000 }]);
  });

  it('输出不与 V2 入参共享引用：mutate 输出 branches/viewport 不污染入参（F3）', () => {
    const v2in = JSON.parse(JSON.stringify(v2Sample)) as FlowGraphV2Export;
    v2in.meta.viewport = { x: 1, y: 2, zoom: 0.5 }; // 覆盖 viewport 透传路径
    const before = JSON.stringify(v2in);
    const { graph: out } = migrateV2toV3(v2in);
    out.branches[0]!.name = 'MUTATED';
    out.branches.push({ id: 'br_injected', name: 'injected' });
    out.meta.viewport!.x = 9999;
    expect(JSON.stringify(v2in)).toBe(before);
  });
});

describe('迁移输出引用完整性（F5：悬空引用 drop + warning，不静默透传）', () => {
  it('含悬空 sequence 边的 V2 输入：迁移后悬空边被清除且 warning 有记录', () => {
    const v2in = JSON.parse(JSON.stringify(v2Sample)) as FlowGraphV2Export;
    v2in.links.push({ id: 'vl_dangling_seq', source: 'n_sb_01', target: 'n_ghost', dataType: 'sequence' });
    const { graph: out, report: rep } = migrateV2toV3(v2in);
    expect(out.links.some((l) => l.source === 'n_ghost' || l.target === 'n_ghost')).toBe(false);
    expect(rep.warnings.some((w) => w.includes('n_ghost') && w.includes('悬空'))).toBe(true);
    expect(checkReferentialIntegrity(out)).toEqual([]);
  });

  it('标准 V2 fixture 迁移输出 0 issue', () => {
    expect(checkReferentialIntegrity(graph)).toEqual([]);
  });
});

describe('【52-02】stale wire 还原：data.stale → asset.stale', () => {
  const STALE = { since: 1724300000000, triggerAssetId: 'n_up_01', triggerEventId: 'evt_n_up_01' };

  it('data.stale 三字段齐全 → asset.stale 还原相等（修复 stale 刷新即丢预存缺口）', () => {
    const v2in = JSON.parse(JSON.stringify(v2Sample)) as FlowGraphV2Export;
    const node = v2in.nodes.find((n) => n.id === 'n_sb_01')!;
    (node.data as Record<string, unknown>).stale = STALE;
    const { graph: out } = migrateV2toV3(v2in);
    expect(asset(out, 'n_sb_01').stale).toEqual(STALE);
  });

  it('data.stale 缺失 → asset.stale 为 null（不伪造）', () => {
    expect(asset(graph, 'n_sb_01').stale).toBeNull();
  });

  it('data.stale 畸形（缺字段 / 非对象）→ 降级 null 不 throw（migrate 宽容风格）', () => {
    const v2in = JSON.parse(JSON.stringify(v2Sample)) as FlowGraphV2Export;
    const a = v2in.nodes.find((n) => n.id === 'n_sb_01')!;
    (a.data as Record<string, unknown>).stale = { since: 123 }; // 缺 trigger 两字段
    const b = v2in.nodes.find((n) => n.id === 'n_script_01')!;
    (b.data as Record<string, unknown>).stale = 'not-an-object'; // 非对象
    expect(() => migrateV2toV3(v2in)).not.toThrow();
    const { graph: out } = migrateV2toV3(v2in);
    expect(asset(out, 'n_sb_01').stale).toBeNull();
    expect(asset(out, 'n_script_01').stale).toBeNull();
  });
});

describe('【52-07】Pass 3 防御：变体组候选事件缺失（真机 9999 实证形态）', () => {
  // 真机形态(kmc sync envelope):两个 variant 组共享候选——组1合并时删掉候选事件,
  // 组2再查该候选 eventById.get(...) 得 undefined,原非空断言 throw → migrate 整体
  // 降级空图(整个画布消失)。修复后:warn + 跳过该候选合并,不崩。
  // 复现:varA(candA winner + candB)先并掉 candB 事件;varB(candB + candC)再遇
  // candB → 事件已被组1消费。candC 有配方,正常并入。
  const mk = (id: string, extra: Record<string, unknown> = {}) => ({
    id, type: 'video' as const, branchId: 'br_main', position: { x: 0, y: 0 }, size: { width: 260, height: 180 },
    data: { label: id, ...extra } as FlowNodeV2Data, state: 'idle',
  })
  const v2in: FlowGraphV2Export = {
    meta: { projectId: 1, episodesId: 1, createdAt: 0, updatedAt: 0 },
    nodes: [
      { ...mk('n_cand_a', { prompt: '配方A' }), isWinner: true },
      { ...mk('n_cand_b', { prompt: '配方B' }), isWinner: true },
      { ...mk('n_cand_c', { prompt: '配方C' }), isWinner: true },
      { id: 'n_var_a', type: 'variant', position: { x: 150, y: 200 }, size: { width: 200, height: 100 }, branchId: 'br_main', data: { label: '组A' } as FlowNodeV2Data, state: 'idle' },
      { id: 'n_var_b', type: 'variant', position: { x: 450, y: 200 }, size: { width: 200, height: 100 }, branchId: 'br_main', data: { label: '组B' } as FlowNodeV2Data, state: 'idle' },
    ],
    links: [
      { id: 'e1', source: 'n_cand_a', target: 'n_var_a', dataType: 'variant' },
      { id: 'e2', source: 'n_cand_b', target: 'n_var_a', dataType: 'variant' },
      { id: 'e3', source: 'n_cand_b', target: 'n_var_b', dataType: 'variant' },
      { id: 'e4', source: 'n_cand_c', target: 'n_var_b', dataType: 'variant' },
    ],
    branches: [],
  };

  it('不 throw:组间共享候选的事件已被前组消费 → warn 跳过,资产与事件存活', () => {
    let out: ReturnType<typeof migrateV2toV3>;
    expect(() => { out = migrateV2toV3(v2in) }).not.toThrow();
    // 三候选资产全部存活
    for (const id of ['n_cand_a', 'n_cand_b', 'n_cand_c']) {
      expect(out!.graph.nodes.find((n) => n.id === id)?.kind).toBe('asset');
    }
    // candB 事件被组A合并删除(既有 P12 行为不变)
    expect(out!.graph.nodes.find((n) => n.id === 'evt_n_cand_b')).toBeUndefined();
    // 组A winner 事件留存 candB 配方(前组合并成功)
    expect(event(out!.graph, 'evt_n_cand_a').params.variantRecipes).toEqual([
      { assetId: 'n_cand_b', prompt: '配方B' },
    ])
    // 告警可见:组B 遇到无事件的 candB
    expect(out!.report.warnings.some((w) => w.includes('n_var_b') && w.includes('n_cand_b') && w.includes('无合成事件'))).toBe(true);
  })

  it('winner 事件也已被前组消费 → 整组跳过合并(warn),不造悬空边', () => {
    // 组C:winner = n_cand_b(其事件已被组A合并消费)
    const v2c: FlowGraphV2Export = {
      ...v2in,
      nodes: [
        ...v2in.nodes,
        { id: 'n_var_c', type: 'variant', position: { x: 750, y: 200 }, size: { width: 200, height: 100 }, branchId: 'br_main', data: { label: '组C' } as FlowNodeV2Data, state: 'idle' },
      ],
      links: [
        ...v2in.links,
        { id: 'e5', source: 'n_cand_b', target: 'n_var_c', dataType: 'variant' },
        { id: 'e6', source: 'n_cand_a', target: 'n_var_c', dataType: 'variant' },
      ],
    }
    let out: ReturnType<typeof migrateV2toV3>
    expect(() => { out = migrateV2toV3(v2c) }).not.toThrow()
    // 跳过合并的告警可见
    expect(out!.report.warnings.some((w) => w.includes('n_var_c') && w.includes('跳过多输出归组'))).toBe(true)
    // candA 资产与事件仍存活(未被悬空重指)
    expect(out!.graph.nodes.find((n) => n.id === 'n_cand_a')?.kind).toBe('asset')
    expect(out!.graph.nodes.find((n) => n.id === 'evt_n_cand_a')?.kind).toBe('event')
  })
})

describe('【Fix-2】无 isWinner 组：不伪造 winner（盲选待决）', () => {
  // 真实后端 load-v2 形态：组内候选全部无 isWinner（未定组 = 盲选素材）。
  // 旧行为伪造 winner=首候选：伪造值经 serialize（winnerNodeId != null 才写出）
  // 回写持久化"用户从未做过的选定"，且前端盲选队列（winnerNodeId==null 过滤）
  // 永远空队列。新语义锁死：winnerNodeId 字段缺省 + curation 不动 + 结构归并
  // 照常（primary = 首个有合成事件的候选，仅承担边重指/配方合并）。
  const mk = (id: string, extra: Record<string, unknown> = {}) => ({
    id, type: 'video' as const, branchId: 'br_main', position: { x: 0, y: 0 }, size: { width: 260, height: 180 },
    data: { label: id, ...extra } as FlowNodeV2Data, state: 'idle',
  })
  const varNode = (id: string): FlowNodeV2 => ({
    id, type: 'variant', branchId: 'br_main', position: { x: 150, y: 200 }, size: { width: 200, height: 100 },
    data: { label: id } as FlowNodeV2Data, state: 'idle',
  })

  it('无 isWinner → 组 winnerNodeId 字段缺省、无候选被标 selected/deprecated、主事件=首个有事件候选、边重指发生', () => {
    const v2in: FlowGraphV2Export = {
      meta: { projectId: 1, episodesId: 1, createdAt: 0, updatedAt: 0 },
      nodes: [
        mk('n_cand_a', { prompt: '配方A', seed: 1 }),
        mk('n_cand_b', { prompt: '配方B', seed: 2 }),
        varNode('n_var_u'),
        mk('n_down'),
      ],
      links: [
        { id: 'u1', source: 'n_cand_a', target: 'n_var_u', dataType: 'variant' },
        { id: 'u2', source: 'n_cand_b', target: 'n_var_u', dataType: 'variant' },
        { id: 'u3', source: 'n_cand_a', target: 'n_down', dataType: 'causal' },
        { id: 'u4', source: 'n_cand_b', target: 'n_down', dataType: 'causal' },
      ],
      branches: [],
    };
    const { graph: g, report: rep } = migrateV2toV3(v2in);
    const grp = g.variantGroups.find((x) => x.id === 'vg_n_var_u');
    expect(grp).toBeDefined();
    expect(grp!.variantNodeIds).toEqual(['n_cand_a', 'n_cand_b']);
    expect(grp!.sourceEventId).toBe('evt_n_cand_a'); // 主事件 = 首个有合成事件的候选
    expect(grp!.winnerNodeId).toBeUndefined();
    expect('winnerNodeId' in grp!).toBe(false); // 字段缺省（非显式 undefined）

    // 结构归并照常：evt_n_cand_b 并入主事件（多输出形态）
    expect(g.nodes.find((n) => n.id === 'evt_n_cand_b')).toBeUndefined();
    expect(linksBetween(g, 'evt_n_cand_a', 'n_cand_b').some((l) => l.role === 'output')).toBe(true);
    expect(event(g, 'evt_n_cand_a').params.variantRecipes).toEqual([
      { assetId: 'n_cand_b', prompt: '配方B', seed: 2 },
    ]);
    // 边重指：次候选下游边置灰，结构主候选下游边不置灰
    expect(linksBetween(g, 'n_cand_b', 'evt_n_down')[0]?.isInactive).toBe(true);
    expect(linksBetween(g, 'n_cand_a', 'evt_n_down')[0]?.isInactive).toBeUndefined();

    // curation 不动（Pass 1 默认 candidate；不伪造 selected，也不伪造 deprecated）
    expect(asset(g, 'n_cand_a').curation).toBe('candidate');
    expect(asset(g, 'n_cand_b').curation).toBe('candidate');
    // 组成员资格照常挂（结构）
    expect(asset(g, 'n_cand_a').variantGroupId).toBe('vg_n_var_u');
    expect(asset(g, 'n_cand_b').variantGroupId).toBe('vg_n_var_u');
    // 告警语义 + 输出合法
    expect(rep.warnings.some((w) => w.includes('n_var_u') && w.includes('winner 留空(盲选待决)'))).toBe(true);
    expect(validateFlowGraphV3(g).ok).toBe(true);
    expect(checkReferentialIntegrity(g)).toEqual([]);
  });

  it('无 isWinner 且全候选无事件 → 组不并、候选独立（现行为锁死）', () => {
    // 全候选无事件的可达形态 = 事件被前组消费（52-07 共享候选）：组A（真 winner）
    // 并掉 evt_b/evt_c 后，未定组遇 [b, c] 双双无事件 → skip 分支，整组不建。
    const v2in: FlowGraphV2Export = {
      meta: { projectId: 1, episodesId: 1, createdAt: 0, updatedAt: 0 },
      nodes: [
        { ...mk('n_cand_a', { prompt: '配方A' }), isWinner: true },
        mk('n_cand_b', { prompt: '配方B' }),
        mk('n_cand_c', { prompt: '配方C' }),
        varNode('n_var_a'),
        varNode('n_var_u'),
      ],
      links: [
        { id: 'a1', source: 'n_cand_a', target: 'n_var_a', dataType: 'variant' },
        { id: 'a2', source: 'n_cand_b', target: 'n_var_a', dataType: 'variant' },
        { id: 'a3', source: 'n_cand_c', target: 'n_var_a', dataType: 'variant' },
        { id: 'u1', source: 'n_cand_b', target: 'n_var_u', dataType: 'variant' },
        { id: 'u2', source: 'n_cand_c', target: 'n_var_u', dataType: 'variant' },
      ],
      branches: [],
    };
    const { graph: g, report: rep } = migrateV2toV3(v2in);
    // 组A（真 winner）正常归并：b/c 事件被消费
    expect(g.variantGroups.find((x) => x.id === 'vg_n_var_a')).toBeDefined();
    expect(g.nodes.find((n) => n.id === 'evt_n_cand_b')).toBeUndefined();
    expect(g.nodes.find((n) => n.id === 'evt_n_cand_c')).toBeUndefined();
    // 未定组不并：无 vg_n_var_u，走 skip 分支
    expect(g.variantGroups.find((x) => x.id === 'vg_n_var_u')).toBeUndefined();
    expect(rep.nodeMap.find((e) => e.v2NodeId === 'n_var_u')?.action).toBe(
      'skipped_variant_merge_no_primary_event',
    );
    expect(rep.warnings.some((w) => w.includes('n_var_u') && w.includes('跳过多输出归组'))).toBe(true);
    // 候选资产独立保留（不崩、不造悬空边）
    expect(asset(g, 'n_cand_b').kind).toBe('asset');
    expect(asset(g, 'n_cand_c').kind).toBe('asset');
    expect(checkReferentialIntegrity(g)).toEqual([]);
  });

  it('有 isWinner → 现行为回归锚：winnerNodeId 写出 + curation selected/deprecated（局部小图锁死）', () => {
    const v2in: FlowGraphV2Export = {
      meta: { projectId: 1, episodesId: 1, createdAt: 0, updatedAt: 0 },
      nodes: [
        mk('n_cand_a', { prompt: '配方A' }),
        mk('n_cand_b', { prompt: '配方B' }),
        { ...mk('n_cand_w', { prompt: '配方W' }), isWinner: true },
        varNode('n_var_d'),
      ],
      links: [
        { id: 'd1', source: 'n_cand_a', target: 'n_var_d', dataType: 'variant' },
        { id: 'd2', source: 'n_cand_w', target: 'n_var_d', dataType: 'variant' },
        { id: 'd3', source: 'n_cand_b', target: 'n_var_d', dataType: 'variant' },
      ],
      branches: [],
    };
    const { graph: g } = migrateV2toV3(v2in);
    const grp = g.variantGroups.find((x) => x.id === 'vg_n_var_d')!;
    expect(grp.winnerNodeId).toBe('n_cand_w');
    expect('winnerNodeId' in grp).toBe(true);
    expect(grp.sourceEventId).toBe('evt_n_cand_w'); // 主事件 = winner 事件（非首候选）
    expect(asset(g, 'n_cand_w').curation).toBe('selected');
    expect(asset(g, 'n_cand_a').curation).toBe('deprecated');
    expect(asset(g, 'n_cand_b').curation).toBe('deprecated');
    // 落选者事件并入 winner 事件，配方留存
    expect(g.nodes.find((n) => n.id === 'evt_n_cand_a')).toBeUndefined();
    expect(event(g, 'evt_n_cand_w').params.variantRecipes).toEqual([
      { assetId: 'n_cand_a', prompt: '配方A' },
      { assetId: 'n_cand_b', prompt: '配方B' },
    ]);
  });
})

describe('Phase 58: recipeParams 全集提取（窄通道解除）', () => {
  // 单 video 节点局部图（L206-217 migrateStoryboard 同款 helper 范式）
  const migrateSingleNode = (data: FlowNodeV2Data, id = 'n_video_x') =>
    migrateV2toV3({
      meta: { projectId: 1, episodesId: 1 },
      nodes: [{
        id, type: 'video', branchId: 'br_main', phaseIndex: 4,
        phaseName: 'video', position: { x: 0, y: 0 }, size: { width: 240, height: 160 },
        state: 'success', data,
      }],
      links: [],
    });

  it('(a) data 带 steps/cfg/quant/sageAttention/negative/lora → params 九键全提取，lora 深结构保真', () => {
    const { graph: g } = migrateSingleNode({
      prompt: '夜色中的城市天际线',
      negative: '模糊，低清',
      seed: 424242,
      engine: 'wan2.2-i2v',
      lora: [
        { name: 'style-anime', strength: 0.7 },
        { name: 'light-film', strength: 0.35 },
      ],
      steps: 32,
      cfg: 6.5,
      quant: 'q8',
      sageAttention: true,
    });
    const params = event(g, 'evt_n_video_x').params;
    expect(params.prompt).toBe('夜色中的城市天际线');
    expect(params.negative).toBe('模糊，低清'); // negative 必须在往返集（裁决 2）
    expect(params.seed).toBe(424242);
    expect(params.modelVersion).toBe('wan2.2-i2v');
    expect(params.steps).toBe(32);
    expect(params.cfg).toBe(6.5);
    expect(params.quant).toBe('q8');
    expect(params.sageAttention).toBe(true);
    // lora 数组整袋透传：深结构（name+strength）保真
    expect(params.lora).toEqual([
      { name: 'style-anime', strength: 0.7 },
      { name: 'light-film', strength: 0.35 },
    ]);
  });

  it('(b) data.engine → params.modelVersion 键名映射回归（唯一非恒等映射）', () => {
    const { graph: g } = migrateSingleNode({ prompt: 'p', seed: 7, engine: 'wan2.2-t2v' });
    const params = event(g, 'evt_n_video_x').params;
    expect(params.modelVersion).toBe('wan2.2-t2v');
    expect((params as Record<string, unknown>).engine).toBeUndefined(); // d 侧键名不进 params
  });

  it('(c) 仅 data.steps 无 prompt/seed/engine → hasRecipe 不再判孤儿，params.steps 在场', () => {
    const { graph: g, report: rep } = migrateSingleNode({ steps: 40 });
    const e = event(g, 'evt_n_video_x');
    expect(e.params.steps).toBe(40); // 配方提取在场（原窄通道下被丢弃）
    expect(e.params.sourcePath).toBeUndefined(); // 未落 orphan import 种子（orphan 分支 params 只剩 sourcePath）
    expect(e.op).not.toBe('import');
    expect(
      rep.importedSeedEvents.some((s) => s.assetNodeId === 'n_video_x' && s.reason === 'orphan_no_recipe_no_causal_input'),
    ).toBe(false);
  });
})

describe('DEBT-03 buildMeta 5 字段读回(61-03)', () => {
  // 51-REVIEW I1：写侧 serialize flattenMeta {...rest} 摊平无缺口，读侧 buildMeta
  // 漏拣——save→reload 后 meta 5 字段(emotion/promptMeta/murchGrade/archetype/viewAngle)
  // 静默丢失。本组按 stage 分支直测 buildMeta 读回，每用例过 validateFlowGraphV3
  //（zod strict 判别联合 = 类型错配回归网）。
  const migrateOne = (type: FlowNodeV2['type'], data: FlowNodeV2Data, id = 'n_x') =>
    migrateV2toV3({
      meta: { projectId: 1, episodesId: 1, createdAt: 0, updatedAt: 0 },
      nodes: [{ id, type, branchId: 'br_main', data, state: 'success' }],
      links: [],
    });

  /** 7-facet 完整合法对象（键集照 types.ts PromptFacets）。 */
  const PROMPT_FACETS: PromptFacets = {
    subject: '林晚站在天台边缘',
    action: '回眸',
    camera: 'dolly-in',
    scene: '雨夜天台',
    lighting: '低调侧光',
    style: '电影感写实',
    text: '无字幕',
  };

  it('a. script: data.emotion=7(number) → meta.emotion 保真且 typeof === "number"（Pitfall 3 正断言）', () => {
    const { graph: g } = migrateOne('script', { emotion: 7, hookType: '悬念' }, 'n_script_e');
    const meta = asset(g, 'n_script_e').meta;
    if (meta.stage !== 'script') throw new Error(`stage=${meta.stage}`);
    expect(meta.emotion).toBe(7);
    expect(typeof meta.emotion).toBe('number'); // script 契约是 number，非 string
    expect(meta.hookType).toBe('悬念');
    expect(validateFlowGraphV3(g).ok).toBe(true);
  });

  it('b. storyboard: data.promptMeta → meta.promptMeta toEqual 原对象（deep equal）', () => {
    const { graph: g } = migrateOne('storyboard', { shotType: 'close-up', durationS: 4, promptMeta: PROMPT_FACETS }, 'n_sb_e');
    const meta = asset(g, 'n_sb_e').meta;
    if (meta.stage !== 'storyboard') throw new Error(`stage=${meta.stage}`);
    expect(meta.promptMeta).toEqual(PROMPT_FACETS);
    expect(meta.shotType).toBe('close-up');
    expect(validateFlowGraphV3(g).ok).toBe(true);
  });

  it('c. video: data.murchGrade → meta.murchGrade', () => {
    const { graph: g } = migrateOne('video', { shotId: 'shot-001', murchGrade: 'A' }, 'n_video_e');
    const meta = asset(g, 'n_video_e').meta;
    if (meta.stage !== 'video') throw new Error(`stage=${meta.stage}`);
    expect(meta.murchGrade).toBe('A');
    expect(meta.shotId).toBe('shot-001');
    expect(validateFlowGraphV3(g).ok).toBe(true);
  });

  it('d. global: data.archetype/viewAngle → meta 双字段读回', () => {
    const { graph: g } = migrateOne('asset', { assetType: 'role', archetype: 'sage', viewAngle: 'front' }, 'n_global_e');
    const meta = asset(g, 'n_global_e').meta;
    if (meta.stage !== 'global') throw new Error(`stage=${meta.stage}`);
    expect(meta.assetType).toBe('role');
    expect(meta.archetype).toBe('sage');
    expect(meta.viewAngle).toBe('front');
    expect(validateFlowGraphV3(g).ok).toBe(true);
  });

  it('e. audio 回归锁: audioType voice + data.emotion(string) → stage voice 且 meta.emotion string（双类型契约另一半）', () => {
    const { graph: g } = migrateOne('audio', { audioType: 'voice', emotion: '激动' }, 'n_audio_e');
    const a = asset(g, 'n_audio_e');
    expect(a.stage).toBe('voice');
    const meta = a.meta;
    if (meta.stage !== 'voice') throw new Error(`stage=${meta.stage}`);
    expect(meta.emotion).toBe('激动');
    expect(typeof meta.emotion).toBe('string');
    expect(validateFlowGraphV3(g).ok).toBe(true);
  });

  it('f. 负向: script data 无 emotion → meta 不含 emotion 键（undefined）', () => {
    const { graph: g } = migrateOne('script', { hookType: '悬念' }, 'n_script_ne');
    const meta = asset(g, 'n_script_ne').meta;
    if (meta.stage !== 'script') throw new Error(`stage=${meta.stage}`);
    expect(meta.emotion).toBeUndefined();
    expect('emotion' in meta).toBe(false); // 条件展开：缺省不写键
    expect(validateFlowGraphV3(g).ok).toBe(true);
  });
})
