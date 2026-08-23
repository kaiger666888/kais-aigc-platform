/**
 * Phase 58: 全配方持久化——配方 round-trip 键映射契约（单点常量）。
 *
 * 设计约束（58-01 锁定）：
 *  - 零 import 纯常量模块——root scripts/verify-phase-58.ts 经相对路径直接 import
 *    做三方集合比较的前提（tsx 无 alias 解析风险）。p 侧类型因此用内联九键
 *    字面量联合，非 keyof GenerationParams（后者需 import 类型，与零依赖前提
 *    冲突；类型与值同源于本表自身）。
 *  - p 侧九键必须与 zod.ts generationParamsSchema.shape 九键严格相等
 *    （Plan 04 verify 门机器锁死；漂移 = 契约破坏）。
 *  - modelVersion ↔ engine 是唯一非恒等映射（§14：引擎即模型版本）——禁裸字符串
 *    数组当键集（映射丢失 → reload 后 modelVersion 丢/双写）。
 */

/**
 * V3 params ↔ V2 data 袋的九键映射表（丢弃点① serialize 反向覆盖与丢弃点②
 * migrate 提取的共同契约）。negative 属于往返集但不属于可编辑集（往返≠可编辑，
 * planner 裁决 2：CONTEXT「扩到 GenerationParams 全集」字面含 negative）。
 */
export const RECIPE_ROUNDTRIP_KEYS: ReadonlyArray<{
  p:
    | 'prompt'
    | 'negative'
    | 'seed'
    | 'modelVersion'
    | 'lora'
    | 'steps'
    | 'cfg'
    | 'quant'
    | 'sageAttention';
  d: string;
}> = [
  { p: 'prompt', d: 'prompt' },
  { p: 'negative', d: 'negative' },
  { p: 'seed', d: 'seed' },
  { p: 'modelVersion', d: 'engine' }, // 唯一非恒等映射（§14：引擎即模型版本）
  { p: 'lora', d: 'lora' },
  { p: 'steps', d: 'steps' },
  { p: 'cfg', d: 'cfg' },
  { p: 'quant', d: 'quant' },
  { p: 'sageAttention', d: 'sageAttention' },
];

/**
 * 详情面板「高级参数」折叠区可编辑字段白名单（UI-SPEC §3，恰好五键）。
 * negative/prompt/seed/modelVersion 不在内（prompt/seed 有专属编辑位，
 * negative/modelVersion 只读往返）。
 */
export const RECIPE_EDITABLE_FIELDS: readonly (
  | 'steps'
  | 'cfg'
  | 'quant'
  | 'sageAttention'
  | 'lora'
)[] = ['steps', 'cfg', 'quant', 'sageAttention', 'lora'];

/**
 * 已知配方键集（九键，由 RECIPE_ROUNDTRIP_KEYS 的 p 侧派生；popover 消费，
 * 与旧 EventParamsPopover 本地 KNOWN_KEYS 九键集语义等价——一处定义两处消费）。
 */
export const RECIPE_KNOWN_KEYS: readonly string[] = RECIPE_ROUNDTRIP_KEYS.map(
  (k) => k.p,
);
