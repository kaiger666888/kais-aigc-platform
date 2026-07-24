/**
 * importFromDir.test.ts — §16 shot-timeline 外部 producer → FlowGraphV3 映射测试
 *
 * 覆盖：
 *  - 真实样本（fixtures/shot-timeline-sample/，93 镜头 + 4 stems）全量映射；
 *  - 输出过 Zod + ajv（schema 3.1，含 stage↔meta allOf 约束），integrity 0 issue；
 *  - 计数 / curation / TimelineStructure / promptMeta / P2 闭环 / 确定性 / 对齐校验；
 *  - 提交的 fixtures/v3-decompose-import.sample.json 与函数输出字节级一致（fixture 防腐）。
 */
import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import schema from '../../schema/flowgraph-v3.schema.json';
import generatedFixture from '../../fixtures/v3-decompose-import.sample.json';
import shotsJson from '../../fixtures/shot-timeline-sample/shots.json';
import promptsJson from '../../fixtures/shot-timeline-sample/prompts.json';
import audioAnalysisJson from '../../fixtures/shot-timeline-sample/audio_analysis.json';
import transcriptJson from '../../fixtures/shot-timeline-sample/transcript.json';
import type {
  AssetNodeV3,
  EventNodeV3,
  FlowGraphV3,
  TimelineShot,
} from '../src/types.js';
import {
  importShotTimelineAsset,
  type ShotTimelineInput,
} from '../src/importFromDir.js';
import { validateFlowGraphV3 } from '../src/zod.js';
import { checkReferentialIntegrity } from '../src/integrity.js';

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateAjv = ajv.compile(schema);

// 与 schema.test.ts 同款约定：fixtures 以 JSON module 导入（resolveJsonModule），
// 结构化拷贝后再交给映射函数（测试内会对副本做篡改，不污染 import 绑定）。
const loadSample = (): ShotTimelineInput =>
  JSON.parse(
    JSON.stringify({
      shots: shotsJson,
      prompts: promptsJson,
      audioAnalysis: audioAnalysisJson,
      transcript: transcriptJson,
    }),
  ) as ShotTimelineInput;

const OPTS = { projectId: 7, episodesId: 101, now: 0 };

function run() {
  return importShotTimelineAsset(loadSample(), OPTS);
}

const assets = (g: FlowGraphV3) => g.nodes.filter((n): n is AssetNodeV3 => n.kind === 'asset');
const events = (g: FlowGraphV3) => g.nodes.filter((n): n is EventNodeV3 => n.kind === 'event');

