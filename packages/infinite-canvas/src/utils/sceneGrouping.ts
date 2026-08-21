/**
 * sceneGrouping.ts — 场景分组共享口径(Phase 55-02 / NAV-02,binding constraint 4)。
 *
 * 全仓唯一实现:sceneNumOf(shotId 首个数字段 → 场景号)+ SCENE_COLORS 4 色
 * 循环 + sceneColorOf + formatTotalDuration(MM:SS)。StoryboardTimeline
 * (本 plan 迁移)、ShotTree(55-05)、搜索导航器(55-04)全部消费本模块,
 * 消灭各处私有 sceneNumOf/取色副本。
 */
import { v3theme } from '../theme/catppuccin'

/** 分镜按场景号循环的 4 模态色板(相邻 scene 不同色)。 */
export const SCENE_COLORS = [v3theme.modality.image, v3theme.modality.video, v3theme.modality.audio, v3theme.modality.text] as const

/** 从 shotId 取场景号(首个数字段;无匹配返回 0)。 */
export function sceneNumOf(shotId: string): number {
  const m = shotId.match(/s?0*(\d+)/i)
  return m ? Number(m[1]) : 0
}

/** 场景号 → 4 色循环色(0/负数钳到首色)。 */
export function sceneColorOf(sceneNum: number): string {
  return SCENE_COLORS[Math.max(0, sceneNum - 1) % SCENE_COLORS.length]
}

/** 累计总时长 → MM:SS(非有限/≤0 → '00:00')。 */
export function formatTotalDuration(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return '00:00'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
