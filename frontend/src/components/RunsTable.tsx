import type { Run } from '../api/types'
import { formatDateTime, relativeTime } from '../lib/format'
import { linkHandler, navigate } from '../lib/router'
import { StatusChip } from './Badge'
import { truncateMiddle } from './ui'

export function RunsTable({ runs, compact }: { runs: Run[]; compact?: boolean }) {
  return (
    <div className="table-wrap">
      <table className={compact ? 'table table-click table-runs-compact' : 'table table-click'}>
        <thead>
          <tr>
            {!compact && <th scope="col">Run id</th>}
            <th scope="col">Goal</th>
            <th scope="col">State</th>
            <th scope="col" className="num">
              Actions
            </th>
            <th scope="col" className="num">
              Auto
            </th>
            {!compact && (
              <th scope="col" className="num">
                Asked
              </th>
            )}
            <th scope="col" className="num">
              Blocked
            </th>
            <th scope="col">Started</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const href = `/runs/${encodeURIComponent(r.id)}`
            const s = r.summary
            return (
              <tr
                key={r.id}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('a,button')) return
                  navigate(href)
                }}
              >
                {!compact && (
                  <td className="mono nowrap">
                    <a href={href} onClick={linkHandler(href)} title={r.id}>
                      {truncateMiddle(r.id, 10, 4)}
                    </a>
                  </td>
                )}
                <td className="cell-truncate cell-goal" title={r.goal}>
                  {compact ? (
                    <a href={href} onClick={linkHandler(href)}>
                      {r.goal}
                    </a>
                  ) : (
                    r.goal
                  )}
                </td>
                <td className="nowrap">
                  <StatusChip status={r.status} />
                </td>
                <td className="num">{s?.total ?? '—'}</td>
                <td className="num">{s?.auto_approved ?? '—'}</td>
                {!compact && <td className="num">{s ? Math.max(0, s.total - s.auto_approved - s.blocked) : '—'}</td>}
                <td className="num">{s?.blocked ? <span className="text-danger">{s.blocked}</span> : (s?.blocked ?? '—')}</td>
                <td className="muted nowrap" title={formatDateTime(r.created_at)}>
                  {relativeTime(r.created_at)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
