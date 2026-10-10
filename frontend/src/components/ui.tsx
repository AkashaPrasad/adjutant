import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ApiError, errorMessage, errorTitle } from '../api/client'
import type { Tone } from '../lib/labels'
import { linkHandler } from '../lib/router'

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

/** Status badge: fill token + text token, optional 6px dot. Always carries a text label. */
export function Badge({
  tone = 'neutral',
  children,
  title,
  dot,
  className,
}: {
  tone?: Tone
  children: ReactNode
  title?: string
  dot?: boolean
  className?: string
}) {
  return (
    <span className={cx('badge', `tone-${tone}`, className)} title={title}>
      {dot && <span className="badge-dot" aria-hidden="true" />}
      {children}
    </span>
  )
}

export function Spinner({ label }: { label?: string }) {
  return <span className="spinner" role={label ? 'status' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />
}

export function Skeleton({ rows = 3, height = 16 }: { rows?: number; height?: number }) {
  return (
    <div className="skeleton-stack" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ height, width: `${96 - ((i * 13) % 28)}%` }} />
      ))}
    </div>
  )
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3 className="empty-title">{title}</h3>
      {children && <p className="empty-body">{children}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry, title }: { error: unknown; onRetry?: () => void; title?: string }) {
  const code = error instanceof ApiError ? error.code : undefined
  const status = error instanceof ApiError && error.status ? error.status : undefined
  if (code === 'network') {
    // The top bar already shows one offline banner; panels stay quiet.
    return <p className="offline-note">Waiting for the API. Data appears here when it is reachable again.</p>
  }
  return (
    <div className="error-block" role="alert">
      <div className="error-block-text">
        <div className="error-block-title">{title ?? errorTitle(error)}</div>
        <div className="error-block-msg">{errorMessage(error)}</div>
        {code && (
          <div className="error-block-meta mono">
            {status ? `HTTP ${status} · ` : ''}
            {code}
          </div>
        )}
      </div>
      {onRetry && (
        <button type="button" className="btn btn-sm" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  )
}

export function Callout({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger' | 'neutral'
  title?: ReactNode
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className={cx('callout', `callout-${tone}`)} role={tone === 'danger' ? 'alert' : undefined}>
      <div className="callout-text">
        {title && <div className="callout-title">{title}</div>}
        {children && <div className="callout-body">{children}</div>}
      </div>
      {action && <div className="callout-action">{action}</div>}
    </div>
  )
}

async function writeClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = value
    document.body.appendChild(ta)
    ta.select()
    try {
      document.execCommand('copy')
    } catch {
      /* ignore */
    }
    ta.remove()
  }
}

