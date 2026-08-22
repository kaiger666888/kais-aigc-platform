/**
 * DeliveryPage.tsx — 交付页（/deliver/:ep，Phase 57-05 版面 / 57-06 终审操作面，UI-SPEC P-3）。
 *
 * 面向收片人（非操作员）：成片 hero 主角、管线带/清单为辅、终审收尾。
 * 数据 = loadDelivery（projects 反查 + load-v2 ∥ gate-state 三既有端点组装，
 * U-10 零新建后端）；master 播放经 resolveMediaUrl 同链（D-12——/oss 与
 * /local-file 均原生 Range，零新流播代码）。
 *
 * 57-06：终审动作条 [放行]/[驳回] 接 54 gate-ops 通道（D-10 一套通道三处
 * 消费）——runTerminalOp 状态机驱动（乐观翻转/409 幂等/失败回滚三分支，
 * 见 lib/gateOpsFlow.ts）；驳回 = ReasonDialog 组件内二次确认（54 C-4）；
 * display 非 pending 或 reviewId 缺（legacy）时动作条不渲染——只留状态行。
 *
 * 设计纪律：token-only（零新 hex——色值只经 var(--cv-*) / v3theme / theme）；
 * accent 冷白只出现在播放键/已播段（原生 controls）、放行主按钮与焦点环
 * （UI-SPEC §Color reserved 5 处）；文案 = UI-SPEC Copywriting Contract 逐字
 * （54 词表同源）；进场 hero→管线带→清单 --cv-d-panel 240ms +
 * --cv-d-ancestor-step 40ms 递进一次（reduced-motion 静止）。
 */
import { useEffect, useState, type CSSProperties, type ReactElement } from 'react'
import { loadDelivery, type DeliveryLoad } from '../services/portalApi'
import PipelineRibbon from '../components/PipelineRibbon'
import ReasonDialog from '../components/ReasonDialog'
import {
  classifyDeliveryNodes,
  phaseCountsOf,
  masterSrc,
  formatBytes,
  relativeTime,
  gateDisplayColor,
  GATE_STATE_LABEL,
  KIND_LABEL,
  P13_PHASE_INDEX,
  P13_GATE_ID,
  P13_GATE_NAME,
} from '../lib/delivery'
import { runTerminalOp, type TerminalAction, type TerminalOpEvent } from '../lib/gateOpsFlow'
import { gateOps, fetchGateState, type GateStateSnapshot } from '@ic/services/canvasApi'
import { PHASE_REGISTRY } from '@ic/constants/phaseRegistry'
import { v3theme, theme } from '@ic/theme/catppuccin'
import { resolveMediaUrl } from '@ic/utils/mediaUrl'

