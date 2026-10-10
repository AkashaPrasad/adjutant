import { useEffect, useRef, type ReactNode } from 'react'
import type { Health } from '../api/types'
import { API_BASE, FRONTEND_SHA, MODEL_ID, MODEL_NAME } from '../config'
import { shortSha } from '../lib/format'
import { useLocalStorage } from '../lib/hooks'
import { linkHandler, navigate, type Route } from '../lib/router'
import { useTheme, type ThemePref } from '../lib/theme'
import { Kbd, SidePanel, cx } from './ui'

interface NavItem {
  to: string
  label: string
  match: Route['name'][]
}

const NAV_MAIN: NavItem[] = [
  { to: '/', label: 'Overview', match: ['overview'] },
  { to: '/runs', label: 'Runs', match: ['runs', 'run'] },
  { to: '/new', label: 'New run', match: ['new'] },
  { to: '/ledger', label: 'Effects', match: ['ledger'] },
  { to: '/systems', label: 'Systems', match: ['systems'] },
  { to: '/audit', label: 'Audit', match: ['audit'] },
]

const NAV_LEARN: NavItem[] = [{ to: '/how-it-works', label: 'How it works', match: ['how'] }]

function NavLink({ item, route, count, onNavigate }: { item: NavItem; route: Route; count?: number; onNavigate: () => void }) {
  const active = item.match.includes(route.name)
  return (
    <a
      href={item.to}
      className={cx('nav-link', active && 'is-active')}
      aria-current={active ? 'page' : undefined}
      onClick={(e) => {
        linkHandler(item.to)(e)
        onNavigate()
      }}
    >
      <span className="nav-label">{item.label}</span>
      {count ? (
        <span className="nav-count" aria-label={`${count} waiting for review`}>
          {count}
        </span>
      ) : null}
    </a>
  )
}

