import { Component, type ErrorInfo, type ReactNode } from 'react'

// ─── 错误边界 (class-based) ────────────────────────────────
//
// React 的函数组件无法捕获子树的渲染错误 — 必须用 class 组件实现
// componentDidCatch。我们把这类错误转为受控 UI,而不是整张画布白屏。
//
// 使用: <ErrorBoundary fallback={<SomeErrorUI />}><Tree/></ErrorBoundary>
//
// 设计取舍:不在这里做自动上报 (Sentry / 自家埋点)。生产环境可在
// componentDidCatch 中接 console.error 或外部上报 hook。

export interface ErrorBoundaryProps {
  /** 出错时渲染的兜底 UI;缺省时渲染内置的简洁错误块 */
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode)
  /** 子树 */
  children: ReactNode
  /** 错误回调 (日志 / 上报 / 父级状态同步) */
  onError?: (error: Error, info: ErrorInfo) => void
  /** 当 props.resetKey 改变时自动 reset — 用于外部驱动的恢复 */
  resetKey?: string | number
}

interface ErrorBoundaryState {
  error: Error | null
}

const INITIAL_STATE: ErrorBoundaryState = { error: null }

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = INITIAL_STATE

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 1) 控制台 — 便于本地调试
    console.error('[ErrorBoundary]', error, info.componentStack)
    // 2) 外部回调 — 用于上报
    this.props.onError?.(error, info)
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    // resetKey 变化 → 清空错误,允许子树重渲染
    if (
      this.state.error !== null &&
      prevProps.resetKey !== this.props.resetKey
    ) {
      this.setState(INITIAL_STATE)
    }
  }

  reset = (): void => {
    this.setState(INITIAL_STATE)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    const { fallback } = this.props
    if (typeof fallback === 'function') return fallback(error, this.reset)
    if (fallback !== undefined) return fallback

    // 缺省 UI — 简洁、自带 retry
    return <DefaultFallback error={error} onReset={this.reset} />
  }
}

function DefaultFallback({
  error,
  onReset,
}: {
  error: Error
  onReset: () => void
}): ReactNode {
  return (
    <div
      role="alert"
      style={{
        padding: 16,
        margin: 8,
        borderRadius: 8,
        background: 'rgba(210, 80, 80, 0.1)',
        border: '1px solid rgba(210, 80, 80, 0.4)',
        color: '#e0e0e0',
        fontSize: 12,
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>
        ⚠️ 这一区块渲染失败
      </div>
      <div style={{ opacity: 0.85, marginBottom: 8 }}>
        {error.message || '未知错误'}
      </div>
      <button
        type="button"
        onClick={onReset}
        style={{
          padding: '4px 12px',
          borderRadius: 4,
          border: '1px solid rgba(255,255,255,0.2)',
          background: 'rgba(255,255,255,0.06)',
          color: '#fff',
          cursor: 'pointer',
          fontSize: 11,
        }}
      >
        重试
      </button>
    </div>
  )
}
