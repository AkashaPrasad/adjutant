import { useEffect, useRef, useState } from 'react'
import { Cpu, GitCommit } from 'lucide-react'
import type { Health } from '../api/types'
import { API_BASE, BUILD_TIME, FRONTEND_SHA } from '../config'
import { formatDateTime, shortSha } from '../lib/format'
import { linkHandler, type Route } from '../lib/router'
import { LogoMark } from './Logo'

interface HealthState {
  data: Health | undefined
  error: unknown
  loading: boolean
}

function healthState(h: HealthState): { tone: 'ok' | 'down' | 'degraded' | 'pending'; label: string } {
  if (h.data) {
    const s = (h.data.status || 'ok').toLowerCase()
    if (h.error) return { tone: 'down', label: 'Unreachable' }
    if (['ok', 'healthy', 'up', 'operational', 'pass'].includes(s)) return { tone: 'ok', label: 'Operational' }
    return { tone: 'degraded', label: 'Degraded' }
  }
  if (h.error) return { tone: 'down', label: 'Unreachable' }
  return { tone: 'pending', label: 'Checking…' }
}

const NAV: { to: string; label: string; match: Route['name'][] }[] = [
  { to: '/', label: 'New run', match: ['new'] },
  { to: '/runs', label: 'Runs', match: ['runs', 'run'] },
  { to: '/ledger', label: 'Effect ledger', match: ['ledger'] },
]

export function Header({ route, health }: { route: Route; health: HealthState }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const state = healthState(health)
  const h = health.data

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const backendSha = h?.commit ? shortSha(h.commit) : health.error ? '—' : '…'

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <a href="/" className="brand" onClick={linkHandler('/')}>
          <LogoMark size={26} />
          <span className="brand-name">Adjutant Gate</span>
        </a>

        <nav className="nav" aria-label="Primary">
          {NAV.map((n) => {
            const active = n.match.includes(route.name)
            return (
              <a
                key={n.to}
                href={n.to}
                className={`nav-link${active ? ' active' : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={linkHandler(n.to)}
              >
                {n.label}
              </a>
            )
          })}
        </nav>

        <div className="topbar-meta" ref={wrapRef}>
          {h?.model && (
            <span className="meta-chip hide-sm" title={h.llm_configured === false ? 'Planner model (not configured)' : 'Planner model'}>
              <Cpu size={13} aria-hidden="true" />
              <span className="truncate">{h.model}</span>
              {h.llm_configured === false && <span className="meta-off">off</span>}
            </span>
          )}
          <span className="meta-chip mono hide-xs" title="Deployed commits: API (backend) and Web (this console)">
            <GitCommit size={13} aria-hidden="true" />
            <span>
              <span className="muted">api</span> {backendSha}
            </span>
            <span className="meta-sep" aria-hidden="true" />
            <span>
              <span className="muted">web</span> {shortSha(FRONTEND_SHA)}
            </span>
          </span>
          <button
            type="button"
            className={`status-pill status-${state.tone}`}
            aria-expanded={open}
            aria-haspopup="dialog"
            onClick={() => setOpen((v) => !v)}
            aria-label={`Backend status: ${state.label}. Show deployment details`}
          >
            <span className="status-dot" aria-hidden="true" />
            {state.label}
          </button>
          {open && (
            <div className="popover" role="dialog" aria-label="Deployment details">
              <div className="popover-title">Deployment</div>
              <dl className="kv">
                <dt>API</dt>
                <dd className="mono truncate" title={API_BASE}>
                  {API_BASE}
                </dd>
                <dt>Status</dt>
                <dd>{health.error && !h ? 'Unreachable' : h?.status ?? '—'}</dd>
                <dt>Service</dt>
                <dd>
                  {h?.service ?? '—'} {h?.version && <span className="muted">v{h.version}</span>}
                </dd>
                <dt>Env</dt>
                <dd>{h?.env ?? '—'}</dd>
                <dt>API commit</dt>
                <dd className="mono">{h?.commit ? shortSha(h.commit, 12) : '—'}</dd>
                <dt>API deployed</dt>
                <dd>{h?.deployed_at ? formatDateTime(h.deployed_at) : '—'}</dd>
                <dt>Web commit</dt>
                <dd className="mono">{shortSha(FRONTEND_SHA, 12)}</dd>
                <dt>Web built</dt>
                <dd>{BUILD_TIME ? formatDateTime(BUILD_TIME) : '—'}</dd>
                <dt>Planner</dt>
                <dd>
                  {h?.model ?? '—'}{' '}
                  {h && (h.llm_configured ? <span className="ok-text">configured</span> : <span className="warn-text">not configured</span>)}
                </dd>
              </dl>
              <div className="popover-foot muted small">Polled every 15s</div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
