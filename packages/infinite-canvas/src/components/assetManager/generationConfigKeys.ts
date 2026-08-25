/**
 * khs v2.5 pre/final 冗余键面常量表 + 资产域指派表 + 子类型→阶段映射（D-01/D-10/D-11）。
 *
 * 契约源 = kais-movie-pipeline skills 仓 runner.py:2341-2392 实码（Phase 27-01 已 shipped，
 * commit cdd12dd「single-product redundancy foundation — default-table 11 paired keys +
 * resolve_capped_redundancy helper」）。27-CONTEXT 快照已过时（12 嵌套键口径）——禁照抄：
 * transition 已被 27-02 单键裁决并入 shot_list（无独立候选域），不可配报告/审计类实为 18 个。
 *
 * 键面口径（62-RESEARCH F 三处漂移修正之③）：
 *   - 11 嵌套键 + 3 扁平键 = 14 可配键
 *   - 5 个确定性派生键 pre 硬上限 1（preCap1）
 *   - p12_audio.bgm / p12_audio.foley 为「占位未接线」态（键面存在供读侧显示，运行时无消费）
 *   - p10_voice.tts pre 钉死 1 + 18 报告/审计类（汇总计数，不逐键枚举——防新漂移面）= 锁定区 19 键
 *
 * 服务端拷贝 src/lib/generationConfigService.ts（62-02 落地）的键集必须与本表相等
 * ——verify-phase-62 S-门锁。D-12 e2e 契约测试以本表为 fixture 口径（键面漂移即暴露）。
 */
import type { AssetSubtype } from './assetManagerData'

// ─── 可配键面（14 键 = 11 嵌套 + 3 扁平） ──────────────────

/** 档位：LLM 产物 / 引擎产物 / 确定性派生 / 文本候选（UI-SPEC C8 档位徽标四态）。 */
export type ConfigTier = 'llm' | 'engine' | 'deterministic' | 'text'

/** 单个可配键面的静态口径（行结构对齐 UI-SPEC C8 配置面板一行）。 */
export interface GenerationConfigKey {
  /** khs phase_key（如 'p09_shotlist.shot_list' / 扁平 'p02_outline'）。 */
  phaseKey: string
  tier: ConfigTier
  /** 中文显示名（UI-SPEC Copywriting phase_key 显示名表逐字）。 */
  label: string
  /** 快照默认 pre（扁平三键全 3；嵌套全 1 除 topic_kernel 共享扁平 =3）。 */
  defaultPre: number
  /**
   * 快照默认 final。null = khs default_final=None 哨兵（_vision_review.py:68-70，
   * 缺省 final 回落 pre）——现网仅扁平 p01_hook 如此（runner 不落数字 final 键）。
   */
  defaultFinal: number | null
  /** 确定性派生类：pre 硬上限 1（D-10，写侧拒绝 pre>1）。 */
  preCap1?: true
  /** 占位未接线：键面存在、读侧显示「未接线」，运行时暂不消费覆盖层（HIER-03）。 */
  unwired?: true
  /** GPU 成本护栏标注（p11_video 特有，⚠ hint「GPU 成本护栏 · 谨慎调高」）。 */
  gpuHint?: true
  /** 注记文案（shot_list：转场随分镜表候选整体——27-02 单键裁决）。 */
  note?: string
}

/**
 * 14 可配键面。嵌套键顺序按 runner.py:2341-2392 实表；transition 不设独立键。
 * 默认值口径（runner.py:2285-2292 + 2341-2392）：扁平 pre 全 3（p02/p03 final=1，
 * p01_hook final 缺省=pre 哨兵）；嵌套默认全 {pre:1, final:1} 除 topic_kernel
 * （嵌套仅 final=1，pre 共享扁平 =3）。
 */
