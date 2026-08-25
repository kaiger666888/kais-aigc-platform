/**
 * scoreVocabulary.ts — 评分维度/视角/verdict 中文映射 + 量纲归一
 * (Phase 56-01 / VIZ-01,D-14/D-15)。
 *
 * 真值源(khs 侧,verify:phase-56 S-vocabulary 契约组对照锚点):
 *  - p03_script_audit.py:9,77-98 —— drama/rhythm/character/reversal_depth/social_resonance 五维
 *  - p14_quality_audit.py:18,1022-1028 —— hook_quality/narrative_design/shot_breakdown/
 *    scene_planning/character_consistency/audio_voice/visual_rendering + master 整体项 八维
 *  - p07_scene_generation.py:450-463 —— views dict(front/angle_left/angle_right/…)
 *  - p10c_voice_audit.py:356-361 —— PASS/WARN/FAIL 三值
 *
 * 契约:未知 key 原样返回(fail-soft——khs 改维度/改词汇不炸前端);
 * normalizeScore 统一 0-1 域(unit 原样钳制;percent /100;NaN→0)。
 * 纯模块零 React import。
 */

/** p03 审计维 + p14 八维 + 常见派生键 → 中文。
 *
 * 72-03 (v3.2 F29) 对齐 khs 真值:
 *  - p03 scores 四维 = drama/rhythm/character/logic(p03_script_audit.py:1322
 *    prompt 行;旧镜像漏 logic);D6/D7 顶层键 = reversal_depth /
 *    social_resonance_depth(:1328/:1332,旧镜像 social_resonance 少 _depth
 *    后缀——substring 命中掩盖了漂移)。
 *  - p14 八维第 8 维 = requirement_conformance(p14_quality_audit.py JSON
 *    模板;旧镜像的 master 不在 khs 实际维度集,仅作派生键保留)。
 */
export const DIM_LABELS: Readonly<Record<string, string>> = {
  // p03 scores 四维 + D6/D7 顶层维(剧本审计)
  drama: '戏剧性',
  rhythm: '节奏',
  character: '人物',
  logic: '逻辑',
  reversal_depth: '反转深度',
  social_resonance_depth: '社会共鸣深度',
  // legacy 键(story-framework 上游仍用短形;显示层兼容)
  social_resonance: '社会共鸣',
  // p14 八维(成片质量审计)
  hook_quality: '钩子质量',
  narrative_design: '叙事设计',
  shot_breakdown: '分镜拆解',
  scene_planning: '场景规划',
  character_consistency: '角色一致性',
  audio_voice: '音频配音',
  visual_rendering: '视觉渲染',
  requirement_conformance: '需求符合度',
  // p14 可选第 9 维(86ke 注入的 theory_check 第二层,仅当输入含新字段时产出)
  info_package_density: '信息密度',
  // 派生/整体项(khs 实际审计不产,聚合层用)
  master: '整体',
  overall: '综合',
}

/** 视角 key(p04 crops 四命名视图 + p07 views dict 实际 key 集)→ 中文。 */
export const VIEW_LABELS: Readonly<Record<string, string>> = {
  front: '正面',
  back: '背面',
  rear: '背面', // 需求文案同义 key
  side: '侧面',
  left: '左侧',
  right: '右侧',
  angle_left: '左侧斜角',
  angle_right: '右侧斜角',
  top_down: '俯视',
  'top-down': '俯视', // 连字符同义 key
  bottom_up: '仰视',
  three_quarter: '3/4 侧',
  '3/4': '3/4 侧',
  close_up: '特写',
  full_body: '全身',
  reference: '参考图',
}

/** qwen-eye/qwen-ear verdict 词表 → 中文(72-05/v3.2 F32:三值闭集扩到 khs
 * 真实五值+解析失败态——SKIPPED 不再与 PASS 混同、ERROR/MUST_FIX 不再被
 * 三值过滤器静默丢弃。未知值原样返回(fail-soft)。 */
export const VERDICT_LABELS: Readonly<Record<string, string>> = {
  PASS: '通过',
  WARN: '留意',
  FAIL: '不过',
  ERROR: '异常',
  SKIPPED: '未评',
  MUST_FIX: '必修',
  PARSE_FAIL: '解析失败',
}

function lookup(table: Readonly<Record<string, string>>, key: string): string {
  return table[key] ?? key
}

export function dimLabel(key: string): string {
  return lookup(DIM_LABELS, key)
}

export function viewLabel(key: string): string {
  return lookup(VIEW_LABELS, key)
}

export function verdictLabel(v: string): string {
  const upper = String(v).toUpperCase()
  const hit = VERDICT_LABELS[upper]
  return hit ?? v
}

/**
 * 量纲归一 → 0-1 域。scale 'percent' /100;'ten' /10(khs p11a0 iframe-qc
 * 真实档位,68-01 F13);缺省 'unit' 原样;非有限/非 number → 0;越界钳制 [0,1]。
 */
export function normalizeScore(
  v: unknown,
  scale?: 'unit' | 'percent' | 'ten',
): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0
  let n = scale === 'percent' ? v / 100 : scale === 'ten' ? v / 10 : v
  if (n > 1) n = 1
  if (n < 0) n = 0
  return n
}
