export function shortSha(sha?: string | null, n = 7): string {
  if (!sha) return 'unknown'
  const s = String(sha).trim()
  if (!s || s === 'dev' || s === 'unknown') return s || 'unknown'
  return s.slice(0, n)
}

export function shortHash(hash?: string | null, n = 10): string {
  if (!hash) return '—'
  const s = String(hash)
  const clean = s.includes(':') ? s.split(':').pop() || s : s
  return clean.length > n ? clean.slice(0, n) : clean
}

export function shortId(id?: string | null, n = 8): string {
  if (!id) return '—'
  const s = String(id)
  return s.length > n + 2 ? s.slice(0, n) : s
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') {
    const d = new Date(value < 1e12 ? value * 1000 : value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(String(value))
  return Number.isNaN(d.getTime()) ? null : d
}

export function formatDateTime(value: unknown): string {
  const d = toDate(value)
  if (!d) return '—'
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function relativeTime(value: unknown): string {
  const d = toDate(value)
  if (!d) return '—'
  const diff = (Date.now() - d.getTime()) / 1000
  const abs = Math.abs(diff)
  const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  if (abs < 45) return 'just now'
  if (abs < 3600) return fmt.format(-Math.round(diff / 60), 'minute')
  if (abs < 86400) return fmt.format(-Math.round(diff / 3600), 'hour')
  if (abs < 86400 * 30) return fmt.format(-Math.round(diff / 86400), 'day')
  return d.toLocaleDateString()
}

export function humanize(key: string): string {
  const s = key.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function pretty(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function flagLabel(flag: unknown): string {
  if (typeof flag === 'string') return flag
  if (flag && typeof flag === 'object') {
    const f = flag as Record<string, unknown>
    const main = f.code ?? f.type ?? f.name ?? f.kind ?? f.rule
    const detail = f.message ?? f.reason ?? f.arg ?? f.detail
    if (main && detail) return `${String(main)}: ${String(detail)}`
    if (main) return String(main)
    if (detail) return String(detail)
  }
  return pretty(flag)
}

export function isTaintFlag(flag: unknown): boolean {
  const s = flagLabel(flag).toLowerCase()
  return s.includes('taint') || s.includes('untrusted')
}

export function pick<T = unknown>(obj: Record<string, unknown> | undefined | null, keys: string[]): T | undefined {
  if (!obj) return undefined
  for (const k of keys) {
    const v = obj[k]
    if (v !== undefined && v !== null && v !== '') return v as T
  }
  return undefined
}
