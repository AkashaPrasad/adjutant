import { useId, useMemo, useState, type ReactNode } from 'react'
import { longDay, shortDay } from '../lib/format'
import { cx } from './ui'

export function StatTile({
  label,
  value,
  unit,
  delta,
  deltaTone,
  loading,
}: {
  label: string
  value: ReactNode
  unit?: string
  delta?: ReactNode
  deltaTone?: 'success' | 'danger' | 'warning'
  loading?: boolean
}) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        {loading ? (
          <span className="skeleton skeleton-num" aria-hidden="true" />
        ) : (
          <>
            {value}
            {unit && <span className="stat-unit">{unit}</span>}
          </>
        )}
      </div>
      {delta !== undefined && <div className={cx('stat-delta', deltaTone && `text-${deltaTone}`)}>{delta}</div>}
    </div>
  )
}

export function StatStrip({ children }: { children: ReactNode }) {
  return <div className="stat-strip">{children}</div>
}

/** A max divisible by 4 so the five gridlines land on whole numbers. */
function niceMax(v: number): number {
  if (v <= 4) return 4
  for (const step of [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]) {
    if (step * 4 >= v) return step * 4
  }
  return Math.ceil(v / 4000) * 4000
}

export interface Series {
  key: string
  label: string
  /** CSS color, normally a token: var(--chart-2) */
  color: string
}

export interface StackPoint {
  key: string
  values: Record<string, number>
}

/**
 * Stacked column chart (<= 4 series). Horizontal hairline grid, zero baseline, 2px max top radius,
 * 40% band gap, 2px surface gap between segments, text legend above, per-column tooltip on
 * hover and focus, and a table view.
 */
export function StackedColumns({
  data,
  series,
  unit,
  height = 168,
  dimmed,
}: {
  data: StackPoint[]
  series: Series[]
  unit: string
  height?: number
  dimmed?: boolean
}) {
  const [hover, setHover] = useState<number | null>(null)
  const [table, setTable] = useState(false)
  const id = useId()
  const totals = data.map((d) => series.reduce((s, x) => s + (d.values[x.key] ?? 0), 0))
  const max = useMemo(() => niceMax(Math.max(0, ...totals)), [totals])
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max)

  return (
    <figure className={cx('chart', dimmed && 'is-dimmed')} aria-labelledby={`${id}-legend`}>
      <div className="chart-top">
        <ul className="chart-legend" id={`${id}-legend`} aria-label="Legend">
          {series.map((s) => (
            <li key={s.key}>
              <span className="legend-swatch" style={{ background: s.color }} aria-hidden="true" />
              {s.label}
            </li>
          ))}
        </ul>
        <button type="button" className="link-btn" onClick={() => setTable((t) => !t)} aria-pressed={table}>
          {table ? 'View as chart' : 'View as table'}
        </button>
      </div>
      {table ? (
        <table className="table table-dense">
          <thead>
            <tr>
              <th scope="col">Day</th>
              {series.map((s) => (
                <th key={s.key} scope="col" className="num">
                  {s.label}
                </th>
              ))}
              <th scope="col" className="num">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={d.key}>
                <td>{longDay(d.key)}</td>
                {series.map((s) => (
                  <td key={s.key} className="num">
                    {d.values[s.key] ?? 0}
                  </td>
                ))}
                <td className="num">{totals[i]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="chart-plot">
          <div className="chart-y" style={{ height }} aria-hidden="true">
            {ticks
              .slice()
              .reverse()
              .map((t) => (
                <span key={t}>{t.toLocaleString()}</span>
              ))}
          </div>
          <div className="chart-main">
            <div className="chart-canvas" style={{ height }}>
              {ticks.map((t) => (
                <span key={t} className={cx('chart-gridline', t === 0 && 'is-base')} style={{ bottom: `${(t / max) * 100}%` }} />
              ))}
              <div className="chart-cols">
                {data.map((d, i) => (
                  <button
                    key={d.key}
                    type="button"
                    className={cx('chart-col', hover === i && 'is-hover')}
                    onPointerEnter={() => setHover(i)}
                    onPointerLeave={() => setHover((c) => (c === i ? null : c))}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover((c) => (c === i ? null : c))}
                    aria-label={`${longDay(d.key)}: ${series.map((s) => `${d.values[s.key] ?? 0} ${s.label}`).join(', ')}`}
                  >
                    <span className="chart-stack" style={{ height: `${(totals[i] / max) * 100}%` }}>
                      {series.map((s) =>
                        (d.values[s.key] ?? 0) > 0 ? (
                          <span
                            key={s.key}
                            className="chart-seg"
                            style={{ flexGrow: d.values[s.key], background: s.color }}
                          />
                        ) : null,
                      )}
                    </span>
                    {hover === i && (
                      <span className="chart-tip" role="tooltip">
                        <span className="chart-tip-head">{longDay(d.key)}</span>
                        {series
                          .slice()
                          .reverse()
                          .map((s) => (
                            <span key={s.key} className="chart-tip-row">
                              <span className="legend-line" style={{ background: s.color }} aria-hidden="true" />
                              <span className="chart-tip-label">{s.label}</span>
                              <strong>{d.values[s.key] ?? 0}</strong>
                            </span>
                          ))}
                        <span className="chart-tip-row chart-tip-total">
                          <span className="chart-tip-label">Total {unit}</span>
                          <strong>{totals[i]}</strong>
                        </span>
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
            <div className="chart-x" aria-hidden="true">
              {data.map((d, i) => (
                <span key={d.key}>{i % 2 === 0 || i === data.length - 1 ? shortDay(d.key) : ''}</span>
              ))}
            </div>
          </div>
        </div>
      )}
    </figure>
  )
}

/** One horizontal stacked bar with numeric rows beneath (count, share). */
export function MixBar({ parts }: { parts: { key: string; label: string; value: number; color: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0)
  return (
    <div className="mix">
      <div className="mix-bar" role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(', ')}>
        {total === 0 ? (
          <span className="mix-empty" />
        ) : (
          parts
            .filter((p) => p.value > 0)
            .map((p) => <span key={p.key} className="mix-seg" style={{ flexGrow: p.value, background: p.color }} />)
        )}
      </div>
      <table className="mix-table">
        <thead className="sr-only">
          <tr>
            <th scope="col">Decision</th>
            <th scope="col">Count</th>
            <th scope="col">Share</th>
          </tr>
        </thead>
        <tbody>
          {parts.map((p) => (
            <tr key={p.key}>
              <th scope="row">
                <span className="legend-swatch" style={{ background: p.color }} aria-hidden="true" />
                {p.label}
              </th>
              <td className="num">{p.value.toLocaleString()}</td>
              <td className="num muted">{total ? Math.round((p.value / total) * 100) : 0}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Horizontal bar list: one series in --chart-1, value and share right-aligned. */
export function BarList({ rows, unit }: { rows: { label: ReactNode; key: string; value: number }[]; unit: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  const total = rows.reduce((s, r) => s + r.value, 0)
  return (
    <table className="barlist">
      <thead className="sr-only">
        <tr>
          <th scope="col">Tool</th>
          <th scope="col">Bar</th>
          <th scope="col">{unit}</th>
          <th scope="col">Share</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <th scope="row" className="barlist-label">
              {r.label}
            </th>
            <td className="barlist-bar" aria-hidden="true">
              <span className="barlist-fill" style={{ width: `${(r.value / max) * 100}%` }} />
            </td>
            <td className="num">{r.value}</td>
            <td className="num muted">{total ? Math.round((r.value / total) * 100) : 0}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
