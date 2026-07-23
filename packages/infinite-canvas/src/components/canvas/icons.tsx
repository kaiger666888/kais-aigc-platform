/**
 * src/components/canvas/icons.tsx — 模态图标 + 事件 op 图标（inline SVG，零外部依赖）。
 *
 *  - ModalityIcon：四模态（text 文档 / image 图片 / audio 波形 / video 播放）。
 *    资产卡的左 3px 边条主权配套图标，色相 = 模态色（P8 色相通道独占）。
 *  - EventOpIcon：executor=human → 人形图标；gpu0/gpu1/cloud → 按 op 名映射的 op 族图标
 *    （人机同构 P5：只靠图标区分人/AI，芯片形态一致）。
 *  简洁几何线条，跟随 color 参数着色；不引外部图标库以保画布零运行时依赖。
 */

export type ModalityIconKind = 'text' | 'image' | 'audio' | 'video'

/** 共用 SVG 外壳（24×24 viewBox，1.8 描边，圆角端点），子节点为具体几何。 */
function SvgIcon({
  size,
  color,
  children,
  fill = 'none',
}: {
  size: number
  color: string
  children: React.ReactNode
  fill?: string
}): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      {children}
    </svg>
  )
}

/** 四模态图标。 */
export function ModalityIcon({
  kind,
  size,
  color,
}: {
  kind: ModalityIconKind
  size: number
  color: string
}): React.ReactElement {
  switch (kind) {
    case 'text':
      // 文档：折角纸 + 三行正文
      return (
        <SvgIcon size={size} color={color}>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5" />
          <path d="M9 13h6M9 17h6" />
        </SvgIcon>
      )
    case 'image':
      // 图片：相框 + 太阳/山
      return (
        <SvgIcon size={size} color={color}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="8.5" cy="9.5" r="1.5" />
          <path d="m21 16-4.5-4.5L7 21" />
        </SvgIcon>
      )
    case 'audio':
      // 波形：五柱等距变频
      return (
        <SvgIcon size={size} color={color}>
          <path d="M4 10v4M8 6v12M12 8v8M16 5v14M20 10v4" />
        </SvgIcon>
      )
    case 'video':
      // 播放：胶片框 + 三角播放键
      return (
        <SvgIcon size={size} color={color}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m10 9 5 3-5 3z" fill={color} stroke="none" />
        </SvgIcon>
      )
  }
}

/** op 名 → 图标族（gpu/cloud executor 走此映射；human 走人形图标）。 */
function opGlyph(op: string, size: number, color: string): React.ReactElement {
  const o = op.toLowerCase()
  // 视频生成族（wan22_* / ltx_ref）→ 胶片
  if (o.includes('i2v') || o.includes('t2v') || o.includes('s2v') || o.includes('ltx')) {
    return (
      <SvgIcon size={size} color={color}>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M7 5v14M17 5v14" />
        <path d="m10.5 9.5 4 2.5-4 2.5z" fill={color} stroke="none" />
      </SvgIcon>
    )
  }
  // 音频分轨族（tts / foley_gen / bgm_gen）→ 波形
  if (o.includes('tts') || o.includes('foley') || o.includes('bgm') || o.includes('audio')) {
    return (
      <SvgIcon size={size} color={color}>
        <path d="M4 10v4M8 6v12M12 8v8M16 5v14M20 10v4" />
      </SvgIcon>
    )
  }
  // 组装族（mix / compose）→ 分层叠加
  if (o.includes('mix') || o.includes('compose')) {
    return (
      <SvgIcon size={size} color={color}>
        <path d="m12 3 9 5-9 5-9-5z" />
        <path d="m3 13 9 5 9-5" />
      </SvgIcon>
    )
  }
  // 编辑族（human_edit / bernini_edit）→ 铅笔
  if (o.includes('edit')) {
    return (
      <SvgIcon size={size} color={color}>
        <path d="M14 4l6 6L9 21H3v-6z" />
        <path d="m13 5 6 6" />
      </SvgIcon>
    )
  }
  // 后处理族（upscale / face_restore）→ 放大镜带加号
  if (o.includes('upscale') || o.includes('face') || o.includes('restore')) {
    return (
      <SvgIcon size={size} color={color}>
        <circle cx="11" cy="11" r="7" />
        <path d="M11 8v6M8 11h6M21 21l-4.3-4.3" />
      </SvgIcon>
    )
  }
  // 逆向 / 分析族（shot_decompose / script_analysis）→ 扫描/网格
  if (o.includes('decompose') || o.includes('analysis') || o.includes('analyz')) {
    return (
      <SvgIcon size={size} color={color}>
        <path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2" />
        <path d="M4 12h16" />
      </SvgIcon>
    )
  }
  // 种子族（import / create）→ 加号入箱
  if (o.includes('import') || o.includes('create')) {
    return (
      <SvgIcon size={size} color={color}>
        <path d="M21 8v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8" />
        <path d="M2 7l10-4 10 4-10 4z" />
        <path d="M12 9v4M10 11h4" />
      </SvgIcon>
    )
  }
  // 兜底：通用操作齿轮
  return (
    <SvgIcon size={size} color={color}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
    </SvgIcon>
  )
}

/**
 * 事件 op 图标：executor=human → 人形（人机同构 P5）；gpu0/gpu1/cloud → op 族图标。
 */
export function EventOpIcon({
  op,
  executor,
  size,
  color,
}: {
  op: string
  executor: 'human' | 'gpu0' | 'gpu1' | 'cloud' | string
  size: number
  color: string
}): React.ReactElement {
  if (executor === 'human') {
    return (
      <SvgIcon size={size} color={color}>
        <circle cx="12" cy="8" r="3.2" />
        <path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" />
      </SvgIcon>
    )
  }
  return opGlyph(op, size, color)
}
