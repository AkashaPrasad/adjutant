import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import type { Effect } from '../api/types'
import { EffectDetail, EffectsTable } from '../components/EffectsTable'
import { ListTabs } from '../components/ListTabs'
import { EmptyState, ErrorState, PageHeader, Pager, Panel, SidePanel, Skeleton } from '../components/ui'
import { useAsync, useDocumentTitle } from '../lib/hooks'

const PAGE = 50

const OUTCOMES = [
  { id: '', label: 'Outcome: all' },
  { id: 'executed', label: 'Outcome: executed, not undone' },
  { id: 'undone', label: 'Outcome: undone' },
  { id: 'not_reversible', label: 'Outcome: could not be undone' },
  { id: 'failed', label: 'Outcome: failed' },
  { id: 'unverified', label: 'Outcome: state check failed' },
]

export function Ledger() {
  useDocumentTitle('Effects')
  const ledger = useAsync(() => api.ledger(500), [], 8_000)
  const [outcome, setOutcome] = useState('')
  const [tool, setTool] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<Effect | null>(null)

  useEffect(() => setPage(0), [outcome, tool, query])

  const tools = useMemo(() => [...new Set((ledger.data ?? []).map((e) => e.tool))].sort(), [ledger.data])
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (ledger.data ?? []).filter((e) => {
      if (tool && e.tool !== tool) return false
      if (outcome === 'executed' && (e.status !== 'executed' || e.undo_status)) return false
      if (outcome === 'undone' && e.undo_status !== 'compensated') return false
      if (outcome === 'not_reversible' && e.undo_status !== 'not_reversible') return false
      if (outcome === 'failed' && e.status !== 'failed' && e.undo_status !== 'compensation_failed') return false
      if (outcome === 'unverified' && !(e.status === 'executed' && e.verified === false)) return false
      if (q) {
        const hay = `${e.run_id} ${e.node_id} ${e.args_hash} ${e.tool} ${JSON.stringify(e.result ?? {})}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [ledger.data, outcome, tool, query])
  const filtered = !!outcome || !!tool || !!query.trim()
  const clear = () => {
    setOutcome('')
    setTool('')
    setQuery('')
  }

  return (
    <div className="page">
      <PageHeader
        title="Effects"
        subtitle="Every side effect, written exactly once per (run, node, args hash)."
      />
      <ListTabs active="effects" />
      <div className="toolbar">
        <input
          type="search"
          className="input search"
          placeholder="Search run, node, hash, external id"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search effects"
          data-search
        />
        <select className="select" value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="Filter by outcome">
          {OUTCOMES.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <select className="select" value={tool} onChange={(e) => setTool(e.target.value)} aria-label="Filter by tool">
          <option value="">Tool: all</option>
          {tools.map((t) => (
            <option key={t} value={t}>
              Tool: {t}
            </option>
          ))}
        </select>
        {filtered && (
          <button type="button" className="link-btn" onClick={clear}>
            Clear
          </button>
        )}
      </div>
      <Panel flush>
        {ledger.initialLoading ? (
          <div className="panel-body">
            <Skeleton rows={8} />
          </div>
        ) : ledger.error != null && !ledger.data ? (
          <div className="panel-body">
            <ErrorState error={ledger.error} onRetry={() => void ledger.reload()} title="Could not load the ledger" />
          </div>
        ) : rows.length > 0 ? (
          <>
            <EffectsTable effects={rows.slice(page * PAGE, (page + 1) * PAGE)} showRun onSelect={setSelected} selectedId={selected?.id} />
            <Pager page={page} pageSize={PAGE} total={rows.length} onPage={setPage} />
          </>
        ) : (ledger.data ?? []).length === 0 ? (
          <EmptyState title="The ledger is empty">Effects are recorded the moment an approved run executes, each exactly once.</EmptyState>
        ) : (
          <EmptyState
            title="No effects match these filters"
            action={
              <button type="button" className="btn" onClick={clear}>
                Clear filters
              </button>
            }
          />
        )}
      </Panel>
      <SidePanel open={!!selected} onClose={() => setSelected(null)} title={selected ? `Effect #${selected.id}` : 'Effect'}>
        {selected && <EffectDetail e={selected} />}
      </SidePanel>
    </div>
  )
}
