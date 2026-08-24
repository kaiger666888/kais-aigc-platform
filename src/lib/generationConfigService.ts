/**
 * generationConfigService.ts — 服务端键面契约拷贝 + 三源合并/寻址/写回纯函数(62-02 HIER-03)。
 *
 * 与前端 packages/infinite-canvas/src/components/assetManager/generationConfigKeys.ts
 * 键集必须相等——verify-phase-62 S-门锁;契约源 = khs runner.py:2341-2392 实码
 * (27-01 cdd12dd 已 shipped;27-CONTEXT 快照已过时禁照抄,RESEARCH F 漂移修正口径)。
 *
 * 位点沿 gate-state.ts → @/lib/gateStateService 先例:route 薄壳 + lib service。
 * 本文件**零 db、零 node:fs import**——所有文件面操作经 FsLike 结构类型注入,
 * 纯函数可直接 node:test 零真实磁盘(src/lib/__tests__/generationConfig.test.ts)。
 *
 * 决策锚:
 * - D-08 两段式写入:①kap 权威覆盖层(canvasRelationalStore.generation_config_overrides)
 *   ②requirement.json best-effort 写回(tmp+rename 原子写 + mtime 乐观锁),三态如实
 *   (synced | file-fail | 未寻址到=路由层 override),寻址失败绝不假成功。
 * - D-09 三源合并优先级:覆盖层 > requirement.json 实测 > 键面快照默认。
 * - D-10 钳制:khs resolver 逐字(_vision_review.py:87-91)pre ≥ 1;final = clamp(1, final, pre)。
 */
import * as pathMod from "path";

// ─── 键面常量(RESEARCH F 修正版:11 嵌套 + 3 扁平;transition 已并入 shot_list) ───

export type ConfigTier = "llm" | "engine" | "deterministic" | "text";

export interface GenerationConfigKeyDef {
  phaseKey: string;
  tier: ConfigTier;
  /** UI-SPEC Copywriting「phase_key 显示名表」逐字。 */
  label: string;
  defaultPre: number;
  /** null = 缺省=pre(khs default_final=None 哨兵语义,_vision_review.py:68-70)。 */
  defaultFinal: number | null;
  /** 确定性派生类硬上限:pre 固定 1(五键,D-10)。 */
  preCap1?: true;
  /** 占位未接线(bgm/foley):读侧显示默认值,写侧允许写覆盖层但运行时暂不消费。 */
  unwired?: true;
  /** GPU 成本护栏 hint(p11_video)。 */
  gpuHint?: true;
  note?: string;
}

/** 14 可配键(嵌套 11 + 扁平 3)。顺序即 GET rows 渲染序(RESEARCH F 表序)。 */
export const GENERATION_CONFIG_KEYS: readonly GenerationConfigKeyDef[] = [
  { phaseKey: "p01_hook.topic_kernel", tier: "llm", label: "选题钩子·题核", defaultPre: 3, defaultFinal: 1 },
  { phaseKey: "p06_script.spatio_temporal", tier: "llm", label: "时空剧本", defaultPre: 1, defaultFinal: 1 },
  { phaseKey: "p09_shotlist.shot_list", tier: "llm", label: "分镜列表·参数", defaultPre: 1, defaultFinal: 1, note: "转场随分镜表候选整体" },
  { phaseKey: "p11_video.video_render", tier: "engine", label: "视频渲染", defaultPre: 1, defaultFinal: 1, gpuHint: true },
  { phaseKey: "p07_style.style_vector", tier: "deterministic", label: "风格·风格向量", defaultPre: 1, defaultFinal: 1, preCap1: true },
  { phaseKey: "p07_style.color_intent", tier: "deterministic", label: "风格·色彩意图", defaultPre: 1, defaultFinal: 1, preCap1: true },
  { phaseKey: "p12_compose.master_timeline", tier: "deterministic", label: "合成·主时间线", defaultPre: 1, defaultFinal: 1, preCap1: true },
  { phaseKey: "p12_compose.audio_mix", tier: "deterministic", label: "合成·混音", defaultPre: 1, defaultFinal: 1, preCap1: true },
  { phaseKey: "p13_master.master_mp4", tier: "deterministic", label: "母版·成片", defaultPre: 1, defaultFinal: 1, preCap1: true },
  { phaseKey: "p12_audio.bgm", tier: "engine", label: "音频·BGM", defaultPre: 1, defaultFinal: 1, unwired: true },
  { phaseKey: "p12_audio.foley", tier: "engine", label: "音频·Foley", defaultPre: 1, defaultFinal: 1, unwired: true },
  { phaseKey: "p01_hook", tier: "text", label: "选题钩子（文本候选）", defaultPre: 3, defaultFinal: null },
  { phaseKey: "p02_outline", tier: "text", label: "故事大纲（文本候选）", defaultPre: 3, defaultFinal: 1 },
  { phaseKey: "p03_script", tier: "text", label: "剧本（文本候选）", defaultPre: 3, defaultFinal: 1 },
];

