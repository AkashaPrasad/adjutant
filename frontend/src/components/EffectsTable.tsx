import type { Effect } from '../api/types'
import { formatDateTime, relativeTime } from '../lib/format'
import { effectStatusMeta, undoStatusMeta } from '../lib/labels'
import { linkHandler } from '../lib/router'
import { Badge, Hash, KeyValue, truncateMiddle, toolSystem } from './ui'
import { JsonView } from './JsonView'

export function externalId(e: Effect): string | null {
  const r = e.result
  if (!r || typeof r !== 'object') return null
  for (const k of ['message_id', 'event_id', 'record_id']) {
    const v = (r as Record<string, unknown>)[k]
    if (typeof v === 'string' && v) return v
  }
  const url = (r as Record<string, unknown>).url
  return typeof url === 'string' ? url : null
}

export function VerifiedMark({ value }: { value?: boolean | null }) {
  if (value === true)
    return (
      <span className="vmark text-success" title="Checked against the system's real state after execution">
        ✓ Verified
      </span>
    )
  if (value === false)
    return (
      <span className="vmark text-danger" title="Post-execution check against system state failed">
        ✕ Not verified
      </span>
    )
  return <span className="vmark muted">Pending</span>
}

export function UndoCell({ e }: { e: Effect }) {
  const undo = undoStatusMeta(e.undo_status, e.tool)
  const msg = (e.compensation ?? e.undo_result)?.message
  if (undo)
    return (
      <Badge tone={undo.tone} dot title={typeof msg === 'string' ? msg : undefined}>
        {undo.label}
      </Badge>
    )
  if (e.status !== 'executed') return <span className="muted">—</span>
  const readOnly = e.tool === 'http.get' || e.tool === 'docs.search'
  const reversible = e.reversible ?? !(e.tool === 'email.send')
  return <span className="muted">{readOnly ? 'Read only' : reversible ? 'Undoable' : 'Irreversible'}</span>
}

export function EffectsTable({
  effects,
  showRun,
  onSelect,
  selectedId,
}: {
  effects: Effect[]
  showRun?: boolean
  onSelect?: (e: Effect) => void
  selectedId?: string | number | null
}) {
  return (
    <div className="table-wrap">
      <table className={onSelect ? 'table table-click' : 'table'}>
        <thead>
          <tr>
            <th scope="col">Effect</th>
            {showRun && <th scope="col">Run</th>}
            <th scope="col">Tool</th>
            <th scope="col">Outcome</th>
            <th scope="col">External id</th>
            <th scope="col">State check</th>
            <th scope="col">Undo</th>
            <th scope="col" title="Exactly-once key: (run, node, args hash)">
              Ledger key (args hash)
            </th>
            <th scope="col">Executed</th>
          </tr>
        </thead>
        <tbody>
          {effects.map((e) => {
            const status = effectStatusMeta(e.status)
            const ext = externalId(e)
            return (
              <tr
                key={`${e.id}`}
                className={selectedId === e.id ? 'is-selected' : undefined}
                onClick={onSelect ? (ev) => !(ev.target as HTMLElement).closest('a,button') && onSelect(e) : undefined}
              >
                <td className="mono nowrap">
                  {onSelect ? (
                    <button type="button" className="link-btn mono" onClick={() => onSelect(e)}>
                      #{e.id} · {e.node_id}
                    </button>
                  ) : (
                    <span>
                      #{e.id} · {e.node_id}
                    </span>
                  )}
                </td>
                {showRun && (
                  <td className="mono nowrap">
                    <a href={`/runs/${e.run_id}`} onClick={linkHandler(`/runs/${e.run_id}`)} title={e.goal ?? e.run_id}>
                      {truncateMiddle(e.run_id, 10, 4)}
                    </a>
                  </td>
                )}
                <td className="nowrap">
                  {toolSystem(e.tool)} <span className="mono muted">{e.tool}</span>
                </td>
                <td className="nowrap">
                  <Badge tone={status.tone} dot>
                    {status.label}
                  </Badge>
                  {e.error && <div className="cell-error">{e.error}</div>}
                </td>
                <td className="mono nowrap">{ext ? truncateMiddle(ext, 16, 6) : <span className="muted">—</span>}</td>
                <td className="nowrap">{e.status === 'executed' ? <VerifiedMark value={e.verified} /> : <span className="muted">—</span>}</td>
                <td className="nowrap">
                  <UndoCell e={e} />
                </td>
                <td className="nowrap">
                  <Hash value={e.args_hash} />
                </td>
                <td className="muted nowrap" title={formatDateTime(e.created_at)}>
                  {relativeTime(e.created_at)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function EffectDetail({ e }: { e: Effect }) {
  const status = effectStatusMeta(e.status)
  return (
    <div className="stack">
      <KeyValue
        rows={[
          ['Effect', <span className="mono">#{e.id}</span>],
          [
            'Run',
            <a className="mono" href={`/runs/${e.run_id}`} onClick={linkHandler(`/runs/${e.run_id}`)}>
              {e.run_id}
            </a>,
          ],
          ['Node', <span className="mono">{e.node_id}</span>],
          ['Tool', <span className="mono">{e.tool}</span>],
          [
            'Outcome',
            <Badge tone={status.tone} dot>
              {status.label}
            </Badge>,
          ],
          ['State check', e.status === 'executed' ? <VerifiedMark value={e.verified} /> : '—'],
          ['Undo', <UndoCell e={e} />],
          ['Ledger key', <Hash value={e.args_hash} />],
          ['Executed at', formatDateTime(e.created_at)],
          ...(e.undone_at ? ([['Undone at', formatDateTime(e.undone_at)]] as [string, string][]) : []),
        ]}
      />
      <div>
        <h3 className="h3">Arguments</h3>
        <JsonView value={e.args ?? {}} />
      </div>
      <div>
        <h3 className="h3">Result</h3>
        {e.error ? <pre className="code">{e.error}</pre> : <JsonView value={e.result ?? null} />}
      </div>
      {e.undo_result && (
        <div>
          <h3 className="h3">Undo result</h3>
          <JsonView value={e.undo_result} />
        </div>
      )}
    </div>
  )
}
