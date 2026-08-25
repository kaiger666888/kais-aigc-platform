/**
 * gateCatalog.ts — kmc 16 gate 定义快照 + 四态折叠(Phase 54-01 / GATE-01)。
 *
 * 平行声明(D-02,canvasAssetSchema 头注释同款纪律):本文件是 khs 权威源的
 * kap 侧快照镜像——
 *   - 定义真值源:kais-hermes-skills plugins/review_gates/gates.yaml(version 2,
 *     16 entry,phase_id-keyed)
 *   - derive 规则真值源:plugins/review_gates/gate_config.py(_PHASE_PREFIX_RE /
 *     _REDLINE_SUFFIX_RE / derive_gate_id / _LEGACY_GATE_ID_TO_PHASE_ID)
 * khs 改 gates.yaml 时 verify:phase-54 S-catalog 变红(零漂移治理)。
 *
 * foldDisplayState(D-04 四态折叠,RESEARCH §E 全表):平台 (state, disposition,
 * review_result) → pending/approve/reject/waive。非 COMPLETE 一律 pending;
 * decision 优先;BLOCK→reject;AUTO/HUMAN 无 decision → approve(legacy 兼容)。
 *
 * 纯模块:无 @/utils import(P7——verify 脚本直读);等值匹配铁律(WR-01——
 * 禁止任何前缀式字符串匹配)。
 */

import { z } from "zod";

// ─── Snapshot schema(gates.yaml entry 镜像)───────────────────────────────

export const GATE_ENTRY_SCHEMA = z.object({
  /** yaml key = phase_id(唯一权威键) */
  phaseId: z.string().min(1),
  /** entry.phase 字段(与 key 相等的冗余回显;红线子键 = 基础 phase) */
  phase: z.string().min(1),
  /** derived gate id(deriveGateId 产物) */
  derivedGateId: z.string().min(1),
  mode: z.enum(["blocking", "webhook", "polling"]),
  /** 红线子键(p13_delivery_redline_*):从不 submit_review,自动扫描 */
  isRedline: z.boolean(),
  /** 红线键平台不可见(静态自动扫描,不出现在 review 列表) */
  platformInvisible: z.boolean(),
  assetBusSlotsToLock: z.array(z.string()),
  reviewerRole: z.array(z.string()),
  timeoutSec: z.number().int().positive(),
  callbackUrl: z.string().nullable(),
  retryPolicy: z.object({
    maxRetries: z.number().int().positive(),
    backoffSec: z.number().int().positive(),
  }),
});
export type GateEntry = z.infer<typeof GATE_ENTRY_SCHEMA>;

// ─── derive 规则移植(gate_config.py 同源)────────────────────────────────

const PHASE_PREFIX_RE = /^(p\d+[a-z0-9]*)/;
const REDLINE_SUFFIX_RE = /_redline_[a-z_]+$/;

/** 红线后缀剥离 → 取完整 sub-phase token + "-gate"(2026-08-18 full-token)。 */
export function deriveGateId(phaseId: string): string {
  const base = phaseId.replace(REDLINE_SUFFIX_RE, "");
  const m = PHASE_PREFIX_RE.exec(base);
  return (m ? m[1] : base) + "-gate";
}

export function isRedlineKey(phaseId: string): boolean {
  return REDLINE_SUFFIX_RE.test(phaseId);
}

/**
 * 完整 sub-phase token(gateStateService 同源):"p11a0_iframe_qc"→"p11a0"、
 * "p11c-gate"→"p11c"——比 leadingPhaseToken(/^p\d+/ 把 p11a0/p11a/p11b/p11c
 * 全折叠成 "p11")更细。70-03 (v3.2 F18) reviewBridge 相位匹配迁移至此:
 * p11a0 的换选绝不能批到同剧集 open 的 p11c 门上(=全量豁免放行)。
 */
export function fullPhaseToken(value: string): string | null {
  const m = /^p\d+[a-z0-9]*/.exec(value.trim().toLowerCase());
  return m === null ? null : m[0];
}

/** legacy 原始 gate_id → phase_id(gate_config.py L136-158 抄录,8 条)。 */
export const LEGACY_GATE_ID_TO_PHASE_ID: Readonly<Record<string, string>> = {
  "topic-gate": "p01_hook_topic",
  "outline-gate": "p02_outline",
  "script-gate": "p03_script_audit",
  "render-gate": "p11_video_render",
  "delivery-gate": "p13_delivery",
  "p11-gate": "p11b_final_render",
  redline_emotion_desensitize: "p13_delivery_redline_emotion",
  redline_no_cold_open: "p13_delivery_redline_no_cold_open",
  redline_unfinished_ending: "p13_delivery_redline_unfinished",
};

export const EXPECTED_GATE_COUNT = 16;

// ─── 16 gate 快照(管线序 P01→P13;gates.yaml 逐字段镜像)──────────────────