/**
 * 锁定区(不可配):tts 单列 + 报告/审计类汇总(**不枚举 18 键名**——khs 未交付
 * 枚举,手工枚举引入新漂移面,RESEARCH F 明示建议)。锁键不入 GET rows。
 */
export const LOCKED_CONFIG_KEYS = {
  tts: { phaseKey: "p10_voice.tts", reason: "TTS 首选即定（防铺轨污染）· pre 钉死 1" },
  reportAudit: { count: 18, reason: "报告/审计类 · 管线固定" },
} as const;

const KNOWN_KEY_SET: ReadonlySet<string> = new Set(GENERATION_CONFIG_KEYS.map((k) => k.phaseKey));

/** phase_key 白名单校验用(PUT 参数门)。 */
export function isKnownPhaseKey(phaseKey: string): boolean {
  return KNOWN_KEY_SET.has(phaseKey);
}

// ─── D-10 钳制(khs resolver 逐字:_vision_review.py:87-91) ───

/** pre ≥ 1;final = clamp(1, final, pre)。服务端兜底第二道(前端禁用是第一道非唯一道)。 */
export function clampRedundancy(pre: number, final: number): { pre: number; final: number } {
  const p = Math.max(1, pre);
  const f = Math.max(1, Math.min(final, p));
  return { pre: p, final: f };
}

/** 有效 pre:覆盖列 > 文件值 > 键面默认(final 单独提供时钳制的基准)。 */
export function effectivePre(
  keyDef: GenerationConfigKeyDef,
  overridePre: number | null | undefined,
  filePre: number | null | undefined,
): number {
  if (overridePre != null) return overridePre;
  if (filePre != null) return filePre;
  return keyDef.defaultPre;
}

// ─── 注入式文件面(FsLike 结构类型——真实 node:fs 结构兼容) ───

export interface FsDirentLike {
  name: string;
  isDirectory(): boolean;
}

export interface FsLike {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: "utf-8"): string;
  writeFileSync(path: string, data: string): void;
  renameSync(from: string, to: string): void;
  statSync(path: string): { mtimeMs: number };
  readdirSync(path: string, options: { withFileTypes: true }): FsDirentLike[];
}

// ─── requirement.json 读侧(v2.5 形状:generation_config: { [phaseKey]: {n_candidates?, final_candidates?} }) ───

export type RequirementFileState = "requirement" | "legacy" | "not-found";

export interface RequirementValues {
  pre?: number;
  final?: number;
}

export interface ReadRequirementResult {
  state: RequirementFileState;
  values: Record<string, RequirementValues>;
}

/**
 * 读单个 requirement.json 的 generation_config namespace:
 * - 有 generation_config 且含任一已知键 → 'requirement'(只提取已知键);
 * - 文件在但无 v2.5 已知键(含旧形态/坏 JSON)→ 'legacy';
 * - ENOENT/EACCES 等读失败 → 'not-found'——读失败与无文件同态,**不抛**。
 */
export function readRequirementConfig(fsLike: FsLike, filePath: string): ReadRequirementResult {
  let raw: string;
  try {
    raw = fsLike.readFileSync(filePath, "utf-8");
  } catch {
    return { state: "not-found", values: {} };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { state: "legacy", values: {} };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { state: "legacy", values: {} };
  }
  const gc = (parsed as Record<string, unknown>).generation_config;
  const values: Record<string, RequirementValues> = {};
  let knownHit = false;
  if (gc && typeof gc === "object" && !Array.isArray(gc)) {
    for (const [phaseKey, entry] of Object.entries(gc as Record<string, unknown>)) {
      if (!KNOWN_KEY_SET.has(phaseKey)) continue;
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const e = entry as Record<string, unknown>;
      const v: RequirementValues = {};
      if (typeof e.n_candidates === "number" && Number.isFinite(e.n_candidates)) v.pre = e.n_candidates;
      if (typeof e.final_candidates === "number" && Number.isFinite(e.final_candidates)) v.final = e.final_candidates;
      values[phaseKey] = v;
      knownHit = true;
    }
  }
  return knownHit ? { state: "requirement", values } : { state: "legacy", values: {} };
}

export interface ResolvedRequirementFile {
  path: string | null;
  /** 寻址命中文件的 mtime(applyRequirementWrite 乐观锁基准);stat 失败/未命中 → null。 */
  mtime: number | null;
  state: RequirementFileState;
  values: Record<string, RequirementValues>;
}

