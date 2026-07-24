/**
 * FlowGraphV3 Zod 校验层
 * 语义来源：宪法 §7–§13；与 schema/flowgraph-v3.schema.json（SSOT）对齐。
 * 严格面：所有 object 默认 .strict()（对齐 additionalProperties:false），
 * 唯一例外 GenerationParams（宪法 §9 开放扩展 → .catchall(z.unknown())）。
 */
import { z } from 'zod';
import type { FlowGraphV3 } from './types.js';

// ---------- 枚举 ----------
export const nodeStateSchema = z.enum(['pending', 'running', 'success', 'failed']);
/** 【V2 复用·待与旧库对齐】 */
export const reviewStatusSchema = z.enum(['pending', 'approved', 'rejected']);
export const stageSchema = z.enum([
  'global',
  'script',
  'storyboard',
  'keyframe',
  'video',
  'voice',
  'foley',
  'bgm',
  'mix',
  'composite',
]);
export const slotRoleSchema = z.enum([
  'keyframe',
  'prompt_ref',
  'lora_ref',
  'reference',
  'edit_target',
  'edit_source',
  'dialogue_track',
  'foley_track',
  'bgm_track',
  'video_track',
  'audio_mix',
  'decompose_source',
  'output',
  'sequence',
]);
export const eventOpSchema = z.enum([
  'import',
  'create',
  'human_edit',
  'wan22_t2v',
  'wan22_i2v',
  'wan22_s2v',
  'bernini_edit',
  'ltx_ref',
  'tts',
  'foley_gen',
  'bgm_gen',
  'mix',
  'compose',
  'upscale',
  'face_restore',
  'shot_decompose',
  'script_analysis',
]);
export const modalitySchema = z.enum(['text', 'image', 'audio', 'video']);
export const scopeSchema = z.enum(['episode', 'global']);
export const curationSchema = z.enum(['candidate', 'selected', 'deprecated', 'locked']);

// ---------- 基础构件 ----------
export const positionSchema = z.object({ x: z.number(), y: z.number() }).strict();
export const sizeSchema = z.object({ width: z.number(), height: z.number() }).strict();

/** 【V2 复用·待与旧库对齐】五维评分最小合理定义。 */
export const aiScoreSchema = z
  .object({
    overall: z.number(),
    dimensions: z.record(z.string(), z.number()).optional(),
  })
  .strict();

/** P13 脏传播记录。 */
export const staleInfoSchema = z
  .object({
    since: z.number(),
    triggerAssetId: z.string(),
    triggerEventId: z.string(),
  })
  .strict();

/** 7-facet 描述性 prompt（P4 边界）。 */
export const promptFacetsSchema = z
  .object({
    subject: z.string().optional(),
    action: z.string().optional(),
    camera: z.string().optional(),
    scene: z.string().optional(),
    lighting: z.string().optional(),
    style: z.string().optional(),
    text: z.string().optional(),
  })
  .strict();

/**
 * P4：配方唯一合法存放处。
 * 宪法 §9 明写开放扩展 → 全树唯一不 .strict() 的 object。
 */
export const generationParamsSchema = z
  .object({
    prompt: z.string().optional(),
    negative: z.string().optional(),
    seed: z.number().optional(),
    modelVersion: z.string().optional(),
    lora: z.array(z.object({ name: z.string(), strength: z.number() }).strict()).optional(),
    steps: z.number().optional(),
    cfg: z.number().optional(),
    quant: z.string().optional(),
    sageAttention: z.boolean().optional(),
  })
  .catchall(z.unknown());

// ---------- §7 顶层 ----------
export const flowMetaV3Schema = z
  .object({
    version: z.literal('3'),
    projectId: z.number(),
    episodesId: z.number(),
    pipelineId: z.string().optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
    viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }).strict().optional(),
  })
  .strict();

/** 【V2 复用·待与旧库对齐】占位复用型分支，最小合理定义。 */
export const flowBranchV2Schema = z
  .object({
    id: z.string(),
    name: z.string(),
    parentBranchId: z.string().optional(),
    createdAt: z.number().optional(),
  })
  .strict();

// ---------- §8 资产元数据判别联合 ----------
const audioTrackMetaShape = {
  shotId: z.string().optional(),
  emotion: z.string().optional(),
  speaker: z.string().optional(),
};

/** 判别联合：按 stage 常量分支（含补的 'mix' 空载荷分支，见 types.ts 假设标注）。 */
export const assetStageMetaSchema = z.discriminatedUnion('stage', [
  z
    .object({
      stage: z.literal('script'),
      hookType: z.string().optional(),
      hookIntensity: z.number().optional(),
      premise: z.string().optional(),
      emotion: z.number().optional(),
    })
    .strict(),
  z
    .object({
      stage: z.literal('storyboard'),
      shotId: z.string(),
      shotType: z.string(),
      cameraMovement: z.string().optional(),
      framing: z.string().optional(),
      composition: z.string().optional(),
      pacing: z.string().optional(),
      durationS: z.number(),
      promptMeta: promptFacetsSchema.optional(),
    })
    .strict(),
  z.object({ stage: z.literal('keyframe'), shotId: z.string() }).strict(),
  z
    .object({
      stage: z.literal('video'),
      shotId: z.string(),
      observedEndState: z.string().optional(),
      murchGrade: z.string().optional(),
    })
    .strict(),
  z.object({ stage: z.literal('voice'), ...audioTrackMetaShape }).strict(),
  z.object({ stage: z.literal('foley'), ...audioTrackMetaShape }).strict(),
  z.object({ stage: z.literal('bgm'), ...audioTrackMetaShape }).strict(),
  z
    .object({
      stage: z.literal('global'),
      assetType: z.enum(['role', 'tool', 'scene', 'lora', 'worldview']),
      archetype: z.string().optional(),
      viewAngle: z.string().optional(),
    })
    .strict(),
  z.object({ stage: z.literal('mix') }).strict(),
  z.object({ stage: z.literal('composite'), edlRef: z.string().optional() }).strict(),
]);

