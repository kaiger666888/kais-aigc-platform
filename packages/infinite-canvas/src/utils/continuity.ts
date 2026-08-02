/**
 * 分镜连续性判定 —— 首尾帧生成流水线的「复用 / 重新生成」决策核心。
 *
 * 背景：Kai 的 6 步流水线中，⑤e 规定——若 shot[n] 的首帧与 shot[n-1] 的尾帧
 * 连续，则直接复用上一镜尾帧；否则独立生成首帧。本模块把这条规则落成纯函数，
 * 只依赖 P09 分镜数据里**已存在**的字段（scene_ref / character_refs /
 * start_frame_description / dialogue_note），不调用任何 API、不读 store。
 *
 * 数据来源（本项目 1785508691757 的 P09 manifest）：
 *   - scene_ref        形如 "assets/S07/S01_front.png"（目录 S07 = 场景组，
 *                       文件名 S01_front = 场景号 + 摄影机角度）
 *   - character_refs   [{ name, turnaround_path, role }, ...]
 *   - start_frame_description / dialogue_note  可能含「闪白/画面全黑/闪回」等转场词
 *
 * 设计要点（与 docs/frame-generation-pipeline.md 对齐）：
 *   1. extractSceneId 返回「场景号 + 角度」复合标识（如 "S01_front"），而非仅
 *      场景号。因为场景角度图就是首尾帧的背景底版（background plate），角度变了
 *      底版就变了——即便同处一个场景 S01，front→angle_right 仍不能复用上一镜尾帧。
 *      粗粒度的「场景号」（"S01"）由 extractSceneBase 提供，仅供分组/展示。
 *   2. 硬转场是「镜间事件」，信号可能出现在上一镜的尾部描述，也可能出现在当前镜
 *      的首部/对白注释。故 hasTransitionSignal 同时扫描 prevShot 与 currShot——
 *      这是判定 B01→B02 为断裂（B01 整镜即「闪回/闪白过渡」）的关键。
 */

// ─── 类型 ────────────────────────────────────────────────

/** 单个分镜的连续性判定所需最小数据（从 P09 manifest 投影）。 */
export interface ShotData {
  /** 分镜号，如 "S01_B03" */
  shotId: string
  /** P09 params.scene_ref，如 "assets/S07/S01_front.png" */
  sceneRef: string
  /** 出场角色名集合（character_refs[].name），如 ["shenzhiyi", "shenzhiyao"] */
  characterNames: string[]
  /** P09 params.start_frame_description（当前镜首帧文字描述） */
  startFrameDesc: string
  /** P09 params.dialogue_note（对白 / SFX / BGM 注释，可能含转场词） */
  dialogueNote?: string
}

/** 连续性二态：continuous = 可复用上一镜尾帧；cut = 需独立生成首帧。 */
export type ContinuityType = 'continuous' | 'cut'

/** 断裂 / 连续的具体原因（与判定优先级一一对应）。 */
export type ContinuityReason =
  | 'same_scene_same_chars' // 连续：同场景同角度 + 同角色 + 无转场
  | 'scene_change' // 断裂：场景号或摄影角度不同
  | 'transition' // 断裂：检测到硬转场 / 时间跳跃信号
  | 'first_shot' // 断裂：全片首个分镜（无前序可复用）
  | 'character_change' // 断裂：前后镜角色集合无交集

/** 连续性判定结果。 */
export interface ContinuityResult {
  type: ContinuityType
  reason: ContinuityReason
  /** 前一镜分镜号；首镜为 null */
  prevShotId: string | null
  /** 是否复用上一镜尾帧作为本镜首帧 */
  reusePrevLastFrame: boolean
}

/** 原因 → 中文标签（供 UI 展示）。 */
export const CONTINUITY_REASON_LABEL: Record<ContinuityReason, string> = {
  same_scene_same_chars: '同场景·同角色',
  scene_change: '场景/角度切换',
  transition: '硬转场/时间跳跃',
  first_shot: '首镜·无前序',
  character_change: '角色无交集',
}

// ─── 场景标识解析 ──────────────────────────────────────────

/** 解析 scene_ref 的 basename 为「场景号 + 角度」结构。 */
function parseSceneRef(sceneRef: string): { token: string; base: string; angle: string | null } | null {
  // 仅取文件名，避免误匹配目录段（"assets/S07/S01_front.png" 的目录 S07 不是场景号）
  const basename = sceneRef.split('/').pop() ?? ''
  // 文件名形如 "S01_front.png" 或 "S01.png"；捕获场景号 + 可选角度
  const m = basename.match(/^S(\d+)(?:_([a-z_]+))?/i)
  if (!m || m[1] === undefined) return null
  const sceneNum = `S${m[1].padStart(2, '0')}`
  const angle = m[2] ?? null
  return {
    token: angle ? `${sceneNum}_${angle}` : sceneNum,
    base: sceneNum,
    angle,
  }
}