describe('§16 真实样本映射（93 镜头 / 4 stems）', () => {
  const { graph, report } = run();

  it('输出过 Zod + ajv（schema 3.1 含 allOf），integrity 0 issue', () => {
    const zodResult = validateFlowGraphV3(graph);
    expect(zodResult.ok).toBe(true);
    const ajvOk = validateAjv(graph);
    expect(validateAjv.errors).toBeNull();
    expect(ajvOk).toBe(true);
    expect(checkReferentialIntegrity(graph)).toEqual([]);
  });

  it('计数：1 成片 / 93 分镜 / 4 音轨 / 1 事件 / 97 output 边 / 92 sequence 边', () => {
    const a = assets(graph);
    expect(a.filter((n) => n.stage === 'composite')).toHaveLength(1);
    expect(a.filter((n) => n.stage === 'storyboard')).toHaveLength(93);
    expect(a.filter((n) => ['voice', 'foley', 'bgm'].includes(n.stage))).toHaveLength(4);
    // 【stems→三轨映射假设】vocals→voice, other→foley, drums/bass→bgm
    expect(a.filter((n) => n.stage === 'voice').map((n) => n.id)).toEqual(['asset_stem_vocals']);
    expect(a.filter((n) => n.stage === 'foley').map((n) => n.id)).toEqual(['asset_stem_other']);
    expect(a.filter((n) => n.stage === 'bgm').map((n) => n.id).sort()).toEqual([
      'asset_stem_bass',
      'asset_stem_drums',
    ]);

    const ev = events(graph);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.id).toBe('evt_decompose_01');
    expect(ev[0]!.op).toBe('shot_decompose');

    expect(graph.links.filter((l) => l.role === 'output')).toHaveLength(97);
    expect(graph.links.filter((l) => l.role === 'sequence')).toHaveLength(92);
    expect(graph.links.filter((l) => l.role === 'decompose_source')).toHaveLength(1);
    expect(report.outputEdgeCount).toBe(97);
    expect(report.sequenceEdgeCount).toBe(92);
  });

  it('1 个 selectMode:"locked" 变体组：sourceEventId=解构事件，成员 97，无 winner', () => {
    expect(graph.variantGroups).toHaveLength(1);
    const vg = graph.variantGroups[0]!;
    expect(vg.id).toBe('vg_decompose');
    expect(vg.selectMode).toBe('locked');
    expect(vg.sourceEventId).toBe('evt_decompose_01');
    expect(vg.variantNodeIds).toHaveLength(97);
    expect(vg.winnerNodeId).toBeUndefined();
    // variantNodeIds = output 边 target 集合（§11 冗余缓存一致性）
    const outputTargets = new Set(
      graph.links.filter((l) => l.role === 'output').map((l) => l.target),
    );
    expect(new Set(vg.variantNodeIds)).toEqual(outputTargets);
  });

  it('全部产物 curation:"locked"、stale:null（§16.3 / §13 参考叶子）', () => {
    for (const n of assets(graph)) {
      expect(n.curation).toBe('locked');
      expect(n.stale).toBeNull();
    }
  });

  it('成片资产：composite/video/episode，media.original=transcript.source，三件套 null', () => {
    const film = assets(graph).find((n) => n.id === 'asset_ext_film_01')!;
    expect(film.stage).toBe('composite');
    expect(film.modality).toBe('video');
    expect(film.scope).toBe('episode');
    expect(film.media.original).toBe(loadSample().transcript.source);
    expect(film.media.proxy).toBeNull();
    expect(film.media.thumbnail).toBeNull();
    expect(film.media.waveform).toBeNull();
    expect(film.meta).toEqual({ stage: 'composite' });
  });

  it('事件 params：whisper/stems/detector/contract/sourceFiles（决策 2），不偷渡 dominant_type（决策 9）', () => {
    const evt = events(graph)[0]!;
    expect(evt.params['whisper']).toEqual({
      backend: 'openai-whisper',
      model: 'large-v3',
      language: 'zh',
    });
    expect(evt.params['stems']).toEqual({
      model: null,
      tracks: ['vocals', 'drums', 'bass', 'other'],
    });
    expect(evt.params['detector']).toBeNull();
    expect(evt.params['contract']).toBe('shot-timeline/unknown');
    expect(evt.params['sourceFiles']).toEqual([
      'shots.json',
      'prompts.json',
      'audio_analysis.json',
      'transcript.json',
    ]);
    // 决策 9：type_distribution / dominant_type 禁止偷渡进 params/meta
    const paramsText = JSON.stringify(evt.params);
    expect(paramsText).not.toContain('dominant_type');
    expect(paramsText).not.toContain('type_distribution');
    for (const n of assets(graph)) {
      expect(JSON.stringify(n.meta)).not.toContain('dominant_type');
    }
    // 它们在 ImportReport 里有家
    expect(report.typeDistribution).toEqual({ dialogue: 44, mixed: 14, bgm: 20, sfx: 15 });
    expect(Object.keys(report.perShotAudioType)).toHaveLength(93);
    expect(report.perShotAudioType['1']).toBe('dialogue');
    expect(report.perShotAudioType['93']).toBe('sfx');
  });

  it('拉片参考区 = 独立 branch（br_reference，name:"拉片参考"），全部节点与边归属该 branch（决策 8）', () => {
    expect(graph.branches).toEqual([
      { id: 'br_reference', name: '拉片参考', createdAt: 0 },
    ]);
    for (const n of graph.nodes) expect(n.branchId).toBe('br_reference');
    for (const l of graph.links) expect(l.branchId).toBe('br_reference');
  });

  it('确定性 id 命名：asset_ext_film_01 / evt_decompose_01 / asset_decomp_shot_001..093 / asset_stem_*', () => {
    const ids = new Set(graph.nodes.map((n) => n.id));
    expect(ids.has('asset_ext_film_01')).toBe(true);
    expect(ids.has('evt_decompose_01')).toBe(true);
    for (let i = 1; i <= 93; i++) {
      expect(ids.has(`asset_decomp_shot_${String(i).padStart(3, '0')}`)).toBe(true);
    }
    for (const t of ['vocals', 'drums', 'bass', 'other']) {
      expect(ids.has(`asset_stem_${t}`)).toBe(true);
    }
  });
});