// ---------- §12 TimelineStructure ----------
export const timelineShotSchema = z
  .object({
    shotId: z.string(),
    index: z.number(),
    startS: z.number(),
    endS: z.number(),
    video: z.string().optional(),
    keyframes: z.array(z.string()).optional(),
    voice: z.string().optional(),
    foley: z.string().optional(),
    bgm: z.string().optional(),
    promptMeta: promptFacetsSchema.optional(),
    dialogueText: z.string().optional(),
  })
  .strict();

export const timelineStructureSchema = z
  .object({
    durationS: z.number(),
    source: z.enum(['compose', 'decompose']),
    shots: z.array(timelineShotSchema),
  })
  .strict();

// ---------- 节点 ----------
const nodeBaseShape = {
  id: z.string(),
  branchId: z.string(),
  phaseIndex: z.number(),
  phaseName: z.string(),
  position: positionSchema, // 语义：布局引擎计算缓存，不手排
  size: sizeSchema,
  state: nodeStateSchema,
};

export const assetMediaSchema = z
  .object({
    original: z.union([z.string(), z.null()]),
    proxy: z.union([z.string(), z.null()]),
    thumbnail: z.union([z.string(), z.null()]),
    waveform: z.union([z.string(), z.null()]),
    durationS: z.number().optional(),
    resolution: z.string().optional(),
  })
  .strict();

export const assetNodeV3Schema = z
  .object({
    ...nodeBaseShape,
    kind: z.literal('asset'),
    stage: stageSchema,
    modality: modalitySchema,
    scope: scopeSchema,
    media: assetMediaSchema,
    content: z.string().optional(),
    meta: assetStageMetaSchema,
    timeline: timelineStructureSchema.optional(),
    reviewStatus: reviewStatusSchema.optional(),
    aiScore: aiScoreSchema.optional(),
    curation: curationSchema,
    stale: z.union([staleInfoSchema, z.null()]),
    variantGroupId: z.string().optional(),
  })
  .strict();

export const eventNodeV3Schema = z
  .object({
    ...nodeBaseShape,
    kind: z.literal('event'),
    op: eventOpSchema,
    params: generationParamsSchema,
    executor: z.enum(['human', 'gpu0', 'gpu1', 'cloud']),
    durationS: z.number().optional(),
  })
  .strict();

/** 【假设】宪法 §7 提及未展开，最小定义。 */
export const structureNodeV3Schema = z
  .object({
    ...nodeBaseShape,
    kind: z.literal('structure'),
    structureType: z.string(),
    refId: z.string().optional(),
    label: z.string().optional(),
  })
  .strict();

export const flowNodeV3Schema = z
  .discriminatedUnion('kind', [
    assetNodeV3Schema,
    eventNodeV3Schema,
    structureNodeV3Schema,
  ])
  .superRefine((node, ctx) => {
    // 宪法 §8：meta 判别联合按节点 stage 分支——node.stage 与 meta.stage 必须一致，
    // 错配 = 契约漂移（判别联合只管 meta 内部形状，不管与节点 stage 的耦合，故在此交叉校验）。
    if (node.kind === 'asset' && node.stage !== node.meta.stage) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['meta', 'stage'],
        message: `节点 stage 与 meta.stage 判别错配：stage='${node.stage}' 但 meta.stage='${node.meta.stage}'（宪法 §8）`,
      });
    }
  });

// ---------- §10 边 = 槽位 ----------
export const flowLinkV3Schema = z
  .object({
    id: z.string(),
    source: z.string(),
    target: z.string(),
    branchId: z.string(),
    role: slotRoleSchema,
    slotParams: z
      .object({
        offsetS: z.number().optional(),
        gain: z.number().optional(),
        fadeInS: z.number().optional(),
        fadeOutS: z.number().optional(),
      })
      .strict()
      .optional(),
    isExplore: z.boolean().optional(),
    isInactive: z.boolean().optional(),
  })
  .strict();

// ---------- §11 变体组 ----------
export const variantGroupV3Schema = z
  .object({
    id: z.string(),
    branchId: z.string(),
    phaseIndex: z.number(),
    sourceEventId: z.string(),
    variantNodeIds: z.array(z.string()),
    winnerNodeId: z.string().optional(),
    // 'locked'：shot_decompose 解构集整组锁定展示（宪法 §11）
    selectMode: z.enum(['single', 'multi', 'locked']),
  })
  .strict();

// ---------- 根 ----------
export const flowGraphV3Schema = z
  .object({
    meta: flowMetaV3Schema,
    nodes: z.array(flowNodeV3Schema),
    links: z.array(flowLinkV3Schema),
    branches: z.array(flowBranchV2Schema),
    variantGroups: z.array(variantGroupV3Schema),
  })
  .strict();

export type ValidateResult = { ok: true; data: FlowGraphV3 } | { ok: false; errors: string[] };

export function validateFlowGraphV3(data: unknown): ValidateResult {
  const result = flowGraphV3Schema.safeParse(data);
  if (result.success) {
    return { ok: true, data: result.data as FlowGraphV3 };
  }
  return {
    ok: false,
    errors: result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    ),
  };
}
