/**
 * src/components/canvas/icons.tsx — 模态图标 + 事件 op 图标（inline SVG，零外部依赖）。
 *
 *  - ModalityIcon：四模态（text 文档 / image 图片 / audio 波形 / video 播放）。
 *    资产卡的左 3px 边条主权配套图标，色相 = 模态色（P8 色相通道独占）。
 *  - AssetTypeIcon：assetType 子类型（v1.1 character/prop + v1.2 dialogue/music/sfx），
 *    模态图标的细化层——几何同词汇，色相仍取模态色（不另开色相通道）。
 *  - EventOpIcon：executor=human → 人形图标；gpu0/gpu1/cloud → 按 op 名映射的 op 族图标
 *    （人机同构 P5：只靠图标区分人/AI，芯片形态一致）。
 *  简洁几何线条，跟随 color 参数着色；不引外部图标库以保画布零运行时依赖。
 */

export type ModalityIconKind = 'text' | 'image' | 'audio' | 'video'

/** 共用 SVG 外壳（24×24 viewBox，1.8 描边，圆角端点），子节点为具体几何。
 *  testId/dataKind 仅作测试锚点（缺省不渲染属性，既有调用方 DOM 不变）。 */
function SvgIcon({
  size,
  color,
  children,
  fill = 'none',
  testId,
  dataKind,
}: {
  size: number
  color: string
  children: React.ReactNode
  fill?: string
  testId?: string
  dataKind?: string
}): React.ReactElement {
  return (
    <svg
      data-testid={testId}
      data-kind={dataKind}
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

// ─── assetType 子类型图标（canvas-sync v1.1/v1.2 消费端渲染） ────────────────

export type AssetTypeIconKind = 'character' | 'prop' | 'dialogue' | 'music' | 'sfx'

const ASSET_TYPE_ICON_KINDS: readonly string[] = ['character', 'prop', 'dialogue', 'music', 'sfx']

/** raw 袋 assetType 是否命中专属图标 kind（未命中回退纯模态图标，不新增兜底 glyph）。 */
export function isAssetTypeIconKind(v: unknown): v is AssetTypeIconKind {
  return typeof v === 'string' && ASSET_TYPE_ICON_KINDS.includes(v)
}

/**
 * assetType 子类型图标：模态图标的细化层（不取代模态主权——色相仍取模态色）。
 *  - character（v1.1）：人形半身，与 EventOpIcon human 同构几何（人机同构 P5 词汇）；
 *  - prop（v1.1）：扳手（旧 AssetNode typeIcons 中 tool/prop 共用 🔧 的语义延续）；
 *  - dialogue / music / sfx（v1.2）：气泡 / 连音符 / 扬声器。
 * 几何延续 SvgIcon 词汇（1.8 描边圆角端点）；渲染于资产卡标题行与缺封面占位。
 */
export function AssetTypeIcon({
  kind,
  size,
  color,
}: {
  kind: AssetTypeIconKind
  size: number
  color: string
}): React.ReactElement {
  switch (kind) {
    case 'character':
      // 人形半身：圆头 + 肩弧
      return (
        <SvgIcon size={size} color={color} testId="asset-type-icon" dataKind={kind}>
          <circle cx="12" cy="8" r="3.2" />
          <path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" />
        </SvgIcon>
      )
    case 'prop':
      // 扳手：工具语义（tool/prop 同族）
      return (
        <SvgIcon size={size} color={color} testId="asset-type-icon" dataKind={kind}>
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </SvgIcon>
      )
    case 'dialogue':
      // 对白气泡：折角气泡 + 两行台词
      return (
        <SvgIcon size={size} color={color} testId="asset-type-icon" dataKind={kind}>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          <path d="M8 8.5h8M8 12h5" />
        </SvgIcon>
      )
    case 'music':
      // 音乐：连线八分音符（双音符 + 梁）
      return (
        <SvgIcon size={size} color={color} testId="asset-type-icon" dataKind={kind}>
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </SvgIcon>
      )
    case 'sfx':
      // 音效：扬声器锥 + 双层声波
      return (
        <SvgIcon size={size} color={color} testId="asset-type-icon" dataKind={kind}>
          <path d="M11 5 6 9H2v6h4l5 4z" />
          <path d="M15.5 8.5a5 5 0 0 1 0 7" />
          <path d="M18.5 5.5a9 9 0 0 1 0 13" />
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

// ─── UI 操作图标（工具栏；stroke = currentColor，跟随按钮文字色） ─────────────

export type UiIconKind = 'save' | 'layout' | 'fit' | 'rocket' | 'iterate' | 'search' | 'graph' | 'film' | 'image' | 'assets' | 'pipeline'

/** UI 操作图标：线性几何，stroke=currentColor，size 默认 14 匹配 12px 按钮。 */
export function UiIcon({
  kind,
  size = 14,
}: {
  kind: UiIconKind
  size?: number
}): React.ReactElement {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    style: { display: 'block' as const, flex: '0 0 auto' },
  }
  switch (kind) {
    case 'save':
      // 软盘：方框 + 顶部槽 + 内部小条
      return (
        <svg {...common}>
          <path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
          <path d="M8 3v5h7V3" />
          <path d="M8 14h8v6H8z" />
        </svg>
      )
    case 'layout':
      // 自动整理：三节点小图（左源 → 右两分支），暗示「重排拓扑」
      return (
        <svg {...common}>
          <circle cx="5" cy="6" r="2" />
          <circle cx="5" cy="18" r="2" />
          <circle cx="19" cy="12" r="2" />
          <path d="M7 7l10 4M7 17l10-4" />
        </svg>
      )
    case 'fit':
      // 适配视图：四角向内收的取景框
      return (
        <svg {...common}>
          <path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4" />
        </svg>
      )
    case 'rocket':
      // 一键成片：火箭
      return (
        <svg {...common}>
          <path d="M12 3c3 2 4.5 5 4.5 9l-1.5 3h-6L7.5 12c0-4 1.5-7 4.5-9z" />
          <circle cx="12" cy="10" r="1.6" />
          <path d="M9 18l-2 2M15 18l2 2M10.5 21h3" />
        </svg>
      )
    case 'iterate':
      // 迭代：循环箭头
      return (
        <svg {...common}>
          <path d="M4 12a8 8 0 0 1 13.7-5.6L20 8" />
          <path d="M20 4v4h-4" />
          <path d="M20 12a8 8 0 0 1-13.7 5.6L4 16" />
          <path d="M4 20v-4h4" />
        </svg>
      )
    case 'search':
      // 搜索：放大镜
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="6" />
          <path d="m20 20-4.3-4.3" />
        </svg>
      )
    case 'graph':
      // 画布空状态：连线城市景
      return (
        <svg {...common}>
          <circle cx="6" cy="7" r="2" />
          <circle cx="18" cy="7" r="2" />
          <rect x="9" y="15" width="6" height="5" rx="1" />
          <path d="M8 7h8M12 9v6" />
        </svg>
      )
    case 'film':
      // 时间轴：胶片条
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="1.5" />
          <path d="M3 9h18M3 15h18M7 5v14M17 5v14" />
        </svg>
      )
    case 'image':
      // 图片占位
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="1.5" />
          <circle cx="9" cy="10" r="1.8" />
          <path d="m3 17 5-4 4 3 3-2 6 5" />
        </svg>
      )
    case 'assets':
      // 资产管理中心：2×2 资源格（collection）
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7.5" height="7.5" rx="1.4" />
          <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.4" />
          <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.4" />
          <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.4" />
        </svg>
      )
    case 'pipeline':
      // 管线状态机：阶段节点串联流水线（左→右三段，中间有进展）
      return (
        <svg {...common}>
          <rect x="2.5" y="8" width="5" height="8" rx="1.2" />
          <rect x="9.5" y="5" width="5" height="11" rx="1.2" />
          <rect x="16.5" y="9" width="5" height="7" rx="1.2" />
          <path d="M7.5 12h2M14.5 12h2" />
        </svg>
      )
  }
}
