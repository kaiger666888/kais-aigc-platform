/**
 * src/components/canvas/LaneBands.tsx — 模态泳道背景带（文字/图片/视频/音频 × 功能子类）。
 *
 * 渲染画布底层地理（在 RF 节点之下、Background 网格之上）：
 *  - 模态路径：每活动子类一条带（模态弱色底 modalityWeak），按模态分组——组首带顶
 *    画模态大标签（文字/图片/视频/音频，模态色），组间加粗分隔线；子类标签（角色/场景/…）弱色。
 *  - stage fallback（fixture 无 phaseIndex）：原 STAGE_ORDER 十带（v3theme.lane 中性灰）。
 *  - 第 0 列左 gutter（globalColumn.width + 右分隔线，承载泳道标签）；
 *  - locked 参考区（lockedZone 包围盒 + hatch 图案 + 虚线框，§1.3 拉片参考）。
 *
 * 坐标对齐：SVG 套用 useViewport 的 translate/scale（与 RF viewport 同变换），
 * 故 band.top / lockedZone 等 flow 坐标与节点严丝合缝；pointer-events:none 不挡交互。
 */
import { useViewport } from '@xyflow/react'
import type { CanvasGeometry } from './laneGeometry'
import { V3_LAYOUT } from '../../constants'
import { v3theme } from '../../theme/catppuccin'
import { MODALITY_LABELS, type LaneModality } from '../../v3/lanes'

const LANE_LABELS: Record<string, string> = {
  global: '全局',
  script: '剧本',
  storyboard: '分镜',
  keyframe: '关键帧',
  video: '视频',
  voice: '配音',
  foley: '音效',
  bgm: 'BGM',
  mix: '混音',
  composite: '成片',
}

/**
 * 管道序号：剧本→成片 是真实的生产顺序，序号编码「这一步在管线里的位置」
 * （结构信息，非装饰）。global 是横切参考列（角色/风格资产，不属于序列环节）→ 不编号。
 */
const PIPELINE_SEQ: Record<string, string> = {
  script: '01', storyboard: '02', keyframe: '03', video: '04',
  voice: '05', foley: '06', bgm: '07', mix: '08', composite: '09',
}

const HATCH_ID = 'cv-locked-zone-hatch'
/** 单带 / 分隔线长度（足够覆盖最大画布；overflow:visible 不裁剪，不挡交互）。 */
const SPAN = 100000

export default function LaneBands({ geometry }: { geometry: CanvasGeometry }): React.ReactElement {
  const { x, y, zoom } = useViewport()
  const { bands, globalColumn, lockedZone } = geometry
  const colX = globalColumn.x ?? 0
  const dividerX = colX + globalColumn.width
  // 模态路径？任一带带 modality 即走模态渲染（否则 stage fallback）。
  const modalityMode = bands.some((b) => b.modality != null)

  return (
    <svg
      data-testid="lane-bands"
      aria-hidden="true"
      width={1}
      height={1}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        overflow: 'visible',
        pointerEvents: 'none',
        zIndex: 0,
        transform: `translate(${x}px, ${y}px) scale(${zoom})`,
        transformOrigin: '0 0',
      }}
    >
      <defs>
        <pattern
          id={HATCH_ID}
          width={6}
          height={6}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width={6} height={6} fill={v3theme.signal.lockedWeak} />
          <line x1={0} y1={0} x2={0} y2={6} stroke={v3theme.signal.lockedHatch} strokeWidth={1} />
        </pattern>
      </defs>

      {/* 泳道带 */}
      {bands.map((b, i) => {
        if (modalityMode) {
          // 模态路径：模态弱色底 + 组首模态大标签 + 子类标签 + 组间加粗分隔
          const mod = b.modality as LaneModality | undefined
          const prev = i > 0 ? (bands[i - 1]!.modality as LaneModality | undefined) : undefined
          const groupStart = mod !== prev
          const accent = mod ? v3theme.modality[mod] : v3theme.laneLabel
          const fill = mod ? v3theme.modalityWeak[mod] : v3theme.surface.canvas
          return (
            <g key={`m-${b.subClass ?? b.lane}-${i}`}>
              <rect x={0} y={b.top} width={SPAN} height={b.height} fill={fill} />
              {/* 组间加粗分隔线（模态边界，强化分组） */}
              {groupStart && (
                <line x1={0} y1={b.top} x2={SPAN} y2={b.top} stroke={accent} strokeWidth={1.5} opacity={0.5} />
              )}
              {groupStart && mod && (
                <text
                  x={colX + 8}
                  y={b.top + V3_LAYOUT.LANE_TOP_INSET}
                  fill={accent}
                  fontSize={11}
                  fontWeight={700}
                  fontFamily="var(--cv-font-mono, monospace)"
                  dominantBaseline="hanging"
                >
                  {MODALITY_LABELS[mod]}
                </text>
              )}
              {/* 子类标签（角色/场景/服装/…）——组首带模态色，其余弱色 */}
              <text
                x={colX + 8 + (groupStart ? 42 : 0)}
                y={b.top + V3_LAYOUT.LANE_TOP_INSET}
                fill={groupStart ? v3theme.laneLabel : 'rgba(154,159,168,0.40)'}
                fontSize={10}
                fontFamily="var(--cv-font-mono, monospace)"
                dominantBaseline="hanging"
              >
                {b.label ?? b.subClass ?? b.lane}
              </text>
            </g>
          )
        }
        // stage fallback：原十带（中性灰 + 管道序号 + 带名）
        const fill = v3theme.lane[b.lane as keyof typeof v3theme.lane] ?? v3theme.surface.canvas
        const seq = PIPELINE_SEQ[b.lane]
        const label = LANE_LABELS[b.lane] ?? b.lane
        return (
          <g key={`s-${b.lane}-${i}`}>
            <rect x={0} y={b.top} width={SPAN} height={b.height} fill={fill} />
            <line x1={0} y1={b.top} x2={SPAN} y2={b.top} stroke="rgba(255,255,255,0.04)" strokeWidth={1} />
            {seq && (
              <text
                x={colX + 8}
                y={b.top + V3_LAYOUT.LANE_TOP_INSET}
                fill={v3theme.laneNum}
                fontSize={9}
                fontFamily="var(--cv-font-mono, monospace)"
                dominantBaseline="hanging"
              >
                {seq}
              </text>
            )}
            <text
              x={colX + 8 + (seq ? 22 : 0)}
              y={b.top + V3_LAYOUT.LANE_TOP_INSET}
              fill={v3theme.laneLabel}
              fontSize={10}
              fontFamily="var(--cv-font-mono, monospace)"
              dominantBaseline="hanging"
            >
              {label}
            </text>
          </g>
        )
      })}

      {/* 左 gutter 右分隔线 */}
      <line
        x1={dividerX}
        y1={0}
        x2={dividerX}
        y2={SPAN}
        stroke={v3theme.surface.lineCanvas}
        strokeWidth={V3_LAYOUT.GLOBAL_COL_DIVIDER}
      />

      {/* locked 参考区（包围盒 + hatch + 虚线框） */}
      {lockedZone && (
        <rect
          x={lockedZone.x}
          y={lockedZone.y}
          width={lockedZone.width}
          height={lockedZone.height}
          fill={`url(#${HATCH_ID})`}
          stroke={v3theme.signal.locked}
          strokeWidth={1}
          strokeDasharray="4 3"
        />
      )}
    </svg>
  )
}
