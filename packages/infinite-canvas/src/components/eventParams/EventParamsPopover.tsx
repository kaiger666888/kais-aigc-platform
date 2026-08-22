/**
 * src/components/eventParams/EventParamsPopover.tsx — P19 事件参数 popover（设计 §4.7 / 宪法 P19）。
 *
 * 芯片点击（EventChipNode → eventChipBus）→ FlowCanvas 的 activeChip → 本组件显隐。
 * 据 eventId 从 graph 查事件节点，把 params（GenerationParams）友好分组渲染：
 *  提示词(prompt/negative) / 采样(seed/steps/cfg/modelVersion/quant/sageAttention) / LoRA(name×strength) / 其他(catchall)，
 *  附 executor + durationS。
 * 「同配方换 seed 重跑」（REGEN-02，52-04）：同配方 + 新随机 seed 提交 /canvas/execute
 *  通道（52-02 extra 契约），pending 态防连点；提交成功后 updateEventParams 回写 canonical
 *  （芯片 tooltip/popover 立即显示新 seed；持久化等下一次 save——地雷 #12 裁定）。
 */
import { useEffect, useState } from 'react'
import type { AssetNodeV3, EventNodeV3, GenerationParams } from '@kais/flowgraph-v3'
import type { EventChipClickInfo } from '../canvas/eventChipBus'
import { theme } from '../../theme/catppuccin'
import { useCanvasStore } from '../../store/canvasStore'
import { executeNode } from '../../services/canvasApi'

interface Props {
  anchor: EventChipClickInfo | null
  onClose: () => void
}

const POPOVER_W = 320
const POPOVER_MAX_H = 480

const KNOWN_KEYS = new Set(['prompt', 'negative', 'seed', 'modelVersion', 'lora', 'steps', 'cfg', 'quant', 'sageAttention'])

