/**
 * generation-config.ts — GET / PUT /api/canvas/v2/generation-config(62-02 HIER-03,UI-GREY-2 锁形)。
 *
 * 读侧(GET):服务端三源合并(D-09:覆盖层 > requirement.json 实测 > 键面快照默认),
 * rows 形状按 UI-SPEC C8(e2e 断言面直接消费);文件面状态随 rows 附 fileState。
 *
 * 写侧(PUT,D-08 两段式):①权威覆盖层先落(generation_config_overrides,两值全 null=删行)
 * → ②requirement.json best-effort 原子写回(tmp+rename+mtime 乐观锁)。响应
 * { phaseKey, writeState },writeState 三态如实:
 *   'synced'    已同步 requirement.json(最强态)
 *   'file-fail' 文件面寻址到但写失败/stale(EACCES 如实上报——本机 pipe-* 恒败验证面)
 *   'override'  两段寻址都未命中,只有覆盖层
 * 文件读失败/EACCES 不影响 HTTP 200——writeState 承载三态,**绝不假成功**。
 *
 * 服务端钳制兜底(D-10 第二道;前端禁用是第一道非唯一道):
 *   pre ≥ 1、final = clamp(1, final, 有效pre)、确定性派生键 pre>1 → 400 + 原因文案。
 *
 * **判错看 HTTP status,不看 body.code**——error() 信封 body.code 恒 400(RESEARCH A 陷阱),
 * HTTP 状态码另由 res.status() 给出。
 */
import express from "express";
import fs from "fs";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import {
  GENERATION_CONFIG_KEYS,
  isKnownPhaseKey,
  clampRedundancy,
  effectivePre,
  resolveRequirementFile,
  applyRequirementWrite,
  mergeThreeSources,
  type FsLike,
} from "@/lib/generationConfigService";
import {
  listGenerationConfigOverrides,
  upsertGenerationConfigOverride,
} from "@/lib/canvasRelationalStore";

const router = express.Router();

// ─── 寻址参数(env 可配;OUTPUT_DIR 为既有 base,RESEARCH B 不复用语义分裂的 KAIS_OUTPUT_DIR) ───

/** D-08② 寻址第一段:专用 env 绝对路径直取(部署指到当前 ep 工作区 requirement.json)。 */
function envRequirementFile(): string | null {
  return process.env.GENERATION_CONFIG_REQUIREMENT_FILE?.trim() || null;
}

/** D-08② 寻址第二段:pipe-* 反查根 = OUTPUT_DIR(默认 /mnt/agents/output)拼 /pipelines。 */
function pipeRootDir(): string {
  const base = process.env.OUTPUT_DIR || "/mnt/agents/output";
  return `${base.replace(/\/+$/, "")}/pipelines`;
}

const fsLike = fs as FsLike;

// ─── GET /:三源合并 rows ──────────────────────────

const querySchema = z.object({
  projectId: z.coerce.number().int(),
  episodesId: z.coerce.number().int(),
});

router.get("/", async (req, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json(error("参数校验失败", parsed.error.issues));
  }
  const { projectId, episodesId } = parsed.data;

  try {
    const scope = { projectId, episodesId };
    const [overrideRows, resolved] = await Promise.all([
      listGenerationConfigOverrides(scope),
      Promise.resolve(
        resolveRequirementFile(fsLike, {
          envFile: envRequirementFile(),
          pipeRoot: pipeRootDir(),
          projectId,
        }),
      ),
    ]);
    const rows = mergeThreeSources(GENERATION_CONFIG_KEYS, overrideRows, resolved.state, resolved.values);
    return res.json(success({ rows, fileState: resolved.state }));
  } catch (err) {
    console.error("[canvas:v2/generation-config] GET 失败", err);
    return res.status(500).json(
      error("generation-config 读取失败", err instanceof Error ? err.message : String(err)),
    );
  }
});

// ─── PUT /overrides/:phaseKey:覆盖层权威段 + best-effort 写回 ───

// z.coerce.number 与 .nullable() 组合安全:null 在 ZodNullable 层短路,不会走 Number(null)=0。
const putSchema = z.object({
  projectId: z.coerce.number().int(),
  episodesId: z.coerce.number().int(),
  // null = 清除该旋钮覆盖;缺省同 null。上界 99 见 T-62-04(防巨值写库,显式 400)。
  nCandidates: z.coerce.number().int().max(99).nullable().optional(),
  finalCandidates: z.coerce.number().int().max(99).nullable().optional(),
});

router.put("/overrides/:phaseKey", async (req, res) => {
  const parse = putSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json(error("参数校验失败", parse.error.issues));
  }
  const { projectId, episodesId } = parse.data;
  // T-62-04:phaseKey 白名单(14 键;p10_voice.tts/报告审计类不在键集天然 400)
  const phaseKey = req.params.phaseKey;
  if (!isKnownPhaseKey(phaseKey)) {
    return res.status(400).json(error(`未知 phase_key: ${phaseKey}`));
  }

  // 缺省归一为 null(清除语义)
  const rawN = parse.data.nCandidates ?? null;
  const rawF = parse.data.finalCandidates ?? null;

  const keyDef = GENERATION_CONFIG_KEYS.find((k) => k.phaseKey === phaseKey)!;

  try {
    const scope = { projectId, episodesId };

    // 文件面只读寻址(零副作用;先于落库——保证写回文件的值与落库值一致)
    const resolved = resolveRequirementFile(fsLike, {
      envFile: envRequirementFile(),
      pipeRoot: pipeRootDir(),
      projectId,
    });

    // D-10 服务端钳制兜底:确定性派生键 pre 固定 1(前端禁用是第一道非唯一道)
    if (keyDef.preCap1 && rawN != null && rawN > 1) {
      return res.status(400).json(error("确定性派生 · pre 固定为 1"));
    }

    // 钳制:pre ≥ 1;final = clamp(1, final, 有效pre)(khs resolver 同式)
    const nc = rawN != null ? Math.max(1, rawN) : null;
    let fc: number | null = null;
    if (rawF != null) {
      const existingRows = await listGenerationConfigOverrides(scope);
      const cur = existingRows.find((r) => r.phaseKey === phaseKey);
      const filePre =
        resolved.state === "requirement" ? resolved.values[phaseKey]?.pre ?? null : null;
      const effPre = effectivePre(keyDef, nc ?? cur?.nCandidates ?? null, filePre);
      fc = clampRedundancy(effPre, rawF).final;
    }

    // 执行序①:权威覆盖层先落(两值全 null → 删行)
    await upsertGenerationConfigOverride(scope, phaseKey, {
      nCandidates: nc,
      finalCandidates: fc,
    });

    // 执行序②:best-effort 写回(命中 path 时以寻址时 mtime 为乐观锁基准)
    let writeState: "synced" | "file-fail" | "override" = "override";
    if (resolved.path) {
      try {
        writeState = applyRequirementWrite(
          fsLike,
          resolved.path,
          phaseKey,
          { nCandidates: nc, finalCandidates: fc },
          resolved.mtime,
        );
      } catch (err) {
        console.error("[canvas:v2/generation-config] requirement.json 写回异常(不阻塞)", err);
        writeState = "file-fail";
      }
    }

    return res.json(success({ phaseKey, writeState }));
  } catch (err) {
    console.error("[canvas:v2/generation-config] PUT 失败", err);
    return res.status(500).json(
      error("覆盖层写入失败", err instanceof Error ? err.message : String(err)),
    );
  }
});

export default router;
