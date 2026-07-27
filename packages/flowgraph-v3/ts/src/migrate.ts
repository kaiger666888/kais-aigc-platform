/**
 * §14 V2 → V3 迁移（纯函数）。
 *
 * 宪法 §14 映射表逐行落地（每行实现落点见函数内注释【§14】）：
 *  | type:'script'          → kind:asset, stage:script, modality:text, prompt→content
 *  | type:'storyboard'      → stage:storyboard, modality:image, data 字段进 meta
 *  | type:'video'           → stage:video（P11 产物）/ composite（P12 master-timeline）
 *  | type:'audio'           → modality:audio, stage 按 audioType 拆 voice/foley/bgm
 *  | type:'asset'           → scope:'global' → 第 0 列
 *  | type:'upscale'/'face_restore' → 改为事件 op，原节点改为普通资产 + output 边
 *  | type:'variant'         → 废弃，由 VariantGroupV3.sourceEventId 表达（同事件多输出归组）
 *  | type:'reference' / ensure_reference_link → 统一为边 role:'reference'
 *  | sequence 边            → 边 role:'sequence'
 *  | data.filePath          → media.original
 *  | data.thumbnailPath     → media.thumbnail（data.thumbnailUrl 为旧别名兜底）
 *  | 节点 data 上的 prompt/seed/engine → 生成事件 params；无事件的补 import 种子事件（P2）
 *  | isWinner               → curation:'selected'
 *
 * 关键设计（V2 无事件实体，全部事件由迁移合成）：
 *  - 每个保留节点合成 1 个生成事件 + 1 条 output 边（P2 闭环由构造保证）。
 *  - 节点有配方（prompt/seed/engine）或有因果入边 → 合成类型对应的生成事件；
 *    两者皆无（仅 video/audio/upscale/face_restore 这类「生成产物」型）→
 *    判定为孤儿资产，补 import 种子事件并逐个列入 report.importedSeedEvents（P2 一个不许漏）。
 *  - script/storyboard 无配方无入边 → op:'create'（人工作品，本身是 P2 种子型事件），不算补种。
 *  - variant 组：候选节点各自的事件合并为 winner 的单事件（多输出归组，P12），
 *    非 winner 候选的种子配方以 params.variantRecipes 留存（§9 开放扩展点，可复现）；
 *    非 winner 下游边同步 isInactive（§11 选定联动的迁移时点状态）。
 */
import type {
  AIScore,
  AssetNodeV3,
  AssetStageMeta,
  EventNodeV3,
  EventOp,
  FlowGraphV3,
  FlowLinkV3,
  FlowMetaV3,
  GenerationParams,
  NodeState,
  ReviewStatus,
  SlotRole,
  Stage,
  VariantGroupV3,
} from './types.js';
import type { FlowGraphV2Export, FlowLinkV2, FlowNodeV2 } from './v2types.js';
import { checkReferentialIntegrity } from './integrity.js';

/** 结构化深拷贝（纯函数契约：输出与输入不共享引用）。 */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ---------- MigrationReport ----------

export interface NodeMigrationEntry {
  v2NodeId: string;
  v2Type: string;
  /** 迁移去向动作（如 'asset+event' / 'dropped_variant_grouped' / 'rewired_to_reference_edges'）。 */
  action: string;
  v3NodeIds: string[];
}

export interface LinkMigrationEntry {
  v2LinkId: string;
  source: string;
  target: string;
  dataType: string | null;
  action: string;
  v3LinkIds: string[];
}

export interface MigrationReport {
  /** 每节点的迁移去向映射。 */
  nodeMap: NodeMigrationEntry[];
  /** 每边的迁移去向映射。 */
  linkMap: LinkMigrationEntry[];
  /** 补种的 import 种子事件清单（P2，一个不许漏）。 */
  importedSeedEvents: Array<{ eventId: string; assetNodeId: string; reason: string }>;
  /** 无法判定 / 取默认值的告警清单。 */
  warnings: string[];
}

// ---------- 内部工具 ----------

/** §7：V2 公共字段全保留；V2 phaseIndex/phaseName 可缺，按 stage 泳道序补齐（假设，见 README）。 */
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

const NODE_STATES: readonly string[] = ['pending', 'running', 'success', 'failed'];
const REVIEW_STATUSES: readonly string[] = ['pending', 'approved', 'rejected'];
const GLOBAL_ASSET_TYPES: readonly string[] = ['role', 'tool', 'scene', 'lora', 'worldview'];