export default function EventParamsPopover({ anchor, onClose }: Props): React.ReactElement | null {
  const graph = useCanvasStore((s) => s.graph)
  const showToast = useCanvasStore((s) => s.showToast)
  const updateEventParams = useCanvasStore((s) => s.updateEventParams)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!anchor) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [anchor, onClose])

  if (!anchor) return null

  const evt = graph?.nodes.find((n) => n.id === anchor.eventId && n.kind === 'event') as EventNodeV3 | undefined
  const params: GenerationParams = evt?.params ?? {}
  const executor = evt?.executor ?? anchor.op
  const durationS = evt?.durationS

  // 定位：以芯片锚点为基准，靠右边界时左移避免溢出
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
  const left = Math.min(anchor.clientX + 8, vw - POPOVER_W - 8)
  const top = anchor.clientY + 8

  // REGEN-02（52-04）：同配方 + 新 seed 提交 execute 通道。
  // nodeId = 产出资产 id（地雷 #4 裁定，与 52-03 PromptSection 同一裁定）——持久化 V2 blob
  // 无 evt_* 节点，传 eventId 则 node:state 回写只更新不可见 canonical 事件节点，画布资产卡
  // 无 running/success 反馈、stale 清除链不生效；eventId 仅用于 canonical 写回。
  // pending 只覆盖 HTTP 提交期，不等 socket success（无 per-request 关联，等了会泄漏）。
  const handleRerollSeed = async () => {
    // 守卫：缺项目上下文（fixture 模式等）→ toast 早退（deleteNode 范式）
    if (anchor.projectId == null || anchor.episodesId == null) {
      showToast('缺少项目上下文', 'warning')
      return
    }
    if (pending) return // 连点抑制
    // 反查产出资产：event → asset 的 role:'output' 边
    const outputAsset = graph?.nodes.find(
      (n): n is AssetNodeV3 =>
        n.kind === 'asset' &&
        graph.links.some((l) => l.role === 'output' && l.source === anchor.eventId && l.target === n.id),
    )
    if (!outputAsset) {
      showToast('未找到该事件的产出资产，无法重跑', 'warning')
      return
    }
    // 保留 1e6 域（与芯片 tooltip seed 量级一致，免改 chipSummary）
    const newSeed = Math.floor(Math.random() * 1_000_000)
    setPending(true)
    try {
      await executeNode(anchor.projectId, anchor.episodesId, outputAsset.id, outputAsset.stage, {
        params: { ...params, seed: newSeed },
      })
      // 提交成功 → 新 seed 回写 canonical（防 reload 回旧值；持久化等下一次 save，地雷 #12 裁定）
      updateEventParams(anchor.eventId, { seed: newSeed })
      showToast(`已提交换 seed 重跑（seed ${newSeed}）`, 'success')
    } catch (err) {
      showToast(`重跑提交失败: ${(err as Error).message}`, 'error')
    } finally {
      setPending(false)
    }
  }

  const otherEntries = Object.entries(params).filter(([k]) => !KNOWN_KEYS.has(k))

  return (
    <div data-testid="event-params-popover-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }} style={{ position: 'fixed', inset: 0, zIndex: 35 }}>
      <div
        data-testid="event-params-popover"
        data-event-id={anchor.eventId}
        data-op={anchor.op}
        style={{
          position: 'absolute', left, top, width: POPOVER_W, maxHeight: POPOVER_MAX_H,
          background: theme.bg.panel, border: `1px solid ${theme.border.default}`, borderRadius: 10,
          boxShadow: `0 8px 28px ${theme.chrome.shadow}`, display: 'flex', flexDirection: 'column', overflow: 'hidden',
          animation: 'cv-chip-tip var(--cv-d-select, 120ms) var(--cv-e-out, cubic-bezier(0.2,0.8,0.2,1))',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: `1px solid ${theme.border.default}`, background: theme.bg.card }}>
          <span style={{ color: theme.text.primary, fontWeight: 700, fontSize: 12, fontFamily: 'var(--cv-font-mono, monospace)' }}>{anchor.op}</span>
          <span style={{ fontSize: 10, color: theme.text.secondary, fontFamily: 'var(--cv-font-mono, monospace)' }}>
            {executor}{typeof durationS === 'number' ? ` · ${durationS}s` : ''}
          </span>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <ParamGroup title="提示词">
            <MonoRow k="prompt" v={params.prompt} />
            <MonoRow k="negative" v={params.negative} />
          </ParamGroup>

          <ParamGroup title="采样">
            <KvRow k="seed" v={params.seed} />
            <KvRow k="steps" v={params.steps} />
            <KvRow k="cfg" v={params.cfg} />
            <KvRow k="modelVersion" v={params.modelVersion} />
            <KvRow k="quant" v={params.quant} />
            {params.sageAttention != null && <KvRow k="sageAttention" v={String(params.sageAttention)} />}
          </ParamGroup>

          {Array.isArray(params.lora) && params.lora.length > 0 && (
            <ParamGroup title="LoRA">
              {params.lora.map((l, i) => (
                <div key={i} style={{ fontSize: 11, color: theme.text.primary, fontFamily: 'var(--cv-font-mono, monospace)' }}>
                  {l.name} <span style={{ color: theme.text.secondary }}>×{l.strength}</span>
                </div>
              ))}
            </ParamGroup>
          )}

          {otherEntries.length > 0 && (
            <ParamGroup title="其他">
              {otherEntries.map(([k, v]) => (
                <KvRow key={k} k={k} v={typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : JSON.stringify(v)} />
              ))}
            </ParamGroup>
          )}
        </div>

        <div style={{ padding: 8, borderTop: `1px solid ${theme.border.default}`, background: theme.bg.card }}>
          <button
            data-testid="reroll-seed-btn"
            data-seed={params.seed ?? ''}
            data-pending={pending ? 'true' : 'false'}
            onClick={() => { void handleRerollSeed() }}
            disabled={pending}
            style={{ ...rerollBtnStyle, cursor: pending ? 'default' : 'pointer', opacity: pending ? 0.6 : 1 }}
          >
            {pending ? '重跑中…' : '🎲 同配方换 seed 重跑'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ParamGroup({ title, children }: { title: string; children: React.ReactNode }) {
  const kids = Array.isArray(children) ? children : [children]
  if (kids.every((c) => c == null || (typeof c === 'object' && 'props' in (c as any) && (c as any).props == null))) return null
  return (
    <div>
      <div style={{ fontSize: 10, color: theme.text.secondary, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>{children}</div>
    </div>
  )
}

function KvRow({ k, v }: { k: string; v: unknown }) {
  if (v == null || v === '') return null
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11 }}>
      <span style={{ color: theme.text.secondary }}>{k}</span>
      <span style={{ color: theme.text.primary, fontFamily: 'var(--cv-font-mono, monospace)' }}>{String(v)}</span>
    </div>
  )
}

function MonoRow({ k, v }: { k: string; v: unknown }) {
  if (v == null || v === '') return null
  return (
    <div>
      <div style={{ fontSize: 10, color: theme.text.secondary, marginBottom: 2 }}>{k}</div>
      <div style={{ fontSize: 11, color: theme.text.primary, background: theme.bg.input, borderRadius: 4, padding: '4px 6px', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 96, overflowY: 'auto' }}>
        {String(v)}
      </div>
    </div>
  )
}

const rerollBtnStyle: React.CSSProperties = {
  width: '100%', padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
  background: theme.button.primary, color: theme.text.onAccent, border: 'none', fontSize: 12, fontWeight: 600,
}
