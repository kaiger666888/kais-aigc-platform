/**
 * FlowGraphV2 导出格式类型（迁移输入）。
 *
 * 【V2 结构反推自 §14·待与旧库对齐】
 * 宪法未给 V2 完整定义，仅 §14 迁移映射表左列 + §7「V2 公共字段全保留」可考。
 * 本文件按映射表反推**最小充分**结构：只声明迁移脚本实际消费的字段，
 * 其余字段经 index signature 开放透传，待与旧库真实导出对齐后收紧。
 *
 * §14 左列覆盖清单：
 *   type: 'script' | 'storyboard' | 'video' | 'audio' | 'asset'
 *       | 'upscale' | 'face_restore' | 'variant' | 'reference'
 *   data.filePath / data.thumbnailUrl / data.prompt / data.seed / data.engine
 *   data.audioType（audio 拆 voice/foley/bgm 的依据）
 *   isWinner / reviewStatus / aiScore（节点级）
 *   links[].dataType（含 'sequence' 与 ensure_reference_link 形态）
 */
import type { FlowBranchV2, NodeState, ReviewStatus, AIScore } from './types.js';

/** V2 节点类型枚举（§14 左列全覆盖）。 */
export type FlowNodeV2Type =
  | 'script'
  | 'storyboard'
  | 'video'
  | 'audio'
  | 'asset'
  | 'upscale'
  | 'face_restore'
  | 'variant'
  | 'reference';

/**
 * V2 音频子类型。【V2 结构反推自 §14·待与旧库对齐】
 * §14：「type:'audio' → stage 按 audioType 拆 voice/foley/bgm」。
 */
export type AudioTypeV2 = 'voice' | 'foley' | 'bgm' | (string & {});

/**
 * V2 节点 data 载荷（最小充分）。
 * prompt/seed/engine 是生成配方，§14 要求迁入事件 params（P4）。
 * 其余字段开放，迁移时按白名单消费、未消费的不进 V3（防私建字段）。
 */
export interface FlowNodeV2Data {
  filePath?: string; // → media.original
  thumbnailUrl?: string; // → media.thumbnail
  prompt?: string; // → 事件 params.prompt（script 例外：→ content）
  seed?: number; // → 事件 params.seed
  engine?: string; // → 事件 params.modelVersion（兼作 video op 推断线索）
  audioType?: AudioTypeV2; // audio 拆轨依据
  // —— 以下为迁移消费的描述性字段（进 meta，非配方）——
  shotId?: string;
  shotType?: string;
  durationS?: number;
  cameraMovement?: string;
  framing?: string;
  composition?: string;
  pacing?: string;
  emotion?: string;
  speaker?: string;
  hookType?: string;
  hookIntensity?: number;
  premise?: string;
  /** global 资产种类（P04 角色 / P07 风格 → role / lora ...）。 */
  assetType?: string;
  /** master-timeline 标记：video 拆 stage:'composite' 的判定线索（P12）。 */
  isMasterTimeline?: boolean;
  edlRef?: string;
  observedEndState?: string;
  [key: string]: unknown; // 【待与旧库对齐】未消费字段不进 V3
}

/**
 * V2 节点（SQLite canvas_nodes 行导出形态）。
 * phaseIndex/phaseName/state/size 在 V2 不对齐（宪法 §7「修掉 V2 不对齐」），
 * 故此处标可选，迁移时按 stage 推导补齐。
 */
export interface FlowNodeV2 {
  id: string;
  type: FlowNodeV2Type;
  branchId: string;
  phaseIndex?: number;
  phaseName?: string;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  state?: NodeState | (string & {});
  data?: FlowNodeV2Data;
  /** 变体选定标记（§14：isWinner → curation:'selected'）。 */
  isWinner?: boolean;
  reviewStatus?: ReviewStatus | (string & {});
  /** 五维评分；旧库可能给裸 number，迁移时归一为 { overall }。 */
  aiScore?: AIScore | number;
}

/**
 * V2 边（SQLite canvas_links 行导出形态）。
 * dataType 取值【待与旧库对齐】，迁移已识别：
 *   'sequence'                → role:'sequence'（import-from-dir 产物，§14）
 *   'reference'               → role:'reference'
 *   'ensure_reference_link'   → role:'reference'（§14 同名形态）
 *   'variant'                 → 候选 → variant 栈节点的归属边（建组用，不成边）
 *   其余/缺省                 → 因果依赖（asset→事件 输入边，role 按源 stage 推断）
 */
export interface FlowLinkV2 {
  id?: string;
  source: string;
  target: string;
  dataType?: string;
  isExplore?: boolean;
}

/** V2 顶层 meta（最小充分，余字段忽略）。 */
export interface FlowMetaV2 {
  projectId: number;
  episodesId: number;
  pipelineId?: string;
  createdAt?: number;
  updatedAt?: number;
  viewport?: { x: number; y: number; zoom: number };
  [key: string]: unknown;
}

/** V2 导出文件根结构。 */
export interface FlowGraphV2Export {
  meta: FlowMetaV2;
  nodes: FlowNodeV2[];
  links: FlowLinkV2[];
  branches?: FlowBranchV2[];
}