/** Text "Copy" button; confirms inline with "Copied" (no toast). */
export function CopyButton({ value, label = 'Copy', className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return (
    <button
      type="button"
      className={cx('copy-btn', className)}
      onClick={(e) => {
        e.stopPropagation()
        void writeClipboard(value).then(() => {
          setCopied(true)
          window.clearTimeout(timer.current)
          timer.current = window.setTimeout(() => setCopied(false), 1400)
        })
      }}
      aria-label={`${label}: ${value}`}
    >
      {copied ? 'Copied' : label}
    </button>
  )
}

export function truncateMiddle(value: string, head = 8, tail = 4): string {
  if (value.length <= head + tail + 1) return value
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}

/** sha256:abcd1234…ef90 with the full value on hover and a copy affordance on hover/focus. */
export function Hash({
  value,
  prefix = 'sha256:',
  previous,
  className,
}: {
  value?: string | null
  prefix?: string
  previous?: string | null
  className?: string
}) {
  if (!value) return <span className="muted">—</span>
  const changed = previous && previous !== value
  return (
    <span className={cx('hash', changed && 'hash-changed', className)} title={`${prefix}${value}`}>
      {changed && (
        <>
          <s className="hash-old mono" aria-label={`previous hash ${previous}`}>
            {truncateMiddle(previous)}
          </s>
          <span className="hash-arrow" aria-hidden="true">
            →
          </span>
        </>
      )}
      <span className="mono">
        <span className="hash-prefix">{prefix}</span>
        {truncateMiddle(value)}
      </span>
      <CopyButton value={value} className="hash-copy" />
    </span>
  )
}

export function Mono({ value, copy }: { value: string; copy?: boolean }) {
  return (
    <span className="hash" title={value}>
      <span className="mono">{value}</span>
      {copy && <CopyButton value={value} className="hash-copy" />}
    </span>
  )
}

export interface Crumb {
  label: string
  href?: string
}

export function PageHeader({
  crumbs,
  title,
  subtitle,
  actions,
  meta,
}: {
  crumbs?: Crumb[]
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  meta?: ReactNode
}) {
  return (
    <header className="page-header">
      {crumbs && crumbs.length > 0 && (
        <nav className="crumbs" aria-label="Breadcrumb">
          {crumbs.map((c, i) => (
            <span key={i} className="crumb">
              {i > 0 && <span className="crumb-sep">/</span>}
              {c.href ? (
                <a href={c.href} onClick={linkHandler(c.href)}>
                  {c.label}
                </a>
              ) : (
                <span aria-current="page">{c.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="page-header-row">
        <div className="page-header-text">
          <h1 className="page-title">{title}</h1>
          {subtitle && <p className="page-subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="page-header-actions">{actions}</div>}
      </div>
      {meta && <div className="page-meta">{meta}</div>}
    </header>
  )
}

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
  id,
  flush,
}: {
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  id?: string
  flush?: boolean
}) {
  return (
    <section className={cx('panel', className)} id={id} aria-label={typeof title === 'string' ? title : undefined}>
      {(title || actions) && (
        <div className={cx('panel-head', flush && 'panel-head-ruled')}>
          <div className="panel-head-text">
            {title && <h2 className="panel-title">{title}</h2>}
            {subtitle && <div className="panel-subtitle">{subtitle}</div>}
          </div>
          {actions && <div className="panel-actions">{actions}</div>}
        </div>
      )}
      <div className={cx(flush ? 'panel-flush' : 'panel-body', bodyClassName)}>{children}</div>
    </section>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: { id: T; label: ReactNode; count?: number }[]
  value: T
  onChange: (id: T) => void
  label: string
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          className={cx('tab', value === t.id && 'is-active')}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.count !== undefined && <span className="tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function KeyValue({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="kv">
      {rows.map(([k, v], i) => (
        <div key={i} className="kv-row">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

const TOOL_SYSTEM: Record<string, string> = {
  email: 'Email',
  slack: 'Slack',
  crm: 'CRM',
  calendar: 'Calendar',
  http: 'Web',
  docs: 'Docs',
}

export function toolSystem(tool: string): string {
  const prefix = tool.split('.')[0]
  return TOOL_SYSTEM[prefix] ?? prefix
}

/** Pager footer: "1-50 of 1,284" plus Previous / Next. */
export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number
  pageSize: number
  total: number
  onPage: (p: number) => void
}) {
  const start = total ? page * pageSize + 1 : 0
  const end = Math.min(total, (page + 1) * pageSize)
  return (
    <div className="pager">
      <span className="pager-count">
        {start}–{end} of {total.toLocaleString()}
      </span>
      <div className="pager-buttons">
        <button type="button" className="btn btn-sm btn-ghost" disabled={page === 0} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <button type="button" className="btn btn-sm btn-ghost" disabled={end >= total} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </div>
    </div>
  )
}

/** Right-side detail panel (480px) for non-destructive drill-down. */
export function SidePanel({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean
  title: ReactNode
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const opener = useRef<Element | null>(null)
  useEffect(() => {
    if (!open) return
    opener.current = document.activeElement
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (opener.current instanceof HTMLElement) opener.current.focus()
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <>
      <div className="sidepanel-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="sidepanel" role="dialog" aria-modal="false" aria-label={typeof title === 'string' ? title : 'Details'} tabIndex={-1} ref={ref}>
        <div className="sidepanel-head">
          <h2 className="panel-title">{title}</h2>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="sidepanel-body">{children}</div>
      </aside>
    </>
  )
}
