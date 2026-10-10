import { API_BASE } from '../config'
import type {
  AuditPacket,
  CreateRunBody,
  Effect,
  Health,
  Plan,
  Run,
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

const DEFAULT_TIMEOUT_MS = 20_000

async function request<T>(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (rest.body !== undefined) headers['Content-Type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...rest,
      headers: { ...headers, ...(rest.headers as Record<string, string> | undefined) },
      signal: controller.signal,
    })
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === 'AbortError'
    throw new ApiError(
      0,
      aborted ? 'timeout' : 'network',
      aborted
        ? `The API did not respond within ${Math.round(timeoutMs / 1000)}s.`
        : `Could not reach the API at ${API_BASE}.`,
    )
  } finally {
    window.clearTimeout(timer)
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

const post = <T>(path: string, body?: unknown, timeoutMs?: number) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}), timeoutMs })

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

function asRun(data: unknown): Run | null {
  if (!data || typeof data !== 'object') return null
  const obj = data as Record<string, unknown>
  if (typeof obj.id === 'string' || typeof obj.id === 'number')
    return { ...obj, id: String(obj.id), items: (obj.items ?? obj.diff) as Run['items'] } as Run
  if (obj.run && typeof obj.run === 'object') return asRun(obj.run)
  return null
}

export const api = {
  health: () => request<Health>('/health', { timeoutMs: 8_000 }),
  tools: async () => asList<ToolDef>(await request<unknown>('/v1/tools'), ['tools', 'items', 'data']),
  plan: (goal: string) => post<Plan>('/v1/plan', { goal }, 90_000),
  createRun: async (body: CreateRunBody) => {
    const data = await post<unknown>('/v1/runs', body, 60_000)
    const run = asRun(data)
    if (!run) throw new ApiError(500, 'bad_response', 'The API returned a run without an id.')
    return run
  },
  listRuns: async (limit = 50) =>
    asList<Run>(await request<unknown>(`/v1/runs?limit=${limit}`), ['runs', 'items', 'data']).map(
      (r): Run => asRun(r) ?? { ...r, id: String(r.id) },
    ),
  getRun: async (id: string) => {
    const run = asRun(await request<unknown>(`/v1/runs/${encodeURIComponent(id)}`))
    if (!run) throw new ApiError(500, 'bad_response', 'The API returned a malformed run.')
    return run
  },
  decide: (
    id: string,
    body: { decision: 'approve' | 'reject'; reviewer: string; approved_hashes: string[]; note?: string },
  ) => post<unknown>(`/v1/runs/${encodeURIComponent(id)}/decision`, body).then(asRun),
  edit: (id: string, node_id: string, args: Record<string, unknown>) =>
    post<unknown>(`/v1/runs/${encodeURIComponent(id)}/edit`, { node_id, args }).then(asRun),
  execute: (id: string) => post<unknown>(`/v1/runs/${encodeURIComponent(id)}/execute`, {}, 120_000).then(asRun),
  undo: (id: string) => post<unknown>(`/v1/runs/${encodeURIComponent(id)}/undo`, {}, 120_000).then(asRun),
  audit: (id: string) => request<AuditPacket>(`/v1/runs/${encodeURIComponent(id)}/audit`),
  ledger: async (limit = 100) =>
    asList<Effect>(await request<unknown>(`/v1/ledger?limit=${limit}`), ['effects', 'entries', 'items', 'ledger', 'data']),
  stats: () => request<Stats>('/v1/stats'),
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error) return err.message
  return String(err)
}
