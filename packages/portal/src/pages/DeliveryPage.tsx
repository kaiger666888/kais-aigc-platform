/**
 * DeliveryPage.tsx — 交付页（/deliver/:ep，Phase 57-05 Task 2，UI-SPEC P-3）。
 *
 * 面向收片人（非操作员）：成片 hero 主角、管线带/清单为辅、终审状态面收尾。
 * 数据 = loadDelivery（projects 反查 + load-v2 ∥ gate-state 三既有端点组装，
 * U-10 零新建后端）；master 播放经 resolveMediaUrl 同链（D-12——/oss 与
 * /local-file 均原生 Range，零新流播代码）。
 *
 * 本 plan 只出终审「状态显示面」（四态行 + note + redline 脚注 + 降级横幅）；
 * 操作条/理由框/409 幂等在 57-06 接 gate-ops（下方 display:none 占位注释）。
 *
 * 设计纪律：token-only（零新 hex——色值只经 var(--cv-*) / v3theme / theme）；
 * accent 冷白只出现在播放键/已播段（原生 controls）与焦点环；文案 = UI-SPEC
 * Copywriting Contract 逐字；进场 hero→管线带→清单 --cv-d-panel 240ms +
 * --cv-d-ancestor-step 40ms 递进一次（reduced-motion 静止）。
 */
import { useEffect, useState, type CSSProperties, type ReactElement } from 'react'
import { loadDelivery, type DeliveryLoad } from '../services/portalApi'
import PipelineRibbon from '../components/PipelineRibbon'
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
`

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

      {state.kind === 'data' && <DeliveryBody ep={ep} data={state.data} videoError={videoError} setVideoError={setVideoError} header={header} />}
    </main>
  )
}

/** 数据态版面：hero（step 0）→ 管线带 full（step 1）→ 交付清单（step 2）+ 终审卡。 */
function DeliveryBody({
  ep,
  data,
  videoError,
  setVideoError,
  header,
}: {
  ep: number
  data: DeliveryLoad & { kind: 'data' }
  videoError: boolean
  setVideoError: (v: boolean) => void
  header: (projectId?: number) => ReactElement
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

          {/* gate-state 拉取失败 / 服务端 degrade → 降级横幅（54 原文；null 快照无时刻省略时段） */}
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
              }}
            >
              状态源不可达 —— 无法连接审核状态源，不会误判为已放行。
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
              }}
            >
              状态源不可达 —— 无法连接审核状态源，正在显示 {relativeTime(gateState.fetchedAt)} 的快照，不会误判为已放行。
            </div>
          )}

          {gateEntry && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
              <span
                className={gateEntry.display === 'pending' && isBlocking ? 'cv-gate-dot-breathe' : undefined}
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  background: gateDisplayColor(gateEntry.display, isBlocking),
                  flex: 'none',
                }}
                aria-hidden="true"
              />
              <span
                style={{
                  fontSize: 'var(--cv-fs-t3)',
                  fontWeight: 600,
                  lineHeight: 1.4,
                  color: gateDisplayColor(gateEntry.display, isBlocking),
                }}
              >
                {GATE_STATE_LABEL[gateEntry.display]}
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

          {/* 57-06 占位：终审动作条 [放行]/[驳回] + 理由对话框（gate-ops 通道）接此 */}
          <div style={{ display: 'none' }} data-reserved="57-06-gate-actions" />
        </div>
      </aside>
    </div>
  )
}
