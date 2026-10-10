import { RefreshCw } from 'lucide-react'
import { api } from '../api/client'
import { EffectsTable } from '../components/EffectsTable'
import { StatsRow } from '../components/StatsRow'
import { EmptyState, ErrorState, Skeleton } from '../components/ui'
import { useAsync, useDocumentTitle } from '../lib/hooks'

export function Ledger() {
  useDocumentTitle('Effect ledger')
  const ledger = useAsync(() => api.ledger(200), [], 15_000)
  const list = ledger.data ?? []
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Effect ledger</h1>
          <p className="page-sub">
            Append-only record of every real side effect. Idempotency keys guarantee each one happens exactly once.
          </p>
        </div>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => void ledger.reload()} disabled={ledger.loading}>
          <RefreshCw size={14} className={ledger.loading ? 'spin' : undefined} aria-hidden="true" /> Refresh
        </button>
      </div>

      <StatsRow />

      <section className="card">
        {ledger.loading && !ledger.data ? (
          <div className="card-body">
            <Skeleton rows={5} />
          </div>
        ) : ledger.error != null && !ledger.data ? (
          <div className="card-body">
            <ErrorState error={ledger.error} onRetry={ledger.reload} title="Could not load the ledger" />
          </div>
        ) : list.length === 0 ? (
          <EmptyState title="The ledger is empty">
            Effects are written only when an approved run executes. Shadow runs never touch the ledger.
          </EmptyState>
        ) : (
          <EffectsTable effects={list} showRun />
        )}
      </section>
    </div>
  )
}