/**
 * 连续性判定所用的场景标识 = 场景号 + 摄影角度（如 "S01_front"）。
 *
 * 为什么包含角度：场景角度图即首尾帧背景底版；front 与 angle_right 是不同底版，
 * 跨角度复用尾帧会得到错误背景。故角度不同即视为「场景」断裂。
 * 如 "assets/S07/S01_front.png" → "S01_front"。
 */
export function extractSceneId(sceneRef: string): string {
  return parseSceneRef(sceneRef)?.token ?? sceneRef
}

/** 粗粒度场景号（仅 "S01"），用于分组 / 展示，不参与复用判定。 */
export function extractSceneBase(sceneRef: string): string {
  return parseSceneRef(sceneRef)?.base ?? sceneRef
}

// ─── 转场 / 时间跳跃信号 ───────────────────────────────────

/**
 * 硬转场 / 时间跳跃关键词。命中任一即判定为转场断裂（不复用）。
 * - 视觉硬切：闪白 / 黑屏 / 画面全黑 / 溶解
 * - 时间跳跃：闪回 / 次日 / X天后（"天后"）/ 与此同时
 * - 通用转场：转场
 */
const TRANSITION_KEYWORDS = [
  '闪白',
  '黑屏',
  '画面全黑',
  '溶解',
  '转场',
  '闪回',
  '次日',
  '天后',
  '与此同时',
] as const

/** 任一文本命中转场关键词即为真（null/undefined 文本自动跳过）。 */
export function hasTransitionSignal(...texts: Array<string | undefined | null>): boolean {
  return texts.some((t) => t != null && t.length > 0 && TRANSITION_KEYWORDS.some((kw) => t.includes(kw)))
}

// ─── 角色交集 ────────────────────────────────────────────

/**
 * 前后镜角色集合是否无交集。任一方缺角色数据（空数组）时返回 false——
 * 无法判定时不作为断裂依据，避免数据缺失导致误判。
 */
export function noCommonCharacters(prev: readonly string[], curr: readonly string[]): boolean {
  if (prev.length === 0 || curr.length === 0) return false
  const currSet = new Set(curr)
  return !prev.some((name) => currSet.has(name))
}

// ─── 判定主函数 ───────────────────────────────────────────

/**
 * 判定 currShot 的首帧是否可复用 prevShot 的尾帧。
 *
 * 优先级（高 → 低，命中即返回）：
 *   1. prevShot === null            → first_shot（不复用）
 *   2. 场景号或角度不同               → scene_change（不复用）
 *   3. 前后镜任一含转场/时间跳跃信号    → transition（不复用）
 *   4. 角色集合无交集                  → character_change（不复用）
 *   5. 否则                          → continuous（复用尾帧）
 *
 * @param prevShot 前一镜；全片首镜传 null
 * @param currShot 当前镜
 */
export function judgeContinuity(prevShot: ShotData | null, currShot: ShotData): ContinuityResult {
  // 1. 首镜：无前序可复用
  if (prevShot == null) {
    return { type: 'cut', reason: 'first_shot', prevShotId: null, reusePrevLastFrame: false }
  }

  // 2. 场景或摄影角度不同 → 背景底版不同，不可复用
  if (extractSceneId(prevShot.sceneRef) !== extractSceneId(currShot.sceneRef)) {
    return { type: 'cut', reason: 'scene_change', prevShotId: prevShot.shotId, reusePrevLastFrame: false }
  }

  // 3. 硬转场 / 时间跳跃：扫描前镜尾部 + 当前镜首部 / 对白注释
  //    （转场是镜间事件，信号常落在前镜尾帧描述，故 prevShot 一并扫描）
  if (
    hasTransitionSignal(
      prevShot.startFrameDesc,
      prevShot.dialogueNote,
      currShot.startFrameDesc,
      currShot.dialogueNote,
    )
  ) {
    return { type: 'cut', reason: 'transition', prevShotId: prevShot.shotId, reusePrevLastFrame: false }
  }

  // 4. 角色完全不同 → 不可复用
  if (noCommonCharacters(prevShot.characterNames, currShot.characterNames)) {
    return { type: 'cut', reason: 'character_change', prevShotId: prevShot.shotId, reusePrevLastFrame: false }
  }

  // 5. 同场景·同角度·同角色·无转场 → 连续，复用上一镜尾帧
  return { type: 'continuous', reason: 'same_scene_same_chars', prevShotId: prevShot.shotId, reusePrevLastFrame: true }
}