export const GENERATION_CONFIG_KEYS: readonly GenerationConfigKey[] = [
  // ── 嵌套键（11，runner.py:2341-2392）──
  { phaseKey: 'p01_hook.topic_kernel', tier: 'llm', label: '选题钩子·题核',
    defaultPre: 3, defaultFinal: 1, note: '嵌套仅设 final；pre 共享扁平键（=3）' },
  { phaseKey: 'p06_script.spatio_temporal', tier: 'llm', label: '时空剧本',
    defaultPre: 1, defaultFinal: 1 },
  { phaseKey: 'p09_shotlist.shot_list', tier: 'llm', label: '分镜列表·参数',
    defaultPre: 1, defaultFinal: 1, note: '转场随分镜表候选整体' },
  { phaseKey: 'p11_video.video_render', tier: 'engine', label: '视频渲染',
    defaultPre: 1, defaultFinal: 1, gpuHint: true },
  { phaseKey: 'p07_style.style_vector', tier: 'deterministic', label: '风格·风格向量',
    defaultPre: 1, defaultFinal: 1, preCap1: true },
  { phaseKey: 'p07_style.color_intent', tier: 'deterministic', label: '风格·色彩意图',
    defaultPre: 1, defaultFinal: 1, preCap1: true },
  { phaseKey: 'p12_compose.master_timeline', tier: 'deterministic', label: '合成·主时间线',
    defaultPre: 1, defaultFinal: 1, preCap1: true },
  { phaseKey: 'p12_compose.audio_mix', tier: 'deterministic', label: '合成·混音',
    defaultPre: 1, defaultFinal: 1, preCap1: true },
  { phaseKey: 'p13_master.master_mp4', tier: 'deterministic', label: '母版·成片',
    defaultPre: 1, defaultFinal: 1, preCap1: true },
  { phaseKey: 'p12_audio.bgm', tier: 'engine', label: '音频·BGM',
    defaultPre: 1, defaultFinal: 1, unwired: true },
  { phaseKey: 'p12_audio.foley', tier: 'engine', label: '音频·Foley',
    defaultPre: 1, defaultFinal: 1, unwired: true },
  // ── 扁平键（3，khs Phase 26，runner.py:2285-2292）──
  { phaseKey: 'p01_hook', tier: 'text', label: '选题钩子（文本候选）',
    defaultPre: 3, defaultFinal: null },
  { phaseKey: 'p02_outline', tier: 'text', label: '故事大纲（文本候选）',
    defaultPre: 3, defaultFinal: 1 },
  { phaseKey: 'p03_script', tier: 'text', label: '剧本（文本候选）',
    defaultPre: 3, defaultFinal: 1 },
]

// ─── 不可配锁定区（汇总形态，不逐键枚举） ──────────────────

/**
 * 不可配键（D-11）：配置面显示为禁用行 + reason，不隐藏。
 * 报告/审计类按「18 个」做汇总计数（khs 未交付逐键枚举清单——手工枚举会引入新漂移面，
 * 62-RESEARCH F 明示建议），tts 单列。锁定区总数 = 1 + 18 = 19
 * （UI-SPEC 旧稿「30」按漂移修正③改 19，62-06/07 同口径）。
 */
export const LOCKED_CONFIG_KEYS = {
  tts: { phaseKey: 'p10_voice.tts', reason: 'TTS 首选即定（防铺轨污染）· pre 钉死 1' },
  reportAudit: { count: 18, reason: '报告/审计类 · 管线固定' },
} as const

/** 锁定区总行数（tts 单列 1 + 报告/审计汇总 18）。 */
export const LOCKED_KEYS_TOTAL = 1 + LOCKED_CONFIG_KEYS.reportAudit.count

// ─── L1 域指派表（UI-SPEC 层间指派规则，e2e 锁死） ─────────

/** 资产层级视图 L1 三域。 */
export type AssetDomain = 'setting' | 'media' | 'text'

/**
 * DB type → 域 指派表（UI-SPEC L1 全量）：
 *   - 设定资产：角色/场景/道具族 + keyframe（G13 首尾分选候选与设定同域语义）
 *   - 媒体产物：video/clip/audio/voice/storyboard
 *   - 文本产物：script_phase/outline/topic/storyboard_board/delivery/style/
 *     requirement/story/script（Notion 文档型资产按 DB type 自然落域，无需 subtype 二级映射）
 * 未列类型兜底 = media（domainOfType）。
 */
export const TYPE_DOMAIN: Record<string, AssetDomain> = {
  // setting
  character: 'setting',
  scene: 'setting',
  scene_variant: 'setting',
  scene_image: 'setting',
  prop: 'setting',
  prop_key: 'setting',
  prop_consumable: 'setting',
  costume: 'setting',
  accessory: 'setting',
  keyframe: 'setting',
  // media
  video: 'media',
  clip: 'media',
  audio: 'media',
  voice: 'media',
  storyboard: 'media',
  // text
  script_phase: 'text',
  outline: 'text',
  topic: 'text',
  storyboard_board: 'text',
  delivery: 'text',
  style: 'text',
  requirement: 'text',
  story: 'text',
  script: 'text',
  // 62-07 报告类资产（type='document'）按文档语义归文本域（此前兜底 media 误染玫）
  document: 'text',
}

