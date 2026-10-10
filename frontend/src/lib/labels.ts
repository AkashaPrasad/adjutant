import type { RunItem } from '../api/types'
import { MODEL_NAME } from '../config'
import { humanize } from './format'

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

interface Meta {
  label: string
  tone: Tone
  hint?: string
}

const RUN_STATUS: Record<string, Meta> = {
  awaiting_approval: { label: 'Needs review', tone: 'warning', hint: 'Some actions need a human decision' },
  blocked: { label: 'Blocked', tone: 'danger', hint: 'Policy blocked at least one action' },
  approved: { label: 'Approved', tone: 'info', hint: 'Ready to execute' },
  executing: { label: 'Executing', tone: 'info', hint: 'Running through the effect ledger' },
  completed: { label: 'Verified', tone: 'success', hint: 'Executed and done-criteria verified' },
  partially_completed: { label: 'Completed, items held back', tone: 'warning', hint: 'Executed; some actions were held back by the gate or a done-criterion was not met' },
  failed: { label: 'Failed', tone: 'danger', hint: 'No effect executed successfully' },
  compensated: { label: 'Undone', tone: 'neutral', hint: 'Reversible effects were compensated' },
  rejected: { label: 'Rejected', tone: 'danger', hint: 'A reviewer rejected the plan; nothing ran' },
}

export function runStatusMeta(status?: string | null): Meta {
  if (!status) return { label: 'Unknown', tone: 'neutral' }
  return RUN_STATUS[status] ?? { label: humanize(status), tone: 'neutral' }
}

export const RUN_STATUS_ORDER = [
  'awaiting_approval',
  'blocked',
  'approved',
  'executing',
  'completed',
  'partially_completed',
  'failed',
  'compensated',
  'rejected',
]