/** 进场编排 + pending 点呼吸（零新节拍：全部既有 token）。 */
const PAGE_CSS = `
@keyframes cv-deliver-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.cv-deliver-step { animation: cv-deliver-in var(--cv-d-panel) var(--cv-e-out) both; }
.cv-deliver-step-1 { animation-delay: var(--cv-d-ancestor-step); }
.cv-deliver-step-2 { animation-delay: calc(var(--cv-d-ancestor-step) * 2); }
@keyframes cv-gate-breathe { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
.cv-gate-dot-breathe { animation: cv-gate-breathe var(--cv-d-running-spin) var(--cv-e-inout) infinite; }
.cv-deliver-cols { display: flex; align-items: flex-start; gap: 24px; }
.cv-deliver-main { flex: 1; min-width: 0; }
.cv-deliver-gate { flex: none; width: 300px; position: sticky; top: 56px; }
@media (max-width: 720px) {
  .cv-deliver-cols { flex-direction: column; }
  .cv-deliver-gate { width: auto; position: static; }
}
@media (prefers-reduced-motion: reduce) {
  .cv-deliver-step, .cv-deliver-step-1, .cv-deliver-step-2 { animation: none; }
  .cv-gate-dot-breathe { animation: none; }
}
@keyframes cv-portal-pulse { 0%, 100% { opacity: 0.35 } 50% { opacity: 0.7 } }
.cv-portal-skel { animation: cv-portal-pulse calc(var(--cv-d-running-spin) * 2) var(--cv-e-inout) infinite; }
@media (prefers-reduced-motion: reduce) { .cv-portal-skel { animation: none; opacity: 0.5; } }
/* 终审动作条退场（UI-SPEC §Motion：--cv-d-unhighlight 220ms；reduced-motion 直接隐藏） */
@keyframes cv-gate-actions-out { from { opacity: 1; } to { opacity: 0; visibility: hidden; } }
.cv-gate-actions-exit { animation: cv-gate-actions-out var(--cv-d-unhighlight) var(--cv-e-out) forwards; pointer-events: none; }
@media (prefers-reduced-motion: reduce) { .cv-gate-actions-exit { animation: none; visibility: hidden; } }
/* toast 进场（54 画布 toast 同语言；节拍复用 --cv-d-panel） */
@keyframes cv-deliver-toast-in { from { opacity: 0; transform: translateX(40px); } to { opacity: 1; transform: none; } }
.cv-deliver-toast { animation: cv-deliver-toast-in var(--cv-d-panel) var(--cv-e-out) both; }
@media (prefers-reduced-motion: reduce) { .cv-deliver-toast { animation: none; } }
`

/** p13 阶段名（驳回确认标题 {阶段名} 插值源——注册表 name「交付」，55-D04 单源）。 */
const P13_PHASE_NAME =
  PHASE_REGISTRY.find((p) => p.khsPrefix === 'p13')?.name ?? '本阶段'

const pageStyle: CSSProperties = {
  maxWidth: 1080,
  margin: '0 auto',
  padding: '24px 32px',
}

const epStyle: CSSProperties = {
  fontFamily: 'var(--cv-font-mono)',
  fontSize: 'var(--cv-fs-t3)',
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--cv-text-secondary)',
}

const headingStyle: CSSProperties = {
  fontSize: 'var(--cv-fs-t1)',
  fontWeight: 600,
  lineHeight: 1.2,
  color: 'var(--cv-text-primary)',
}

const bodyStyle: CSSProperties = {
  marginTop: 8,
  fontSize: 'var(--cv-fs-t2)',
  lineHeight: 1.6,
  color: 'var(--cv-text-secondary)',
}

/** ghost 行内动作（28px 档；冷白 accent 不进填充——UI-SPEC §Color reserved）。 */
const ghostStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  height: 28,
  marginTop: 16,
  padding: '0 12px',
  borderRadius: 6,
  border: '1px solid var(--cv-line-panel)',
  color: 'var(--cv-text-secondary)',
  textDecoration: 'none',
  fontSize: 'var(--cv-fs-t2)',
  transition: 'color var(--cv-d-select) var(--cv-e-out), border-color var(--cv-d-select) var(--cv-e-out)',
}

/** hero 壳：panel 底 + 发丝边；16:9 video；2xl=48px 上下留白（影院呼吸感）。 */
const heroShellStyle: CSSProperties = {
  background: 'var(--cv-bg-panel)',
  border: '1px solid var(--cv-line-panel)',
  borderRadius: 8,
  overflow: 'hidden',
}

const heroVideoStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  aspectRatio: '16 / 9',
  background: 'var(--cv-bg-canvas)',
}

/** 清单行（≥28px 可命中下限；mono 文件名 + 尺寸 + 徽章 + 打开）。 */
const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  minHeight: 28,
  padding: '4px 0',
  borderTop: '1px solid var(--cv-line-panel)',
}

const fileStyle: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontFamily: 'var(--cv-font-mono)',
  fontSize: 'var(--cv-fs-t3)',
  color: 'var(--cv-text-primary)',
}

