import { useState } from 'react'
import { api, errorMessage, isMissingEndpoint } from '../api/client'
import { ActivityFeed } from '../components/Activity'
import { BarList, MixBar, StackedColumns, StatStrip, StatTile } from '../components/Charts'
import { RunsTable } from '../components/RunsTable'
import { ScenarioList } from '../components/Scenarios'
import { ConfirmDialog } from '../components/Shell'
import { useToast } from '../components/Toast'
import { Badge, EmptyState, ErrorState, PageHeader, Panel, Skeleton, toolSystem } from '../components/ui'
import { loadActivity, loadBlocked, loadDashboard, useScenarios } from '../lib/data'
import { formatDateTime, pct, plural, relativeTime } from '../lib/format'
import { useAsync, useDocumentTitle } from '../lib/hooks'
import { linkHandler, navigate } from '../lib/router'

const DECISION_SERIES = [
  { key: 'auto', label: 'Auto', color: 'var(--chart-2)' },
  { key: 'ask', label: 'Needs approval', color: 'var(--warn)' },
  { key: 'block', label: 'Blocked', color: 'var(--danger)' },
]

export function Overview({ env }: { env?: string }) {
  useDocumentTitle('Overview')
  const dash = useAsync(loadDashboard, [], 10_000)
  const activity = useAsync(() => loadActivity(30), [], 5_000)
  const scenarios = useScenarios()
  const runsKey = (dash.data?.runs ?? []).map((r) => `${r.id}:${r.status}`).join('|')
  const blocked = useAsync(() => loadBlocked(dash.data?.runs ?? []), [runsKey])
  const d = dash.data
  const s = d?.stats

  const pending = (d?.runs ?? []).filter((r) => r.status === 'awaiting_approval' || r.status === 'blocked')
  const ready = (d?.runs ?? []).filter((r) => r.status === 'approved')
  const oldestPending = pending.length ? pending[pending.length - 1] : undefined
  const actions = s?.actions_total ?? 0
  const loading = dash.initialLoading

  const reload = () => {
    void dash.reload()
    void activity.reload()
  }

  return (
    <div className="page">
      <PageHeader
        title="Overview"
        subtitle="Agent actions through the gate: previewed in a shadow run, approved only when policy requires it, executed once, undoable, verified."
        meta={
          <>
            {env && <Badge tone="neutral">{env}</Badge>}
            {dash.loading && !loading && <span className="muted small">Refreshing…</span>}
          </>
        }
        actions={
          <>
            <ResetDemo onDone={reload} />
            <a href="/new" className="btn btn-primary" onClick={linkHandler('/new')}>
              New run
            </a>
          </>
        }
      />

      {dash.error != null && !d ? (
        <ErrorState error={dash.error} onRetry={reload} title="Could not load the dashboard" />
      ) : (
        <>
          <div className="attention" role="status" aria-live="polite">
            {loading ? (
              <span className="muted">Loading current state…</span>
            ) : pending.length > 0 ? (
              <>
                <span className="status-dot tone-warning" aria-hidden="true" />
                <span>
                  <strong>{plural(pending.length, 'run')}</strong> waiting for review.
                </span>
                <a href={`/runs/${pending[0].id}`} onClick={linkHandler(`/runs/${pending[0].id}`)}>
                  Review the latest
                </a>
              </>
            ) : ready.length > 0 ? (
              <>
                <span className="status-dot tone-info" aria-hidden="true" />
                <span>
                  <strong>{plural(ready.length, 'run')}</strong> approved and ready to execute.
                </span>
                <a href={`/runs/${ready[0].id}`} onClick={linkHandler(`/runs/${ready[0].id}`)}>
                  Open
                </a>
              </>
            ) : (
              <>
                <span className="status-dot tone-success" aria-hidden="true" />
                <span>No runs waiting for review. Start a demo scenario to send a plan through the gate.</span>
              </>
            )}
          </div>

          <StatStrip>
            <StatTile
              label="Pending approvals"
              value={pending.length}
              loading={loading}
              delta={oldestPending ? `oldest ${relativeTime(oldestPending.created_at)}` : 'none waiting'}
              deltaTone={pending.length ? 'warning' : undefined}
            />
            <StatTile
              label="Actions evaluated"
              value={actions.toLocaleString()}
              loading={loading}
              delta={`across ${plural(s?.runs_total ?? 0, 'run')}`}
            />
            <StatTile
              label="Auto-approval rate"
              value={pct(s?.prompts_avoided ?? 0, actions).replace('%', '')}
              unit="%"
              loading={loading}
              delta={`${(s?.prompts_avoided ?? 0).toLocaleString()} prompts avoided`}
            />
            <StatTile
              label="Blocked by taint"
              value={s?.taint_blocks ?? 0}
              loading={loading}
              delta="untrusted value in a recipient, channel or id"
            />
            <StatTile
              label="Verified runs"
              value={d?.verified ?? 0}
              loading={loading}
              delta={(d?.verificationFailed ?? 0) > 0 ? `${d?.verificationFailed} failed verification` : 'no failed verification'}
              deltaTone={(d?.verificationFailed ?? 0) > 0 ? 'danger' : undefined}
            />
            <StatTile
              label="Effects undone"
              value={d?.undone ?? 0}
              loading={loading}
              delta={`${d?.notReversible ?? 0} could not be undone`}
            />
          </StatStrip>

          <div className="grid-2-1">
            <Panel
              title="Demo scenarios"
              subtitle="Five scripted tasks, one per failure mode. Each opens a prefilled run."
              actions={scenarios.data?.source === 'local' ? <Badge tone="neutral">bundled</Badge> : undefined}
            >
              {scenarios.initialLoading ? <Skeleton rows={5} height={40} /> : <ScenarioList scenarios={scenarios.data?.list ?? []} />}
            </Panel>
            <Panel
              title="Live activity"
              subtitle={
                <span className="live">
                  <span className="status-dot tone-success" aria-hidden="true" /> polling every 5s
                </span>
              }
              bodyClassName="panel-scroll"
            >
              {activity.initialLoading ? (
                <Skeleton rows={6} />
              ) : activity.error != null && !activity.data ? (
                <ErrorState error={activity.error} onRetry={() => void activity.reload()} />
              ) : activity.data && activity.data.events.length > 0 ? (
                <ActivityFeed events={activity.data.events} />
              ) : (
                <EmptyState title="No activity yet">Shadow runs, reviews, effects and undo appear here as they happen.</EmptyState>
              )}
            </Panel>
          </div>

          <div className="grid-2-1">
            <Panel title="Actions over time" subtitle="Actions per day by gate decision, last 7 days.">
              {loading ? (
                <Skeleton rows={5} height={24} />
              ) : (
                <StackedColumns
                  unit="actions"
                  series={DECISION_SERIES}
                  dimmed={dash.loading && !!d}
                  data={(d?.decisionsByDay ?? []).map((p) => ({ key: p.day, values: { auto: p.auto, ask: p.ask, block: p.block } }))}
                />
              )}
            </Panel>
            <div className="stack">
              <Panel title="Decision mix" subtitle="All actions evaluated.">
                {loading ? (
                  <Skeleton rows={3} />
                ) : (
                  <MixBar
                    parts={[
                      { key: 'auto', label: 'Auto', value: d?.mix.auto ?? 0, color: 'var(--chart-2)' },
                      { key: 'ask', label: 'Needs approval', value: d?.mix.ask ?? 0, color: 'var(--warn)' },
                      { key: 'block', label: 'Blocked', value: d?.mix.block ?? 0, color: 'var(--danger)' },
                    ]}
                  />
                )}
              </Panel>
              <Panel title="Effects by tool" subtitle="Side effects in the ledger.">
                {loading ? (
                  <Skeleton rows={3} />
                ) : d && d.byTool.length > 0 ? (
                  <BarList
                    unit="effects"
                    rows={d.byTool.map((r) => ({
                      key: r.tool,
                      value: r.count,
                      label: (
                        <span className="barlist-name">
                          {toolSystem(r.tool)} <span className="mono muted">{r.tool}</span>
                        </span>
                      ),
                    }))}
                  />
                ) : (
                  <EmptyState title="No effects yet">Execute an approved run to record effects.</EmptyState>
                )}
              </Panel>
            </div>
          </div>

          <div className="grid-1-1">
            <Panel
              title="Pending approvals"
              flush
              actions={
                <a href="/runs" onClick={linkHandler('/runs')} className="link">
                  View all
                </a>
              }
            >
              {loading ? (
                <div className="panel-body">
                  <Skeleton rows={4} />
                </div>
              ) : pending.length ? (
                <div className="table-wrap">
                  <table className="table table-click">
                    <thead>
                      <tr>
                        <th scope="col">Run</th>
                        <th scope="col" className="num">
                          Waiting
                        </th>
                        <th scope="col" className="num">
                          Blocked
                        </th>
                        <th scope="col">Age</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pending.slice(0, 8).map((r) => (
                        <tr key={r.id} onClick={() => navigate(`/runs/${r.id}`)}>
                          <td className="cell-truncate">
                            <a href={`/runs/${r.id}`} onClick={linkHandler(`/runs/${r.id}`)} title={r.goal}>
                              {r.goal}
                            </a>
                          </td>
                          <td className="num">{r.summary?.needs_approval ?? 0}</td>
                          <td className="num">{r.summary?.blocked ? <span className="text-danger">{r.summary.blocked}</span> : 0}</td>
                          <td className="muted nowrap" title={formatDateTime(r.created_at)}>
                            {relativeTime(r.created_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState title="No pending approvals">Runs that need a human decision are listed here.</EmptyState>
              )}
            </Panel>
            <Panel title="Recent blocked actions" flush>
              {blocked.initialLoading || loading ? (
                <div className="panel-body">
                  <Skeleton rows={4} />
                </div>
              ) : blocked.data && blocked.data.length ? (
                <div className="table-wrap">
                  <table className="table table-click">
                    <thead>
                      <tr>
                        <th scope="col">Time</th>
                        <th scope="col">Tool</th>
                        <th scope="col">Rule</th>
                      </tr>
                    </thead>
                    <tbody>
                      {blocked.data.map((b) => (
                        <tr key={`${b.run_id}-${b.node_id}`} onClick={() => navigate(`/runs/${b.run_id}`)}>
                          <td className="muted nowrap" title={formatDateTime(b.at)}>
                            {relativeTime(b.at)}
                          </td>
                          <td>
                            <a href={`/runs/${b.run_id}`} onClick={linkHandler(`/runs/${b.run_id}`)} className="mono" title={b.goal}>
                              {b.tool}
                            </a>
                          </td>
                          <td className="text-danger cell-truncate" title={b.rule}>
                            {b.rule}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState title="No blocked actions">Actions stopped by taint or invalid arguments are listed here.</EmptyState>
              )}
            </Panel>
          </div>

          <Panel
            title="Recent runs"
            flush
            actions={
              <a href="/runs" onClick={linkHandler('/runs')} className="link">
                View all
              </a>
            }
          >
            {loading ? (
              <div className="panel-body">
                <Skeleton rows={5} />
              </div>
            ) : d && d.runs.length > 0 ? (
              <RunsTable runs={d.runs.slice(0, 8)} compact />
            ) : (
              <EmptyState
                title="No runs yet"
                action={
                  <a href="/new" className="btn btn-primary" onClick={linkHandler('/new')}>
                    New run
                  </a>
                }
              >
                Start a demo scenario, or reset demo data to load a week of example history.
              </EmptyState>
            )}
          </Panel>
        </>
      )}
    </div>
  )
}

function ResetDemo({ onDone }: { onDone: () => void }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const reset = async () => {
    setBusy(true)
    try {
      await api.resetDemo(true)
      toast.push('success', 'Demo data reset', 'Runs, ledger and sandbox systems were cleared and reseeded with example history.')
      onDone()
      setOpen(false)
    } catch (err) {
      toast.push(
        'error',
        'Reset failed',
        isMissingEndpoint(err) ? 'This API version does not expose POST /v1/demo/reset.' : errorMessage(err),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" className="btn btn-danger" onClick={() => setOpen(true)}>
        Reset demo data
      </button>
      <ConfirmDialog
        open={open}
        title="Reset demo data"
        confirmLabel="Reset demo data"
        busy={busy}
        onClose={() => setOpen(false)}
        onConfirm={() => void reset()}
      >
        This deletes every run, ledger entry and audit trail on this API, restores the sandbox systems (outbox, Slack,
        CRM, calendar) to their seed state, and loads a week of example runs.
      </ConfirmDialog>
    </>
  )
}
