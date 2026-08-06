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
} from '../src/types.js';
import type { FlowGraphV2Export, FlowNodeV2Data } from '../src/v2types.js';

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
