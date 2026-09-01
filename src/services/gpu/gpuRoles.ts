/**
 * src/services/gpu/gpuRoles.ts — GPU 角色→UUID→索引 解析库 (TS 侧)
 *
 * bash 对应实现: /opt/kais-gpu/gpu-roles.sh (被 kap-llm.sh / kap-ear.sh source)。
 * 设计文档: docs/gpu-dual-3090-expansion.md (双3090 扩展 Phase A, 2026-09-01)。
 *
 * 背景: 现网按裸索引绑定的位点 (gpuId: 1 / device_ids: ["1"] / CUDA_VISIBLE_DEVICES=1)
 * 在新 3090 插进 PCIe 枚举序中间槽位时会全部漂移指向新卡。防漂移铁律 =
 * 一律用 UUID 锚定角色, 索引只在运行时向 nvidia-smi 解析, 不落盘不缓存跨重启。
 *
 * 解析链 (每层缺省落入下一层, 与 gpu-roles.sh 逐层对齐):
 *   1. env  覆盖:  KAIS_GPU_<ROLE>_UUID (角色直指) / KAIS_GPU_<SVC>_ROLE (服务改角色,
 *                  服务名横线→下划线大写, 如 qwen-llm → KAIS_GPU_QWEN_LLM_ROLE)
 *   2. conf 真源:  ${KAIS_GPU_CONF:-/opt/kais-gpu/gpu.conf}
 *                  角色→UUID 键 `<ROLE>_UUID`; 服务→角色键 `<svc>_role` (键名原样,
 *                  qwen-llm 与 qwen_tts 两种拼写在 conf 里并存, 勿强转)
 *   3. 发现兜底:   QC_GEN2 UUID=TBD 时按属性+排除法找新卡
 *                  (name 含 3090 ∧ totalMb≥23000 ∧ uuid≠RENDER_GEN1), 对索引漂移免疫
 *   4. 最终兜底:   RENDER_GEN1 老 3090 UUID (QC_GEN2 未插卡也退到这里 = 今日拓扑)
 *
 * conf 文件不存在/不可读 = 全部走默认, 不抛异常; nvidia-smi 调用失败一律静默回退
 * (返回 null / 今日硬编码), 绝不让调度器启动或排队路径抛异常。
 *
 * 同步 vs 异步: bash 侧每次调用即查一次 nvidia-smi。TS 侧 engineGpuIndex /
 * profile 索引过滤是同步签名, 走 execFileSync + 短 TTL 缓存 (KAIS_GPU_ROLES_CACHE_MS,
 * 默认 5s, 仅进程内); 显式异步入口 resolveServiceIndex() 每次 实时 execFile 查询,
 * 与 bash 逐调用语义一致。测试用 __resetGpuRolesCachesForTests() 清缓存。
 */

import { execFile, execFileSync } from "child_process";
import { promisify } from "util";
import { readFileSync } from "fs";
import type { GpuDevice } from "./types";

const execFileAsync = promisify(execFile);

/** nvidia-smi 单次查询超时 (驱动卡死时不拖垮调用方) */
const SMI_TIMEOUT_MS = 10_000;
/** nvidia-smi 派生结果 (索引表/设备表) 的进程内缓存时长 */
const CACHE_TTL_MS = process.env.KAIS_GPU_ROLES_CACHE_MS
  ? parseInt(process.env.KAIS_GPU_ROLES_CACHE_MS, 10) || 5_000
  : 5_000;

// ─── 最终兜底 (今日拓扑硬编码, 与 gpu-roles.sh 同源) ──────────────────────

/** RENDER_GEN1 = 现役老 3090 (UUID 与索引无关, 现网 kap-llm/kap-ear 已在用) */
export const FALLBACK_RENDER_UUID = "GPU-c5cdd49c-5a18-7d0b-2af5-1d2f642538c6";
/** AUX_LIGHT = 3060 Ti (conf 缺失时的设备表兜底用; 角色链兜底与 bash 同款落渲染卡) */
export const FALLBACK_AUX_UUID = "GPU-efe011dd-82a0-a20f-6ad8-eaa21aaf8570";

/** conf/env 均未登记服务→角色时的缺省角色 (= 渲染卡, 今日行为) */
export const DEFAULT_ROLE = "RENDER_GEN1";

/** QC_GEN2 发现兜底的识别阈值 (3090 24GB; 3060Ti 8GB 天然排除) */
const QC_MIN_TOTAL_MB = 23_000;

// ─── conf 读取 ────────────────────────────────────────────

function confPath(): string {
  return process.env.KAIS_GPU_CONF || "/opt/kais-gpu/gpu.conf";
}

