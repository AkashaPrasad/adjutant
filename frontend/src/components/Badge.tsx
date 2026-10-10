import type { ReactNode } from 'react'
import { humanize } from '../lib/format'

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'muted'

export function Badge({
  tone = 'neutral',
  children,
  dot = false,
  title,
  mono = false,
}: {
  tone?: Tone
  children: ReactNode
  dot?: boolean
  title?: string
  mono?: boolean
}) {
  return (
    <span className={`badge badge-${tone}${mono ? ' mono' : ''}`} title={title}>
      {dot && <span className="badge-dot" aria-hidden="true" />}
      {children}
    </span>
  )
}

const STATUS_TONE: Record<string, Tone> = {
  awaiting_approval: 'warning',
  needs_approval: 'warning',
  pending_approval: 'warning',
  blocked: 'danger',
  approved: 'accent',
  executing: 'accent',
  running: 'accent',
  completed: 'success',
  executed: 'success',
  succeeded: 'success',
  success: 'success',
  verified: 'success',
  ok: 'success',
  failed: 'danger',
  error: 'danger',
  partially_completed: 'warning',
  compensated: 'muted',
  undone: 'muted',
  rejected: 'muted',
  skipped: 'muted',
  previewed: 'neutral',
  pending: 'neutral',
  planned: 'neutral',
}

const STATUS_LABEL: Record<string, string> = {
  awaiting_approval: 'Awaiting approval',
  partially_completed: 'Partially completed',
  compensated: 'Compensated',
}

export function statusTone(status?: string): Tone {
  if (!status) return 'neutral'
  const s = status.toLowerCase()
  if (STATUS_TONE[s]) return STATUS_TONE[s]
  if (s.includes('fail') || s.includes('error')) return 'danger'
  if (s.includes('block')) return 'danger'
  if (s.includes('approv')) return 'warning'
  if (s.includes('complet') || s.includes('success')) return 'success'
  return 'neutral'
}

export function StatusBadge({ status }: { status?: string }) {
  if (!status) return <Badge tone="neutral">Unknown</Badge>
  return (
    <Badge tone={statusTone(status)} dot>
      {STATUS_LABEL[status] ?? humanize(status)}
    </Badge>
  )
}

export function RiskBadge({ risk }: { risk?: string }) {
  if (!risk) return null
  const r = risk.toLowerCase()
  const tone: Tone = r === 'high' ? 'danger' : r === 'medium' ? 'warning' : r === 'low' ? 'success' : 'neutral'
  return (
    <Badge tone={tone} title={`Risk: ${risk}`}>
      {humanize(risk)} risk
    </Badge>
  )
}