const sizeStyle: CSSProperties = {
  flex: 'none',
  fontFamily: 'var(--cv-font-mono)',
  fontSize: 'var(--cv-fs-t4)',
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--cv-text-tertiary)',
}

/** 三型徽章（U-12 词汇；中性灰——非状态色，两维度纪律）。 */
const badgeStyle: CSSProperties = {
  flex: 'none',
  padding: '1px 8px',
  borderRadius: 6,
  border: '1px solid var(--cv-line-panel)',
  fontSize: 'var(--cv-fs-t3)',
  fontWeight: 600,
  lineHeight: 1.4,
  color: 'var(--cv-text-secondary)',
}

const openLinkStyle: CSSProperties = {
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  height: 28,
  padding: '0 10px',
  borderRadius: 6,
  border: '1px solid var(--cv-line-panel)',
  color: 'var(--cv-text-secondary)',
  textDecoration: 'none',
  fontSize: 'var(--cv-fs-t2)',
}

/** 终审卡（右 1/3 sticky；状态显示面）。 */
const gateCardStyle: CSSProperties = {
  background: 'var(--cv-bg-card)',
  border: '1px solid var(--cv-line-panel)',
  borderRadius: 8,
  padding: 16,
}

const gateMonoStyle: CSSProperties = {
  marginTop: 4,
  fontFamily: 'var(--cv-font-mono)',
  fontSize: 'var(--cv-fs-t4)',
  color: 'var(--cv-text-tertiary)',
}

/** 终审动作条（54 同款按钮本体 32px + 2px 边距 = 36px 行；[放行] 冷白 primary / [驳回] 玫）。 */
const actionBaseStyle: CSSProperties = {
  flex: 1,
  height: 32,
  borderRadius: 6,
  border: 'none',
  fontSize: 'var(--cv-fs-t2)',
  fontWeight: 600,
}

const approveBtnStyle: CSSProperties = {
  ...actionBaseStyle,
  background: theme.button.primary,
  color: theme.text.onAccent,
}

const rejectBtnStyle: CSSProperties = {
  ...actionBaseStyle,
  background: theme.button.danger,
  color: theme.text.onAccent,
}

/** 降级横幅 [重试]（54 同款 ghost 键）。 */
const retryBtnStyle: CSSProperties = {
  flex: 'none',
  background: 'none',
  border: `1px solid ${theme.border.strong}`,
  borderRadius: 6,
  color: 'var(--cv-text-primary)',
  padding: '2px 10px',
  cursor: 'pointer',
  fontSize: 'var(--cv-fs-t3)',
}

type ToastTone = 'success' | 'info' | 'error'

/** toast 三档色（54 四态色映射：approved / pending 冷灰 / rejected——零新 hex）。 */
function toastToneColor(tone: ToastTone): string {
  if (tone === 'success') return v3theme.signal.approved
  if (tone === 'error') return v3theme.signal.rejected
  return v3theme.signal.pending
}

function toastGlyph(tone: ToastTone): string {
  if (tone === 'success') return '✓'
  if (tone === 'error') return '✗'
  return 'ℹ'
}

/** toast auto-dismiss（画布 useToast AUTO_DISMISS_MS 同值）。 */
const TOAST_DISMISS_MS = 3000

type LoadState =
  | { kind: 'loading' }
  | { kind: 'no-episode' }
  | { kind: 'error'; message: string }
  | { kind: 'data'; data: DeliveryLoad & { kind: 'data' } }

