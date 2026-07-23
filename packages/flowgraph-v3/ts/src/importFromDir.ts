/**
 * §16 外部 producer 接入：shot-timeline → FlowGraphV3（import-from-dir 映射升级）。
 *
 * 宪法 §16 五条逐条落地（orchestrator 映射决策见各段注释）：
 *  1. 整份 ShotTimelineAsset 收敛为 1 个 shot_decompose 事件：
 *     inputs = 原成片（role:'decompose_source'），params 记录 whisper/stems/detector/contract
 *     版本与来源文件，outputs = 93 分镜 + 4 音轨资产（97 条 output 边）。
 *  2. N-1 条镜头顺序边 → role:'sequence'（P11：不参与因果分层）。
 *  3. 全部产物 curation:'locked'；「拉片参考区」语义由独立 branch（br_reference）承载
 *     ——schema 无 zone 字段，zone 留给布局引擎（见 README 假设清单）。
 *  4. prompts.json 7-facet → storyboard 资产 meta.promptMeta（描述，非配方，P4 边界）。
 *  5. 成片资产（1 个 composite，episode 级）挂 TimelineStructure(source:'decompose')。
 *
 * P2 说明：成片资产是 shot_decompose 的外部输入（宪法 P2 明写的种子例外之一），
 * 不补 import 事件；其余 97 个资产全部由解构事件的 output 边闭环。
 *
 * 确定性（决策 10）：同输入 → 字节级同输出。id 全部确定性命名，时间戳由 opts.now
 * 注入（默认 0），数组顺序仅依赖输入数据与固定常量，无任何环境/随机源。
 */
import type {
  AssetNodeV3,
  EventNodeV3,
  FlowBranchV2,
  FlowGraphV3,
  FlowLinkV3,
  PromptFacets,
  Stage,
  TimelineShot,
  TimelineStructure,
  VariantGroupV3,
} from './types.js';
import { checkReferentialIntegrity } from './integrity.js';

// ---------- 输入契约（shot-timeline 外部 producer 四文件的最小读取面） ----------

/** shots.json 条目：镜头切分结果。 */
export interface ShotEntry {
  id: number;
  start_sec: number;
  end_sec: number;
  duration: number;
}

/** prompts.json 条目：7-facet 描述性 prompt（§8 PromptFacets 的数据源）。 */
export interface PromptEntry {
  shot_id: number;
  start_sec: number;
  end_sec: number;
  duration: number;
  subject: string;
  action: string;
  camera: string;
  scene: string;
  lighting: string;
  style: string;
  prompt_text: string;
}

/** audio_analysis.json 的 per-shot 条目（只读映射所需字段，其余字段原样容忍）。 */
export interface AudioAnalysisShot {
  shot_id: number;
  start_sec: number;
  end_sec: number;
  duration: number;
  dominant_type: string;
}

/** audio_analysis.json（episode 级）。 */
export interface AudioAnalysis {
  episode?: string;
  duration: number;
  stems: string[];
  shots: AudioAnalysisShot[];
  type_distribution: Record<string, number>;
}

/** transcript.json（whisper 转录）。 */
export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface Transcript {
  backend: string;
  model: string;
  language: string;
  segments: TranscriptSegment[];
  text?: string;
  duration?: number;
  /** 原成片文件名 → 成片资产 media.original。 */
  source: string;
}

export interface ShotTimelineInput {
  shots: ShotEntry[];
  prompts: PromptEntry[];
  audioAnalysis: AudioAnalysis;
  transcript: Transcript;
}

// ---------- 输出报告 ----------

export interface ImportReport {
  assetIds: {
    /** 成片资产 id（asset_ext_film_01）。 */
    film: string;
    /** shot_decompose 事件 id（evt_decompose_01）。 */
    event: string;
    /** 93 个分镜资产 id（时间序）。 */
    storyboards: string[];
    /** stem 轨 → 资产 id（asset_stem_<track>）。 */
    stems: Record<string, string>;
    /** 解构集变体组 id（vg_decompose）。 */
    variantGroup: string;
  };
  sequenceEdgeCount: number;
  outputEdgeCount: number;
  /**
   * episode 级 type_distribution 与 per-shot dominant_type：schema（3.1）无槽位承载，
   * 按决策 9 禁止偷渡进 params/meta，只进本报告（README 假设清单记 schema gap，
   * 候选 minor：TimelineShot.observedAudioType）。
   */
  typeDistribution: Record<string, number>;
  perShotAudioType: Record<string, string>;
  warnings: string[];
}

// ---------- 常量（确定性命名的唯一来源） ----------

