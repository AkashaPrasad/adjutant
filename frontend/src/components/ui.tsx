import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, Copy, Inbox, Info, Loader2, RefreshCw, X, XCircle } from 'lucide-react'
import { ApiError, errorMessage } from '../api/client'

export function Spinner({ label, size = 16 }: { label?: string; size?: number }) {
  return (
    <span className="spinner" role="status" aria-live="polite">
      <Loader2 size={size} className="spin" aria-hidden="true" />
      {label ? <span>{label}</span> : <span className="sr-only">Loading</span>}
    </span>
  )
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading-block">
      <Spinner label={label} />
    </div>
  )
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skeleton-stack" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ width: `${92 - i * 11}%` }} />
      ))}
    </div>
  )
}

export function EmptyState({
  title,
  children,
  action,
  icon,
}: {
  title: string
  children?: ReactNode
  action?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden="true">
        {icon ?? <Inbox size={20} />}
      </div>
      <div className="empty-title">{title}</div>
      {children && <div className="empty-body">{children}</div>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  )
}

export function Callout({
  tone = 'info',
  title,
  children,
  onDismiss,
  action,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success'
  title?: ReactNode
  children?: ReactNode
  onDismiss?: () => void
  action?: ReactNode
}) {
  const Icon = tone === 'danger' ? XCircle : tone === 'warning' ? AlertTriangle : tone === 'success' ? Check : Info
  return (
    <div className={`callout callout-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon size={16} className="callout-icon" aria-hidden="true" />
      <div className="callout-content">
        {title && <div className="callout-title">{title}</div>}
        {children && <div className="callout-body">{children}</div>}
      </div>
      {action}
      {onDismiss && (
        <button type="button" className="icon-btn" onClick={onDismiss} aria-label="Dismiss">
          <X size={14} />
        </button>
      )}
    </div>
  )
}

export function ErrorState({ error, onRetry, title }: { error: unknown; onRetry?: () => void; title?: string }) {
  const unreachable = error instanceof ApiError && (error.code === 'network' || error.code === 'timeout')
  return (
    <Callout
      tone="danger"
      title={title ?? (unreachable ? 'API unreachable' : 'Something went wrong')}
      action={
        onRetry && (
          <button type="button" className="btn btn-sm" onClick={onRetry}>
            <RefreshCw size={14} aria-hidden="true" /> Retry
          </button>
        )
      }
    >
      {errorMessage(error)}
      {error instanceof ApiError && error.status > 0 && (
        <span className="muted mono small"> ({error.status} {error.code})</span>
      )}
    </Callout>
  )
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          window.clearTimeout(timer.current)
          timer.current = window.setTimeout(() => setCopied(false), 1400)
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  )
}

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: string
  subtitle?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      prevFocus?.focus?.()
    }
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`modal${wide ? ' modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        ref={ref}
      >
        <div className="modal-header">
          <div>
            <h2 id="modal-title" className="modal-title">
              {title}
            </h2>
            {subtitle && <div className="modal-subtitle">{subtitle}</div>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close dialog">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  )
}

export function Code({ value, maxHeight }: { value: unknown; maxHeight?: number }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return (
    <pre className="code" style={maxHeight ? { maxHeight } : undefined}>
      <code>{text ?? '—'}</code>
    </pre>
  )
}
