import { useEffect, useMemo, useState } from 'react'
import { api, errorMessage, isMissingEndpoint } from '../api/client'
import type { Effect, SandboxObject } from '../api/types'
import { JsonView } from '../components/JsonView'
import { CalendarCard, CrmRecordCard, EmailCard, SlackMessage } from '../components/Artifacts'
import { ConfirmDialog } from '../components/Shell'
import { UndoCell } from '../components/EffectsTable'
import { useToast } from '../components/Toast'
import { Badge, EmptyState, ErrorState, Hash, PageHeader, Panel, SidePanel, Skeleton, Tabs, cx, truncateMiddle } from '../components/ui'
import { loadScenarios } from '../lib/data'
import { formatDateTime, relativeTime } from '../lib/format'
import { effectStatusMeta, type Tone } from '../lib/labels'
import { useAsync, useDocumentTitle } from '../lib/hooks'
import { linkHandler } from '../lib/router'

type SystemId = 'email' | 'slack_message' | 'crm_record' | 'calendar_event' | 'inbox'

const SYSTEMS: { id: SystemId; label: string; desc: string; tools: string[] }[] = [
  { id: 'email', label: 'Outbox', desc: 'Emails sent by agents. Sent email cannot be recalled.', tools: ['email.send'] },
  { id: 'slack_message', label: 'Slack', desc: 'Messages posted to channels. Undo deletes them.', tools: ['slack.post'] },
  { id: 'crm_record', label: 'CRM', desc: 'Account records. Undo restores previous field values.', tools: ['crm.update'] },
  { id: 'calendar_event', label: 'Calendar', desc: 'Events created by agents. Undo cancels them.', tools: ['calendar.create_event'] },
  { id: 'inbox', label: 'Inbox', desc: 'Inbound messages: untrusted content the agent reads.', tools: [] },
]

function objectStatus(kind: SystemId, o: SandboxObject, undoByExternal: Map<string, Effect>): { label: string; tone: Tone; note?: string } {
  const eff = undoByExternal.get(o.id)
  if (kind === 'email') {
    if (o.data.recall === 'not_possible' || eff?.undo_status === 'not_reversible')
      return { label: 'Sent', tone: 'success', note: 'Undo attempted: recall not possible' }
    return { label: 'Sent', tone: 'success' }
  }
  switch (o.status) {
    case 'posted':
      return { label: 'Posted', tone: 'success' }
    case 'deleted':
      return { label: 'Deleted by undo', tone: 'neutral' }
    case 'confirmed':
      return { label: 'Confirmed', tone: 'success' }
    case 'cancelled':
      return { label: 'Cancelled by undo', tone: 'neutral' }
    case 'active':
      return { label: 'Active', tone: 'neutral' }
    case 'unread':
      return { label: 'Unread', tone: 'info' }
    default:
      return { label: o.status, tone: 'neutral' }
  }
}

async function sha256(text: string): Promise<string | null> {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}