/** 迁移产物的执行状态默认 success（资产已存在）；V2 值合法则保留。 */
function normalizeState(v2: FlowNodeV2): NodeState {
  return v2.state && NODE_STATES.includes(v2.state) ? (v2.state as NodeState) : 'success';
}

function normalizeReviewStatus(v2: FlowNodeV2): ReviewStatus | undefined {
  return v2.reviewStatus && REVIEW_STATUSES.includes(v2.reviewStatus)
    ? (v2.reviewStatus as ReviewStatus)
    : undefined;
}

/** aiScore 兼容裸 number（【V2 复用·待与旧库对齐】）。 */
function normalizeAiScore(v2: FlowNodeV2): AIScore | undefined {
  if (v2.aiScore == null) return undefined;
  if (typeof v2.aiScore === 'number') return { overall: v2.aiScore };
  return v2.aiScore;
}

/** modality 嗅探：按 filePath 扩展名（假设：资产文件扩展名可信）。 */
function sniffModality(filePath: string | undefined, fallback: 'image' | 'audio' | 'video') {
  if (!filePath) return fallback;
  const p = filePath.toLowerCase();
  if (/\.(mp4|mov|webm|mkv|avi)$/.test(p)) return 'video' as const;
  if (/\.(wav|mp3|aac|flac|ogg|m4a)$/.test(p)) return 'audio' as const;
  if (/\.(png|jpe?g|webp|gif|bmp)$/.test(p)) return 'image' as const;
  return fallback;
}

/**
 * 仅当路径是前端可直接消费的形态（`/oss/...` 或绝对路径）时返回它；相对路径返回
 * null。storyboard 的 scene_ref 常是相对 episode 根的路径（如 `assets/S07/x.png`），
 * 前端无法解析会 404——这类由 canvas_sync / 补数据脚本解析成绝对路径回填到 filePath，
 * migrate 层只对已是可消费形态的 scene_ref 做兜底。
 */
function consumableMediaPath(p: unknown): string | null {
  return typeof p === 'string' && /^(\/oss\/|\/)/.test(p) ? p : null;
}

/** 从 character_refs[].turnaround_path 取首个字符串值（storyboard 画面再兜底）。 */
function firstTurnaroundPath(refs: unknown): unknown {
  if (!Array.isArray(refs)) return null;
  for (const r of refs) {
    if (r && typeof r === 'object') {
      const tp = (r as Record<string, unknown>).turnaround_path;
      if (typeof tp === 'string') return tp;
    }
  }
  return null;
}

/** 【§14】节点 data 上的 prompt/seed/engine → 生成事件 params（P4：配方唯一合法存放处）。 */
function recipeParams(v2: FlowNodeV2): GenerationParams {
  const d = v2.data ?? {};
  const params: GenerationParams = {};
  if (d.prompt != null) params.prompt = d.prompt;
  if (d.seed != null) params.seed = d.seed;
  if (d.engine != null) params.modelVersion = d.engine; // engine → modelVersion（§14 语义：引擎即模型版本）
  return params;
}

function hasRecipe(v2: FlowNodeV2): boolean {
  const d = v2.data ?? {};
  return d.prompt != null || d.seed != null || d.engine != null;
}

/** video 事件 op 推断：engine 字符串是唯一线索（假设，注释即规则）。 */
function inferVideoOp(v2: FlowNodeV2, warnings: string[]): EventOp {
  const engine = v2.data?.engine;
  if (engine) {
    if (/i2v/i.test(engine)) return 'wan22_i2v';
    if (/s2v/i.test(engine)) return 'wan22_s2v';
    if (/t2v|wan/i.test(engine)) return 'wan22_t2v';
    warnings.push(
      `节点 ${v2.id}: engine "${engine}" 无法判定 video op，默认 wan22_t2v（待与旧库对齐）`,
    );
    return 'wan22_t2v';
  }
  warnings.push(`节点 ${v2.id}: 缺 engine，video op 默认 wan22_t2v`);
  return 'wan22_t2v';
}

/**
 * 【§14】video → stage:video / composite 的判定规则（注释即规则）：
 * data.isMasterTimeline === true，或 phaseName 含 master/composite/成片/合成，
 * 或 data.edlRef 存在 → P12 master-timeline → stage:'composite'；否则 P11 产物 → stage:'video'。
 */