const BRANCH_ID = 'br_reference'; // 决策 8：拉片参考区 = 独立 branch + curation:'locked'
const FILM_ASSET_ID = 'asset_ext_film_01';
const EVENT_ID = 'evt_decompose_01';
const VARIANT_GROUP_ID = 'vg_decompose';
const SOURCE_FILES = ['shots.json', 'prompts.json', 'audio_analysis.json', 'transcript.json'];

/** 泳道序（与 migrate.ts STAGE_ORDER 一致，README 假设 4：展示层约定）。 */
const STAGE_ORDER: Record<Stage, number> = {
  global: 0,
  script: 1,
  storyboard: 2,
  keyframe: 3,
  video: 4,
  voice: 5,
  foley: 6,
  bgm: 7,
  mix: 8,
  composite: 9,
};

/**
 * 【stems→三轨映射假设，待与 producer 确认】
 * demucs 4 轨 → 宪法三轨：vocals→voice，other→foley，drums/bass→bgm（两个 bgm 资产）。
 */
const STEM_STAGE_MAP: Record<string, 'voice' | 'foley' | 'bgm'> = {
  vocals: 'voice',
  other: 'foley',
  drums: 'bgm',
  bass: 'bgm',
};

const pad3 = (n: number) => String(n).padStart(3, '0');
const storyboardAssetId = (shotId: number) => `asset_decomp_shot_${pad3(shotId)}`;
const stemAssetId = (track: string) => `asset_stem_${track}`;

// ---------- 主函数 ----------