/**
 * conf 单键读取 (键精确前缀匹配, 首行生效; 对齐 bash grep -E "^key=" | cut -d= -f2-)。
 * 文件不存在/不可读/键缺失 → null, 不抛异常。值内空白剥除 (对齐 bash tr -d)。
 */
function confGet(key: string): string | null {
  try {
    const raw = readFileSync(confPath(), "utf8");
    for (const line of raw.split("\n")) {
      if (line.startsWith(`${key}=`)) {
        return line.slice(key.length + 1).replace(/\s+/g, "") || null;
      }
    }
  } catch {
    // conf 缺失/不可读 = 全部走默认 — 设计如此, 静默
  }
  return null;
}

// ─── 服务/引擎 → 角色 ─────────────────────────────────────

/** env 键名: 服务名横线→下划线大写 (qwen-llm → KAIS_GPU_QWEN_LLM_ROLE; 对齐 bash tr) */
function serviceEnvRoleKey(service: string): string {
  return `KAIS_GPU_${service.replace(/-/g, "_").toUpperCase()}_ROLE`;
}

/**
 * conf/env 是否显式登记了该服务/引擎的角色。
 * 返回 null = 未登记 (调用方走自己的缺省链); 这是与 resolveServiceRole 的区别 —
 * 后者把「未登记」折叠成 DEFAULT_ROLE, 会掩盖「conf 没写」与「conf 写了 RENDER_GEN1」。
 */
export function lookupServiceRole(service: string): string | null {
  const envVal = process.env[serviceEnvRoleKey(service)];
  if (envVal && envVal.trim()) return envVal.trim();
  return confGet(`${service}_role`);
}

/** 服务/引擎 → 角色 (env 覆盖 → conf <svc>_role → RENDER_GEN1; 对齐 bash kais_gpu_role) */
export function resolveServiceRole(service: string): string {
  return lookupServiceRole(service) ?? DEFAULT_ROLE;
}

// ─── QC_GEN2 发现兜底 ─────────────────────────────────────

/**
 * 按属性+排除法识别新 3090 (name 含 3090 ∧ totalMb≥23000 ∧ uuid≠RENDER_GEN1)。
 * 只对 QC_GEN2 有意义; nvidia-smi 不可用/没找到 → null (调用方落最终兜底)。
 */
function discoverQcUuid(): string | null {
  try {
    const stdout = execFileSync(
      "nvidia-smi",
      ["--query-gpu=uuid,name,memory.total", "--format=csv,noheader,nounits"],
      { timeout: SMI_TIMEOUT_MS, encoding: "utf8" },
    );
    const renderUuid = confGet("RENDER_GEN1_UUID") || FALLBACK_RENDER_UUID;
    for (const line of stdout.trim().split("\n")) {
      const cols = line.split(",").map((s) => s.trim());
      if (cols.length < 3) continue;
      const [uuid, name, totalMb] = cols;
      if (/3090/i.test(name) && uuid !== renderUuid && (parseInt(totalMb, 10) || 0) >= QC_MIN_TOTAL_MB) {
        return uuid;
      }
    }
  } catch {
    // 无 nvidia-smi / 驱动异常 — 未插卡场景照旧退渲染卡
  }
  return null;
}

// ─── 角色 → UUID ──────────────────────────────────────────

/** 角色 → UUID (env KAIS_GPU_<ROLE>_UUID → conf <ROLE>_UUID → 发现兜底 → 渲染卡) */
export function resolveRoleUuid(role: string): string {
  const envVal = process.env[`KAIS_GPU_${role}_UUID`];
  if (envVal && envVal.trim()) return envVal.trim();
  const confVal = confGet(`${role}_UUID`);
  // TBD = 插卡日 setup 脚本回填前的占位 → 走发现兜底
  if (confVal && confVal !== "TBD") return confVal;
  // 发现兜底只对 QC_GEN2 有意义; 其他角色 TBD/缺省落最终兜底 (gpu-roles.sh 同款:
  // 未插卡时 QC_GEN2 也退渲染卡, 服务照常可用)
  if (role === "QC_GEN2") {
    const found = discoverQcUuid();
    if (found) return found;
  }
  return FALLBACK_RENDER_UUID;
}

/** 服务/引擎 → UUID (主入口; 对齐 bash kais_gpu_uuid) */
export function resolveServiceUuid(service: string): string {
  return resolveRoleUuid(resolveServiceRole(service));
}

// ─── UUID → 运行时索引 ────────────────────────────────────

/** 解析 nvidia-smi `index,uuid` 输出; UUID 不在系统上 (卡被拔/驱动故障) → null */
function parseUuidIndex(stdout: string, uuid: string): number | null {
  for (const line of stdout.trim().split("\n")) {
    const cols = line.split(",").map((s) => s.trim());
    if (cols.length < 2) continue;
    if (cols[1] === uuid) {
      const idx = parseInt(cols[0], 10);
      return Number.isFinite(idx) ? idx : null;
    }
  }
  return null;
}

