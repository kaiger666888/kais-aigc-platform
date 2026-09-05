/**
 * src/services/gpu/index.ts — GPU 调度器公共接口
 */

export {
  GpuScheduler,
  getGpuScheduler,
  getGpuSchedulerAsync,
  __resetGpuSchedulerForTests,
  GPU_DEVICES,
  getRegisteredServices,
} from "./GpuScheduler";
export type { SchedulerTuningOpts } from "./GpuScheduler";
export type { StateStore } from "./stateStore";
export { MemoryStateStore } from "./memoryStateStore";
export { RedisStateStore } from "./redisStateStore";
export type * from "./types";
// M1 双卡调度: 优先级类模型 + Persona 仲裁器
export {
  DEFAULT_PRIORITY_CLASS,
  DEFAULT_DEV_TTL_MIN,
  MAX_DEV_TTL_MIN,
  DEV_PRIORITY_CLASSES,
  PROD_PRIORITY_CLASSES,
  isPriorityClass,
  isDevClass,
  isProdClass,
  validatePriorityOptions,
} from "./priority";
export type { ValidatedPriority, PriorityValidation } from "./priority";
export {
  PersonaArbiter,
  getPersonaArbiterAsync,
  __resetPersonaArbiterForTests,
  QC_PERSONA_SERVICES,
} from "./personaArbiter";
export type {
  Persona,
  PersonaState,
  PersonaSignals,
  PersonaSwitchPlan,
  PersonaSwitchExecutor,
  PersonaArbiterOpts,
} from "./personaArbiter";