export function importShotTimelineAsset(
  input: ShotTimelineInput,
  opts: { projectId: number; episodesId: number; now?: number },
): { graph: FlowGraphV3; report: ImportReport } {
  const now = opts.now ?? 0;
  const warnings: string[] = [];
  const { shots, prompts, audioAnalysis, transcript } = input;

  // ----- 三项对齐校验：shots / prompts / audioAnalysis.shots 的 shot_id 集合必须一致 -----
  const idSetOf = (ids: number[]) => new Set(ids);
  const shotIds = idSetOf(shots.map((s) => s.id));
  const promptIds = idSetOf(prompts.map((p) => p.shot_id));
  const audioIds = idSetOf(audioAnalysis.shots.map((s) => s.shot_id));
  const sameSet = (a: Set<number>, b: Set<number>) =>
    a.size === b.size && [...a].every((x) => b.has(x));
  if (
    shots.length !== shotIds.size ||
    prompts.length !== promptIds.size ||
    audioAnalysis.shots.length !== audioIds.size ||
    !sameSet(shotIds, promptIds) ||
    !sameSet(shotIds, audioIds)
  ) {
    throw new Error(
      `importShotTimelineAsset: 三文件 shot_id 集合不对齐 ` +
        `(shots=${shotIds.size}, prompts=${promptIds.size}, audio_analysis=${audioIds.size})`,
    );
  }

  // 确定性时序：按 start_sec 排序（并列按 id 兜底），样本本身即按此序
  const orderedShots = [...shots].sort((a, b) => a.start_sec - b.start_sec || a.id - b.id);
  const promptByShotId = new Map(prompts.map((p) => [p.shot_id, p]));

  // 样本数据问题检查（只进 warnings，不阻断）
  const maxSegEnd = transcript.segments.reduce((m, s) => Math.max(m, s.end), 0);
  if (maxSegEnd > audioAnalysis.duration) {
    warnings.push(
      `transcript 末段 end=${maxSegEnd} 超出 audio_analysis.duration=${audioAnalysis.duration}` +
        `（whisper 时间轴与成片时长不一致，按重叠聚合不受影响）`,
    );
  }
  // transcript.source 文件名可疑（括号不配对等截断特征）：原样透传 media.original，但记 warning 不静默
  const src = transcript.source;
  const unbalanced = [...src].reduce((n, c) => n + (c === '(' || c === '（' ? 1 : c === ')' || c === '）' ? -1 : 0), 0) !== 0;
  if (unbalanced) {
    warnings.push(`transcript.source 文件名疑似截断（括号不配对）：${src}（已原样透传 media.original）`);
  }

  // ----- 节点公共骨架（§7 FlowNodeBase；position 是布局引擎缓存，这里给占位 0） -----
  const base = (id: string, stage: Stage) => ({
    id,
    branchId: BRANCH_ID,
    phaseIndex: STAGE_ORDER[stage],
    phaseName: stage,
    position: { x: 0, y: 0 },
    size: { width: 240, height: 160 },
    state: 'success' as const,
  });

  const nodes: FlowGraphV3['nodes'] = [];
  const links: FlowLinkV3[] = [];

  // ----- 决策 1：1 个 composite 外部成片资产（episode 级，挂 TimelineStructure） -----
  const film: AssetNodeV3 = {
    ...base(FILM_ASSET_ID, 'composite'),
    kind: 'asset',
    stage: 'composite',
    modality: 'video',
    scope: 'episode',
    media: {
      original: transcript.source, // 原成片文件名；样本无实际媒体文件 → 三件套置 null
      proxy: null,
      thumbnail: null,
      waveform: null,
      durationS: audioAnalysis.duration,
    },
    meta: { stage: 'composite' },
    curation: 'locked',
    stale: null,
    // timeline 在尾部填充（需要先建 stem 资产 id）
  };

  // ----- 决策 2：1 个 shot_decompose 事件（外部 producer，executor:'cloud'） -----
  const decomposeEvent: EventNodeV3 = {
    ...base(EVENT_ID, 'composite'),
    kind: 'event',
    op: 'shot_decompose',
    params: {
      whisper: {
        backend: transcript.backend,
        model: transcript.model,
        language: transcript.language,
      },
      stems: { model: null, tracks: [...audioAnalysis.stems] },
      detector: null,
      contract: 'shot-timeline/unknown',
      sourceFiles: [...SOURCE_FILES],
      note: '版本字段样本未提供，待 producer 侧补齐',
    },
    executor: 'cloud',
  };

  // 入边：成片 → 事件（role:'decompose_source'，P2 种子例外：成片是外部输入，无 output 入边）
  links.push({
    id: 'lnk_decompose_source',
    source: FILM_ASSET_ID,
    target: EVENT_ID,
    branchId: BRANCH_ID,
    role: 'decompose_source',
  });

  // ----- 决策 3：93 个 storyboard 资产（一产出；7-facet 进 meta.promptMeta） -----
  const storyboards: AssetNodeV3[] = [];
  const promptMetaOf = (shotId: number): PromptFacets => {
    const p = promptByShotId.get(shotId)!;
    return {
      subject: p.subject,
      action: p.action,
      camera: p.camera,
      scene: p.scene,
      lighting: p.lighting,
      style: p.style,
      text: p.prompt_text,
    };
  };

  for (const s of orderedShots) {
    const assetId = storyboardAssetId(s.id);
    storyboards.push({
      ...base(assetId, 'storyboard'),
      kind: 'asset',
      stage: 'storyboard',
      modality: 'image',
      scope: 'episode',
      media: { original: null, proxy: null, thumbnail: null, waveform: null },
      meta: {
        stage: 'storyboard',
        shotId: String(s.id),
        // 诚实缺省：样本无景别字段（README 假设清单）
        shotType: 'unknown',
        durationS: s.duration,
        cameraMovement: promptByShotId.get(s.id)!.camera,
        promptMeta: promptMetaOf(s.id),
      },
      curation: 'locked',
      stale: null,
      variantGroupId: VARIANT_GROUP_ID,
    });
    links.push({
      id: `lnk_out_shot_${pad3(s.id)}`,
      source: EVENT_ID,
      target: assetId,
      branchId: BRANCH_ID,
      role: 'output',
    });
  }

  // ----- 决策 4：stem 音频资产（【stems→三轨映射假设，待与 producer 确认】） -----
  const stemIds: Record<string, string> = {};
  const stemAssets: AssetNodeV3[] = [];
  for (const track of audioAnalysis.stems) {
    const stage = STEM_STAGE_MAP[track];
    if (stage == null) {
      warnings.push(`未知 stem 轨 "${track}"：无三轨映射规则，已跳过（待与 producer 确认）`);
      continue;
    }
    const assetId = stemAssetId(track);
    stemIds[track] = assetId;
    stemAssets.push({
      ...base(assetId, stage),
      kind: 'asset',
      stage,
      modality: 'audio',
      scope: 'episode',
      // 样本无音频文件 → media 全 null
      media: { original: null, proxy: null, thumbnail: null, waveform: null },
      // episode 级音轨：meta.speaker/emotion 省略（voice/foley/bgm 分支均只读 stage）
      meta: { stage },
      curation: 'locked',
      stale: null,
      variantGroupId: VARIANT_GROUP_ID,
    });
    links.push({
      id: `lnk_out_stem_${track}`,
      source: EVENT_ID,
      target: assetId,
      branchId: BRANCH_ID,
      role: 'output',
    });
  }

  // ----- 决策 5：92 条 sequence 边（分镜 i→i+1，P11 不参与因果分层） -----
  let sequenceEdgeCount = 0;
  for (let i = 0; i + 1 < orderedShots.length; i++) {
    const from = storyboardAssetId(orderedShots[i]!.id);
    const to = storyboardAssetId(orderedShots[i + 1]!.id);
    links.push({
      id: `lnk_seq_${pad3(orderedShots[i]!.id)}_${pad3(orderedShots[i + 1]!.id)}`,
      source: from,
      target: to,
      branchId: BRANCH_ID,
      role: 'sequence',
    });
    sequenceEdgeCount++;
  }

  // ----- 决策 7：TimelineStructure（source:'decompose'，episode 级 stem 引用 + 对白聚合） -----
  // TimelineShot.bgm 是单槽位，而 bgm 有 drums+bass 两个 stem 资产：
  // 确定性取舍 = 指向 stems 顺序中首个 bgm 资产，取舍本身记 warning（不静默）。
  const firstBgmTrack = audioAnalysis.stems.find((t) => STEM_STAGE_MAP[t] === 'bgm');
  const bgmRef = firstBgmTrack != null ? stemIds[firstBgmTrack] : undefined;
  const bgmTracks = audioAnalysis.stems.filter((t) => STEM_STAGE_MAP[t] === 'bgm');
  if (bgmTracks.length > 1) {
    warnings.push(
      `TimelineShot.bgm 为单槽位，无法承载 ${bgmTracks.length} 条 bgm stem（${bgmTracks.join('/')})；` +
        `暂指向 ${bgmRef}，其余 bgm 资产由变体组/output 边承载（待 schema/映射确认）`,
    );
  }

  /**
   * dialogueText 聚合规则：shot [startS,endS) 与 segment [start,end) 有任意时间重叠
   * 即纳入（seg.start < endS && seg.end > startS），按 segment 顺序以空字符串拼接，
   * 去首尾空白；无重叠则省略该字段。
   */
  const dialogueFor = (startS: number, endS: number): string | undefined => {
    const text = transcript.segments
      .filter((seg) => seg.start < endS && seg.end > startS)
      .map((seg) => seg.text)
      .join('')
      .trim();
    return text.length > 0 ? text : undefined;
  };

  const timelineShots: TimelineShot[] = orderedShots.map((s, index) => {
    const dialogueText = dialogueFor(s.start_sec, s.end_sec);
    return {
      shotId: String(s.id),
      index,
      startS: s.start_sec,
      endS: s.end_sec,
      ...(stemIds['vocals'] != null ? { voice: stemIds['vocals'] } : {}),
      ...(stemIds['other'] != null ? { foley: stemIds['other'] } : {}),
      ...(bgmRef != null ? { bgm: bgmRef } : {}),
      promptMeta: promptMetaOf(s.id),
      ...(dialogueText != null ? { dialogueText } : {}),
    };
  });

  const timeline: TimelineStructure = {
    durationS: audioAnalysis.duration,
    source: 'decompose',
    shots: timelineShots,
  };
  film.timeline = timeline;

  // ----- 决策 6：1 个 VariantGroup（§11 解构集同构复用，selectMode:'locked'，无 winner） -----
  const variantNodeIds = [
    ...storyboards.map((a) => a.id),
    ...stemAssets.map((a) => a.id),
  ];
  const variantGroup: VariantGroupV3 = {
    id: VARIANT_GROUP_ID,
    branchId: BRANCH_ID,
    phaseIndex: STAGE_ORDER.composite,
    sourceEventId: EVENT_ID,
    variantNodeIds,
    selectMode: 'locked',
  };

  // ----- 组装（节点顺序固定：成片 → 事件 → 93 分镜 → 4 音轨） -----
  nodes.push(film, decomposeEvent, ...storyboards, ...stemAssets);

  const branches: FlowBranchV2[] = [
    // 决策 8：拉片参考区语义由独立 branch 承载（zone 留给布局引擎，schema 无此字段）
    { id: BRANCH_ID, name: '拉片参考', createdAt: now },
  ];

  const graph: FlowGraphV3 = {
    meta: {
      version: '3',
      projectId: opts.projectId,
      episodesId: opts.episodesId,
      createdAt: now,
      updatedAt: now,
    },
    nodes,
    links,
    branches,
    variantGroups: [variantGroup],
  };

  // 终检：构造输出必须 0 issue（与 migrate.ts 同款防御，不静默透传悬空引用）
  for (const issue of checkReferentialIntegrity(graph)) {
    warnings.push(`导入输出完整性（终检残留）: ${issue.path} ${issue.message}`);
  }

  const report: ImportReport = {
    assetIds: {
      film: FILM_ASSET_ID,
      event: EVENT_ID,
      storyboards: storyboards.map((a) => a.id),
      stems: stemIds,
      variantGroup: VARIANT_GROUP_ID,
    },
    sequenceEdgeCount,
    outputEdgeCount: variantNodeIds.length,
    // 决策 9：dominant_type / type_distribution 只进报告，不进 params/meta（schema 无槽位）
    typeDistribution: { ...audioAnalysis.type_distribution },
    perShotAudioType: Object.fromEntries(
      [...audioAnalysis.shots]
        .sort((a, b) => a.start_sec - b.start_sec || a.shot_id - b.shot_id)
        .map((s) => [String(s.shot_id), s.dominant_type]),
    ),
    warnings,
  };

  return { graph, report };
}
