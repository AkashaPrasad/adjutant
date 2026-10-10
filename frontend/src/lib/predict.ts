import { ApiError, api } from '../api/client'
import type { PlannedAction, Run, Scenario } from '../api/types'

export type Predicted = 'auto' | 'ask' | 'block'

const SENSITIVE: Record<string, string[]> = {
  'email.send': ['to', 'cc'],
  'slack.post': ['channel'],
  'crm.update': ['record_id'],
  'calendar.create_event': ['attendees'],
  'http.get': ['url'],
}
const READS = new Set(['http.get', 'docs.search'])
const IRREVERSIBLE = new Set(['email.send'])

/**
 * Mirror of the backend's deterministic policy (backend/app/policy.py), used only to draw the
 * scenario decision strip before a run exists. The shadow run remains the source of truth.
 */
export function predictDecision(a: PlannedAction, autoLow: boolean, crmIds?: Set<string>): Predicted {
  if (!(a.tool in SENSITIVE) && !READS.has(a.tool)) return 'block'
  if (a.tool === 'crm.update' && crmIds && crmIds.size && !crmIds.has(String(a.args.record_id))) return 'block'
  const src = a.arg_sources ?? {}
  if ((SENSITIVE[a.tool] ?? []).some((k) => k in a.args && src[k] === 'untrusted')) return 'block'
  if (READS.has(a.tool)) return 'auto'
  if (IRREVERSIBLE.has(a.tool)) return 'ask'
  if (Object.keys(a.args).some((k) => src[k] === 'untrusted')) return 'ask'
  return autoLow ? 'auto' : 'ask'
}

/** One-click path: POST /v1/scenarios/{id}/run, falling back to POST /v1/runs on older APIs. */
export async function startScenario(s: Scenario): Promise<Run> {
  try {
    return await api.runScenario(s.id)
  } catch (err) {
    if (!(err instanceof ApiError && (err.status === 404 || err.status === 405))) throw err
    return api.createRun({
      goal: s.goal,
      actions: s.actions,
      done_criteria: s.done_criteria,
      auto_approve_low_risk: s.auto_approve_low_risk ?? true,
    })
  }
}