/**
 * 服务/引擎 → 当前 GPU 索引 (异步主入口; 对齐 bash kais_gpu_index)。
 * 每次实时 execFile 查询 (无缓存); UUID 不在位 / nvidia-smi 失败 → null,
 * 由调用方兜底 (绝不抛异常)。
 */
export async function resolveServiceIndex(service: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      "nvidia-smi",
      ["--query-gpu=index,uuid", "--format=csv,noheader,nounits"],
      { timeout: SMI_TIMEOUT_MS },
    );
    return parseUuidIndex(stdout, resolveServiceUuid(service));
  } catch {
    return null;
  }
}

/** UUID→index 表的进程内短 TTL 缓存 (同步路径共用一次 spawn; 不缓存跨重启) */
let indexCache: { at: number; map: Map<string, number> } | null = null;

function uuidIndexMapSync(): Map<string, number> {
  if (indexCache && Date.now() - indexCache.at < CACHE_TTL_MS) return indexCache.map;
  const map = new Map<string, number>();
  try {
    const stdout = execFileSync(
      "nvidia-smi",
      ["--query-gpu=index,uuid", "--format=csv,noheader,nounits"],
      { timeout: SMI_TIMEOUT_MS, encoding: "utf8" },
    );
    for (const line of stdout.trim().split("\n")) {
      const cols = line.split(",").map((s) => s.trim());
      if (cols.length < 2) continue;
      const idx = parseInt(cols[0], 10);
      if (Number.isFinite(idx)) map.set(cols[1], idx);
    }
  } catch {
    // nvidia-smi 不可用 → 空表 (resolve 返回 null → 调用方兜底)
  }
  indexCache = { at: Date.now(), map };
  return map;
}

/** 角色 → 当前索引 (同步, 5s TTL 缓存; 失败 → null 由调用方兜底) */
export function resolveRoleIndexSync(role: string): number | null {
  return uuidIndexMapSync().get(resolveRoleUuid(role)) ?? null;
}

/** 服务/引擎 → 当前索引 (同步, 5s TTL 缓存; 失败 → null 由调用方兜底) */
export function resolveServiceIndexSync(service: string): number | null {
  return uuidIndexMapSync().get(resolveServiceUuid(service)) ?? null;
}

// ─── GPU 设备表 ───────────────────────────────────────────

/** 今日拓扑硬编码 (getGpuDevices 失败回退; 与改版前 GpuScheduler.GPU_DEVICES 同源) */
const FALLBACK_DEVICES: GpuDevice[] = [
  { id: 0, name: "RTX 3060 Ti", totalMb: 8192, gpusFlag: '"device=0"' },
  { id: 1, name: "RTX 3090", totalMb: 24576, gpusFlag: '"device=1"' },
];

let deviceCache: { at: number; devices: GpuDevice[] } | null = null;

/**
 * 查询全部 GPU 设备构建 GpuDevice[] (插卡后含 GPU2; 5s TTL 缓存)。
 * nvidia-smi 失败/无输出时回退今日硬编码两卡数组 — 调度器启动路径零异常。
 */
export function getGpuDevices(): GpuDevice[] {
  if (deviceCache && Date.now() - deviceCache.at < CACHE_TTL_MS) return deviceCache.devices;
  let devices = FALLBACK_DEVICES;
  try {
    const stdout = execFileSync(
      "nvidia-smi",
      ["--query-gpu=index,name,memory.total", "--format=csv,noheader,nounits"],
      { timeout: SMI_TIMEOUT_MS, encoding: "utf8" },
    );
    const parsed: GpuDevice[] = [];
    for (const line of stdout.trim().split("\n")) {
      const cols = line.split(",").map((s) => s.trim());
      if (cols.length < 3) continue;
      const id = parseInt(cols[0], 10);
      const totalMb = parseInt(cols[2], 10) || 0;
      if (!Number.isFinite(id)) continue;
      parsed.push({ id, name: cols[1], totalMb, gpusFlag: `"device=${id}"` });
    }
    parsed.sort((a, b) => a.id - b.id);
    if (parsed.length > 0) devices = parsed;
  } catch {
    // 无 nvidia-smi / 驱动异常 — 今日硬编码兜底
  }
  deviceCache = { at: Date.now(), devices };
  return devices;
}

// ─── 测试辅助 ─────────────────────────────────────────────

/** 测试专用 — 清空 nvidia-smi 派生缓存 (索引表/设备表), env/conf 变更后须调用 */
export function __resetGpuRolesCachesForTests(): void {
  indexCache = null;
  deviceCache = null;
}