function inferVideoStage(v2: FlowNodeV2): 'video' | 'composite' {
  const d = v2.data ?? {};
  if (d.isMasterTimeline === true) return 'composite';
  if (d.edlRef != null) return 'composite';
  if (v2.phaseName && /master|composite|成片|合成|timeline/i.test(v2.phaseName)) return 'composite';
  return 'video';
}

/** 因果入边角色推断（假设：V2 无槽位语义，按源资产 stage 给最小合理 role）。 */
function inferInputRole(sourceStage: Stage | undefined, sourceAssetType?: string): SlotRole {
  if (sourceStage === 'keyframe') return 'keyframe';
  if (sourceStage === 'script' || sourceStage === 'storyboard') return 'prompt_ref';
  if (sourceStage === 'global' && sourceAssetType === 'lora') return 'lora_ref';
  return 'reference';
}

interface Ctx {
  warnings: string[];
  shotIdOf(v2: FlowNodeV2): string;
}

function buildMeta(v2: FlowNodeV2, stage: Stage, ctx: Ctx): AssetStageMeta {
  const d = v2.data ?? {};
  switch (stage) {
    case 'script':
      return {
        stage: 'script',
        ...(d.hookType != null ? { hookType: d.hookType } : {}),
        ...(d.hookIntensity != null ? { hookIntensity: d.hookIntensity } : {}),
        ...(d.premise != null ? { premise: d.premise } : {}),
      };
    case 'storyboard':
      if (d.shotType == null)
        ctx.warnings.push(`节点 ${v2.id}: storyboard 缺 shotType，默认 "unknown"`);
      if (d.durationS == null) ctx.warnings.push(`节点 ${v2.id}: storyboard 缺 durationS，默认 0`);
      return {
        stage: 'storyboard',
        shotId: ctx.shotIdOf(v2),
        shotType: d.shotType ?? 'unknown',
        durationS: d.durationS ?? 0,
        ...(d.cameraMovement != null ? { cameraMovement: d.cameraMovement } : {}),
        ...(d.framing != null ? { framing: d.framing } : {}),
        ...(d.composition != null ? { composition: d.composition } : {}),
        ...(d.pacing != null ? { pacing: d.pacing } : {}),
      };
    case 'keyframe':
      return { stage: 'keyframe', shotId: ctx.shotIdOf(v2) };
    case 'video':
      return {
        stage: 'video',
        shotId: ctx.shotIdOf(v2),
        ...(d.observedEndState != null ? { observedEndState: d.observedEndState } : {}),
      };
    case 'voice':
    case 'foley':
    case 'bgm':
      return {
        stage,
        ...(d.shotId != null ? { shotId: d.shotId } : {}),
        ...(d.emotion != null ? { emotion: d.emotion } : {}),
        ...(d.speaker != null ? { speaker: d.speaker } : {}),
      };
    case 'global': {
      // P04 角色 / P07 风格 → assetType；data.assetType 优先，phaseName 线索兜底。
      let assetType = d.assetType;
      if (assetType == null && v2.phaseName) {
        if (/P04|角色|role/i.test(v2.phaseName)) assetType = 'role';
        else if (/P07|风格|lora/i.test(v2.phaseName)) assetType = 'lora';
      }
      if (assetType == null || !GLOBAL_ASSET_TYPES.includes(assetType)) {
        ctx.warnings.push(
          `节点 ${v2.id}: global 资产 assetType 无法判定（${String(assetType)}），默认 "role"`,
        );
        assetType = 'role';
      }
      return {
        stage: 'global',
        assetType: assetType as 'role' | 'tool' | 'scene' | 'lora' | 'worldview',
      };
    }
    case 'mix':
      return { stage: 'mix' };
    case 'composite':
      return { stage: 'composite', ...(d.edlRef != null ? { edlRef: d.edlRef } : {}) };
  }
}

/** V2 节点类型 → V3 (stage, modality, scope, op, executor)。 */
interface NodePlan {
  stage: Stage;
  modality: 'text' | 'image' | 'audio' | 'video';
  scope: 'episode' | 'global';
  op: EventOp;
  executor: EventNodeV3['executor'];
  /** true = 无配方无入边时补 import 种子事件（孤儿，列 report）。 */
  orphanEligible: boolean;
}