export default function DeliveryPage({ ep }: { ep: number }) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [videoError, setVideoError] = useState(false)

  const load = () => {
    setState({ kind: 'loading' })
    setVideoError(false)
    loadDelivery(ep)
      .then((data) => setState(data.kind === 'data' ? { kind: 'data', data } : { kind: 'no-episode' }))
      .catch((err: { message?: string }) =>
        setState({ kind: 'error', message: err?.message ?? '加载失败' }),
      )
  }

  useEffect(() => {
    load()
  }, [ep])

  /** 57-06：终审幂等重拉 / 降级重试后的 gate-state 回写（null = 降级，fail-closed 诚实）。 */
  const applyGateSnapshot = (snapshot: GateStateSnapshot | null) => {
    setState((s) => (s.kind === 'data' ? { ...s, data: { ...s.data, gateState: snapshot } } : s))
  }

  const header = (projectId?: number) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
      <span style={epStyle}>EP {ep}</span>
      {state.kind === 'data' && (
        <span style={{ ...headingStyle, flex: 1, minWidth: 0 }}>{state.data.projectName}</span>
      )}
      <a
        href={projectId != null ? `/canvas?project=${projectId}&ep=${ep}&zone=p13` : `/canvas?ep=${ep}`}
        style={{ ...ghostStyle, marginTop: 0, flex: 'none' }}
      >
        去画布
      </a>
    </div>
  )

  return (
    <main style={pageStyle}>
      <style>{PAGE_CSS}</style>

      {state.kind === 'loading' && (
        <div aria-busy="true">
          {header()}
          <div style={{ marginTop: 48 }}>
            <div
              className="cv-portal-skel"
              style={{ height: 0, paddingBottom: '56.25%', borderRadius: 8, background: 'var(--cv-bg-card)' }}
            />
          </div>
        </div>
      )}

      {state.kind === 'no-episode' && (
        <div>
          {header()}
          <p style={{ ...headingStyle, marginTop: 32 }}>未找到该集</p>
          <p style={bodyStyle}>这一集还没有画布数据——回到门户从集行进入。</p>
          <a href="/portal" style={ghostStyle}>
            回门户
          </a>
        </div>
      )}

      {state.kind === 'error' && (
        <div>
          {header()}
          <p style={{ ...headingStyle, marginTop: 32 }}>交付页加载失败 —— 稍后重试，或直接进入画布。</p>
          <p style={bodyStyle}>
            <button
              onClick={load}
              style={{ ...ghostStyle, background: 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              重试
            </button>
          </p>
        </div>
      )}

      {state.kind === 'data' && (
        <DeliveryBody
          ep={ep}
          data={state.data}
          videoError={videoError}
          setVideoError={setVideoError}
          header={header}
          onGateSnapshot={applyGateSnapshot}
        />
      )}
    </main>
  )
}

/** 数据态版面：hero（step 0）→ 管线带 full（step 1）→ 交付清单（step 2）+ 终审卡（57-06 动作面）。 */
function DeliveryBody({
  ep,
  data,
  videoError,
  setVideoError,
  header,
  onGateSnapshot,
}: {
  ep: number
  data: DeliveryLoad & { kind: 'data' }
  videoError: boolean
  setVideoError: (v: boolean) => void
  header: (projectId?: number) => ReactElement
  onGateSnapshot: (snapshot: GateStateSnapshot | null) => void
}) {
  const { projectId, graph, gateState } = data
  const nodes = graph?.nodes ?? []
  const p13Nodes = nodes.filter(
    (n) => n.phaseIndex === P13_PHASE_INDEX || n.data?.phaseIndex === P13_PHASE_INDEX,
  )
  const counts = graph ? phaseCountsOf(nodes) : null
  const { master, items } = classifyDeliveryNodes(p13Nodes)
  const src = masterSrc(master)

  const gateEntry = gateState?.gates.find((g) => g.gateId === P13_GATE_ID) ?? null
  const isBlocking = gateState?.blocking?.gateId === P13_GATE_ID

  // ─── 57-06 终审操作状态（runTerminalOp 事件流的 UI 侧落点）─────────────
  /** 乐观翻态（成功/幂等期间覆盖快照；回滚与重拉时清除）。 */
  const [gateOverride, setGateOverride] = useState<'approve' | 'reject' | null>(null)
  /** 行级处理中（禁两键，禁全屏 loading）。 */
  const [working, setWorking] = useState(false)
  /** 驳回二次确认对话框（54 C-4 组件内 state）。 */
  const [confirming, setConfirming] = useState(false)
  /** 成功后动作条退场（--cv-d-unhighlight 220ms，CSS 动画完成后保持隐藏）。 */
  const [exited, setExited] = useState(false)
  const [toast, setToast] = useState<{ tone: ToastTone; text: string } | null>(null)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), TOAST_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [toast])

  /** 幂等/降级重试的重拉（fetchGateState 失败自返 null → 降级横幅，fail-closed）。 */
  const refetchGateState = () => {
    fetchGateState(projectId, ep)
      .then((snapshot) => {
        setGateOverride(null)
        setExited(false)
        onGateSnapshot(snapshot)
      })
      .catch(() => {})
  }

  const applyOpEvent = (e: TerminalOpEvent) => {
    if (e.type === 'working') {
      setWorking(true)
    } else if (e.type === 'optimistic') {
      setGateOverride(e.display)
    } else if (e.type === 'success') {
      setWorking(false)
      setExited(true)
      setToast({ tone: 'success', text: e.toast })
    } else if (e.type === 'idempotent') {
      // 409 幂等成功：不回滚——重拉快照回实际态 + 幂等 toast。
      setWorking(false)
      setToast({ tone: 'info', text: e.toast })
      refetchGateState()
    } else {
      // 失败回滚：乐观态清回快照 + 错误 toast。
      setWorking(false)
      setGateOverride(null)
      setToast({ tone: 'error', text: e.toast })
    }
  }

  const runOp = (action: TerminalAction, reason?: string) => {
    if (gateEntry == null) return
    void runTerminalOp({
      gate: gateEntry,
      projectId,
      episodesId: ep,
      action,
      ...(reason != null ? { reason } : {}),
      api: { gateOps },
      onEvent: applyOpEvent,
    })
  }

  // ─── 终审卡派生态 ────────────────────────────────────────────────────
  /** fail-closed：快照拉取失败（null）或服务端 degrade（陈旧快照）都禁动作。 */
  const degraded = gateState == null || gateState.degrade
  const effDisplay = gateEntry ? (gateOverride ?? gateEntry.display) : null
  /** 动作条渲染前提（54 语义）：display=pending 且 reviewId 存在（legacy 无 reviewId 只留状态行）。 */
  const canPlan = gateEntry != null && gateEntry.display === 'pending' && gateEntry.reviewId != null
  /** null 降级也渲染动作条（禁用 + 横幅——比消失诚实）；exited 后保持挂载播
   * 220ms 退场动画（forwards 隐藏，pointer-events none——视觉等同移除）。 */
  const actionsVisible = gateState == null || canPlan || exited
  const actionsDisabled = degraded || working

  return (
    <div className="cv-deliver-cols">
      <div className="cv-deliver-main">
        {header(projectId)}

        {/* 成片 hero（收片人动线第一站；2xl=48px 上下留白） */}
        <section className="cv-deliver-step" style={{ padding: '48px 0' }} aria-label="成片">
          {src && !videoError ? (
            <div style={heroShellStyle}>
              <video controls preload="metadata" src={src} onError={() => setVideoError(true)} style={heroVideoStyle} />
            </div>
          ) : src && videoError ? (
            <div style={{ ...heroShellStyle, padding: 24 }}>
              <p style={headingStyle}>成片加载失败</p>
              <p style={bodyStyle}>播放器无法载入该文件，可直开文件重试。</p>
              <a href={src} target="_blank" rel="noreferrer" style={ghostStyle}>
                直开文件
              </a>
            </div>
          ) : (
            <div style={{ ...heroShellStyle, padding: 24 }}>
              <p style={headingStyle}>本集尚未产出成片</p>
              <p style={bodyStyle}>P13 交付阶段完成后，这里会播放 master.mp4 并给出交付清单。</p>
              <a href={`/canvas?project=${projectId}&ep=${ep}&zone=p13`} style={ghostStyle}>
                去画布看 P13
              </a>
            </div>
          )}
        </section>

        {/* 管线带 full（签名元素交付页形态：22 段 + gate 四态点 + 段级 zone 深链） */}
        <section className="cv-deliver-step cv-deliver-step-1" style={{ paddingBottom: 24 }} aria-label="管线带">
          <PipelineRibbon
            projectId={projectId}
            ep={ep}
            counts={counts}
            variant="full"
            gates={gateState?.gates ?? null}
            blockingGateId={gateState?.blocking?.gateId ?? null}
          />
        </section>

        {/* 交付清单（三型徽章；行 = mono 文件名 + 尺寸 + 徽章 + 打开） */}
        <section className="cv-deliver-step cv-deliver-step-2" aria-label="交付清单">
          <h2 style={headingStyle}>交付清单</h2>
          {items.length === 0 ? (
            <div style={{ marginTop: 8, paddingBottom: 24 }}>
              <p style={headingStyle}>交付清单为空</p>
              <p style={bodyStyle}>P13 交付阶段产出后，这里会列出成片与交付包</p>
            </div>
          ) : (
            <div style={{ marginTop: 12, borderBottom: '1px solid var(--cv-line-panel)' }}>
              {items.map((item) => {
                const itemUrl = resolveMediaUrl(item.filePath)
                return (
                  <div key={item.id} style={rowStyle}>
                    <span style={fileStyle} title={item.label}>
                      {item.label}
                    </span>
                    {item.size != null && <span style={sizeStyle}>{formatBytes(item.size)}</span>}
                    <span style={badgeStyle}>{KIND_LABEL[item.kind]}</span>
                    {itemUrl ? (
                      <a href={itemUrl} target="_blank" rel="noreferrer" style={openLinkStyle}>
                        打开
                      </a>
                    ) : (
                      <span style={{ ...openLinkStyle, border: 'none', color: 'var(--cv-text-tertiary)' }} aria-hidden="true" />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>

      {/* 终审卡（右 1/3 sticky；本 plan 状态显示面，操作条 57-06） */}
      <aside className="cv-deliver-gate cv-deliver-step" aria-label="终审">
        <div style={gateCardStyle}>
          <h2 style={headingStyle}>成片终审</h2>
          <p style={gateMonoStyle}>
            {P13_GATE_NAME ?? '—'} · {P13_GATE_ID ?? '—'}
          </p>

          {/* gate-state 拉取失败 / 服务端 degrade → 降级横幅（54 原文 + [重试]；null 快照无时刻省略时段；动作条 fail-closed 禁用） */}
          {gateState == null && (
            <div
              data-testid="deliver-gate-degrade"
              style={{
                marginTop: 12,
                background: theme.chrome.errorBar,
                border: `1px solid ${v3theme.signal.rejected}66`,
                borderRadius: 6,
                padding: '8px 12px',
                fontSize: 'var(--cv-fs-t3)',
                lineHeight: 1.6,
                color: 'var(--cv-text-primary)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span style={{ flex: 1 }}>状态源不可达 —— 无法连接审核状态源，不会误判为已放行。</span>
              <button onClick={refetchGateState} style={retryBtnStyle}>
                重试
              </button>
            </div>
          )}
          {gateState?.degrade && (
            <div
              data-testid="deliver-gate-degrade"
              style={{
                marginTop: 12,
                background: theme.chrome.errorBar,
                border: `1px solid ${v3theme.signal.rejected}66`,
                borderRadius: 6,
                padding: '8px 12px',
                fontSize: 'var(--cv-fs-t3)',
                lineHeight: 1.6,
                color: 'var(--cv-text-primary)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span style={{ flex: 1 }}>
                状态源不可达 —— 无法连接审核状态源，正在显示 {relativeTime(gateState.fetchedAt)} 的快照，不会误判为已放行。
              </span>
              <button onClick={refetchGateState} style={retryBtnStyle}>
                重试
              </button>
            </div>
          )}

          {gateEntry && effDisplay != null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
              <span
                className={effDisplay === 'pending' && isBlocking ? 'cv-gate-dot-breathe' : undefined}
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  background: gateDisplayColor(effDisplay, isBlocking),
                  flex: 'none',
                }}
                aria-hidden="true"
              />
              <span
                data-testid="deliver-gate-state"
                style={{
                  fontSize: 'var(--cv-fs-t3)',
                  fontWeight: 600,
                  lineHeight: 1.4,
                  color: gateDisplayColor(effDisplay, isBlocking),
                }}
              >
                {working ? '处理中…' : GATE_STATE_LABEL[effDisplay]}
              </span>
              <span style={gateMonoStyle}>{gateEntry.gateId}</span>
            </div>
          )}

          {gateEntry?.note && (
            <p
              title={gateEntry.note}
              style={{
                marginTop: 8,
                fontSize: 'var(--cv-fs-t3)',
                lineHeight: 1.6,
                color: 'var(--cv-text-secondary)',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {gateEntry.note}
            </p>
          )}

          {/* 红线子门脚注（54 原文；自动扫描不进人工决策） */}
          <p style={{ marginTop: 12, fontSize: 'var(--cv-fs-t4)', lineHeight: 1.4, color: 'var(--cv-text-tertiary)' }}>
            p13 红线子门为本地自动扫描，不进入人工决策。
          </p>

          {/* 57-06 终审动作条：[放行] 单点击即执行（54 U-05 无二次确认）/ [驳回] 开 ReasonDialog；
              display 非 pending 或 reviewId 缺（legacy）不渲染——只留上方状态行；
              降级（fail-closed）/处理中禁两键；成功后退场 --cv-d-unhighlight 220ms。 */}
          {actionsVisible && (
            <div
              className={exited ? 'cv-gate-actions-exit' : undefined}
              data-testid="deliver-gate-actions"
              style={{ display: 'flex', gap: 8, marginTop: 16, padding: '2px 0' }}
            >
              <button
                onClick={() => runOp('approve')}
                disabled={actionsDisabled}
                style={{ ...approveBtnStyle, cursor: actionsDisabled ? 'not-allowed' : 'pointer' }}
              >
                放行
              </button>
              <button
                onClick={() => setConfirming(true)}
                disabled={actionsDisabled}
                style={{ ...rejectBtnStyle, cursor: actionsDisabled ? 'not-allowed' : 'pointer' }}
              >
                驳回
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* 驳回理由对话框（54 C-4 复刻：必填 1-500 + 二次确认 + Esc） */}
      {confirming && gateEntry && (
        <ReasonDialog
          phaseName={P13_PHASE_NAME}
          onCancel={() => setConfirming(false)}
          onConfirm={(reason) => {
            setConfirming(false)
            runOp('reject', reason)
          }}
        />
      )}

      {/* 终审操作 toast（54 词表逐字：成功/幂等/回滚；3s 自散，点击即散） */}
      {toast && (
        <div
          className="cv-deliver-toast"
          role="status"
          data-testid="deliver-gate-toast"
          onClick={() => setToast(null)}
          style={{
            position: 'fixed',
            bottom: 20,
            right: 20,
            zIndex: 1000,
            background: 'var(--cv-bg-elevated)',
            border: `1px solid ${toastToneColor(toast.tone)}`,
            borderRadius: 8,
            padding: '10px 16px',
            color: 'var(--cv-text-primary)',
            fontSize: 'var(--cv-fs-t2)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            boxShadow: theme.shadow.cardHi,
            maxWidth: 360,
            cursor: 'pointer',
          }}
        >
          <span style={{ color: toastToneColor(toast.tone), fontWeight: 700, fontSize: 'var(--cv-fs-t1)' }}>
            {toastGlyph(toast.tone)}
          </span>
          <span>{toast.text}</span>
        </div>
      )}
    </div>
  )
}