export function Sidebar({
  route,
  open,
  pending,
  health,
  onClose,
  onDemo,
  onShortcuts,
}: {
  route: Route
  open: boolean
  pending: number
  health?: Health
  onClose: () => void
  onDemo: () => void
  onShortcuts: () => void
}) {
  const [pref, setPref] = useTheme()
  return (
    <>
      <div className={cx('sidebar-scrim', open && 'is-open')} onClick={onClose} aria-hidden="true" />
      <nav className={cx('sidebar', open && 'is-open')} aria-label="Primary">
        <a href="/" className="workspace" onClick={linkHandler('/')}>
          <span className="workspace-name">Adjutant Gate</span>
          <span className="workspace-env">{health?.env ?? 'console'}</span>
        </a>
        <div className="nav-group">
          {NAV_MAIN.map((item) => (
            <NavLink key={item.to} item={item} route={route} count={item.to === '/runs' ? pending : undefined} onNavigate={onClose} />
          ))}
        </div>
        <div className="nav-group">
          <div className="nav-group-label">Reference</div>
          {NAV_LEARN.map((item) => (
            <NavLink key={item.to} item={item} route={route} onNavigate={onClose} />
          ))}
          <a className="nav-link" href={`${API_BASE}/docs`} target="_blank" rel="noreferrer">
            <span className="nav-label">API reference</span>
            <span className="nav-ext" aria-hidden="true">
              ↗
            </span>
          </a>
          <button type="button" className="nav-link" onClick={onDemo}>
            <span className="nav-label">Demo script</span>
            <Kbd>d</Kbd>
          </button>
          <button type="button" className="nav-link" onClick={onShortcuts}>
            <span className="nav-label">Shortcuts</span>
            <Kbd>?</Kbd>
          </button>
        </div>
        <div className="sidebar-foot">
          <div className="theme-switch" role="radiogroup" aria-label="Theme">
            {(['light', 'dark', 'system'] as ThemePref[]).map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={pref === p}
                className={cx('theme-opt', pref === p && 'is-active')}
                onClick={() => setPref(p)}
              >
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
          <div className="build-id mono" title={`web ${FRONTEND_SHA} · api ${health?.commit ?? 'unknown'}`}>
            web {shortSha(FRONTEND_SHA)} · api {shortSha(health?.commit)}
          </div>
        </div>
      </nav>
    </>
  )
}

export function Topbar({
  health,
  healthError,
  onMenu,
  onShortcuts,
}: {
  health?: Health
  healthError: boolean
  onMenu: () => void
  onShortcuts: () => void
}) {
  const online = !!health && !healthError
  const llm = health?.llm_configured
  return (
    <header className="topbar">
      <button type="button" className="btn btn-sm btn-ghost topbar-menu" onClick={onMenu}>
        Menu
      </button>
      <div className="topbar-right">
        <span
          className="topbar-item"
          title={online ? `API ${API_BASE} · commit ${health?.commit ?? 'unknown'} · ${health?.env ?? ''}` : `API at ${API_BASE} is not reachable`}
        >
          <span className={cx('status-dot', online ? 'tone-success' : 'tone-danger')} aria-hidden="true" />
          <span>{online ? 'API healthy' : 'API offline'}</span>
          {online && <span className="mono topbar-sha">{shortSha(health?.commit)}</span>}
        </span>
        <span className="topbar-sep" aria-hidden="true" />
        <span className="topbar-item topbar-hide-sm" title={`Web build ${FRONTEND_SHA}`}>
          <span className="muted">Web</span>
          <span className="mono topbar-sha">{shortSha(FRONTEND_SHA)}</span>
        </span>
        <span className="topbar-sep topbar-hide-sm" aria-hidden="true" />
        <span
          className="topbar-item topbar-model"
          title={`${MODEL_NAME} (${MODEL_ID}) plans actions and judges done-criteria.${llm === false ? ' Not configured on this API: planning is disabled and verification is deterministic.' : ''}`}
        >
          <span className="muted topbar-hide-sm">Model</span>
          <span className={cx('status-dot', llm === false ? 'tone-warning' : online ? 'tone-success' : 'tone-neutral')} aria-hidden="true" />
          <span>{MODEL_NAME}</span>
          {llm === false && <span className="text-warning">not configured</span>}
        </span>
        <span className="topbar-sep topbar-hide-xs" aria-hidden="true" />
        <button type="button" className="btn btn-sm btn-ghost topbar-hide-xs" onClick={onShortcuts} aria-label="Keyboard shortcuts">
          <Kbd>?</Kbd>
        </button>
      </div>
    </header>
  )
}

/** Confirmation dialog for destructive actions only. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement
    ref.current?.querySelector<HTMLButtonElement>('button[data-autofocus]')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (opener instanceof HTMLElement) opener.focus()
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" ref={ref}>
        <h2 id="confirm-title" className="modal-title">
          {title}
        </h2>
        <div className="modal-body">{children}</div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy} data-autofocus>
            Cancel
          </button>
          <button type="button" className="btn btn-danger-solid" onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export function ShortcutsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const groups: [string, [ReactNode, string][]][] = [
    [
      'Navigation',
      [
        [<><Kbd>g</Kbd> <Kbd>o</Kbd></>, 'Overview'],
        [<><Kbd>g</Kbd> <Kbd>r</Kbd></>, 'Runs'],
        [<Kbd key="n">n</Kbd>, 'New run'],
        [<><Kbd>g</Kbd> <Kbd>e</Kbd></>, 'Effects'],
        [<><Kbd>g</Kbd> <Kbd>s</Kbd></>, 'Systems'],
        [<><Kbd>g</Kbd> <Kbd>a</Kbd></>, 'Audit'],
        [<><Kbd>g</Kbd> <Kbd>h</Kbd></>, 'How it works'],
        [<Kbd key="slash">/</Kbd>, 'Focus search'],
      ],
    ],
    [
      'Run review',
      [
        [<><Kbd>j</Kbd> <Kbd>k</Kbd></>, 'Next / previous action'],
        [<Kbd key="a">a</Kbd>, 'Stage approve for the selected action'],
        [<Kbd key="r">r</Kbd>, 'Stage reject for the selected action'],
        [<Kbd key="e">e</Kbd>, 'Edit the selected action'],
      ],
    ],
    [
      'General',
      [
        [<Kbd key="t">t</Kbd>, 'Toggle light / dark theme'],
        [<Kbd key="d">d</Kbd>, 'Demo script'],
        [<Kbd key="q">?</Kbd>, 'This list'],
        [<Kbd key="esc">Esc</Kbd>, 'Close panels'],
      ],
    ],
  ]
  return (
    <SidePanel open={open} onClose={onClose} title="Keyboard shortcuts">
      {groups.map(([name, rows]) => (
        <div key={name} className="shortcut-group">
          <h3 className="h3">{name}</h3>
          <dl className="shortcuts">
            {rows.map(([keys, label], i) => (
              <div key={i} className="shortcut-row">
                <dt>{label}</dt>
                <dd>{keys}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </SidePanel>
  )
}

const DEMO_STEPS = [
  {
    title: 'Set the scene',
    body: 'Overview: agents now act on real systems. The gate previews every action, asks only when needed, executes once, undoes where possible and checks the result.',
    to: '/',
  },
  {
    title: 'One batched review',
    body: 'Vendor follow-up: 3 actions, 2 auto-approved by policy, 1 needs approval. Approve the email against its args hash, then execute.',
    to: '/new?scenario=vendor-followup',
  },
  {
    title: 'Taint blocks an injected recipient',
    body: 'Injected recipient: the inbound email chose `to`, so the gate blocks it. Edit the recipient: the hash changes and the action re-gates.',
    to: '/new?scenario=injected-recipient',
  },
  {
    title: 'Exactly once, then undo',
    body: 'Exactly once: execute, then Execute again: replayed from the ledger, no second email. Undo: Slack message deleted, email cannot be recalled. Open Systems.',
    to: '/new?scenario=exactly-once',
  },
  {
    title: 'Proof of done and audit',
    body: 'False done: verification fails against real outputs. Open the audit packet, verify the signature, then tamper one byte and verify again.',
    to: '/new?scenario=false-done',
  },
]

export function DemoDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [done, setDone] = useLocalStorage<boolean[]>('adjutant.demo.steps', DEMO_STEPS.map(() => false))
  const count = done.filter(Boolean).length
  return (
    <SidePanel open={open} onClose={onClose} title={`Demo script · ${count} of ${DEMO_STEPS.length} done`}>
      <ol className="demo-steps">
        {DEMO_STEPS.map((step, i) => (
          <li key={step.title} className={cx('demo-step', done[i] && 'is-done')}>
            <label className="demo-check">
              <input
                type="checkbox"
                checked={!!done[i]}
                onChange={() => setDone((prev) => DEMO_STEPS.map((_, j) => (j === i ? !prev[j] : !!prev[j])))}
              />
              <span className="demo-step-title">
                {i + 1}. {step.title}
              </span>
            </label>
            <p className="demo-step-body">{step.body}</p>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                navigate(step.to)
                onClose()
              }}
            >
              Open
            </button>
          </li>
        ))}
      </ol>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDone(DEMO_STEPS.map(() => false))}>
        Clear checklist
      </button>
    </SidePanel>
  )
}