function planNode(v2: FlowNodeV2, warnings: string[]): NodePlan {
  const d = v2.data ?? {};
  switch (v2.type) {
    case 'script': // 【§14】script → stage:script, modality:text
      return {
        stage: 'script',
        modality: 'text',
        scope: 'episode',
        op: 'create',
        executor: 'human',
        orphanEligible: false, // 人工作品，create 即种子事件
      };
    case 'storyboard': // 【§14】storyboard → stage:storyboard, modality:image
      return {
        stage: 'storyboard',
        modality: 'image',
        scope: 'episode',
        op: 'create',
        executor: 'human',
        orphanEligible: false,
      };
    case 'video': {
      // 【§14】video → video / composite，op 按 engine 推断
      const stage = inferVideoStage(v2);
      return {
        stage,
        modality: 'video',
        scope: 'episode',
        op: stage === 'composite' ? 'compose' : inferVideoOp(v2, warnings),
        executor: 'gpu0',
        orphanEligible: true,
      };
    }
    case 'audio': {
      // 【§14】audio → 按 audioType 拆 voice/foley/bgm（op 同步拆 tts/foley_gen/bgm_gen）
      const at = d.audioType;
      if (at === 'foley')
        return {
          stage: 'foley',
          modality: 'audio',
          scope: 'episode',
          op: 'foley_gen',
          executor: 'gpu0',
          orphanEligible: true,
        };
      if (at === 'bgm')
        return {
          stage: 'bgm',
          modality: 'audio',
          scope: 'episode',
          op: 'bgm_gen',
          executor: 'gpu0',
          orphanEligible: true,
        };
      if (at !== 'voice')
        warnings.push(
          `节点 ${v2.id}: audioType "${String(at)}" 无法判定，默认 voice/tts（待与旧库对齐）`,
        );
      return {
        stage: 'voice',
        modality: 'audio',
        scope: 'episode',
        op: 'tts',
        executor: 'gpu0',
        orphanEligible: true,
      };
    }
    case 'asset':
      // 【§14】asset（P04 角色 / P07 风格）→ scope:'global' 第 0 列；外部来源 → import 种子事件
      return {
        stage: 'global',
        modality: sniffModality(d.filePath, 'image'),
        scope: 'global',
        op: 'import',
        executor: 'human',
        orphanEligible: false, // import 本来就是种子事件
      };
    case 'upscale':
    case 'face_restore': {
      // 【§14】upscale/face_restore → 改为事件 op，原节点改为普通资产 + output 边。
      // 结果资产 stage 继承首个因果入边源资产的 stage（keyframe/video/storyboard），
      // 无法判定时默认 video 并告警（stage 在入边处理后再校正，见下方二次修正）。
      return {
        stage: 'video',
        modality: sniffModality(d.filePath, 'video'),
        scope: 'episode',
        op: v2.type,
        executor: 'gpu0',
        orphanEligible: true,
      };
    }
    default:
      // variant / reference 不走这里（调用前已分流）
      throw new Error(`planNode: 不支持的 V2 节点类型 ${v2.type}（节点 ${v2.id}）`);
  }
}

// ---------- 主函数 ----------