describe('TimelineStructure（决策 7）', () => {
  const { graph } = run();
  const film = assets(graph).find((n) => n.id === 'asset_ext_film_01')!;
  const timeline = film.timeline!;
  const input = loadSample();

  it('durationS=audio_analysis.duration，source:"decompose"，93 shots，index 连续 0..92', () => {
    expect(timeline.durationS).toBe(input.audioAnalysis.duration);
    expect(timeline.source).toBe('decompose');
    expect(timeline.shots).toHaveLength(93);
    timeline.shots.forEach((s, i) => {
      expect(s.index).toBe(i);
      expect(s.shotId).toBe(String(i + 1)); // 样本 id 1..93 与时间序一致
    });
  });

  it('episode 级 stem 引用：voice=asset_stem_vocals / foley=asset_stem_other / bgm=asset_stem_drums（首个 bgm，取舍已记 warning）', () => {
    for (const s of timeline.shots) {
      expect(s.voice).toBe('asset_stem_vocals');
      expect(s.foley).toBe('asset_stem_other');
      expect(s.bgm).toBe('asset_stem_drums');
    }
    // 单槽位 vs 双 bgm stem 的取舍必须 fail-visible（进 warnings，不静默）
    const { report } = run();
    expect(report.warnings.some((w) => w.includes('bgm') && w.includes('单槽位'))).toBe(true);
  });

  it('样本数据问题全部 fail-visible：transcript 超时长 + source 文件名截断进 warnings', () => {
    const { report } = run();
    expect(report.warnings.some((w) => w.includes('超出 audio_analysis.duration'))).toBe(true);
    expect(report.warnings.some((w) => w.includes('文件名疑似截断'))).toBe(true);
  });

  it('dialogueText 抽样手工核算：shot 2（[6.73,9.63)）重叠 segment 5.62-8.02/8.02-9.1/9.1-10.26', () => {
    // transcript 手工核算：三段文本 = '三 二' + '我喜欢他' + '我的爸爸'（空字符串拼接）
    const shot2 = timeline.shots[1]!;
    expect(shot2.startS).toBe(6.73);
    expect(shot2.endS).toBe(9.63);
    expect(shot2.dialogueText).toBe('三 二我喜欢他我的爸爸');
  });

  it('真实样本 93 shots 全部有对白（segments 连续覆盖）；合成无对白输入 → 省略 dialogueText 字段', () => {
    // 真实样本：whisper segments 覆盖全时间轴，93/93 有 dialogueText
    expect(timeline.shots.every((s) => typeof s.dialogueText === 'string')).toBe(true);

    // 合成输入：segment 只覆盖 shot 1 → shot 2 不得携带 dialogueText 键
    const synthetic: ShotTimelineInput = {
      shots: [
        { id: 1, start_sec: 0, end_sec: 5, duration: 5 },
        { id: 2, start_sec: 5, end_sec: 10, duration: 5 },
      ],
      prompts: [1, 2].map((id) => ({
        shot_id: id,
        start_sec: (id - 1) * 5,
        end_sec: id * 5,
        duration: 5,
        subject: 's',
        action: 'a',
        camera: 'c',
        scene: 'sc',
        lighting: 'l',
        style: 'st',
        prompt_text: 't',
      })),
      audioAnalysis: {
        duration: 10,
        stems: ['vocals'],
        shots: [
          { shot_id: 1, start_sec: 0, end_sec: 5, duration: 5, dominant_type: 'dialogue' },
          { shot_id: 2, start_sec: 5, end_sec: 10, duration: 5, dominant_type: 'bgm' },
        ],
        type_distribution: { dialogue: 1, bgm: 1 },
      },
      transcript: {
        backend: 'openai-whisper',
        model: 'large-v3',
        language: 'zh',
        source: 'x.mp4',
        segments: [{ start: 0, end: 4.9, text: '有对白的镜头' }],
      },
    };
    const { graph: g2 } = importShotTimelineAsset(synthetic, OPTS);
    const t2 = assets(g2).find((n) => n.id === 'asset_ext_film_01')!.timeline!;
    expect(t2.shots[0]!.dialogueText).toBe('有对白的镜头');
    expect('dialogueText' in t2.shots[1]!).toBe(false); // 无重叠 → 省略字段，不是空字符串
    expect(validateAjv(g2)).toBe(true);
  });

  it('promptMeta 与 prompts.json 逐字段相等（7-facet，text=prompt_text）；cameraMovement=prompts.camera', () => {
    const promptById = new Map(input.prompts.map((p) => [String(p.shot_id), p]));
    const storyboards = assets(graph).filter((n) => n.stage === 'storyboard');
    expect(storyboards).toHaveLength(93);
    for (const sb of storyboards) {
      const meta = sb.meta;
      if (meta.stage !== 'storyboard') throw new Error('meta 判别联合错配');
      const p = promptById.get(meta.shotId)!;
      expect(meta.promptMeta).toEqual({
        subject: p.subject,
        action: p.action,
        camera: p.camera,
        scene: p.scene,
        lighting: p.lighting,
        style: p.style,
        text: p.prompt_text,
      });
      expect(meta.cameraMovement).toBe(p.camera);
      expect(meta.shotType).toBe('unknown'); // 诚实缺省：样本无景别
      // TimelineShot.promptMeta 与分镜资产同源同值（§12 正逆向同构）
      const tlShot = timeline.shots.find((s: TimelineShot) => s.shotId === meta.shotId)!;
      expect(tlShot.promptMeta).toEqual(meta.promptMeta);
    }
  });
});

