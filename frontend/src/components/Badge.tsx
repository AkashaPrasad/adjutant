import type { ArgSource, RunItem } from '../api/types'
import { gateDecision, itemStatusMeta, runStatusMeta } from '../lib/labels'
import { Badge, cx } from './ui'

export function StatusChip({ status }: { status?: string | null }) {
  const meta = runStatusMeta(status)
  return (
    <Badge tone={meta.tone} dot title={meta.hint}>
      {meta.label}
    </Badge>
  )
}

export function ItemStatusChip({ status }: { status?: string | null }) {
  const meta = itemStatusMeta(status)
  return (
    <Badge tone={meta.tone} dot>
      {meta.label}
    </Badge>
  )
}

/** Risk is text only: low neutral, medium amber, high red. */
export function RiskText({ risk }: { risk?: string | null }) {
  const r = risk ?? 'unknown'
  return <span className={cx('risk', `risk-${r}`)}>{r.charAt(0).toUpperCase() + r.slice(1)} risk</span>
}

/** The gate's verdict for one action. Auto is deliberately neutral. */
export function DecisionBadge({ item, staged }: { item: RunItem; staged?: 'approve' | 'reject' }) {
  const d = gateDecision(item)
  if (d === 'block')
    return (
      <Badge tone="danger" dot>
        Blocked
      </Badge>
    )
  if (d === 'auto')
    return (
      <Badge tone="neutral" dot title="Auto-approved by policy">
        Auto
      </Badge>
    )
  if (item.status === 'approved' || item.status === 'executed' || item.status === 'compensated')
    return (
      <Badge tone="success" dot title={item.approved_by ? `Approved by ${item.approved_by}` : undefined}>
        Approved
      </Badge>
    )
  if (item.status === 'declined' || item.status === 'rejected')
    return (
      <Badge tone="danger" dot>
        {item.status === 'declined' ? 'Declined' : 'Rejected'}
      </Badge>
    )
  if (staged === 'approve')
    return (
      <Badge tone="success" dot title="Staged in this review; submitted with the batch">
        Approve (staged)
      </Badge>
    )
  if (staged === 'reject')
    return (
      <Badge tone="danger" dot title="Staged in this review; submitted with the batch">
        Reject (staged)
      </Badge>
    )
  if (d === 'ask')
    return (
      <Badge tone="warning" dot>
        Needs approval
      </Badge>
    )
  return <Badge tone="neutral">No decision</Badge>
}

export function SourceBadge({ source }: { source?: ArgSource }) {
  if (source === 'untrusted')
    return (
      <Badge tone="warning" title="Value came from untrusted content (inbound email, web page, search result)">
        untrusted
      </Badge>
    )
  return (
    <Badge tone="neutral" title="Value came from the user or the agent's own wording">
      user
    </Badge>
  )
}
