/**
 * FlowGraphV3 TS 类型
 * 语义来源：宪法 §7–§13（《AI短剧创作无限画布 · 设计宪法 v1.0》）
 * 与 schema/flowgraph-v3.schema.json（SSOT）逐字段对齐；冲突时以 schema/宪法为准。
 *
 * 假设标注（详见 README 假设清单）：
 *  - ReviewStatus / AIScore / FlowBranchV2：宪法注明"复用 V2"但 V2 定义不在宪法中，
 *    按最小合理定义补全，标注【V2 复用·待与旧库对齐】。
 *  - StructureNodeV3：宪法 §7 提及但未展开，按最小定义实现。
 *  - AssetStageMeta 补 { stage:'mix' } 空载荷分支（宪法 Stage 含 'mix' 但 §8 联合未列）。
 */

// ---------- §7 顶层结构 ----------

export interface FlowGraphV3 {
  meta: FlowMetaV3;
  nodes: FlowNodeV3[]; // AssetNodeV3 | EventNodeV3 | StructureNodeV3
  links: FlowLinkV3[]; // 槽位边
  branches: FlowBranchV2[]; // 复用，不动
  variantGroups: VariantGroupV3[];
}

export interface FlowMetaV3 {
  version: '3';
  projectId: number;
  episodesId: number; // P10：一集一画布
  pipelineId?: string;
  createdAt: number;
  updatedAt: number;
  viewport?: { x: number; y: number; zoom: number }; // P17
}

export interface FlowNodeBase {
  // V2 公共字段全保留
  id: string;
  branchId: string;
  phaseIndex: number; // 前后端统一必填（修掉 V2 不对齐）
  phaseName: string;
  position: { x: number; y: number }; // 语义：布局引擎计算缓存，不手排
  size: { width: number; height: number };
  state: NodeState; // pending|running|success|failed（执行状态）
}

export type FlowNodeV3 = AssetNodeV3 | EventNodeV3 | StructureNodeV3;

/** 执行状态（§13 状态机总表）。宪法 §7 明写取值。 */
export type NodeState = 'pending' | 'running' | 'success' | 'failed';

/**
 * 【V2 复用·待与旧库对齐】人工审核状态（§13）。
 * V2 定义不在宪法中；最小合理定义：pending/approved/rejected。
 */
export type ReviewStatus = 'pending' | 'approved' | 'rejected';

/**
 * 【V2 复用·待与旧库对齐】五维评分（§8，产物属性）。
 * V2 定义不在宪法中；最小合理定义：overall 总分必填，
 * dimensions 以维度名→分值映射承载五维明细。
 */
export interface AIScore {
  overall: number;
  dimensions?: Record<string, number>;
}

// ---------- §8 资产节点：只管"是什么" ----------

export interface AssetNodeV3 extends FlowNodeBase {
  kind: 'asset';

  stage: Stage; // P8：泳道（y 轴）
  modality: 'text' | 'image' | 'audio' | 'video'; // P8：颜色通道
  scope: 'episode' | 'global'; // P9：global 锚定第 0 列

  media: {
    // P15：轻量三件套
    original: string | null; // = V2 filePath
    proxy: string | null; // 480p 视频 / 压缩图
    thumbnail: string | null; // = V2 thumbnailUrl
    waveform: string | null; // 音频波形
    durationS?: number;
    resolution?: string;
  };

  content?: string; // text 模态的本体
  meta: AssetStageMeta; // 描述性元数据（判别联合，见下）
  timeline?: TimelineStructure; // P6：仅 stage='composite' 持有

  reviewStatus?: ReviewStatus; // 人工审核（复用）
  aiScore?: AIScore; // 五维评分（复用，产物属性）
  curation: 'candidate' | 'selected' | 'deprecated' | 'locked'; // P12
  stale: StaleInfo | null; // P13：null=干净
  variantGroupId?: string;
}

export type Stage =
  | 'global' // 第 0 列
  | 'script' // 剧本
  | 'storyboard' // 分镜
  | 'keyframe' // 关键帧
  | 'video' // 视频
  | 'voice' // 配音轨（Pass 1）
  | 'foley' // 音效轨（Pass 2）
  | 'bgm' // BGM 轨（Pass 3）
  | 'mix' // 混音产物
  | 'composite'; // 音画合成 / 成片

export interface StaleInfo {
  since: number;
  triggerAssetId: string;
  triggerEventId: string;
}

export type AssetStageMeta =
  | { stage: 'script'; hookType?: string; hookIntensity?: number; premise?: string; emotion?: number }
  | {
      stage: 'storyboard';
      shotId: string;
      shotType: string;
      cameraMovement?: string;
      framing?: string;
      composition?: string;
      pacing?: string;
      durationS: number;
      promptMeta?: PromptFacets;
    }
  | { stage: 'keyframe'; shotId: string }
  | { stage: 'video'; shotId: string; observedEndState?: string; murchGrade?: string }
  | { stage: 'voice' | 'foley' | 'bgm'; shotId?: string; emotion?: string; speaker?: string }
  | { stage: 'global'; assetType: 'role' | 'tool' | 'scene' | 'lora' | 'worldview'; archetype?: string; viewAngle?: string }
  /** 【假设】宪法 Stage 含 'mix' 但 §8 AssetStageMeta 未列其分支；最小补空载荷分支。 */
  | { stage: 'mix' }
  | { stage: 'composite'; edlRef?: string };

