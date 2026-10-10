export function shortSha(sha?: string | null, n = 7): string {
  if (!sha) return 'unknown'
  const s = String(sha).trim()
  if (!s || s === 'dev' || s === 'unknown') return s || 'unknown'
  return s.slice(0, n)
}

export function shortHash(hash?: string | null, n = 8): string {
  if (!hash) return '—'
  const s = String(hash)
  return s.length > n ? s.slice(0, n) : s
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

export function formatTime(value: unknown): string {
  const d = toDate(value)
  if (!d) return '—'
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function relativeTime(value: unknown): string {
  const d = toDate(value)
  if (!d) return '—'
  const diff = (Date.now() - d.getTime()) / 1000
  const abs = Math.abs(diff)
  const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  if (abs < 30) return 'just now'
  if (abs < 90) return fmt.format(-Math.round(diff), 'second')
  if (abs < 3600) return fmt.format(-Math.round(diff / 60), 'minute')
  if (abs < 86400) return fmt.format(-Math.round(diff / 3600), 'hour')
  if (abs < 86400 * 30) return fmt.format(-Math.round(diff / 86400), 'day')
  return d.toLocaleDateString()
}

export function humanize(key: string): string {
  const s = key.replace(/[_.-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim()
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

export function inlineValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value.join(', ')
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function compact(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '—'
  if (Math.abs(n) < 1000) return String(Math.round(n * 10) / 10)
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

export function pct(part: number, whole: number): string {
  if (!whole) return '0%'
  return `${Math.round((part / whole) * 100)}%`
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`
}

export function dayKey(value: unknown): string | null {
  const d = toDate(value)
  if (!d) return null
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function shortDay(day: string): string {
  const d = new Date(`${day}T12:00:00`)
  if (Number.isNaN(d.getTime())) return day
  return d.toLocaleDateString(undefined, { weekday: 'short' })
}

export function longDay(day: string): string {
  const d = new Date(`${day}T12:00:00`)
  if (Number.isNaN(d.getTime())) return day
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
