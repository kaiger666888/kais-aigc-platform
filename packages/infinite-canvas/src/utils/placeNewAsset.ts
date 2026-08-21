/**
 * placeNewAsset.ts — 新资产有界落点纯函数(Phase 55-04 / NAV-04,UI-SPEC §6)。
 *
 * 两模式:事件源旁(anchor='source',+24/−16 右上偏移,4px 网格)与视口中心
 * (anchor='center',8px 网格)。非有限输入一律防御性走 center 分支
 * (T-55-02:payload.position 伪造/NaN 不得散布)。纯函数无随机数
 * ——随机散布反模式(旧 LAYOUT 常量,55-07 已删)的替代者。
 */

export interface PlaceNewAssetOptions {
  sourcePosition?: { x: number; y: number } | null;
  viewportCenter: { x: number; y: number };
  anchor?: 'source' | 'center';
}

/** 有界常量(成功标准 4 纯函数口径):源旁偏移与网格步长。 */
export const PLACE_OFFSET = { x: 24, y: -16 } as const;
export const PLACE_GRID = { source: 4, center: 8 } as const;

function finitePoint(p: unknown): { x: number; y: number } | null {
  if (p == null || typeof p !== 'object') return null;
  const { x, y } = p as { x?: unknown; y?: unknown };
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

const snap = (v: number, grid: number): number => Math.round(v / grid) * grid;

export function placeNewAsset(opts: PlaceNewAssetOptions): { x: number; y: number } {
  const source = finitePoint(opts.sourcePosition);
  if (opts.anchor === 'source' && source != null) {
    return {
      x: snap(source.x + PLACE_OFFSET.x, PLACE_GRID.source),
      y: snap(source.y + PLACE_OFFSET.y, PLACE_GRID.source),
    };
  }
  const center = finitePoint(opts.viewportCenter) ?? { x: 0, y: 0 };
  return {
    x: snap(center.x, PLACE_GRID.center),
    y: snap(center.y, PLACE_GRID.center),
  };
}
