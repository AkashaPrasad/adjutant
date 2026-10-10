import { Fragment, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { Effect } from '../api/types'
import { formatDateTime, pick, pretty, shortHash, shortId } from '../lib/format'
import { linkHandler } from '../lib/router'
import { StatusBadge } from './Badge'
import { Code } from './ui'

function summarize(v: unknown): string {
  if (v === undefined || v === null || v === '') return '—'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  const o = v as Record<string, unknown>
  const s = pick<unknown>(o, ['id', 'external_id', 'message_id', 'ts', 'record_id', 'url', 'status'])
  if (s !== undefined) return String(s)
  return pretty(v).replace(/\s+/g, ' ').slice(0, 80)
}

export function EffectsTable({ effects, showRun = false }: { effects: Effect[]; showRun?: boolean }) {
  const [open, setOpen] = useState<number | null>(null)
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col" className="col-toggle">
              <span className="sr-only">Details</span>
            </th>
            <th scope="col">Time</th>
            {showRun && <th scope="col">Run</th>}
            <th scope="col">Node</th>
            <th scope="col">Tool</th>
            <th scope="col">Status</th>
            <th scope="col">Idempotency key</th>
            <th scope="col">Result</th>
          </tr>
        </thead>
        <tbody>
          {effects.map((e, i) => {
            const runId = pick<string>(e, ['run_id', 'runId'])
            const ts = pick(e, ['created_at', 'executed_at', 'ts', 'timestamp', 'updated_at'])
            const key = pick<string>(e, ['idempotency_key', 'effect_key', 'key', 'args_hash'])
            const result = pick(e, ['external_id', 'external_ref', 'result', 'output', 'response'])
            const isOpen = open === i
            return (
              <Fragment key={String(e.id ?? i)}>
                <tr className={isOpen ? 'row-open' : undefined}>
                  <td className="col-toggle">
                    <button
                      type="button"
                      className="icon-btn"
                      aria-expanded={isOpen}
                      aria-label={isOpen ? 'Hide effect details' : 'Show effect details'}
                      onClick={() => setOpen(isOpen ? null : i)}
                    >
                      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                  </td>
                  <td className="nowrap muted">{formatDateTime(ts)}</td>
                  {showRun && (
                    <td className="mono nowrap">
                      {runId ? (
                        <a href={`/runs/${encodeURIComponent(runId)}`} onClick={linkHandler(`/runs/${encodeURIComponent(runId)}`)}>
                          {shortId(runId)}
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                  )}
                  <td className="mono nowrap">{e.node_id ?? '—'}</td>
                  <td className="nowrap">
                    <code className="tool-name">{e.tool ?? '—'}</code>
                  </td>
                  <td>
                    <StatusBadge status={pick<string>(e, ['status', 'state'])} />
                  </td>
                  <td className="mono muted nowrap" title={key}>
                    {key ? shortHash(key, 14) : '—'}
                  </td>
                  <td className="truncate-cell" title={summarize(result)}>
                    {summarize(result)}
                  </td>
                </tr>
                {isOpen && (
                  <tr className="row-detail">
                    <td colSpan={showRun ? 8 : 7}>
                      <Code value={e} maxHeight={320} />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