export function Systems() {
  useDocumentTitle('Systems')
  const toast = useToast()
  const sandbox = useAsync(() => api.sandbox(), [], 5_000)
  const ledger = useAsync(() => api.ledger(500), [], 5_000)
  const scenarios = useAsync(loadScenarios, [])
  const [system, setSystem] = useState<SystemId>('email')
  const [view, setView] = useState<'records' | 'changes'>('records')
  const [selected, setSelected] = useState<SandboxObject | null>(null)
  const [snapshot, setSnapshot] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [resetting, setResetting] = useState(false)

  const state = sandbox.data
  const inboxFromApi = state && Array.isArray(state.inbox) ? state.inbox : null
  const inbox: SandboxObject[] = useMemo(() => {
    if (inboxFromApi) return inboxFromApi
    return (scenarios.data?.list ?? [])
      .filter((s) => s.context)
      .map((s) => ({ kind: 'inbox', id: `fixture-${s.id}`, data: { from: /From:\s*(.+)/.exec(s.context ?? '')?.[1] ?? 'unknown', subject: /Subject:\s*(.+)/.exec(s.context ?? '')?.[1] ?? s.title, body: s.context, scenario: s.title }, status: 'unread' }))
  }, [inboxFromApi, scenarios.data])

  const records = (id: SystemId): SandboxObject[] => (id === 'inbox' ? inbox : [...(state?.[id] ?? [])].reverse())

  const undoByExternal = useMemo(() => {
    const m = new Map<string, Effect>()
    for (const e of ledger.data ?? []) {
      const r = e.result as Record<string, unknown> | null | undefined
      const ext = r && (r.message_id ?? r.event_id ?? r.record_id)
      if (typeof ext === 'string' && !m.has(ext)) m.set(ext, e)
    }
    return m
  }, [ledger.data])

  useEffect(() => {
    if (!state) return
    void sha256(JSON.stringify(state)).then(setSnapshot)
  }, [state])

  const sys = SYSTEMS.find((s) => s.id === system) ?? SYSTEMS[0]
  const rows = records(system)
  const changes = (ledger.data ?? []).filter((e) => sys.tools.includes(e.tool))
  const lastChanged = rows.reduce<string | undefined>((acc, o) => (o.updated_at && (!acc || o.updated_at > acc) ? o.updated_at : acc), undefined)

  const reset = async () => {
    setResetting(true)
    try {
      await api.resetDemo(true)
      toast.push('success', 'Sandbox reset', 'Systems restored to seed state; runs and ledger reseeded.')
      setConfirm(false)
      void sandbox.reload()
      void ledger.reload()
    } catch (err) {
      toast.push('error', 'Reset failed', isMissingEndpoint(err) ? 'This API version does not expose POST /v1/demo/reset.' : errorMessage(err))
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Systems"
        subtitle="Sandbox systems the agents act on. Read-only, live."
        actions={
          <button type="button" className="btn btn-danger" onClick={() => setConfirm(true)}>
            Reset sandbox
          </button>
        }
      />
      {sandbox.error != null && !state ? (
        <ErrorState error={sandbox.error} onRetry={() => void sandbox.reload()} title="Could not load sandbox state" />
      ) : (
        <div className="systems">
          <nav className="panel system-list" aria-label="Systems">
            {SYSTEMS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={cx('system-row', system === s.id && 'is-selected')}
                aria-current={system === s.id ? 'true' : undefined}
                onClick={() => {
                  setSystem(s.id)
                  setView(s.id === 'inbox' ? 'records' : view)
                }}
              >
                <span>{s.label}</span>
                <span className="num muted">{sandbox.initialLoading ? '…' : records(s.id).length}</span>
              </button>
            ))}
          </nav>
          <Panel
            className="system-main"
            title={sys.label}
            subtitle={sys.desc}
            flush
            actions={
              <div className="system-meta">
                <span className="muted small">Last changed {lastChanged ? relativeTime(lastChanged) : '—'}</span>
                {snapshot && (
                  <span className="small">
                    Snapshot <Hash value={snapshot} />
                  </span>
                )}
              </div>
            }
          >
            {sys.id !== 'inbox' && (
              <div className="panel-tabs">
                <Tabs
                  label="System view"
                  value={view}
                  onChange={setView}
                  tabs={[
                    { id: 'records', label: 'Records', count: rows.length },
                    { id: 'changes', label: 'Changes', count: changes.length },
                  ]}
                />
              </div>
            )}
            {sandbox.initialLoading ? (
              <div className="panel-body">
                <Skeleton rows={6} />
              </div>
            ) : view === 'records' || sys.id === 'inbox' ? (
              rows.length ? (
                <RecordsTable system={sys.id} rows={rows} undoByExternal={undoByExternal} onSelect={setSelected} />
              ) : (
                <EmptyState title={`No ${sys.label.toLowerCase()} records`}>
                  {sys.id === 'email'
                    ? 'Nothing has been sent. Execute an approved run with an email action.'
                    : 'Execute a run that writes here to see the effect.'}
                </EmptyState>
              )
            ) : changes.length ? (
              <ChangesList effects={changes} />
            ) : (
              <EmptyState title="No changes yet">Effects applied to this system by executed runs appear here.</EmptyState>
            )}
          </Panel>
        </div>
      )}
      <SidePanel open={!!selected} onClose={() => setSelected(null)} title={selected ? selected.id : 'Record'}>
        {selected && (
          <div className="stack">
            {typeof selected.data.body === 'string' && <pre className="mail-body">{selected.data.body}</pre>}
            <JsonView value={selected} />
          </div>
        )}
      </SidePanel>
      <ConfirmDialog open={confirm} title="Reset sandbox" confirmLabel="Reset sandbox" busy={resetting} onClose={() => setConfirm(false)} onConfirm={() => void reset()}>
        This clears the outbox, Slack, calendar and CRM changes, deletes every run and ledger entry, and reseeds example history.
      </ConfirmDialog>
    </div>
  )
}

