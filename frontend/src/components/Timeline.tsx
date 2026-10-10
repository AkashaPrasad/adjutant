import { Check, Circle, Minus, X } from 'lucide-react'
import type { Run } from '../api/types'

type StepState = 'done' | 'current' | 'pending' | 'failed' | 'warn' | 'skipped'
interface Step {
  key: string
  label: string
  detail: string
  state: StepState
}

export function computeSteps(run: Run): Step[] {
  const s = (run.status || '').toLowerCase()
  const v = run.verification
  const executedStates = ['completed', 'failed', 'partially_completed', 'compensated']

  const approval: Step =
    s === 'awaiting_approval'
      ? { key: 'approve', label: 'Approval', detail: 'Waiting for a reviewer', state: 'current' }
      : s === 'blocked'
        ? { key: 'approve', label: 'Approval', detail: 'Blocked by policy', state: 'failed' }
        : s === 'rejected'
          ? { key: 'approve', label: 'Approval', detail: 'Rejected by reviewer', state: 'failed' }
          : { key: 'approve', label: 'Approval', detail: 'Approved', state: 'done' }

  let execute: Step = { key: 'execute', label: 'Execute', detail: 'Not started', state: 'pending' }
  if (s === 'approved') execute = { key: 'execute', label: 'Execute', detail: 'Ready to execute', state: 'current' }
  else if (s === 'completed') execute = { key: 'execute', label: 'Execute', detail: 'Executed once', state: 'done' }
  else if (s === 'partially_completed')
    execute = { key: 'execute', label: 'Execute', detail: 'Partially completed', state: 'warn' }
  else if (s === 'failed') execute = { key: 'execute', label: 'Execute', detail: 'Failed', state: 'failed' }
  else if (s === 'compensated') execute = { key: 'execute', label: 'Execute', detail: 'Executed', state: 'done' }
  else if (s === 'rejected' || s === 'blocked')
    execute = { key: 'execute', label: 'Execute', detail: 'Skipped', state: 'skipped' }

  let verify: Step = { key: 'verify', label: 'Verify', detail: 'Pending', state: 'pending' }
  if (v && v.passed === true) verify = { key: 'verify', label: 'Verify', detail: 'Verified', state: 'done' }
  else if (v && v.passed === false) verify = { key: 'verify', label: 'Verify', detail: 'Not verified', state: 'failed' }
  else if (executedStates.includes(s)) verify = { key: 'verify', label: 'Verify', detail: 'No result yet', state: 'current' }
  else if (s === 'rejected' || s === 'blocked') verify = { ...verify, detail: 'Skipped', state: 'skipped' }

  const steps: Step[] = [
    { key: 'preview', label: 'Shadow run', detail: `${run.items?.length ?? 0} items previewed`, state: 'done' },
    approval,
    execute,
    verify,
  ]
  if (s === 'compensated') steps.push({ key: 'undo', label: 'Undo', detail: 'Compensated newest-first', state: 'done' })
  return steps
}

const ICON: Record<StepState, typeof Check> = {
  done: Check,
  current: Circle,
  pending: Circle,
  failed: X,
  warn: Minus,
  skipped: Minus,
}

export function Timeline({ run }: { run: Run }) {
  const steps = computeSteps(run)
  return (
    <ol className="timeline" aria-label="Run progress">
      {steps.map((step) => {
        const Icon = ICON[step.state]
        return (
          <li key={step.key} className={`tl-step tl-${step.state}`} aria-current={step.state === 'current' ? 'step' : undefined}>
            <span className="tl-icon" aria-hidden="true">
              <Icon size={12} strokeWidth={3} />
            </span>
            <span className="tl-text">
              <span className="tl-label">{step.label}</span>
              <span className="tl-detail">{step.detail}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}
