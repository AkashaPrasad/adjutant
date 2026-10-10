export type ArgSource = 'user' | 'untrusted'
export type Risk = 'low' | 'medium' | 'high'

export type RunStatus =
  | 'awaiting_approval'
  | 'blocked'
  | 'approved'
  | 'executing'
  | 'completed'
  | 'partially_completed'
  | 'failed'
  | 'compensated'
  | 'rejected'
  | (string & {})

export type ItemStatus =
  | 'pending_approval'
  | 'auto_approved'
  | 'blocked'
  | 'approved'
  | 'declined'
  | 'rejected'
  | 'executed'
  | 'failed'
  | 'skipped'
  | 'compensated'
  | (string & {})

export interface Health {
  status?: string
  service?: string
  version?: string
  commit?: string
  deployed_at?: string | null
  env?: string
  model?: string
  llm_configured?: boolean
}

export interface ToolArgDef {
  name: string
  type: string
  required?: boolean
  description?: string
}

export interface ToolDef {
  name: string
  description?: string
  kind?: 'read' | 'write' | (string & {})
  reversible?: boolean
  sensitive_args?: string[]
  args?: ToolArgDef[]
}

export interface PlannedAction {
  node_id: string
  tool: string
  args: Record<string, unknown>
  arg_sources?: Record<string, ArgSource>
}

export interface Plan {
  goal?: string
  model?: string
  actions: PlannedAction[]
  done_criteria?: string[]
  dropped?: { node_id?: string; tool?: string; reason?: string }[]
  notes?: string
  taint_propagated?: (string | { node_id?: string; arg?: string; value?: string; reason?: string })[]
  latency_ms?: number
  reasoning_effort?: string
}

export type ScenarioMode = 'approval' | 'taint_block' | 'auto' | 'false_done' | 'exactly_once' | (string & {})

export interface Scenario {
  id: string
  title: string
  tagline?: string
  description?: string
  pain_point?: string
  expected_outcome?: string
  goal: string
  context?: string | null
  actions: PlannedAction[]
  done_criteria: string[]
  auto_approve_low_risk?: boolean
  mode?: ScenarioMode
  agent_claim?: string
}

export interface CreateRunBody {
  goal: string
  actions: PlannedAction[]
  done_criteria: string[]
  auto_approve_low_risk: boolean
}

export interface RunItem {
  node_id: string
  seq?: number
  tool: string
  kind?: string | null
  reversible?: boolean | null
  args: Record<string, unknown>
  arg_sources?: Record<string, ArgSource>
  args_hash: string
  preview?: Record<string, unknown> | null
  risk?: Risk | (string & {})
  decision_required?: boolean
  flags?: string[]
  status: ItemStatus
  approved_hash?: string | null
  approved_by?: string | null
  approval_mode?: 'policy' | 'human' | null | (string & {})
}

export interface Effect {
  id: number | string
  run_id: string
  node_id: string
  tool: string
  args_hash: string
  args?: Record<string, unknown>
  status: string
  result?: Record<string, unknown> | null
  error?: string | null
  verified?: boolean | null
  undo_status?: string | null
  undo_result?: Record<string, unknown> | null
  created_at?: string
  undone_at?: string | null
  goal?: string
  reversible?: boolean | null
  compensation?: Record<string, unknown> | null
}

export interface CriterionResult {
  criterion: string
  met: boolean
  evidence?: string
  judge?: string
  method?: string
}

export interface Verification {
  method?: 'muse' | 'deterministic' | (string & {})
  judge?: 'muse' | 'deterministic' | 'deterministic-fallback' | (string & {})
  model?: string
  criteria_met?: number
  criteria_total?: number
  judge_latency_ms?: number
  passed?: boolean
  effects_verified?: boolean
  checks?: { node_id: string; tool: string; status: string; verified: boolean }[]
  criteria?: CriterionResult[]
  verified_at?: string
  note?: string
}

export interface RunEvent {
  id?: number | string
  type: string
  at?: string
  created_at?: string
  data?: Record<string, unknown> | null
}

export interface RunSummary {
  total: number
  auto_approved: number
  needs_approval: number
  blocked: number
}

export interface Run {
  id: string
  goal: string
  status: RunStatus
  auto_approve_low_risk?: boolean
  done_criteria?: string[]
  created_at?: string
  updated_at?: string
  summary?: RunSummary
  items: RunItem[]
  decision?: {
    decision: string
    reviewer: string
    approved_hashes?: string[]
    note?: string | null
    decided_at?: string
  } | null
  verification?: Verification | null
  undo?: { compensated?: string[]; not_reversible?: string[]; failed?: string[]; undone_at?: string } | null
  effects: Effect[]
  events?: RunEvent[]
  replayed?: boolean
  in_progress?: boolean
}

export interface AuditBundle {
  packet: Record<string, unknown>
  signature: string
  algorithm?: string
  key_id?: string
}

export interface AuditVerifyResult {
  valid: boolean
  algorithm?: string
  key_id?: string
}

export interface ActivityEvent {
  id: number | string
  run_id: string
  goal?: string
  type: string
  at: string
  data?: Record<string, unknown> | null
}

export interface DayPoint {
  day: string
  runs: number
  prompts_avoided: number
}

export interface Stats {
  runs_total?: number
  runs_by_status?: Record<string, number>
  effects_total?: number
  effects_by_status?: Record<string, number>
  undo_by_status?: Record<string, number>
  actions_total?: number
  prompts_avoided?: number
  approvals_required?: number
  human_approvals?: number
  taint_blocks?: number
  blocked_items?: number
  verified_runs?: number
  verification_failed_runs?: number
  effects_compensated?: number
  avg_actions_per_run?: number
  runs_last_7d?: DayPoint[]
  by_tool?: Record<string, number>
}

export interface SandboxObject {
  kind: string
  id: string
  data: Record<string, unknown>
  status: string
  created_at?: string
  updated_at?: string
}

export type SandboxState = Record<string, SandboxObject[]>
