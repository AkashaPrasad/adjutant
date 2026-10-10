export type ArgSource = 'user' | 'untrusted'
export type Risk = 'low' | 'medium' | 'high'

export type RunStatus =
  | 'awaiting_approval'
  | 'blocked'
  | 'approved'
  | 'completed'
  | 'failed'
  | 'partially_completed'
  | 'compensated'
  | 'rejected'
  | (string & {})

export interface Health {
  status?: string
  service?: string
  version?: string
  commit?: string
  deployed_at?: string
  env?: string
  model?: string
  llm_configured?: boolean
}

export interface ToolDef {
  name: string
  description?: string
  kind?: 'read' | 'write' | (string & {})
  reversible?: boolean
  sensitive_args?: string[]
}

export interface PlannedAction {
  node_id: string
  tool: string
  args: Record<string, unknown>
  arg_sources?: Record<string, ArgSource>
}

export interface Plan {
  actions: PlannedAction[]
  done_criteria?: string[]
}

export interface CreateRunBody {
  goal: string
  actions: PlannedAction[]
  done_criteria?: string[]
  auto_approve_low_risk?: boolean
}

export interface RunItem {
  node_id: string
  tool: string
  args?: Record<string, unknown>
  arg_sources?: Record<string, ArgSource>
  args_hash?: string
  preview?: unknown
  risk?: Risk | (string & {})
  decision_required?: boolean
  flags?: unknown[]
  status?: string
  [key: string]: unknown
}

export interface Effect {
  id?: string | number
  run_id?: string
  node_id?: string
  tool?: string
  status?: string
  idempotency_key?: string
  args_hash?: string
  external_id?: string
  result?: unknown
  compensation?: unknown
  created_at?: string
  [key: string]: unknown
}

export interface Verification {
  passed?: boolean | null
  details?: unknown
  [key: string]: unknown
}

export interface Run {
  id: string
  goal?: string
  status?: RunStatus
  created_at?: string
  updated_at?: string
  items?: RunItem[]
  effects?: Effect[]
  verification?: Verification | null
  done_criteria?: string[]
  events?: unknown[]
  [key: string]: unknown
}

export interface AuditPacket {
  packet: unknown
  signature?: string
  algorithm?: string
  [key: string]: unknown
}

export type Stats = Record<string, unknown>
