/**
 * src/services/gpu/priority.ts — 任务优先级类模型 (M1 双卡调度)
 *
 * 设计文档: docs/gpu-scheduling-architecture.md §2.1。
 * 调用方声明的任务维度, 与 profile.priority (VRAM 驱逐维度) 正交 — 不改 profile。
 *
 *   dev-P0   Kai 交互式开发验证 (唯一可 --force → T2 硬杀)
 *   dev-P1   Kai 后台开发任务
 *   prod-P2  管线在飞链路 (KMC 当前 episode)
 *   prod-P3  批量后台生产 — 默认值 (= 今日行为)
 *
 * 纯函数模块 (零 IO 零副作用), 校验规则:
 *   - force 仅 dev-P0 合法, 其余组合直接拒绝
 *   - ttlMin 仅 dev 类合法 (缺省 120min, 上限 480min), prod 类传入直接拒绝
 *   - 缺省 priorityClass 折叠为 prod-P3 (无 dev/preempt 流量 = 调度行为逐位兼容)
 */

import type { AllocationRequest, PriorityClass } from "./types";

export const DEFAULT_PRIORITY_CLASS: PriorityClass = "prod-P3";
/** dev 占用 TTL 缺省值 (§2.3: 默认 2h) */
export const DEFAULT_DEV_TTL_MIN = 120;
/** dev 占用 TTL 上限 (§2.3: 上限 480min = 8h) */
export const MAX_DEV_TTL_MIN = 480;
/** dev 类集合 */
export const DEV_PRIORITY_CLASSES: readonly PriorityClass[] = ["dev-P0", "dev-P1"];
/** prod 类集合 */
export const PROD_PRIORITY_CLASSES: readonly PriorityClass[] = ["prod-P2", "prod-P3"];

const ALL_CLASSES: readonly PriorityClass[] = [...DEV_PRIORITY_CLASSES, ...PROD_PRIORITY_CLASSES];

export function isPriorityClass(v: unknown): v is PriorityClass {
  return typeof v === "string" && (ALL_CLASSES as readonly string[]).includes(v);
}

export function isDevClass(pc: PriorityClass): boolean {
  return (DEV_PRIORITY_CLASSES as readonly string[]).includes(pc);
}

export function isProdClass(pc: PriorityClass): boolean {
  return (PROD_PRIORITY_CLASSES as readonly string[]).includes(pc);
}

export interface ValidatedPriority {
  priorityClass: PriorityClass;
  force: boolean;
  /** dev 类: 生效 TTL 分钟数; prod 类: null */
  ttlMin: number | null;
}

export type PriorityValidation =
  | { ok: true; value: ValidatedPriority }
  | { ok: false; reason: string };

/**
 * 校验并折叠 allocate 的优先级三元组 (priorityClass/force/ttlMin)。
 * 非法组合一律拒绝 (granted=false 由调用方落), 绝不静默降级 — force 语义安全第一。
 */
export function validatePriorityOptions(
  req: Pick<AllocationRequest, "priorityClass" | "force" | "ttlMin">,
): PriorityValidation {
  const { priorityClass, force, ttlMin } = req;

  if (priorityClass !== undefined && !isPriorityClass(priorityClass)) {
    return { ok: false, reason: `priorityClass 非法: ${JSON.stringify(priorityClass)} (合法值: ${ALL_CLASSES.join(" | ")})` };
  }
  const effectiveClass = priorityClass ?? DEFAULT_PRIORITY_CLASS;

  const forceRequested = force === true;
  if (forceRequested && effectiveClass !== "dev-P0") {
    return { ok: false, reason: `force 仅 dev-P0 合法 (当前 ${effectiveClass}); T2 硬杀是交互式开发专属语义` };
  }

  let effectiveTtlMin: number | null = null;
  if (ttlMin !== undefined) {
    if (!isDevClass(effectiveClass)) {
      return { ok: false, reason: `ttlMin 仅 dev 类合法 (当前 ${effectiveClass}); prod 任务不做占用 TTL` };
    }
    if (typeof ttlMin !== "number" || !Number.isFinite(ttlMin) || ttlMin < 1) {
      return { ok: false, reason: `ttlMin 必须为 ≥1 的数值分钟 (收到 ${JSON.stringify(ttlMin)})` };
    }
    if (ttlMin > MAX_DEV_TTL_MIN) {
      return { ok: false, reason: `ttlMin 超上限 (最大 ${MAX_DEV_TTL_MIN}min, 收到 ${ttlMin})` };
    }
    effectiveTtlMin = ttlMin;
  } else if (isDevClass(effectiveClass)) {
    effectiveTtlMin = DEFAULT_DEV_TTL_MIN;
  }

  return { ok: true, value: { priorityClass: effectiveClass, force: forceRequested, ttlMin: effectiveTtlMin } };
}