/**
 * 两段寻址(D-08②,各自如实报 found/legacy/not-found):
 * - 段一:env GENERATION_CONFIG_REQUIREMENT_FILE 绝对路径直取(存在即用;
 *   仅接受绝对路径且以 .json 结尾的固定文件名——T-62-05 路径穿越守卫)。
 * - 段二:「pipeRoot 下各 pipe-* 子目录内的 requirement.json」按 JSON.project_id||projectId 字符串等值
 *   过滤,取 mtime 最新(RESEARCH B 实测:pipe-* 有 project_id/projectId 双字符串键并存)。
 * - 命中零 → path=null(本部署 pipe-* 写恒 EACCES,但**读**通常可达)。
 */
export function resolveRequirementFile(
  fsLike: FsLike,
  opts: { envFile?: string | null; pipeRoot: string; projectId: number },
): ResolvedRequirementFile {
  const finish = (filePath: string): ResolvedRequirementFile => {
    let mtime: number | null = null;
    try {
      mtime = fsLike.statSync(filePath).mtimeMs;
    } catch {
      mtime = null;
    }
    const cfg = readRequirementConfig(fsLike, filePath);
    return { path: filePath, mtime, state: cfg.state, values: cfg.values };
  };

  // 段一:env 绝对路径直取(存在即用;不存在则落段二)
  const envFile = opts.envFile?.trim() || null;
  if (envFile && pathMod.isAbsolute(envFile) && envFile.endsWith(".json")) {
    const resolved = pathMod.resolve(envFile);
    if (fsLike.existsSync(resolved)) {
      return finish(resolved);
    }
  }

  // 段二:pipe-* projectId 反查,mtime 最新
  let best: { path: string; mtimeMs: number } | null = null;
  try {
    const entries = fsLike.readdirSync(opts.pipeRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith("pipe-")) continue;
      const candidate = pathMod.join(opts.pipeRoot, entry.name, "requirement.json");
      if (!fsLike.existsSync(candidate)) continue;
      let pid: unknown;
      try {
        const parsed = JSON.parse(fsLike.readFileSync(candidate, "utf-8"));
        pid = parsed?.project_id ?? parsed?.projectId;
      } catch {
        continue; // 不可读/坏 JSON 的候选跳过(不影响其他 pipe 目录)
      }
      if (pid == null || String(pid) !== String(opts.projectId)) continue;
      let mtimeMs = 0;
      try {
        mtimeMs = fsLike.statSync(candidate).mtimeMs;
      } catch {
        mtimeMs = 0; // 无 mtime 仍可候选(排最后)
      }
      if (!best || mtimeMs > best.mtimeMs) best = { path: candidate, mtimeMs };
    }
  } catch {
    // pipeRoot 不存在/不可读 → 命中零,如实返回未寻址到
  }
  return best ? finish(best.path) : { path: null, mtime: null, state: "not-found", values: {} };
}

// ─── requirement.json 写侧(best-effort,三态之二:synced | file-fail) ───

export type ApplyWriteResult = "synced" | "file-fail";

/**
 * 原子写回 generation_config[phaseKey](tmp+rename;mtime 乐观锁):
 * 1) 读现有 JSON(不存在/不可读/坏 JSON → 起始 {});
 * 2) merge 保留其他顶层键与 generation_config 内其他 phaseKey 条目;
 *    null 值 = 清除该旋钮键;条目清空后整个条目移除;
 * 3) re-stat mtime ≠ mtimeAtRead → 'file-fail'(stale,放弃覆盖,不丢他方写入);
 * 4) writeFileSync(tmp) + renameSync(tmp, target) 原子替换。
 * 任一步 throw(含 EACCES——本机 pipe-* 写恒败)→ catch 返回 'file-fail':
 * **绝不向上抛、绝不假成功**(T-62-06/T-62-07)。
 */
