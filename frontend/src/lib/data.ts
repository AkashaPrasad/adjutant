import { api, isMissingEndpoint } from '../api/client'
import type { ActivityEvent, DayPoint, Effect, Run, Scenario, Stats } from '../api/types'
import { FALLBACK_SCENARIOS } from '../samples'
import { dayKey } from './format'
import { useAsync } from './hooks'

export type Source = 'api' | 'local'

let scenarioCache: { list: Scenario[]; source: Source } | null = null

export async function loadScenarios(): Promise<{ list: Scenario[]; source: Source }> {
  if (scenarioCache) return scenarioCache
  try {
    const list = await api.scenarios()
    if (list.length) {
      scenarioCache = { list, source: 'api' }
      return scenarioCache
    }
  } catch {
    /* fall through: any failure uses the bundled scenarios */
  }
  return { list: FALLBACK_SCENARIOS, source: 'local' }
}

export function useScenarios() {
  return useAsync(loadScenarios, [])
}

export interface DecisionDay {
  day: string
  auto: number
  ask: number
  block: number
}

export interface Dashboard {
  stats: Stats
  week: DayPoint[]
  decisionsByDay: DecisionDay[]
  mix: { auto: number; ask: number; block: number }
  byTool: { tool: string; count: number }[]
  runs: Run[]
  verified: number
  verificationFailed: number
  undone: number
  notReversible: number
  derived: boolean
}

function lastSevenDays(): string[] {
  const out: string[] = []
  const now = new Date()
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(now.getDate() - i)
    out.push(dayKey(d) as string)
  }
  return out
}

/** Stats plus everything the dashboard needs, deriving extended fields when the API predates them. */
export async function loadDashboard(): Promise<Dashboard> {
  const [stats, runs] = await Promise.all([api.stats(), api.listRuns(200)])
  let derived = false

  let week: DayPoint[]
  if (Array.isArray(stats.runs_last_7d) && stats.runs_last_7d.length) {
    const byDay = new Map(stats.runs_last_7d.map((d) => [d.day.slice(0, 10), d]))
    week = lastSevenDays().map((day) => byDay.get(day) ?? { day, runs: 0, prompts_avoided: 0 })
  } else {
    derived = true
    const days = lastSevenDays()
    const acc = new Map(days.map((d) => [d, { day: d, runs: 0, prompts_avoided: 0 }]))
    for (const r of runs) {
      const k = dayKey(r.created_at)
      const slot = k ? acc.get(k) : undefined
      if (slot) {
        slot.runs += 1
        slot.prompts_avoided += r.summary?.auto_approved ?? 0
      }
    }
    week = days.map((d) => acc.get(d) as DayPoint)
  }

  const decisionMap = new Map(lastSevenDays().map((d) => [d, { day: d, auto: 0, ask: 0, block: 0 }]))
  const mixFromRuns = { auto: 0, ask: 0, block: 0 }
  for (const r of runs) {
    const s = r.summary
    if (!s) continue
    const ask = Math.max(0, s.total - s.auto_approved - s.blocked)
    mixFromRuns.auto += s.auto_approved
    mixFromRuns.ask += ask
    mixFromRuns.block += s.blocked
    const k = dayKey(r.created_at)
    const slot = k ? decisionMap.get(k) : undefined
    if (slot) {
      slot.auto += s.auto_approved
      slot.ask += ask
      slot.block += s.blocked
    }
  }
  const decisionsByDay = [...decisionMap.values()]
  const mix = {
    auto: stats.prompts_avoided ?? mixFromRuns.auto,
    ask: stats.approvals_required ?? mixFromRuns.ask,
    block: stats.blocked_items ?? mixFromRuns.block,
  }

  let byToolMap = stats.by_tool
  let ledger: Effect[] | null = null
  if (!byToolMap) {
    derived = true
    ledger = await api.ledger(500).catch(() => [])
    byToolMap = {}
    for (const e of ledger) byToolMap[e.tool] = (byToolMap[e.tool] ?? 0) + 1
  }
  const byTool = Object.entries(byToolMap)
    .map(([tool, count]) => ({ tool, count }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count)

  const statuses = stats.runs_by_status ?? {}
  const verified = stats.verified_runs ?? statuses.completed ?? 0
  const verificationFailed = stats.verification_failed_runs ?? statuses.partially_completed ?? 0
  const undone = stats.effects_compensated ?? stats.undo_by_status?.compensated ?? 0
  const notReversible = stats.undo_by_status?.not_reversible ?? 0

  return { stats, week, decisionsByDay, mix, byTool, runs, verified, verificationFailed, undone, notReversible, derived }
}

/** Activity feed; when GET /v1/activity is missing, synthesize from the runs list. */
export async function loadActivity(limit = 30): Promise<{ events: ActivityEvent[]; source: Source }> {
  try {
    return { events: await api.activity(limit), source: 'api' }
  } catch (err) {
    if (!isMissingEndpoint(err)) throw err
  }
  const runs = await api.listRuns(limit)
  const events: ActivityEvent[] = []
  for (const r of runs) {
    events.push({ id: `${r.id}-c`, run_id: r.id, goal: r.goal, type: 'run.created', at: r.created_at ?? '', data: { status: r.status } })
    if (r.updated_at && r.updated_at !== r.created_at) {
      events.push({ id: `${r.id}-u`, run_id: r.id, goal: r.goal, type: 'run.status', at: r.updated_at, data: { status: r.status } })
    }
  }
  events.sort((a, b) => (a.at < b.at ? 1 : -1))
  return { events: events.slice(0, limit), source: 'local' }
}

export interface BlockedAction {
  run_id: string
  goal: string
  node_id: string
  tool: string
  rule: string
  reason: string
  at?: string
}

/** Most recent blocked actions, read from the runs that currently hold a blocked item. */
export async function loadBlocked(runs: Run[], limit = 8): Promise<BlockedAction[]> {
  const candidates = runs.filter((r) => (r.summary?.blocked ?? 0) > 0).slice(0, 6)
  const details = await Promise.all(candidates.map((r) => api.getRun(r.id).catch(() => null)))
  const out: BlockedAction[] = []
  for (const run of details) {
    if (!run) continue
    for (const item of run.items) {
      if (item.status !== 'blocked') continue
      const flags = item.flags ?? []
      const taint = flags.filter((f) => f.startsWith('taint:')).map((f) => f.slice(6))
      out.push({
        run_id: run.id,
        goal: run.goal,
        node_id: item.node_id,
        tool: item.tool,
        rule: taint.length ? `taint: ${taint.join(', ')}` : flags.includes('invalid_args') ? 'invalid args' : flags.join(', '),
        reason: taint.length
          ? `${taint.join(', ')} came from untrusted content: ${run.goal}`
          : typeof item.preview?.error === 'string'
            ? `${item.preview.error}: ${run.goal}`
            : run.goal,
        at: run.created_at,
      })
    }
  }
  return out.slice(0, limit)
}
