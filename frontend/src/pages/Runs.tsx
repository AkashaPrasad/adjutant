import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import { ListTabs } from '../components/ListTabs'
import { RunsTable } from '../components/RunsTable'
import { EmptyState, ErrorState, PageHeader, Pager, Panel, Skeleton } from '../components/ui'
import { RUN_STATUS_ORDER, runStatusMeta } from '../lib/labels'
import { useAsync, useDocumentTitle } from '../lib/hooks'
import { linkHandler } from '../lib/router'

const PAGE = 50

export function Runs() {
  useDocumentTitle('Runs')
  const runs = useAsync(() => api.listRuns(200), [], 8_000)
  const [status, setStatus] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)

  useEffect(() => setPage(0), [status, query])

  const counts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const r of runs.data ?? []) out[r.status] = (out[r.status] ?? 0) + 1
    return out
  }, [runs.data])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (runs.data ?? []).filter(
      (r) =>
        (!status || (status === 'review' ? r.status === 'awaiting_approval' || r.status === 'blocked' : r.status === status)) &&
        (!q || r.goal.toLowerCase().includes(q) || r.id.toLowerCase().includes(q)),
    )
  }, [runs.data, status, query])

  const reviewCount = (counts.awaiting_approval ?? 0) + (counts.blocked ?? 0)
  const filtered = !!status || !!query.trim()

  return (
    <div className="page">
      <PageHeader
        title="Runs"
        subtitle="Every task an agent sent through the gate, newest first."
        actions={
          <a href="/new" className="btn btn-primary" onClick={linkHandler('/new')}>
            New run
          </a>
        }
      />
      <ListTabs active="runs" />
      <div className="toolbar">
        <input
          type="search"
          className="input search"
          placeholder="Search goal or run id"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search runs"
          data-search
        />
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by state">
          <option value="">State: all ({runs.data?.length ?? 0})</option>
          <option value="review">State: needs review ({reviewCount})</option>
          {RUN_STATUS_ORDER.filter((s) => counts[s]).map((s) => (
            <option key={s} value={s}>
              State: {runStatusMeta(s).label.toLowerCase()} ({counts[s]})
            </option>
          ))}
        </select>
        {filtered && (
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setStatus('')
              setQuery('')
            }}
          >
            Clear
          </button>
        )}
      </div>
      <Panel flush>
        {runs.initialLoading ? (
          <div className="panel-body">
            <Skeleton rows={8} />
          </div>
        ) : runs.error != null && !runs.data ? (
          <div className="panel-body">
            <ErrorState error={runs.error} onRetry={() => void runs.reload()} title="Could not load runs" />
          </div>
        ) : rows.length > 0 ? (
          <>
            <RunsTable runs={rows.slice(page * PAGE, (page + 1) * PAGE)} />
            <Pager page={page} pageSize={PAGE} total={rows.length} onPage={setPage} />
          </>
        ) : (runs.data ?? []).length === 0 ? (
          <EmptyState
            title="No runs yet"
            action={
              <a href="/new" className="btn btn-primary" onClick={linkHandler('/new')}>
                New run
              </a>
            }
          >
            A run is one agent task: shadow-run, reviewed once, executed through the ledger, verified.
          </EmptyState>
        ) : (
          <EmptyState
            title="No runs match these filters"
            action={
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setStatus('')
                  setQuery('')
                }}
              >
                Clear filters
              </button>
            }
          />
        )}
      </Panel>
    </div>
  )
}