// 7-facet 描述性 prompt（P4 边界：这是"画面是什么"，不是"怎么生成的"）
export interface PromptFacets {
  subject?: string;
  action?: string;
  camera?: string;
  scene?: string;
  lighting?: string;
  style?: string;
  text?: string;
}

// ---------- §9 事件节点：只管"怎么来的" ----------

export interface EventNodeV3 extends FlowNodeBase {
  kind: 'event';
  op: EventOp;
  params: GenerationParams; // P4：配方唯一合法存放处
  executor: 'human' | 'gpu0' | 'gpu1' | 'cloud';
  durationS?: number;
  // inputs / outputs 不在节点上——由 links 表达，槽位 = 边
}

export type EventOp =
  // 种子与人工（P5 人机同构）
  | 'import'
  | 'create'
  | 'human_edit'
  // 视频生成
  | 'wan22_t2v'
  | 'wan22_i2v'
  | 'wan22_s2v'
  | 'bernini_edit'
  | 'ltx_ref'
  // 音频分轨
  | 'tts'
  | 'foley_gen'
  | 'bgm_gen'
  // 组装
  | 'mix'
  | 'compose'
  // 后处理
  | 'upscale'
  | 'face_restore'
  // 逆向与分析（P6 / P23）
  | 'shot_decompose' // 外部成片 → 解构集（一事件多产出）
  | 'script_analysis'; // 剧本段落 → 情绪标注 / 评估报告

export interface GenerationParams {
  prompt?: string;
  negative?: string;
  seed?: number;
  modelVersion?: string;
  lora?: Array<{ name: string; strength: number }>;
  steps?: number;
  cfg?: number;
  quant?: string;
  sageAttention?: boolean;
  [key: string]: unknown; // 开放扩展，op 级 schema 由 SSOT yaml 门控
}

// ---------- §10 边 = 槽位 ----------

export interface FlowLinkV3 {
  id: string;
  source: string;
  target: string;
  branchId: string;

  role: SlotRole; // 替代 V2 dataType
  slotParams?: {
    // P4：槽位级参数
    offsetS?: number; // "Foley 轨偏移 -0.3s"挂这里
    gain?: number;
    fadeInS?: number;
    fadeOutS?: number;
  };

  isExplore?: boolean;
  isInactive?: boolean; // 非选定变体下游边自动置灰
}

export type SlotRole =
  // —— 输入槽位（asset → event）——
  | 'keyframe'
  | 'prompt_ref'
  | 'lora_ref'
  | 'reference'
  | 'edit_target'
  | 'edit_source' // human_edit 新旧版
  | 'dialogue_track'
  | 'foley_track'
  | 'bgm_track' // mix 三路输入
  | 'video_track'
  | 'audio_mix' // compose 两路输入
  | 'decompose_source' // shot_decompose 的原成片
  // —— 产出（event → asset）——
  | 'output'
  // —— 时间序（asset → asset，P11：不参与因果分层）——
  | 'sequence';

// ---------- §11 变体组与分支 ----------

export interface VariantGroupV3 {
  id: string;
  branchId: string;
  phaseIndex: number;
  sourceEventId: string; // P12：变体组 = 事件的多输出，SSOT
  variantNodeIds: string[]; // 冗余缓存（= 事件 output 边的 target 集合）
  winnerNodeId?: string; // 用户决策，持久化
  // 'locked'：shot_decompose 解构集同构复用（§11）——整组锁定展示，无 winner 语义
  selectMode: 'single' | 'multi' | 'locked';
}

/**
 * 【V2 复用·待与旧库对齐】占位复用型分支。
 * 宪法 §7『branches: FlowBranchV2[] 复用，不动』，V2 定义不在宪法中；
 * 最小合理定义：id/name 必填，parentBranchId/createdAt 可选。
 * 语义：branch = 探索岔路（时间线分叉），与 variantGroup 正交（§11）。
 */
export interface FlowBranchV2 {
  id: string;
  name: string;
  parentBranchId?: string;
  createdAt?: number;
}

/**
 * 【假设】宪法 §7 列为 FlowNodeV3 成员但未展开；
 * 最小定义：kind:'structure' + 结构载荷字段。语义待宪法补原则后收紧。
 */
export interface StructureNodeV3 extends FlowNodeBase {
  kind: 'structure';
  structureType: string;
  refId?: string;
  label?: string;
}

// ---------- §12 TimelineStructure：成片的标准内部结构（P6） ----------

export interface TimelineStructure {
  durationS: number;
  source: 'compose' | 'decompose'; // 正向合成 / 逆向解构
  shots: TimelineShot[];
}

export interface TimelineShot {
  shotId: string;
  index: number;
  startS: number;
  endS: number;
  // 资产引用：正向指向创作资产，逆向指向解构产物
  video?: string; // assetId
  keyframes?: string[]; // assetId[]（首尾帧）
  voice?: string;
  foley?: string;
  bgm?: string;
  promptMeta?: PromptFacets; // 7-facet，正逆向同构
  dialogueText?: string; // 对白（设计稿 / 转录观测）
}