function entry(
  phaseId: string,
  mode: "blocking" | "webhook" | "polling",
  reviewerRole: string[],
  slots: string[],
  timeoutSec: number,
  retry: { maxRetries: number; backoffSec: number },
  phase?: string,
): GateEntry {
  return {
    phaseId,
    phase: phase ?? phaseId.replace(REDLINE_SUFFIX_RE, ""),
    derivedGateId: deriveGateId(phaseId),
    mode,
    isRedline: isRedlineKey(phaseId),
    platformInvisible: isRedlineKey(phaseId), // 红线从不 submit_review
    assetBusSlotsToLock: slots,
    reviewerRole,
    timeoutSec,
    callbackUrl: null,
    retryPolicy: retry,
  };
}

export const GATE_CATALOG: readonly GateEntry[] = [
  entry("p01_hook_topic", "blocking", ["creative_source"], ["hook-topic", "outline"], 3600, { maxRetries: 2, backoffSec: 300 }),
  // ICA M1 (2026-08-25 27c7dce): creative-contracts 追加锁定 — 契约清单 Gate 2 逐条确认期间不得变异
  entry("p02_outline", "blocking", ["creative_source"], ["outline", "creative-contracts"], 3600, { maxRetries: 2, backoffSec: 300 }),
  entry("p03_script_audit", "blocking", ["script_auditor", "compliance_gate"], ["spatio-temporal-script", "temp-dialogue"], 7200, { maxRetries: 3, backoffSec: 600 }),
  entry("p04_character_design", "blocking", ["character_designer", "visual_executor"], ["character-bible", "character-assets"], 3600, { maxRetries: 2, backoffSec: 300 }),
  entry("p06_spatio_temporal_script", "blocking", ["creative_source"], ["spatio-temporal-script", "temp-dialogue"], 3600, { maxRetries: 2, backoffSec: 300 }),
  entry("p07_scene_generation", "blocking", ["creative_source"], ["scene-images", "geometry-bed"], 3600, { maxRetries: 2, backoffSec: 300 }),
  entry("p09c_storyboard_board", "blocking", ["visual_executor"], ["storyboard-board", "storyboard-qc"], 3600, { maxRetries: 2, backoffSec: 300 }),
  entry("p10c_voice_audit", "blocking", ["editor"], ["voice-audit"], 3600, { maxRetries: 2, backoffSec: 300 }),
  entry("p11a0_iframe_qc", "blocking", ["visual_executor"], ["iframe-qc"], 3600, { maxRetries: 2, backoffSec: 300 }),
  entry("p11a_preview_clips", "blocking", ["visual_executor"], ["rapid-preview-clips", "preview-qc"], 7200, { maxRetries: 2, backoffSec: 300 }),
  entry("p11b_final_render", "webhook", ["editor"], ["final-shots"], 14400, { maxRetries: 1, backoffSec: 1800 }),
  entry("p11c_video_qc", "blocking", ["editor"], ["video-qc", "failed-shots"], 14400, { maxRetries: 3, backoffSec: 600 }),
  entry("p13_delivery", "blocking", ["compliance_marketing", "editor"], ["final-shots", "master-mp4"], 7200, { maxRetries: 3, backoffSec: 600 }),
  entry("p13_delivery_redline_emotion", "blocking", ["redline_scanner"], ["final-shots", "master-mp4"], 60, { maxRetries: 1, backoffSec: 60 }),
  entry("p13_delivery_redline_no_cold_open", "blocking", ["redline_scanner"], ["final-shots"], 60, { maxRetries: 1, backoffSec: 60 }),
  entry("p13_delivery_redline_unfinished", "blocking", ["redline_scanner"], ["final-shots"], 60, { maxRetries: 1, backoffSec: 60 }),
];

// ─── UI 显示名(UI-SPEC U-06 固化)─────────────────────────────────────────

export const GATE_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  "p01-gate": "选题定向",
  "p02-gate": "大纲",
  "p03-gate": "剧本审核",
  "p04-gate": "角色设计",
  "p06-gate": "时空剧本",
  "p07-gate": "场景生成",
  "p09c-gate": "分镜板",
  "p10c-gate": "配音审听",
  "p11a0-gate": "条件帧门",
  "p11a-gate": "预览片段",
  "p11b-gate": "最终渲染",
  "p11c-gate": "镜头质检",
  "p13-gate": "成片交付",
  // 红线 3 键(平台不可见,静态自动扫描态)
  "p13_delivery_redline_emotion": "情绪红线",
  "p13_delivery_redline_no_cold_open": "无冷开场红线",
  "p13_delivery_redline_unfinished": "完整性红线",
};

/** 管线序索引(P01→P13;用于泳道/面板排序)。 */
export const GATE_PIPELINE_ORDER: readonly string[] = GATE_CATALOG.map((g) => g.phaseId);

// ─── 四态折叠(D-04,RESEARCH §E 全表)────────────────────────────────────

export type GateDisplayState = "pending" | "approve" | "reject" | "waive";

export function foldDisplayState(
  state: string,
  disposition: string | null,
  result: { decision?: string } | null,
): GateDisplayState {
  // PENDING / POLICY_EVAL / APPROVING → 等你决策(D-04:中间态全部折叠)
  if (state !== "COMPLETE") return "pending";
  const d = result?.decision;
  if (d === "reject") return "reject";
  if (d === "waive") return "waive";
  if (d === "approve") return "approve";
  if (disposition === "BLOCK") return "reject"; // 系统拦截
  return "approve"; // AUTO / legacy(无 decision 的历史 COMPLETE,显示层兼容读法)
}