export function migrateV2toV3(v2: FlowGraphV2Export): {
  graph: FlowGraphV3;
  report: MigrationReport;
} {
  const warnings: string[] = [];
  const nodeMap: NodeMigrationEntry[] = [];
  const linkMap: LinkMigrationEntry[] = [];
  const importedSeedEvents: MigrationReport['importedSeedEvents'] = [];

  const nodes: FlowGraphV3['nodes'] = [];
  const links: FlowLinkV3[] = [];
  const variantGroups: VariantGroupV3[] = [];

  const v2Nodes = new Map(v2.nodes.map((n) => [n.id, n]));
  const incoming = new Map<string, FlowLinkV2[]>(); // target → links
  const outgoing = new Map<string, FlowLinkV2[]>(); // source → links
  for (const l of v2.links) {
    incoming.set(l.target, [...(incoming.get(l.target) ?? []), l]);
    outgoing.set(l.source, [...(outgoing.get(l.source) ?? []), l]);
  }

  const ctx: Ctx = {
    warnings,
    shotIdOf(n) {
      if (n.data?.shotId != null) return n.data.shotId;
      const fallback = `shot-${n.id}`;
      warnings.push(`节点 ${n.id}: 缺 shotId，默认 "${fallback}"`);
      return fallback;
    },
  };

  // ----- Pass 1：保留节点 → 资产 + 事件 + output 边（variant/reference 分流） -----
  const eventIdOf = new Map<string, string>(); // v2NodeId → 合成事件 id
  const assetById = new Map<string, AssetNodeV3>();
  const eventById = new Map<string, EventNodeV3>();
  let linkCounter = 0;
  const nextLinkId = (hint: string) => `l_${hint}_${++linkCounter}`;

  for (const n of v2.nodes) {
    if (n.type === 'variant' || n.type === 'reference') continue; // Pass 3/4 处理

    const plan = planNode(n, warnings);
    const d = n.data ?? {};
    const causalInputs = (incoming.get(n.id) ?? []).filter(
      (l) => l.dataType !== 'sequence' && l.dataType !== 'variant',
    );
    const orphan = plan.orphanEligible && !hasRecipe(n) && causalInputs.length === 0;

    // P2：找不到归属事件的生成产物型资产 → 补 import 种子事件（一个不许漏）
    const op: EventOp = orphan ? 'import' : plan.op;
    const executor: EventNodeV3['executor'] = orphan ? 'human' : plan.executor;
    const params: GenerationParams = orphan
      ? { ...(d.filePath != null ? { sourcePath: d.filePath } : {}) }
      : plan.op === 'import'
        ? {
            ...(d.filePath != null ? { sourcePath: d.filePath } : {}),
            ...recipeParams(n),
          }
        : n.type === 'script'
          ? (() => {
              // 【§14】script 的 prompt → content（不进 params，防同一参数抄两处 / P4）
              const p = recipeParams(n);
              delete p.prompt;
              return p;
            })()
          : recipeParams(n);

    const phaseIndex = n.phaseIndex ?? STAGE_ORDER[plan.stage];
    const phaseName = n.phaseName ?? plan.stage;
    const position = n.position ?? { x: 0, y: 0 };
    const size = n.size ?? { width: 240, height: 160 };

    const eventId = `evt_${n.id}`;
    const eventNode: EventNodeV3 = {
      id: eventId,
      branchId: n.branchId,
      phaseIndex,
      phaseName,
      // 语义：布局引擎计算缓存（§7），迁移只给上游偏移占位，由布局引擎重算
      position: { x: position.x - 160, y: position.y },
      size,
      state: 'success',
      kind: 'event',
      op,
      params,
      executor,
    };
    eventById.set(eventId, eventNode);
    nodes.push(eventNode);
    eventIdOf.set(n.id, eventId);

    if (orphan) {
      importedSeedEvents.push({
        eventId,
        assetNodeId: n.id,
        reason: 'orphan_no_recipe_no_causal_input',
      });
    } else if (plan.op === 'import') {
      importedSeedEvents.push({ eventId, assetNodeId: n.id, reason: 'global_asset_seed' });
    }

    // 【§14】isWinner → curation:'selected'
    const curation: AssetNodeV3['curation'] = n.isWinner === true ? 'selected' : 'candidate';
    const asset: AssetNodeV3 = {
      id: n.id,
      branchId: n.branchId,
      phaseIndex,
      phaseName,
      position,
      size,
      state: normalizeState(n),
      kind: 'asset',
      stage: plan.stage,
      modality: plan.modality,
      scope: plan.scope,
      media: {
        // 【§14】data.filePath → media.original；data.thumbnailPath → media.thumbnail
        // （后端实际字段是 thumbnailPath；thumbnailUrl 为旧别名兜底。thumbnailPath 未进
        //  v2types 白名单——后端富字段，按 §7「V2 公共字段全保留」宽松消费，cast 读取）
        // storyboard 兜底：filePath 缺失时回退 scene_ref（场景参考图），再回退
        // character_refs[].turnaround_path——但仅当已是 /oss/ 或绝对路径形态
        // （相对路径前端无法解析，由 canvas_sync / 补数据脚本解析回填，不在此回退）。
        original: d.filePath
          ?? consumableMediaPath((d as Record<string, unknown>).scene_ref)
          ?? consumableMediaPath(firstTurnaroundPath((d as Record<string, unknown>).character_refs))
          ?? null,
        proxy: null,
        thumbnail: ((d as Record<string, unknown>).thumbnailPath as string | null | undefined) ?? d.thumbnailUrl ?? null,
        waveform: null,
        ...(d.durationS != null ? { durationS: d.durationS } : {}),
      },
      // 【§14】script: prompt→content（描述性文本本体，非配方）
      ...(n.type === 'script' && d.prompt != null ? { content: d.prompt } : {}),
      meta: buildMeta(n, plan.stage, ctx),
      ...(normalizeReviewStatus(n) != null ? { reviewStatus: normalizeReviewStatus(n)! } : {}),
      ...(normalizeAiScore(n) != null ? { aiScore: normalizeAiScore(n)! } : {}),
      curation,
      stale: null,
    };
    assetById.set(n.id, asset);
    nodes.push(asset);

    // output 边（event → asset）——P2 闭环
    links.push({
      id: nextLinkId(`out_${n.id}`),
      source: eventId,
      target: n.id,
      branchId: n.branchId,
      role: 'output',
    });

    nodeMap.push({
      v2NodeId: n.id,
      v2Type: n.type,
      action:
        n.type === 'upscale' || n.type === 'face_restore'
          ? 'event_op_plus_asset' // 【§14】改为事件 op，原节点改为普通资产 + output 边
          : orphan
            ? 'asset_plus_import_seed_event'
            : 'asset_plus_event',
      v3NodeIds: [n.id, eventId],
    });
  }

  // upscale/face_restore 结果资产 stage 二次修正：继承首个因果入边源资产 stage
  for (const n of v2.nodes) {
    if (n.type !== 'upscale' && n.type !== 'face_restore') continue;
    const asset = assetById.get(n.id)!;
    const causalIn = (incoming.get(n.id) ?? []).find(
      (l) => l.dataType !== 'sequence' && l.dataType !== 'variant' && assetById.has(l.source),
    );
    const srcStage = causalIn ? assetById.get(causalIn.source)?.stage : undefined;
    if (srcStage === 'keyframe' || srcStage === 'video' || srcStage === 'storyboard') {
      asset.stage = srcStage;
      asset.meta = buildMeta(n, srcStage, ctx);
    } else {
      warnings.push(`节点 ${n.id}: ${n.type} 结果资产 stage 无法继承（无因果入边），默认 video`);
    }
  }

  // ----- Pass 2：V2 边 → V3 槽位边（variant/reference 相关边分流） -----
  const isVariantNode = (id: string) => v2Nodes.get(id)?.type === 'variant';
  const isReferenceNode = (id: string) => v2Nodes.get(id)?.type === 'reference';

  v2.links.forEach((l, idx) => {
    const linkId = l.id ?? `lv2_${idx}`;
    const dt = l.dataType ?? null;

    if (isVariantNode(l.target) || isVariantNode(l.source)) {
      linkMap.push({
        v2LinkId: linkId,
        source: l.source,
        target: l.target,
        dataType: dt,
        action: 'consumed_by_variant_group',
        v3LinkIds: [],
      });
      return;
    }
    if (isReferenceNode(l.source) || isReferenceNode(l.target)) {
      linkMap.push({
        v2LinkId: linkId,
        source: l.source,
        target: l.target,
        dataType: dt,
        action: 'consumed_by_reference_rewire',
        v3LinkIds: [],
      });
      return;
    }

    const targetEvent = eventIdOf.get(l.target);
    // 【§14】sequence 边（import-from-dir 产物）→ role:'sequence'（asset→asset，不过事件）
    if (dt === 'sequence') {
      const id = nextLinkId('seq');
      links.push({
        id,
        source: l.source,
        target: l.target,
        branchId: v2Nodes.get(l.source)?.branchId ?? 'br_main',
        role: 'sequence',
        ...(l.isExplore != null ? { isExplore: l.isExplore } : {}),
      });
      linkMap.push({
        v2LinkId: linkId,
        source: l.source,
        target: l.target,
        dataType: dt,
        action: 'role_sequence',
        v3LinkIds: [id],
      });
      return;
    }

    if (!targetEvent) {
      warnings.push(`边 ${linkId}（${l.source}→${l.target}）：target 无合成事件，丢弃`);
      linkMap.push({
        v2LinkId: linkId,
        source: l.source,
        target: l.target,
        dataType: dt,
        action: 'dropped_no_target_event',
        v3LinkIds: [],
      });
      return;
    }

    // 【§14】type:'reference' / ensure_reference_link → 统一为边 role:'reference'
    // 普通因果边 → asset→事件 输入边，role 按源 stage 推断（假设，见 inferInputRole）
    const role: SlotRole =
      dt === 'reference' || dt === 'ensure_reference_link'
        ? 'reference'
        : inferInputRole(assetById.get(l.source)?.stage);
    const id = nextLinkId('in');
    links.push({
      id,
      source: l.source,
      target: targetEvent,
      branchId: v2Nodes.get(l.source)?.branchId ?? 'br_main',
      role,
      ...(l.isExplore != null ? { isExplore: l.isExplore } : {}),
    });
    linkMap.push({
      v2LinkId: linkId,
      source: l.source,
      target: l.target,
      dataType: dt,
      action: `input_edge_role_${role}`,
      v3LinkIds: [id],
    });
  });

  // ----- Pass 3：type:'variant' 废弃 → VariantGroupV3.sourceEventId（同事件多输出归组） -----
  for (const n of v2.nodes) {
    if (n.type !== 'variant') continue;
    const candidates = (incoming.get(n.id) ?? [])
      .filter((l) => l.dataType == null || l.dataType === 'variant')
      .map((l) => l.source)
      .filter((id) => assetById.has(id));
    if (candidates.length === 0) {
      warnings.push(`variant 节点 ${n.id}: 无候选入边，废弃且不建组`);
      nodeMap.push({
        v2NodeId: n.id,
        v2Type: n.type,
        action: 'dropped_variant_no_candidates',
        v3NodeIds: [],
      });
      continue;
    }

    // winner：候选中 isWinner===true（多个取首个并告警；没有则取首候选并告警）
    const winners = candidates.filter((id) => v2Nodes.get(id)?.isWinner === true);
    if (winners.length > 1)
      warnings.push(`variant 节点 ${n.id}: 多个 isWinner 候选，取首个 ${winners[0]}`);
    const winnerNodeId = winners[0] ?? candidates[0]!;
    if (winners.length === 0)
      warnings.push(`variant 节点 ${n.id}: 无 isWinner 候选，winner 默认首候选 ${winnerNodeId}`);

    // 多输出归组：候选事件合并为 winner 的单事件（P12：一次生成事件的多个输出天然构成变体组）
    const primaryEventId = eventIdOf.get(winnerNodeId)!;
    const primaryEvent = eventById.get(primaryEventId)!;
    const variantRecipes: Array<Record<string, unknown>> = [];
    for (const candId of candidates) {
      if (candId === winnerNodeId) continue;
      const candEventId = eventIdOf.get(candId)!;
      const candEvent = eventById.get(candEventId)!;
      // 非 winner 配方留存（§9 开放扩展点，保可复现）
      if (Object.keys(candEvent.params).length > 0) {
        variantRecipes.push({ assetId: candId, ...candEvent.params });
      }
      // output 边重指到主事件；输入边重指到主事件（去重）
      for (const link of links) {
        if (link.source === candEventId) link.source = primaryEventId;
        if (link.target === candEventId) link.target = primaryEventId;
      }
      eventById.delete(candEventId);
      const idx = nodes.findIndex((x) => x.id === candEventId);
      if (idx >= 0) nodes.splice(idx, 1);
    }
    if (variantRecipes.length > 0) primaryEvent.params.variantRecipes = variantRecipes;

    // 去重合并产生的重复输入边（同 source/target/role）
    const seen = new Set<string>();
    for (let i = links.length - 1; i >= 0; i--) {
      const l = links[i]!;
      if (l.role === 'output' || l.role === 'sequence') continue;
      const key = `${l.source}|${l.target}|${l.role}`;
      if (seen.has(key)) links.splice(i, 1);
      else seen.add(key);
    }

    // curation 与下游边置灰（§11 选定联动的迁移时点状态）
    const candSet = new Set(candidates);
    for (const candId of candidates) {
      const asset = assetById.get(candId)!;
      asset.curation = candId === winnerNodeId ? 'selected' : 'deprecated';
      asset.variantGroupId = `vg_${n.id}`;
    }
    for (const link of links) {
      if (!candSet.has(link.source)) continue;
      if (link.source === winnerNodeId) delete link.isInactive;
      else link.isInactive = true;
    }

    const group: VariantGroupV3 = {
      id: `vg_${n.id}`,
      branchId: n.branchId,
      phaseIndex: n.phaseIndex ?? assetById.get(winnerNodeId)!.phaseIndex,
      sourceEventId: primaryEventId,
      variantNodeIds: candidates,
      winnerNodeId,
      selectMode: 'single',
    };
    variantGroups.push(group);
    nodeMap.push({
      v2NodeId: n.id,
      v2Type: n.type,
      action: 'dropped_variant_grouped', // 【§14】variant 废弃 → VariantGroupV3.sourceEventId
      v3NodeIds: [group.id],
    });
  }

  // ----- Pass 4：type:'reference' 节点废弃 → 边 role:'reference'（incoming × outgoing 重接） -----
  for (const n of v2.nodes) {
    if (n.type !== 'reference') continue;
    const ins = (incoming.get(n.id) ?? []).map((l) => l.source).filter((id) => assetById.has(id));
    const outs = (outgoing.get(n.id) ?? [])
      .map((l) => l.target)
      .filter((id) => eventIdOf.has(id));
    const v3LinkIds: string[] = [];
    if (ins.length === 0 || outs.length === 0) {
      warnings.push(
        `reference 节点 ${n.id}: ${ins.length === 0 ? '无入边' : '无出边'}，无法重接为 reference 边，废弃`,
      );
    }
    for (const s of ins) {
      for (const t of outs) {
        const id = nextLinkId('ref');
        links.push({
          id,
          source: s,
          target: eventIdOf.get(t)!,
          branchId: n.branchId,
          role: 'reference',
        });
        v3LinkIds.push(id);
      }
    }
    nodeMap.push({
      v2NodeId: n.id,
      v2Type: n.type,
      action: 'rewired_to_reference_edges', // 【§14】统一为边 role:'reference'
      v3NodeIds: v3LinkIds,
    });
  }

  // ----- 尾部：引用完整性（F5）——迁移输出的悬空引用不静默透传：drop + 记 report.warnings -----
  // 典型来源：V2 边指向已被消费/不存在的节点（如 sequence 边端点是 variant/reference 之外的死引用）。
  {
    const nodeIds = new Set(nodes.map((n) => n.id));
    for (let i = links.length - 1; i >= 0; i--) {
      const l = links[i]!;
      if (!nodeIds.has(l.source) || !nodeIds.has(l.target)) {
        warnings.push(
          `迁移输出完整性：边 ${l.id}（${l.source}→${l.target}）端点悬空，已 drop（不静默透传）`,
        );
        links.splice(i, 1);
      }
    }
    for (let i = variantGroups.length - 1; i >= 0; i--) {
      const g = variantGroups[i]!;
      if (!nodeIds.has(g.sourceEventId)) {
        warnings.push(`迁移输出完整性：变体组 ${g.id} sourceEventId ${g.sourceEventId} 悬空，整组 drop`);
        variantGroups.splice(i, 1);
        continue;
      }
      const kept = g.variantNodeIds.filter((id) => {
        if (nodeIds.has(id)) return true;
        warnings.push(`迁移输出完整性：变体组 ${g.id} 成员 ${id} 悬空，已从 variantNodeIds 移除`);
        return false;
      });
      g.variantNodeIds = kept;
      if (g.winnerNodeId != null && !nodeIds.has(g.winnerNodeId)) {
        warnings.push(
          `迁移输出完整性：变体组 ${g.id} winnerNodeId ${g.winnerNodeId} 悬空，已清除 winner 持久化`,
        );
        delete g.winnerNodeId;
      }
    }
    // 终检在 graph 构造后执行（见函数尾部）
  }

  const meta: FlowMetaV3 = {
    version: '3',
    projectId: v2.meta.projectId,
    episodesId: v2.meta.episodesId, // P10：一集一画布
    ...(v2.meta.pipelineId != null ? { pipelineId: v2.meta.pipelineId } : {}),
    createdAt: v2.meta.createdAt ?? 0, // 假设：V2 缺时间戳补 0，待与旧库对齐
    updatedAt: v2.meta.updatedAt ?? 0,
    // 深拷贝：输出与输入不共享引用（纯函数契约——mutate 输出不许污染 V2 入参）
    ...(v2.meta.viewport != null ? { viewport: { ...v2.meta.viewport } } : {}),
  };

  const graph: FlowGraphV3 = {
    meta,
    nodes,
    links,
    branches: clone(v2.branches ?? []), // FlowBranchV2 原样保留（§11）；深拷贝防共享引用
    variantGroups,
  };
  // 终检：清理后必须 0 issue（不静默透传任何残留悬空引用；残留记入 warnings）
  for (const issue of checkReferentialIntegrity(graph)) {
    warnings.push(`迁移输出完整性（终检残留）: ${issue.path} ${issue.message}`);
  }
  return { graph, report: { nodeMap, linkMap, importedSeedEvents, warnings } };
}
