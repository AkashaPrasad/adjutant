import { ChevronRight, Plus, RefreshCw } from 'lucide-react'
import { api } from '../api/client'
import { StatusBadge } from '../components/Badge'
import { StatsRow } from '../components/StatsRow'
import { EmptyState, ErrorState, Skeleton } from '../components/ui'
import { formatDateTime, relativeTime, shortId } from '../lib/format'
import { useAsync, useDocumentTitle } from '../lib/hooks'
import { linkHandler, navigate } from '../lib/router'

export function Runs() {
  useDocumentTitle('Runs')
  const runs = useAsync(() => api.listRuns(50), [], 15_000)
  const list = runs.data ?? []

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Runs</h1>
          <p className="page-sub">Every goal the gate has previewed, with its approval and execution state.</p>
        </div>
        <div className="row gap-sm">
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void runs.reload()} disabled={runs.loading}>
            <RefreshCw size={14} className={runs.loading ? 'spin' : undefined} aria-hidden="true" /> Refresh
          </button>
          <a href="/" className="btn btn-sm btn-primary" onClick={linkHandler('/')}>
            <Plus size={14} aria-hidden="true" /> New run
          </a>
        </div>
      </div>

      <StatsRow />

      <section className="card">
        {runs.loading && !runs.data ? (
          <div className="card-body">
            <Skeleton rows={5} />
          </div>
        ) : runs.error != null && !runs.data ? (
          <div className="card-body">
            <ErrorState error={runs.error} onRetry={runs.reload} title="Could not load runs" />
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            title="No runs yet"
            action={
              <a href="/" className="btn btn-primary" onClick={linkHandler('/')}>
                <Plus size={14} aria-hidden="true" /> Start a run
              </a>
            }
          >
            Create a run from a goal or a sample plan. It will be shadow-run first; nothing executes without approval.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table table-hover">
              <thead>
                <tr>
                  <th scope="col">Goal</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">
                    Items
                  </th>
                  <th scope="col">Run</th>
                  <th scope="col">Created</th>
                  <th scope="col">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => {
                  const href = `/runs/${encodeURIComponent(r.id)}`
                  const count = Array.isArray(r.items) ? r.items.length : (r.item_count as number | undefined)
                  return (
                    <tr key={r.id} className="clickable" onClick={() => navigate(href)}>
                      <td className="goal-cell">
                        <a href={href} onClick={(e) => { e.stopPropagation(); linkHandler(href)(e) }} className="goal-link">
                          {r.goal || 'Untitled run'}
                        </a>
                      </td>
                      <td>
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="num">{count ?? '—'}</td>
                      <td className="mono muted nowrap">{shortId(r.id)}</td>
                      <td className="muted nowrap" title={formatDateTime(r.created_at)}>
                        {relativeTime(r.created_at)}
                      </td>
                      <td className="col-chevron" aria-hidden="true">
                        <ChevronRight size={15} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
