import { API_BASE } from '../config'
import type {
  ActivityEvent,
  AuditBundle,
  AuditVerifyResult,
  CreateRunBody,
  Effect,
  Health,
  Plan,
  Run,
  RunEvent,
  SandboxState,
  Scenario,
  Stats,
  ToolDef,
} from './types'

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

/** True when the endpoint does not exist on this API version (so the UI should fall back). */
export function isMissingEndpoint(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.status === 405)
}

const DEFAULT_TIMEOUT_MS = 20_000

interface RequestOptions extends RequestInit {
  timeoutMs?: number
}

async function request<T>(path: string, init: RequestOptions = {}): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal: outer, ...rest } = init
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort('timeout'), timeoutMs)
  const onOuterAbort = () => controller.abort('cancelled')
  outer?.addEventListener('abort', onOuterAbort)
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (rest.body !== undefined) headers['Content-Type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...rest,
      headers: { ...headers, ...(rest.headers as Record<string, string> | undefined) },
      signal: controller.signal,
    })
  } catch {
    const reason = controller.signal.aborted ? String(controller.signal.reason ?? '') : ''
    if (reason === 'cancelled') throw new ApiError(0, 'cancelled', 'Request cancelled.')
    throw new ApiError(
      0,
      reason === 'timeout' ? 'timeout' : 'network',
      reason === 'timeout'
        ? `The API did not respond within ${Math.round(timeoutMs / 1000)}s.`
        : `Could not reach the API at ${API_BASE}. Check that the backend is running.`,
    )
  } finally {
    window.clearTimeout(timer)
    outer?.removeEventListener('abort', onOuterAbort)
  }

  const text = await res.text()
  let data: unknown = undefined
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }

  if (!res.ok) {
    const envelope = (data && typeof data === 'object' ? data : {}) as {
      error?: { code?: string; message?: string }
      detail?: unknown
    }
    const code = envelope.error?.code || `http_${res.status}`
    let message = envelope.error?.message
    if (!message && envelope.detail) {
      message = typeof envelope.detail === 'string' ? envelope.detail : JSON.stringify(envelope.detail)
    }
    if (!message) message = typeof data === 'string' && data ? data.slice(0, 300) : res.statusText || 'Request failed'
    throw new ApiError(res.status, code, message)
  }
  return data as T
}

const post = <T>(path: string, body?: unknown, timeoutMs?: number, signal?: AbortSignal) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}), timeoutMs, signal })

function asList<T>(data: unknown, keys: string[]): T[] {
  if (Array.isArray(data)) return data as T[]
  if (data && typeof data === 'object') {
    for (const k of keys) {
      const v = (data as Record<string, unknown>)[k]
      if (Array.isArray(v)) return v as T[]
    }
  }
  return []
}

/** Normalize a run payload: the API calls the plan diff `diff`; the UI calls it `items`. */
function asRun(data: unknown): Run {
  if (!data || typeof data !== 'object') throw new ApiError(500, 'bad_response', 'The API returned a malformed run.')
  const obj = data as Record<string, unknown>
  if (obj.run && typeof obj.run === 'object' && !obj.id) return asRun(obj.run)
  if (typeof obj.id !== 'string') throw new ApiError(500, 'bad_response', 'The API returned a run without an id.')
  const items = (Array.isArray(obj.items) ? obj.items : Array.isArray(obj.diff) ? obj.diff : []) as Run['items']
  const effects = (Array.isArray(obj.effects) ? obj.effects : []) as Run['effects']
  const events = Array.isArray(obj.events) ? (obj.events as RunEvent[]) : undefined
  return { ...(obj as unknown as Run), items, effects, events }
}

const enc = encodeURIComponent

export const api = {
  health: () => request<Health>('/health', { timeoutMs: 8_000 }),
  tools: async () => asList<ToolDef>(await request<unknown>('/v1/tools'), ['tools']),
  scenarios: async () => asList<Scenario>(await request<unknown>('/v1/scenarios'), ['scenarios']),
  plan: (goal: string, context: string | undefined, signal?: AbortSignal) =>
    post<Plan>('/v1/plan', context ? { goal, context } : { goal }, 60_000, signal),
  runScenario: async (id: string) => asRun(await post<unknown>(`/v1/scenarios/${enc(id)}/run`, {}, 30_000)),
  createRun: async (body: CreateRunBody) => asRun(await post<unknown>('/v1/runs', body, 60_000)),
  listRuns: async (limit = 50) => asList<Run>(await request<unknown>(`/v1/runs?limit=${limit}`), ['runs']),
  getRun: async (id: string) => asRun(await request<unknown>(`/v1/runs/${enc(id)}`)),
  decide: async (
    id: string,
    body: { decision: 'approve' | 'reject'; reviewer: string; approved_hashes: string[]; note?: string },
  ) => asRun(await post<unknown>(`/v1/runs/${enc(id)}/decision`, body)),
  edit: async (id: string, node_id: string, args: Record<string, unknown>) =>
    asRun(await post<unknown>(`/v1/runs/${enc(id)}/edit`, { node_id, args })),
  execute: async (id: string) => {
    const data = await post<Record<string, unknown>>(`/v1/runs/${enc(id)}/execute`, {}, 60_000)
    return { run: asRun(data), replayed: data?.replayed === true, inProgress: data?.in_progress === true }
  },
  undo: async (id: string) => asRun(await post<unknown>(`/v1/runs/${enc(id)}/undo`, {}, 60_000)),
  audit: (id: string) => request<AuditBundle>(`/v1/runs/${enc(id)}/audit`),
  verifyAudit: (packet: unknown, signature: string) =>
    post<AuditVerifyResult>('/v1/audit/verify', { packet, signature }),
  ledger: async (limit = 200) => asList<Effect>(await request<unknown>(`/v1/ledger?limit=${limit}`), ['effects']),
  stats: () => request<Stats>('/v1/stats'),
  sandbox: () => request<SandboxState>('/v1/sandbox'),
  activity: async (limit = 50) =>
    asList<ActivityEvent>(await request<unknown>(`/v1/activity?limit=${limit}`), ['events', 'activity']),
  resetDemo: (seed = true) => post<{ ok?: boolean; stats?: Stats }>('/v1/demo/reset', { seed }, 30_000),
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error) return err.message
  return String(err)
}

export function errorTitle(err: unknown, fallback = 'Something went wrong'): string {
  if (!(err instanceof ApiError)) return fallback
  switch (err.code) {
    case 'network':
      return 'API unreachable'
    case 'timeout':
      return 'Request timed out'
    case 'stale_approval':
      return 'Approval is stale'
    case 'item_blocked':
      return 'Blocked items cannot be approved'
    case 'not_approved':
      return 'Run is not approved yet'
    case 'invalid_state':
      return 'Not allowed in this state'
    case 'validation_error':
      return 'Invalid request'
    case 'llm_unavailable':
      return 'Planner unavailable'
    case 'llm_error':
      return 'Planner error'
    case 'llm_timeout':
      return 'Planner timed out'
    default:
      return fallback
  }
}