/** type → 域（未列类型兜底 media）。 */
export function domainOfType(type: string): AssetDomain {
  return TYPE_DOMAIN[type] ?? 'media'
}

// ─── 子类型 → 管线阶段映射（D-01 阶段徽标推导） ────────────

/** PHASE_BY_SUBTYPE 条目：阶段码 + （可选）报告/审计标志。 */
export interface PhaseBySubtypeEntry {
  /** 阶段码（如 'P09'，阶段徽标直显文案）。 */
  phaseCode: string
  /** 报告/审计类产物：不进单件桶显式节点（D-03），但计入域级 total。 */
  reportAudit?: boolean
}

/**
 * 子类型 → 管线阶段静态映射（键域 = AssetSubtype 全词表，assetManagerData.ts）。
 * 阶段徽标缺省 meta.phaseCode 直读时的推导回退表（e2e 契约锁）。
 * subtype='unknown' 不入表——兜底走 meta 直读。
 */
export const PHASE_BY_SUBTYPE: Partial<Record<AssetSubtype, PhaseBySubtypeEntry>> = {
  pipeline_requirement: { phaseCode: 'P01' },
  story_framework: { phaseCode: 'P02' },
  episode_script: { phaseCode: 'P03' },
  // P04 角色设计族（概念图/Turnaround/服化道时段变体/Bible）
  character_concept: { phaseCode: 'P04' },
  turnaround_sheet: { phaseCode: 'P04' },
  turnaround_view: { phaseCode: 'P04' },
  costume_temporal_variant: { phaseCode: 'P04' },
  costume_turnaround: { phaseCode: 'P04' },
  costume_design: { phaseCode: 'P04' },
  character_bible: { phaseCode: 'P04' },
  spatio_temporal_script: { phaseCode: 'P06' },
  // P07 场景设计族
  scene_base: { phaseCode: 'P07' },
  scene_variant: { phaseCode: 'P07' },
  scene_blueprint: { phaseCode: 'P07' },
  scene_temporal_variant: { phaseCode: 'P07' },
  scene_view_angle: { phaseCode: 'P07' },
  scene_design: { phaseCode: 'P07' },
  // P09 分镜族（transition 无独立资产子类型——随 shot_list 整体）
  shot_list: { phaseCode: 'P09' },
  e_konte: { phaseCode: 'P09' },
  keyframe_first: { phaseCode: 'P09' },
  keyframe_last: { phaseCode: 'P09' },
  midframe: { phaseCode: 'P09' },
  scene_angle_shot: { phaseCode: 'P09' },
  // P10 语音族（rapid_preview 为 P10b 快速预览）
  voice_print: { phaseCode: 'P10' },
  voice_profile: { phaseCode: 'P10' },
  voice_clips: { phaseCode: 'P10' },
  rapid_preview: { phaseCode: 'P10' },
  video_clips: { phaseCode: 'P11' },
  // P12 合成/音频族
  bgm_design: { phaseCode: 'P12' },
  bgm_track: { phaseCode: 'P12' },
  foley_stem: { phaseCode: 'P12' },
  audio_stems: { phaseCode: 'P12' },
  master_timeline: { phaseCode: 'P12' },
  // P13 交付（delivery_package 为报告/审计类：不进单件桶卡片，计入域计数）
  master_mp4: { phaseCode: 'P13' },
  delivery_package: { phaseCode: 'P13', reportAudit: true },
}

// ─── 钳制（khs resolver 逐字） ─────────────────────────────

/**
 * 冗余旋钮钳制 —— khs resolver 逐字（pipeline/phases/_vision_review.py:87-91）：
 *   pre ≥ 1；final = max(1, min(final, pre))（即 clamp(1, final, pre)）。
 * kap 写侧前端第一道同语义拦截（D-10）；绕过前端由后端 400 兜底。
 */
export function clampRedundancy(pre: number, final: number): { pre: number; final: number } {
  const p = Math.max(1, pre)
  return { pre: p, final: Math.max(1, Math.min(final, p)) }
}