export function applyRequirementWrite(
  fsLike: FsLike,
  filePath: string,
  phaseKey: string,
  values: { nCandidates: number | null; finalCandidates: number | null },
  mtimeAtRead: number | null,
): ApplyWriteResult {
  try {
    // 1) 读现有 JSON
    let base: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(fsLike.readFileSync(filePath, "utf-8"));
      base = parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      base = {};
    }

    // 2) merge generation_config namespace(保留其他顶层键与其他条目)
    const rawGc = base.generation_config;
    const gc: Record<string, unknown> =
      rawGc && typeof rawGc === "object" && !Array.isArray(rawGc)
        ? { ...(rawGc as Record<string, unknown>) }
        : {};
    const rawEntry = gc[phaseKey];
    const entry: Record<string, unknown> =
      rawEntry && typeof rawEntry === "object" && !Array.isArray(rawEntry)
        ? { ...(rawEntry as Record<string, unknown>) }
        : {};
    if (values.nCandidates == null) delete entry.n_candidates;
    else entry.n_candidates = values.nCandidates;
    if (values.finalCandidates == null) delete entry.final_candidates;
    else entry.final_candidates = values.finalCandidates;
    if (Object.keys(entry).length === 0) delete gc[phaseKey];
    else gc[phaseKey] = entry;

    // 3) mtime 乐观锁(stale 不覆盖)
    let currentMtime: number | null = null;
    try {
      currentMtime = fsLike.statSync(filePath).mtimeMs;
    } catch {
      currentMtime = null;
    }
    if ((currentMtime ?? null) !== (mtimeAtRead ?? null)) return "file-fail";

    // 4) tmp + rename 原子替换
    const tmp = `${filePath}.tmp-${Date.now()}`;
    fsLike.writeFileSync(tmp, `${JSON.stringify({ ...base, generation_config: gc }, null, 2)}\n`);
    fsLike.renameSync(tmp, filePath);
    return "synced";
  } catch {
    return "file-fail"; // 含 EACCES——如实三态,绝不假成功
  }
}

// ─── D-09 三源合并(GET rows 服务端合成) ───

export type RowSource = "override" | "requirement" | "snapshot" | "legacy";

const SOURCE_RANK: Record<RowSource, number> = { override: 3, requirement: 2, snapshot: 1, legacy: 1 };

export interface GenerationConfigRow {
  phaseKey: string;
  tier: ConfigTier;
  label: string;
  pre: number;
  final: number;
  /** 行级来源 = 两旋钮中较强源(override > requirement > legacy/snapshot)。 */
  source: RowSource;
  /** 文件面为旧形态(无 v2.5 键)标志——UI「无 v2.5 键」角标数据。 */
  sourceLegacy?: true;
  /** 全部 14 键可编辑(unwired 键亦允许写覆盖层,带 unwired 标注)。锁键不入 rows。 */
  editable: boolean;
  unwired?: true;
  gpuHint?: true;
  note?: string;
}

/**
 * 三源合并(keys × 覆盖层行 × requirement.json 实测 × 键面快照默认):
 * - 值级优先:override 列(非 null)> requirement 文件值 > 快照默认;半覆盖支持
 *   (仅一列覆盖时另一旋钮走下一源);
 * - 行级 source 取两旋钮中较强源;file state='legacy' 时无覆盖行的 source='legacy'
 *   (UI-SPEC C8:显示快照默认值 + 「无 v2.5 键」角标),有覆盖行仍按较强源;
 * - defaultFinal=null(p01_hook 扁平哨兵)→ final 缺省回落有效 pre。
 */
export function mergeThreeSources(
  keys: readonly GenerationConfigKeyDef[],
  overrideRows:
    | ReadonlyArray<{ phaseKey: string; nCandidates: number | null; finalCandidates: number | null }>
    | Record<string, { nCandidates: number | null; finalCandidates: number | null }>,
  fileState: RequirementFileState,
  fileValues: Record<string, RequirementValues>,
): GenerationConfigRow[] {
  const ovMap =
    Array.isArray(overrideRows)
      ? new Map(overrideRows.map((r) => [r.phaseKey, r]))
      : new Map(Object.entries(overrideRows));

  return keys.map((k) => {
    const ov = ovMap.get(k.phaseKey) ?? null;
    const fv = fileState === "requirement" ? fileValues[k.phaseKey] : undefined;

    const preSource: RowSource =
      ov != null && ov.nCandidates != null ? "override"
      : fv?.pre != null ? "requirement"
      : fileState === "legacy" ? "legacy"
      : "snapshot";
    const finalSource: RowSource =
      ov != null && ov.finalCandidates != null ? "override"
      : fv?.final != null ? "requirement"
      : fileState === "legacy" ? "legacy"
      : "snapshot";

    const pre = ov?.nCandidates ?? fv?.pre ?? k.defaultPre;
    const final = ov?.finalCandidates ?? fv?.final ?? k.defaultFinal ?? pre;
    const source: RowSource =
      SOURCE_RANK[preSource] >= SOURCE_RANK[finalSource] ? preSource : finalSource;

    return {
      phaseKey: k.phaseKey,
      tier: k.tier,
      label: k.label,
      pre,
      final,
      source,
      editable: true,
      ...(fileState === "legacy" ? { sourceLegacy: true as const } : {}),
      ...(k.unwired ? { unwired: true as const } : {}),
      ...(k.gpuHint ? { gpuHint: true as const } : {}),
      ...(k.note ? { note: k.note } : {}),
    };
  });
}