function RecordsTable({
  system,
  rows,
  undoByExternal,
  onSelect,
}: {
  system: SystemId
  rows: SandboxObject[]
  undoByExternal: Map<string, Effect>
  onSelect: (o: SandboxObject) => void
}) {
  const str = (v: unknown) => (v === undefined || v === null ? '' : String(v))
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? [v] : [])
  return (
    <div className={cx('art-grid', system === 'slack_message' && 'art-grid-1')}>
      {rows.map((o) => {
        const st = objectStatus(system, o, undoByExternal)
        const chip = (
          <Badge tone={st.note ? 'warning' : st.tone} dot title={st.note}>
            {st.note ? 'Cannot be recalled' : st.label}
          </Badge>
        )
        const d = o.data
        let card
        switch (system) {
          case 'email':
            card = <EmailCard compact from={str(d.from) || undefined} to={list(d.to)} cc={list(d.cc)} subject={str(d.subject)} body={str(d.body)} status={chip} />
            break
          case 'slack_message':
            card = <SlackMessage channel={str(d.channel)} text={str(d.text)} author={str(d.author) || undefined} at={str(d.posted_at) || o.created_at} deleted={o.status === 'deleted'} status={chip} />
            break
          case 'crm_record':
            card = <CrmRecordCard id={o.id} data={d} status={chip} />
            break
          case 'calendar_event':
            card = <CalendarCard title={str(d.title)} start={str(d.start)} end={str(d.end)} attendees={list(d.attendees)} cancelled={o.status === 'cancelled'} status={chip} />
            break
          default:
            card = (
              <EmailCard
                compact
                from={`${d.from_name ? `${str(d.from_name)} ` : ''}<${str(d.from)}>`}
                to={list(d.to)}
                subject={str(d.subject)}
                body={str(d.body)}
                status={d.trust === 'untrusted' || o.id.startsWith('fixture-') ? <Badge tone="warning">untrusted</Badge> : chip}
              />
            )
        }
        return (
          <button key={o.id} type="button" className="art-btn" onClick={() => onSelect(o)} aria-label={`Open ${o.id}`} title={`${o.id} · updated ${formatDateTime(o.updated_at)}`}>
            {card}
          </button>
        )
      })}
    </div>
  )
}

function ChangesList({ effects }: { effects: Effect[] }) {
  const [open, setOpen] = useState<Set<string | number>>(new Set())
  return (
    <ul className="changes">
      {effects.map((e) => {
        const st = effectStatusMeta(e.status)
        const isOpen = open.has(e.id)
        return (
          <li key={e.id} className="change">
            <div className="change-row">
              <span className="muted nowrap" title={formatDateTime(e.created_at)}>
                {formatDateTime(e.created_at)}
              </span>
              <a className="mono" href={`/runs/${e.run_id}`} onClick={linkHandler(`/runs/${e.run_id}`)}>
                {truncateMiddle(e.run_id, 10, 4)}
              </a>
              <span className="mono">{e.tool}</span>
              <Badge tone={st.tone} dot>
                {st.label}
              </Badge>
              <UndoCell e={e} />
              <button
                type="button"
                className="link-btn change-toggle"
                aria-expanded={isOpen}
                onClick={() =>
                  setOpen((s) => {
                    const n = new Set(s)
                    if (n.has(e.id)) n.delete(e.id)
                    else n.add(e.id)
                    return n
                  })
                }
              >
                {isOpen ? 'Hide diff' : 'Show diff'}
              </button>
            </div>
            {isOpen && (
              <div className="change-diff">
                <JsonView value={{ args: e.args, result: e.result, undo: e.undo_result ?? undefined }} maxHeight={280} />
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