describe('P2 闭环与 P11 边语义', () => {
  const { graph } = run();

  it('97 个产出资产各有且仅有 1 条 output 入边；成片资产是 P2 种子例外（shot_decompose 外部输入）', () => {
    const outputInEdges = new Map<string, number>();
    for (const l of graph.links.filter((l) => l.role === 'output')) {
      outputInEdges.set(l.target, (outputInEdges.get(l.target) ?? 0) + 1);
      expect(l.source).toBe('evt_decompose_01');
    }
    for (const n of assets(graph)) {
      if (n.id === 'asset_ext_film_01') {
        // 宪法 P2 明写的例外：shot_decompose 的外部输入，无 output 入边，
        // 其溯源由 decompose_source 出边表达
        expect(outputInEdges.has(n.id)).toBe(false);
        const out = graph.links.filter((l) => l.source === n.id);
        expect(out).toHaveLength(1);
        expect(out[0]!.role).toBe('decompose_source');
        expect(out[0]!.target).toBe('evt_decompose_01');
      } else {
        expect(outputInEdges.get(n.id)).toBe(1);
      }
    }
    expect(outputInEdges.size).toBe(97);
  });

  it('sequence 边 source/target 都是 storyboard 资产，且连接相邻镜头 i→i+1（P11）', () => {
    const stageOf = new Map(assets(graph).map((n) => [n.id, n.stage]));
    const seq = graph.links.filter((l) => l.role === 'sequence');
    expect(seq).toHaveLength(92);
    seq.forEach((l, i) => {
      expect(stageOf.get(l.source)).toBe('storyboard');
      expect(stageOf.get(l.target)).toBe('storyboard');
      const pad = (n: number) => String(n).padStart(3, '0');
      expect(l.source).toBe(`asset_decomp_shot_${pad(i + 1)}`);
      expect(l.target).toBe(`asset_decomp_shot_${pad(i + 2)}`);
    });
  });
});

describe('确定性与对齐校验', () => {
  it('同输入跑两遍深比较相等（含与 opts.now 默认值一致）', () => {
    const a = run();
    const b = run();
    expect(JSON.stringify(a.graph)).toBe(JSON.stringify(b.graph));
    expect(a.report).toEqual(b.report);
    // now 缺省 = 0
    const c = importShotTimelineAsset(loadSample(), { projectId: 7, episodesId: 101 });
    expect(c.graph.meta.createdAt).toBe(0);
    expect(JSON.stringify(c.graph)).toBe(JSON.stringify(a.graph));
  });

  it('提交的 fixture 与函数输出一致（确定性防腐）', () => {
    const { graph } = run();
    // fixture 由同一序列化（JSON.stringify(graph, null, 2)+'\n'）产出；
    // 序列化等价 ⇒ 文件内容未漂移（py 侧 harness 另对文件做严格校验）
    expect(JSON.stringify(graph, null, 2) + '\n').toBe(
      JSON.stringify(generatedFixture, null, 2) + '\n',
    );
    // 提交态 fixture 自身也要过 ajv + Zod + integrity
    expect(validateAjv(generatedFixture)).toBe(true);
    expect(validateFlowGraphV3(generatedFixture).ok).toBe(true);
    expect(checkReferentialIntegrity(generatedFixture as FlowGraphV3)).toEqual([]);
  });

  it('三文件 shot_id 集合不对齐 → 抛错（含重复 id）', () => {
    const tampered = loadSample();
    tampered.prompts = tampered.prompts.filter((p) => p.shot_id !== 42);
    expect(() => importShotTimelineAsset(tampered, OPTS)).toThrow(/shot_id 集合不对齐/);

    const tampered2 = loadSample();
    tampered2.audioAnalysis.shots[0] = { ...tampered2.audioAnalysis.shots[0]!, shot_id: 999 };
    expect(() => importShotTimelineAsset(tampered2, OPTS)).toThrow(/shot_id 集合不对齐/);

    const tampered3 = loadSample();
    tampered3.shots = [...tampered3.shots, { ...tampered3.shots[0]! }]; // 重复 id
    expect(() => importShotTimelineAsset(tampered3, OPTS)).toThrow(/shot_id 集合不对齐/);
  });
});