const ITEM_STATUS: Record<string, Meta> = {
  pending_approval: { label: 'Needs approval', tone: 'warning' },
  auto_approved: { label: 'Auto', tone: 'neutral' },
  blocked: { label: 'Blocked', tone: 'danger' },
  approved: { label: 'Approved', tone: 'success' },
  declined: { label: 'Declined', tone: 'danger' },
  rejected: { label: 'Rejected', tone: 'danger' },
  executed: { label: 'Executed', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  skipped: { label: 'Skipped', tone: 'neutral' },
  compensated: { label: 'Undone', tone: 'neutral' },
}

export function itemStatusMeta(status?: string | null): Meta {
  if (!status) return { label: 'Unknown', tone: 'neutral' }
  return ITEM_STATUS[status] ?? { label: humanize(status), tone: 'neutral' }
}

const EFFECT_STATUS: Record<string, Meta> = {
  executed: { label: 'Executed', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  refused: { label: 'Refused', tone: 'danger' },
}

export function effectStatusMeta(status?: string | null): Meta {
  if (!status) return { label: '—', tone: 'neutral' }
  return EFFECT_STATUS[status] ?? { label: humanize(status), tone: 'neutral' }
}

const UNDO_STATUS: Record<string, Meta> = {
  compensated: { label: 'Undone', tone: 'neutral' },
  not_reversible: { label: 'Cannot be undone', tone: 'warning' },
  compensation_failed: { label: 'Undo failed', tone: 'danger' },
}

export function undoStatusMeta(status?: string | null, tool?: string): Meta | null {
  if (!status) return null
  if (status === 'not_reversible' && tool === 'email.send') return { label: 'Email cannot be recalled', tone: 'warning' }
  return UNDO_STATUS[status] ?? { label: humanize(status), tone: 'neutral' }
}

/** Human explanation of a policy flag. */
export function flagMeta(flag: string): Meta {
  const [kind, arg] = flag.split(':')
  switch (kind) {
    case 'taint':
      return {
        label: `taint: ${arg}`,
        tone: 'danger',
        hint: `\`${arg}\` came from untrusted content. Untrusted data may fill a body, never a recipient, channel or record id.`,
      }
    case 'untrusted_content':
      return { label: `untrusted ${arg}`, tone: 'warning', hint: `\`${arg}\` contains untrusted content, so a human reviews it.` }
    case 'irreversible':
      return { label: 'irreversible', tone: 'warning', hint: 'This action cannot be undone once it runs.' }
    case 'reversible':
      return { label: 'reversible', tone: 'neutral', hint: 'Can be compensated by Undo.' }
    case 'read_only':
      return { label: 'read only', tone: 'neutral', hint: 'Reads real data; no side effect.' }
    case 'invalid_args':
      return { label: 'invalid args', tone: 'danger', hint: 'The shadow run could not validate these arguments.' }
    default:
      return { label: flag.replace(/_/g, ' '), tone: 'neutral' }
  }
}

/** One sentence: why the policy decided what it decided. */
export function decisionReason(item: RunItem): string {
  const flags = item.flags ?? []
  const taint = flags.filter((f) => f.startsWith('taint:')).map((f) => f.split(':')[1])
  if (taint.length) {
    return `Taint: ${taint.map((a) => `\`${a}\``).join(', ')} came from untrusted content. Untrusted data may fill a body, never a recipient, channel or record id.`
  }
  if (flags.includes('invalid_args')) {
    const err = item.preview && typeof item.preview.error === 'string' ? item.preview.error : 'arguments failed validation'
    return `Shadow run failed: ${err}.`
  }
  const untrusted = flags.filter((f) => f.startsWith('untrusted_content:')).map((f) => f.split(':')[1])
  if (item.status === 'pending_approval') {
    if (flags.includes('irreversible')) return 'Irreversible write: a human must approve this exact version.'
    if (untrusted.length) return `Reversible write carrying untrusted ${untrusted.join(', ')}: review before it runs.`
    return 'Policy requires a human decision for this write.'
  }
  if (item.approval_mode === 'policy') {
    if (flags.includes('read_only')) return 'Read-only: performed for real in the shadow run, no side effect.'
    return 'Low-risk reversible write: auto-approved by policy, no prompt needed.'
  }
  if (item.approval_mode === 'human' && item.approved_by) return `Approved by ${item.approved_by} against this args hash.`
  return ''
}

export type GateDecision = 'auto' | 'ask' | 'block' | 'none'

export function gateDecision(item: RunItem): GateDecision {
  if (item.status === 'blocked' || (item.flags ?? []).some((f) => f.startsWith('taint:') || f === 'invalid_args'))
    return 'block'
  if (item.approval_mode === 'policy') return 'auto'
  if (item.decision_required) return 'ask'
  return 'none'
}

interface EventMeta {
  label: string
  tone: Tone
}

const EVENTS: Record<string, EventMeta> = {
  'run.created': { label: 'Shadow run completed', tone: 'info' },
  decision: { label: 'Review submitted', tone: 'info' },
  'item.edited': { label: 'Action edited and re-gated', tone: 'warning' },
  'execution.started': { label: 'Execution started', tone: 'info' },
  'effect.executed': { label: 'Effect executed', tone: 'success' },
  'effect.failed': { label: 'Effect failed', tone: 'danger' },
  'effect.refused': { label: 'Effect refused (hash mismatch)', tone: 'danger' },
  'effect.deduplicated': { label: 'Ledger hit: duplicate prevented', tone: 'info' },
  'execution.replayed': { label: 'Replayed from effect ledger', tone: 'info' },
  'execute.replayed': { label: 'Execute replayed: no new effects', tone: 'info' },
  'run.replayed': { label: 'Replayed from effect ledger', tone: 'info' },
  'run.finalized': { label: 'Verification finished', tone: 'success' },
  'run.verified': { label: 'Verification finished', tone: 'success' },
  'run.compensated': { label: 'Undo completed', tone: 'neutral' },
  'audit.exported': { label: 'Audit packet exported', tone: 'neutral' },
  'demo.reset': { label: 'Demo data reset', tone: 'neutral' },
}

export function eventMeta(type: string, data?: Record<string, unknown> | null): EventMeta {
  const base = EVENTS[type] ?? { label: humanize(type), tone: 'neutral' as Tone }
  if (type === 'decision' && data?.decision === 'reject') return { label: 'Run rejected', tone: 'neutral' }
  if (type === 'run.finalized' && data && data.verified === false) return { label: 'Verification failed', tone: 'danger' }
  return base
}

export function eventDetail(type: string, data?: Record<string, unknown> | null): string {
  if (!data) return ''
  const node = typeof data.node_id === 'string' ? data.node_id : ''
  switch (type) {
    case 'run.created':
      return `${data.actions ?? '?'} action(s) previewed; status ${runStatusMeta(String(data.status)).label.toLowerCase()}`
    case 'decision': {
      const n = Array.isArray(data.approved_hashes) ? data.approved_hashes.length : 0
      return data.decision === 'reject'
        ? `by ${data.reviewer ?? 'reviewer'}`
        : `${data.reviewer ?? 'reviewer'} approved ${n} hash${n === 1 ? '' : 'es'}`
    }
    case 'item.edited':
      return `${node}: ${String(data.old_args_hash ?? '').slice(0, 8)} → ${String(data.new_args_hash ?? '').slice(0, 8)}`
    case 'effect.executed':
    case 'effect.failed':
      return [node, typeof data.tool === 'string' ? data.tool : '', typeof data.error === 'string' ? data.error : '']
        .filter(Boolean)
        .join(' · ')
    case 'execute.replayed':
      return `${data.effects ?? '?'} effect(s) returned from ledger, ${data.new_effects ?? 0} new`
    case 'effect.refused':
    case 'effect.deduplicated':
      return node
    case 'run.finalized':
      return `${runStatusMeta(String(data.status)).label}${data.verified === true ? ' · criteria met' : ''}`
    case 'run.compensated': {
      const c = Array.isArray(data.compensated) ? data.compensated.length : 0
      const nr = Array.isArray(data.not_reversible) ? data.not_reversible.length : 0
      return `${c} undone · ${nr} not reversible`
    }
    default:
      return node
  }
}

/** Who judged the done-criteria: the model, plain deterministic checks, or the deterministic fallback. */
export function judgeLabel(judge?: string | null, model?: string | null): string {
  const j = judge ?? ''
  if (j === 'muse' || /muse/i.test(j)) return MODEL_NAME
  if (j === 'deterministic-fallback') return 'Deterministic fallback'
  if (j === 'deterministic') return 'Deterministic checks'
  if (model && /muse/i.test(model)) return MODEL_NAME
  return 'Deterministic checks'
}
