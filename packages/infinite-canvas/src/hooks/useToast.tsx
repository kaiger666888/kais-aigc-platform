import { useState, useCallback, useRef, useEffect } from 'react'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface Toast {
  id: number
  message: string
  type: ToastType
}

const AUTO_DISMISS_MS = 3000

let nextId = 0

// ─── ToastContainer ───────────────────────────────────────

const typeColors: Record<ToastType, { bg: string; border: string; icon: string }> = {
  success: { bg: '#1e2e1e', border: '#a6e3a1', icon: '✓' },
  error:   { bg: '#2e1e1e', border: '#f38ba8', icon: '✗' },
  info:    { bg: '#1e1e2e', border: '#89b4fa', icon: 'ℹ' },
  warning: { bg: '#2e2a1e', border: '#f9e2af', icon: '⚠' },
}

export function ToastContainer({ toasts, onDismiss }: {
  toasts: Toast[]
  onDismiss: (id: number) => void
}) {
  return (
    <div style={{
      position: 'fixed',
      bottom: 20,
      right: 20,
      zIndex: 10000,
      display: 'flex',
      flexDirection: 'column-reverse',
      gap: 8,
      pointerEvents: 'none',
    }}>
      {toasts.map((t) => {
        const c = typeColors[t.type]
        return (
          <div
            key={t.id}
            onClick={() => onDismiss(t.id)}
            style={{
              pointerEvents: 'auto',
              background: c.bg,
              border: `1px solid ${c.border}`,
              borderRadius: 8,
              padding: '10px 16px',
              color: '#cdd6f4',
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              animation: 'toast-in 0.25s ease-out',
              cursor: 'pointer',
              minWidth: 200,
              maxWidth: 360,
            }}
          >
            <span style={{ color: c.border, fontWeight: 700, fontSize: 14 }}>{c.icon}</span>
            <span>{t.message}</span>
          </div>
        )
      })}
    </div>
  )
}

// ─── useToast hook ────────────────────────────────────────

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    return () => {
      timers.current.forEach((t) => clearTimeout(t))
    }
  }, [])

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = nextId++
    setToasts((prev) => [...prev, { id, message, type }])

    const timer = setTimeout(() => {
      timers.current.delete(id)
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, AUTO_DISMISS_MS)
    timers.current.set(id, timer)
  }, [])

  return { toasts, showToast, dismiss }
}
