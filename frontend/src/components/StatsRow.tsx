import { api } from '../api/client'
import { humanize } from '../lib/format'
import { useAsync } from '../lib/hooks'

type Tile = { key: string; label: string; value: string; hint?: string }

const PREFERRED = [
  'total_runs',
  'runs',
  'runs_total',
  'awaiting_approval',
  'completed',
  'blocked',
  'effects',
  'total_effects',
  'effects_total',
  'compensated',
  'verified',
  'verification_pass_rate',
]

function formatValue(key: string, v: unknown): string | null {
  if (typeof v === 'number') {
    if (/rate|ratio|pct|percent/i.test(key)) return v <= 1 ? `${Math.round(v * 100)}%` : `${Math.round(v)}%`
    return Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2)
  }
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'string' && v.length <= 16) return v
  return null
}

function toTiles(stats: Record<string, unknown>): Tile[] {
  const tiles: Tile[] = []
  for (const [k, v] of Object.entries(stats)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === 'number')
      const total = entries.reduce((sum, [, x]) => sum + (x as number), 0)
      if (entries.length) {
        tiles.push({
          key: k,
          label: humanize(k),
          value: total.toLocaleString(),
          hint: entries
            .slice(0, 4)
            .map(([name, x]) => `${humanize(name)} ${x as number}`)
            .join(' · '),
        })
      }
      continue
    }
    const value = formatValue(k, v)
    if (value !== null) tiles.push({ key: k, label: humanize(k), value })
  }
  tiles.sort((a, b) => {
    const ia = PREFERRED.indexOf(a.key)
    const ib = PREFERRED.indexOf(b.key)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })
  return tiles.slice(0, 6)
}

export function StatsRow() {
  const { data, error, loading } = useAsync(() => api.stats(), [], 30_000)
  if (error && !data) {
    return <div className="stats-row stats-unavailable muted small">Stats unavailable.</div>
  }
  if (loading && !data) {
    return (
      <div className="stats-row" aria-busy="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="stat stat-skeleton">
            <div className="skeleton" style={{ width: '50%' }} />
            <div className="skeleton skeleton-lg" style={{ width: '30%' }} />
          </div>
        ))}
      </div>
    )
  }
  const tiles = data ? toTiles(data) : []
  if (!tiles.length) return null
  return (
    <div className="stats-row">
      {tiles.map((t) => (
        <div className="stat" key={t.key}>
          <div className="stat-label">{t.label}</div>
          <div className="stat-value">{t.value}</div>
          {t.hint && <div className="stat-hint">{t.hint}</div>}
        </div>
      ))}
    </div>
  )
}
