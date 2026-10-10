import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, api, errorMessage } from '../api/client'
import type { AuditBundle, AuditVerifyResult, Run, RunEvent, RunItem } from '../api/types'
import { Timeline } from '../components/Activity'
import { DecisionBadge, ItemStatusChip, RiskText, SourceBadge, StatusChip } from '../components/Badge'
import { EffectsTable, UndoCell } from '../components/EffectsTable'
import { JsonView } from '../components/JsonView'
import { PreviewView } from '../components/Preview'
import { ConfirmDialog } from '../components/Shell'
import { useToast } from '../components/Toast'
import {
  Badge,
  Callout,
  EmptyState,
  ErrorState,
  Hash,
  Kbd,
  KeyValue,
  Mono,
  PageHeader,
  Panel,
  Skeleton,
  Spinner,
  cx,
  toolSystem,
  truncateMiddle,
} from '../components/ui'
import { MODEL_NAME } from '../config'
import { downloadJson, formatDateTime, inlineValue, plural, relativeTime } from '../lib/format'
import { useAsync, useDocumentTitle, useElapsed, useLocalStorage } from '../lib/hooks'
import { decisionReason, flagMeta, gateDecision, judgeLabel, runStatusMeta } from '../lib/labels'
import { linkHandler } from '../lib/router'
import { runCache } from '../lib/runCache'
import { useScenarios } from '../lib/data'
import { tamperPacket } from '../lib/audit'

const REVIEW = new Set(['awaiting_approval', 'blocked'])
const PRE_EXEC = new Set(['awaiting_approval', 'blocked', 'approved'])
const FINISHED = new Set(['completed', 'partially_completed', 'failed'])
const DONE_EXEC = new Set(['completed', 'partially_completed', 'failed', 'compensated'])

type Staged = Record<string, 'approve' | 'reject'>
type Busy = null | 'submit' | 'reject' | 'execute' | 'undo' | 'edit' | 'audit' | 'verify'

const stageKey = (it: RunItem) => `${it.node_id}:${it.args_hash}`

function sortForReview(items: RunItem[]): RunItem[] {
  const rank = (it: RunItem) => {
    const d = gateDecision(it)
    if (it.status === 'pending_approval') return 0
    if (d === 'block') return 1
    return 2
  }
  return [...items].sort((a, b) => rank(a) - rank(b) || (a.seq ?? 0) - (b.seq ?? 0))
}

/* ------------------------------------------------------------------------------------------ */

type StepState = 'done' | 'current' | 'failed' | 'todo'

function steps(run: Run, auditValid: boolean | null): { label: string; state: StepState; hint: string }[] {
  const s = run.status
  const review: StepState = REVIEW.has(s) ? 'current' : s === 'rejected' ? 'failed' : 'done'
  const exec: StepState =
    s === 'approved' || s === 'executing' ? 'current' : s === 'failed' ? 'failed' : DONE_EXEC.has(s) ? 'done' : 'todo'
  const v = run.verification
  const verify: StepState = v ? (v.passed ? 'done' : 'failed') : 'todo'
  const audit: StepState = auditValid === true ? 'done' : auditValid === false ? 'failed' : DONE_EXEC.has(s) || s === 'rejected' ? 'current' : 'todo'
  return [
    { label: 'Shadow run', state: 'done', hint: 'Reads real, writes previewed' },
    { label: 'Review', state: review, hint: s === 'rejected' ? 'Rejected' : 'One batched decision' },
    { label: 'Execute', state: exec, hint: s === 'executing' ? 'In progress' : 'Exactly once via the ledger' },
    { label: 'Verify', state: verify, hint: v ? (v.passed ? 'Done-criteria met' : 'Criteria not met') : 'Judged on real outputs' },
    { label: 'Audit', state: audit, hint: auditValid === true ? 'Signature valid' : auditValid === false ? 'Signature invalid' : 'Signed packet' },
  ]
}

function Stepper({ run, auditValid }: { run: Run; auditValid: boolean | null }) {
  return (
    <ol className="stepper" aria-label="Run progress">
      {steps(run, auditValid).map((st, i) => (
        <li key={st.label} className={cx('step', `is-${st.state}`)} aria-current={st.state === 'current' ? 'step' : undefined}>
          <span className="step-num" aria-hidden="true">
            {st.state === 'done' ? '✓' : st.state === 'failed' ? '✕' : i + 1}
          </span>
          <span className="step-text">
            <span className="step-label">{st.label}</span>
            <span className="step-hint">{st.hint}</span>
          </span>
          <span className="sr-only">{st.state}</span>
        </li>
      ))}
    </ol>
  )
}

/* ------------------------------------------------------------------------------------------ */

export function RunReview({ id }: { id: string }) {
  const toast = useToast()
  const [pollMs, setPollMs] = useState<number | undefined>(undefined)
  const runQ = useAsync(() => api.getRun(id), [id], pollMs)
  const run = runQ.data ?? runCache.get(id)
  useDocumentTitle(run ? `Run ${truncateMiddle(run.id, 10, 4)}` : 'Run')
  const status = run?.status ?? ''

  useEffect(() => setPollMs(status === 'executing' ? 2000 : undefined), [status])

  // Events: from the run payload when the API includes them, else from the audit trail.
  const needEvents = !!run && !Array.isArray(run.events)
  const eventsKey = run ? `${run.updated_at}:${run.status}:${run.effects.length}` : ''
  const eventsQ = useAsync<RunEvent[]>(
    async () => (needEvents ? ((await api.audit(id)).packet.events as RunEvent[]) ?? [] : []),
    [id, needEvents, eventsKey],
  )
  const events = run?.events ?? eventsQ.data ?? []

  const scenariosQ = useScenarios()
  const scenario = run ? scenariosQ.data?.list.find((sc) => sc.goal === run.goal) : undefined
  const [reviewer, setReviewer] = useLocalStorage('adjutant.reviewer', 'operator')
  const [staged, setStaged] = useState<Staged>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [prevHash, setPrevHash] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<Busy>(null)
  const [actionError, setActionError] = useState<unknown>(null)
  const [confirm, setConfirm] = useState<null | 'reject' | 'undo'>(null)
  const [replay, setReplay] = useState<{ before: number; after: number; at: string } | null>(null)
  const [executions, setExecutions] = useState(0)
  const [audit, setAudit] = useState<AuditBundle | null>(null)
  const [auditResult, setAuditResult] = useState<(AuditVerifyResult & { tampered: boolean }) | null>(null)
  const [tamper, setTamper] = useState(false)
  const execElapsed = useElapsed(busy === 'execute')
  const auditRef = useRef<HTMLDivElement>(null)

  const items = useMemo(() => run?.items ?? [], [run])
  const inReview = REVIEW.has(status)
  const ordered = useMemo(() => (inReview ? sortForReview(items) : [...items].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))), [items, inReview])
  const selected = ordered.find((i) => i.node_id === selectedId) ?? ordered[0]

  // Drop staged decisions whose hash no longer exists (an edit re-gated the item).
  const hashSig = items.map(stageKey).join('|')
  useEffect(() => {
    setStaged((prev) => {
      const valid = new Set(hashSig.split('|'))
      const next: Staged = {}
      for (const [k, v] of Object.entries(prev)) if (valid.has(k)) next[k] = v
      return next
    })
  }, [hashSig])

  const apply = useCallback(
    (r: Run) => {
      runQ.setData(r)
      runCache.set(r.id, r)
    },
    [runQ],
  )

  const perform = async (kind: Exclude<Busy, null>, fn: () => Promise<void>) => {
    setBusy(kind)
    setActionError(null)
    try {
      await fn()
      return true
    } catch (err) {
      setActionError(err)
      toast.push('error', `${kind === 'submit' ? 'Review' : kind.charAt(0).toUpperCase() + kind.slice(1)} failed`, errorMessage(err))
      if (err instanceof ApiError && err.status === 409) void runQ.reload()
      return false
    } finally {
      setBusy(null)
    }
  }

  const pending = items.filter((i) => i.status === 'pending_approval')
  const blocked = items.filter((i) => i.status === 'blocked')
  const stagedApprove = pending.filter((i) => staged[stageKey(i)] === 'approve')
  const stagedReject = pending.filter((i) => staged[stageKey(i)] === 'reject')
  const unstaged = pending.filter((i) => !staged[stageKey(i)])
  const reviewerName = reviewer.trim() || 'operator'

  const stage = useCallback(
    (it: RunItem, v: 'approve' | 'reject') => {
      if (it.status !== 'pending_approval') return
      setStaged((p) => ({ ...p, [stageKey(it)]: v }))
      const next = sortForReview(items).find((x) => x.status === 'pending_approval' && x.node_id !== it.node_id && !staged[stageKey(x)])
      if (next) setSelectedId(next.node_id)
    },
    [items, staged],
  )

  const submit = (approvedHashes: string[], label: string) =>
    perform('submit', async () => {
      const r = await api.decide(id, { decision: 'approve', reviewer: reviewerName, approved_hashes: approvedHashes })
      apply(r)
      setStaged({})
      toast.push('success', label, `${plural(approvedHashes.length, 'action')} approved by ${reviewerName}, bound to their args hashes. Status: ${runStatusMeta(r.status).label}.`)
    })

  const rejectRun = () =>
    perform('reject', async () => {
      const r = await api.decide(id, { decision: 'reject', reviewer: reviewerName, approved_hashes: [] })
      apply(r)
      setConfirm(null)
      toast.push('success', 'Run rejected', 'Nothing was executed.')
    })

  const execute = () =>
    perform('execute', async () => {
      const before = run?.effects.length ?? 0
      const { run: r, replayed, inProgress } = await api.execute(id)
      apply(r)
      setExecutions((n) => n + 1)
      if (inProgress && !replayed) {
        toast.push('info', 'Execution in progress', 'The first execute call is still verifying. Nothing new was started.')
      } else if (replayed) {
        setReplay({ before, after: r.effects.length, at: new Date().toISOString() })
        toast.push('info', 'Replayed from effect ledger: no duplicate side effects', `${r.effects.length} effect(s) in the ledger before and after. Nothing was sent twice.`)
      } else {
        setReplay(null)
        const v = r.verification
        const ok = v?.passed
        const score = v?.criteria_total ? ` ${v.criteria_met ?? 0}/${v.criteria_total} criteria met.` : ''
        toast.push(
          ok ? 'success' : 'info',
          ok ? 'Executed and verified' : 'Executed: done claim not verified',
          `${plural(r.effects.filter((e) => e.status === 'executed').length, 'effect')} executed once.${score} Judge: ${judgeLabel(v?.judge ?? v?.method, v?.model)}.`,
        )
      }
    })

  const undo = () =>
    perform('undo', async () => {
      const r = await api.undo(id)
      apply(r)
      setReplay(null)
      setConfirm(null)
      const u = r.undo
      toast.push(
        'success',
        'Undo complete',
        `${u?.compensated?.length ?? 0} effect(s) compensated newest first; ${u?.not_reversible?.length ?? 0} cannot be undone.`,
      )
    })

  const saveEdit = (it: RunItem, args: Record<string, unknown>) =>
    perform('edit', async () => {
      const r = await api.edit(id, it.node_id, args)
      const updated = r.items.find((x) => x.node_id === it.node_id)
      apply(r)
      setEditing(false)
      if (updated && updated.args_hash !== it.args_hash) {
        setPrevHash((p) => ({ ...p, [it.node_id]: it.args_hash }))
        toast.push(
          'info',
          'Edited and re-gated',
          `Args hash ${it.args_hash.slice(0, 8)} → ${updated.args_hash.slice(0, 8)}. Any approval of the old version no longer applies. New decision: ${gateDecision(updated) === 'auto' ? 'Auto' : gateDecision(updated) === 'block' ? 'Blocked' : 'Needs approval'}.`,
        )
      } else {
        toast.push('info', 'No change', 'The arguments are identical, so the hash and decision are unchanged.')
      }
    })

  const loadAudit = () =>
    perform('audit', async () => {
      const a = await api.audit(id)
      setAudit(a)
      setAuditResult(null)
      setTamper(false)
      toast.push('success', 'Audit packet generated', `Signed with ${a.algorithm ?? 'HMAC-SHA256'}, key ${a.key_id ?? 'unknown'}.`)
      window.setTimeout(() => auditRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
    })

  const tampered = useMemo(() => (audit ? tamperPacket(audit.packet) : null), [audit])

  const verifyAudit = () =>
    perform('verify', async () => {
      if (!audit) return
      const packet = tamper && tampered ? tampered.packet : audit.packet
      const res = await api.verifyAudit(packet, audit.signature)
      setAuditResult({ ...res, tampered: tamper })
      toast.push(
        res.valid ? 'success' : 'error',
        res.valid ? 'Signature valid' : 'Signature invalid',
        res.valid ? 'The packet is exactly what the gate signed.' : tamper ? `One byte changed (${tampered?.path}); the HMAC no longer matches.` : 'The packet does not match its signature.',
      )
    })

  // Keyboard: j/k select, a/r stage, e edit.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest('input,textarea,select,[contenteditable]')) return
      if (!selected) return
      const idx = ordered.findIndex((i) => i.node_id === selected.node_id)
      if (e.key === 'j') setSelectedId(ordered[Math.min(ordered.length - 1, idx + 1)]?.node_id ?? null)
      else if (e.key === 'k') setSelectedId(ordered[Math.max(0, idx - 1)]?.node_id ?? null)
      else if (e.key === 'a' && inReview) stage(selected, 'approve')
      else if (e.key === 'r' && inReview) stage(selected, 'reject')
      else if (e.key === 'e' && PRE_EXEC.has(status)) setEditing(true)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ordered, selected, inReview, stage, status])

  if (!run) {
    if (runQ.error) {
      const notFound = runQ.error instanceof ApiError && runQ.error.status === 404
      return (
        <div className="page">
          <PageHeader crumbs={[{ label: 'Runs', href: '/runs' }, { label: id }]} title="Run" />
          {notFound ? (
            <EmptyState
              title="Run not found"
              action={
                <a href="/runs" className="btn" onClick={linkHandler('/runs')}>
                  View all runs
                </a>
              }
            >
              No run with id {id} exists on this API. It may have been cleared by a demo reset.
            </EmptyState>
          ) : (
            <ErrorState error={runQ.error} onRetry={() => void runQ.reload()} title="Could not load this run" />
          )}
        </div>
      )
    }
    return (
      <div className="page">
        <PageHeader crumbs={[{ label: 'Runs', href: '/runs' }, { label: id }]} title="Loading run…" />
        <Skeleton rows={2} height={48} />
        <div className="review-grid">
          <Skeleton rows={6} height={48} />
          <Skeleton rows={10} />
        </div>
      </div>
    )
  }

  const meta = runStatusMeta(status)
  const finished = FINISHED.has(status)
  const executed = DONE_EXEC.has(status)
  const editable = PRE_EXEC.has(status)

  const next = nextStep(run, pending.length, blocked.length)

  return (
    <div className="page page-review">
      <PageHeader
        crumbs={[{ label: 'Runs', href: '/runs' }, { label: truncateMiddle(run.id, 10, 4) }]}
        title={<span className="title-clamp" title={run.goal}>{run.goal}</span>}
        meta={
          <>
            <StatusChip status={status} />
            <Mono value={run.id} copy />
            <span className="muted" title={formatDateTime(run.created_at)}>
              Started {relativeTime(run.created_at)}
            </span>
            {run.decision && (
              <span className="muted">
                {run.decision.decision === 'reject' ? 'Rejected' : 'Reviewed'} by {run.decision.reviewer}
              </span>
            )}
            {runQ.loading && !runQ.initialLoading && <span className="muted small">Refreshing…</span>}
          </>
        }
        actions={
          <button type="button" className="btn" onClick={() => void loadAudit()} disabled={busy === 'audit'}>
            {audit ? 'Regenerate audit packet' : 'Audit packet'}
          </button>
        }
      />

      <Stepper run={run} auditValid={auditResult ? auditResult.valid : null} />

      <div className={cx('next-step', `tone-${next.tone}`)} role="status" aria-live="polite">
        <span className={cx('status-dot', `tone-${next.tone}`)} aria-hidden="true" />
        <div>
          <strong>{next.title}</strong> <span className="next-step-body">{next.body}</span>
        </div>
      </div>

      {replay && (
        <Callout tone="info" title="Replayed from effect ledger: no duplicate side effects">
          The second execute call hit the ledger key (run, node, args hash) and returned the stored result. Effects in the ledger:{' '}
          <strong>{replay.before}</strong> before, <strong>{replay.after}</strong> after. Check Systems: the outbox still holds one copy.
        </Callout>
      )}
      {actionError != null && <ErrorState error={actionError} title="The last action failed" />}

      <div className="review-grid">
        <section className="panel action-list" aria-label="Proposed actions">
          <div className="panel-head panel-head-ruled">
            <div className="panel-head-text">
              <h2 className="panel-title">Proposed actions</h2>
              <div className="panel-subtitle">
                {items.length} total · {run.summary?.auto_approved ?? 0} auto · {pending.length} waiting · {blocked.length} blocked
              </div>
            </div>
          </div>
          <ul className="alist" role="listbox" aria-label="Actions">
            {ordered.map((it) => {
              const sel = selected?.node_id === it.node_id
              const summary = typeof it.preview?.summary === 'string' ? it.preview.summary : inlineValue(it.args)
              return (
                <li key={it.node_id} role="option" aria-selected={sel}>
                  <button type="button" className={cx('alist-row', sel && 'is-selected')} onClick={() => setSelectedId(it.node_id)}>
                    <span className="alist-line1">
                      <span className="mono alist-tool">
                        <span className="alist-seq">{(it.seq ?? 0) + 1}</span>
                        {it.tool}
                      </span>
                      <DecisionBadge item={it} staged={staged[stageKey(it)]} />
                    </span>
                    <span className="alist-line2">
                      <span className="alist-summary">{summary}</span>
                      <RiskText risk={it.risk} />
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>

        {selected && (
          <ActionDetail
            key={selected.node_id}
            item={selected}
            run={run}
            editing={editing}
            editable={editable}
            busy={busy}
            staged={staged[stageKey(selected)]}
            previousHash={prevHash[selected.node_id]}
            onEdit={() => setEditing(true)}
            onCancelEdit={() => setEditing(false)}
            onSave={(args) => void saveEdit(selected, args)}
            onStage={(v) => stage(selected, v)}
          />
        )}

        <aside className="review-aside">
          <Panel title="Timeline" bodyClassName="panel-scroll">
            {events.length ? (
              <Timeline events={events} />
            ) : eventsQ.initialLoading ? (
              <Skeleton rows={5} />
            ) : (
              <p className="muted">No events recorded.</p>
            )}
          </Panel>
          <Panel title="Policy">
            <KeyValue
              rows={[
                ['Auto-approve low risk', run.auto_approve_low_risk ? 'On' : 'Off'],
                ['Reviewer', run.decision?.reviewer ?? '—'],
                ['Decided', run.decision?.decided_at ? formatDateTime(run.decision.decided_at) : '—'],
                ['Planner and judge', MODEL_NAME],
              ]}
            />
          </Panel>
        </aside>
      </div>

      {(run.verification || executed) && <VerificationPanel run={run} agentClaim={scenario?.agent_claim} />}

      {run.effects.length > 0 && (
        <Panel
          title="Effects"
          subtitle="Written to the effect ledger exactly once, keyed on (run, node, args hash). Undo compensates newest first."
          flush
          actions={
            run.undo ? (
              <span className="muted small">
                Undo: {run.undo.compensated?.length ?? 0} compensated · {run.undo.not_reversible?.length ?? 0} not reversible
                {run.undo.failed?.length ? ` · ${run.undo.failed.length} failed` : ''}
              </span>
            ) : undefined
          }
        >
          <EffectsTable effects={[...run.effects].reverse()} />
        </Panel>
      )}

      {run.undo && (
        <Panel title="Undo results" subtitle="Compensations ran newest first.">
          <ul className="undo-results">
            {[...run.effects]
              .reverse()
              .filter((e) => e.undo_status)
              .map((e) => {
                const msg = (e.compensation ?? e.undo_result)?.message
                return (
                  <li key={e.id}>
                    <span className="mono">{e.node_id}</span>
                    <UndoCell e={e} />
                    <span className="text-2">{typeof msg === 'string' ? msg : (e.undo_status ?? '').replace('_', ' ')}</span>
                  </li>
                )
              })}
          </ul>
        </Panel>
      )}

      <div ref={auditRef}>
        <AuditPanel
          audit={audit}
          tamper={tamper}
          tampered={tampered}
          result={auditResult}
          busy={busy}
          onLoad={() => void loadAudit()}
          onTamper={(v) => {
            setTamper(v)
            setAuditResult(null)
          }}
          onVerify={() => void verifyAudit()}
          runId={run.id}
        />
      </div>

      <div className="run-bar" role="region" aria-label="Run actions">
        <div className="run-bar-left">
          <StatusChip status={status} />
          {!inReview && <span className="run-bar-text">{meta.hint}</span>}
          {inReview && (
            <label className="run-bar-reviewer">
              <span className="muted">Reviewer</span>
              <input className="input input-sm" value={reviewer} onChange={(e) => setReviewer(e.target.value)} aria-label="Reviewer name" />
            </label>
          )}
          {inReview && (
            <span className="run-bar-keys muted small">
              <Kbd>a</Kbd> approve · <Kbd>r</Kbd> reject · <Kbd>j</Kbd>/<Kbd>k</Kbd> move
            </span>
          )}
        </div>
        <div className="run-bar-actions">
          {inReview && (
            <>
              <button type="button" className="btn btn-danger" disabled={!!busy} onClick={() => setConfirm('reject')}>
                Reject run
              </button>
              {pending.length > 0 && (
                <button
                  type="button"
                  className="btn"
                  disabled={!!busy}
                  onClick={() => void submit(pending.map((p) => p.args_hash), 'All pending approved')}
                >
                  Approve all pending ({pending.length})
                </button>
              )}
              <button
                type="button"
                className="btn btn-primary"
                disabled={!!busy || (pending.length > 0 && stagedApprove.length + stagedReject.length === 0)}
                onClick={() => void submit(stagedApprove.map((p) => p.args_hash), pending.length ? 'Review submitted' : 'Proceeding without blocked actions')}
                title={unstaged.length ? `${unstaged.length} unstaged action(s) will be declined` : undefined}
              >
                {busy === 'submit'
                  ? 'Submitting…'
                  : pending.length === 0
                    ? `Proceed without ${plural(blocked.length, 'blocked action')}`
                    : stagedApprove.length + stagedReject.length === 0
                      ? 'Submit review'
                      : `Submit review: ${stagedApprove.length} approve, ${stagedReject.length + unstaged.length} decline`}
              </button>
            </>
          )}
          {status === 'approved' && (
            <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => void execute()}>
              {busy === 'execute' ? `Executing… ${execElapsed}s` : 'Execute'}
            </button>
          )}
          {status === 'executing' && (
            <span className="row gap-sm">
              <Spinner /> Executing through the effect ledger…
            </span>
          )}
          {(finished || status === 'compensated') && (
            <>
              {finished && (
                <button type="button" className="btn btn-danger" disabled={!!busy} onClick={() => setConfirm('undo')}>
                  {busy === 'undo' ? 'Undoing…' : 'Undo'}
                </button>
              )}
              <button type="button" className="btn" disabled={!!busy} onClick={() => void execute()} title="Calls execute again, as a retrying agent would">
                {busy === 'execute' ? `Executing… ${execElapsed}s` : 'Execute again'}
              </button>
              <button type="button" className={cx('btn', !auditResult && 'btn-primary')} disabled={!!busy} onClick={() => (audit ? auditRef.current?.scrollIntoView({ behavior: 'smooth' }) : void loadAudit())}>
                {audit ? 'View audit packet' : 'Audit packet'}
              </button>
            </>
          )}
          {busy === 'execute' && executions === 0 && (
            <span className="muted small">Executing, then verifying with {MODEL_NAME}</span>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirm === 'reject'}
        title="Reject this run"
        confirmLabel="Reject run"
        busy={busy === 'reject'}
        onClose={() => setConfirm(null)}
        onConfirm={() => void rejectRun()}
      >
        Every action in “{run.goal}” is rejected and nothing is executed. The decision is recorded in the audit packet under reviewer{' '}
        <strong>{reviewerName}</strong>.
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === 'undo'}
        title="Undo executed effects"
        confirmLabel="Undo effects"
        busy={busy === 'undo'}
        onClose={() => setConfirm(null)}
        onConfirm={() => void undo()}
      >
        <p>Compensations run newest first:</p>
        <ul className="undo-plan">
          {[...run.effects]
            .reverse()
            .filter((e) => e.status === 'executed' && !e.undo_status && e.tool !== 'http.get' && e.tool !== 'docs.search')
            .map((e) => (
              <li key={e.id}>
                <span className="mono">{e.node_id}</span> {e.tool}:{' '}
                {e.tool === 'email.send' ? (
                  <span className="text-warning">email cannot be recalled; recorded as not reversible</span>
                ) : e.tool === 'slack.post' ? (
                  'message deleted'
                ) : e.tool === 'crm.update' ? (
                  'previous field values restored'
                ) : e.tool === 'calendar.create_event' ? (
                  'event cancelled'
                ) : (
                  'compensated'
                )}
              </li>
            ))}
        </ul>
      </ConfirmDialog>
    </div>
  )
}

function nextStep(run: Run, pending: number, blocked: number): { title: string; body: string; tone: 'warning' | 'danger' | 'info' | 'success' | 'neutral' } {
  switch (run.status) {
    case 'awaiting_approval':
      return {
        tone: 'warning',
        title: `${plural(pending, 'action')} need${pending === 1 ? 's' : ''} your approval.`,
        body: `Approve or reject each one, then submit a single review. ${run.summary?.auto_approved ?? 0} were auto-approved by policy${blocked ? `; ${blocked} blocked` : ''}.`,
      }
    case 'blocked':
      return {
        tone: 'danger',
        title: `${plural(blocked, 'action')} blocked by policy.`,
        body: 'Edit the blocked value to a trusted one (the action re-gates with a new hash), proceed without it, or reject the run.',
      }
    case 'approved':
      return { tone: 'info', title: 'Approved and ready.', body: 'Execute runs every approved action exactly once through the effect ledger, then verifies the done-criteria.' }
    case 'executing':
      return { tone: 'info', title: 'Executing.', body: 'Effects are written through the ledger; verification follows.' }
    case 'completed':
      return { tone: 'success', title: 'Executed and verified.', body: 'Every done-criterion was met by real outputs. Try Execute again to see exactly-once, or Undo.' }
    case 'partially_completed': {
      const v = run.verification
      const held = run.items.filter((i) => ['blocked', 'declined', 'rejected', 'skipped'].includes(i.status)).length
      if (v && !v.passed) {
        return {
          tone: 'warning',
          title: 'Done claim not verified.',
          body: `Only ${v.criteria_met ?? 0} of ${v.criteria_total ?? v.criteria?.length ?? 0} done-criteria were met by real outputs, so the gate does not report this run as done. See Verification.`,
        }
      }
      return {
        tone: 'warning',
        title: 'Completed with held-back items.',
        body: `${plural(held, 'action')} did not run because the gate held ${held === 1 ? 'it' : 'them'} back. Everything that ran was verified.`,
      }
    }
    case 'failed':
      return { tone: 'danger', title: 'Execution failed.', body: 'No effect completed. See the effects and timeline for the error.' }
    case 'compensated':
      return { tone: 'neutral', title: 'Undone.', body: 'Reversible effects were compensated newest first. Irreversible ones (sent email) are recorded as not reversible.' }
    case 'rejected':
      return { tone: 'neutral', title: 'Rejected.', body: 'A reviewer rejected the plan. Nothing was executed.' }
    default:
      return { tone: 'neutral', title: runStatusMeta(run.status).label, body: '' }
  }
}

/* ------------------------------------------------------------------------------------------ */

function ActionDetail({
  item,
  run,
  editing,
  editable,
  busy,
  staged,
  previousHash,
  onEdit,
  onCancelEdit,
  onSave,
  onStage,
}: {
  item: RunItem
  run: Run
  editing: boolean
  editable: boolean
  busy: Busy
  staged?: 'approve' | 'reject'
  previousHash?: string
  onEdit: () => void
  onCancelEdit: () => void
  onSave: (args: Record<string, unknown>) => void
  onStage: (v: 'approve' | 'reject') => void
}) {
  const decision = gateDecision(item)
  const reason = decisionReason(item)
  const sources = item.arg_sources ?? {}
  const flags = item.flags ?? []
  const effect = run.effects.find((e) => e.node_id === item.node_id)
  const hashBound = item.approved_hash ? item.approved_hash === item.args_hash : null
  const kind = item.kind === 'read' ? 'Read' : item.reversible ? 'Reversible write' : 'Irreversible write'

  return (
    <section className="panel action-detail" aria-label={`Action ${item.node_id}`}>
      <div className="panel-head panel-head-ruled">
        <div className="panel-head-text">
          <h2 className="panel-title">
            <span className="mono">{item.node_id}</span> · <span className="mono">{item.tool}</span>
          </h2>
          <div className="panel-subtitle">
            {toolSystem(item.tool)} · {kind}
          </div>
        </div>
        <div className="panel-actions">
          <ItemStatusChip status={item.status} />
        </div>
      </div>

      <div className={cx('decision-reason', `is-${decision}`)}>
        <div className="decision-reason-head">
          <DecisionBadge item={item} staged={staged} />
          <RiskText risk={item.risk} />
        </div>
        {reason && <p>{renderTicks(reason)}</p>}
        {flags.length > 0 && (
          <div className="flag-row">
            {flags.map((f) => {
              const m = flagMeta(f)
              return (
                <Badge key={f} tone={m.tone} title={m.hint}>
                  {m.label}
                </Badge>
              )
            })}
          </div>
        )}
        {(item.status === 'pending_approval' || item.status === 'blocked') && (
        <div className="decision-bar">
          {item.status === 'pending_approval' ? (
            <>
              <span className="decision-bar-label">
                Decision: <strong>{staged === 'approve' ? 'Approve (staged)' : staged === 'reject' ? 'Reject (staged)' : 'Needs approval'}</strong>
              </span>
              <div className="row gap-sm">
                <button type="button" className={cx('btn', staged === 'reject' && 'is-pressed')} aria-pressed={staged === 'reject'} onClick={() => onStage('reject')}>
                  Reject
                </button>
                <button type="button" className={cx('btn btn-primary', staged === 'approve' && 'is-pressed')} aria-pressed={staged === 'approve'} onClick={() => onStage('approve')}>
                  Approve
                </button>
              </div>
            </>
          ) : item.status === 'blocked' ? (
            <>
              <span className="decision-bar-label text-danger">Cannot be approved while blocked. Fix the value to re-gate it.</span>
              {editable && (
                <button type="button" className="btn" onClick={onEdit}>
                  Edit to fix
                </button>
              )}
            </>
          ) : null}
        </div>
        )}
      </div>

      <div className="detail-section">
        <h3 className="h3">Proposed effect</h3>
        <PreviewView item={item} />
      </div>

      <div className="detail-section">
        <div className="detail-section-head">
          <h3 className="h3">Arguments</h3>
          {editable && !editing && (
            <button type="button" className="btn btn-sm" onClick={onEdit}>
              Edit
            </button>
          )}
        </div>
        {editing ? (
          <ArgEditor item={item} busy={busy === 'edit'} onCancel={onCancelEdit} onSave={onSave} />
        ) : (
          <table className="table table-dense args-table">
            <thead>
              <tr>
                <th scope="col">Argument</th>
                <th scope="col">Value</th>
                <th scope="col">Source</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(item.args).map(([k, v]) => {
                const tainted = flags.includes(`taint:${k}`)
                return (
                  <tr key={k} className={tainted ? 'is-flagged' : undefined}>
                    <td className="mono">{k}</td>
                    <td className="args-value">{typeof v === 'string' ? v : inlineValue(v)}</td>
                    <td>
                      <SourceBadge source={sources[k]} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="detail-section">
        <h3 className="h3">Binding</h3>
        <KeyValue
          rows={[
            ['Args hash', <Hash value={item.args_hash} previous={previousHash} />],
            [
              'Approved hash',
              item.approved_hash ? (
                <span className="row gap-sm wrap">
                  <Hash value={item.approved_hash} />
                  {hashBound ? <span className="text-success">matches</span> : <span className="text-danger">does not match</span>}
                </span>
              ) : (
                <span className="muted">Not approved yet</span>
              ),
            ],
            ['Approved by', item.approved_by ? `${item.approved_by}${item.approval_mode === 'policy' ? ' (deterministic rule)' : ''}` : '—'],
            ['Effect', effect ? `#${effect.id} · ${effect.status}${effect.undo_status ? ` · ${effect.undo_status.replace('_', ' ')}` : ''}` : '—'],
          ]}
        />
        {previousHash && previousHash !== item.args_hash && (
          <p className="small muted">Edited in this session: the old hash is void, so any approval of it no longer applies.</p>
        )}
      </div>

    </section>
  )
}

function renderTicks(text: string) {
  return text.split('`').map((part, i) => (i % 2 ? <code key={i}>{part}</code> : <span key={i}>{part}</span>))
}

function ArgEditor({
  item,
  busy,
  onCancel,
  onSave,
}: {
  item: RunItem
  busy: boolean
  onCancel: () => void
  onSave: (args: Record<string, unknown>) => void
}) {
  const [drafts, setDrafts] = useState(() =>
    Object.entries(item.args).map(([k, v]) => ({ k, text: typeof v === 'string' ? v : JSON.stringify(v), json: typeof v !== 'string' })),
  )
  const [error, setError] = useState<string | null>(null)
  const save = () => {
    const out: Record<string, unknown> = {}
    for (const d of drafts) {
      if (d.json) {
        try {
          out[d.k] = JSON.parse(d.text)
        } catch {
          setError(`${d.k} must be valid JSON`)
          return
        }
      } else out[d.k] = d.text
    }
    setError(null)
    onSave(out)
  }
  return (
    <div className="arg-editor">
      {drafts.map((d, i) => (
        <label key={d.k} className="field">
          <span className="field-label mono">
            {d.k} <SourceBadge source={item.arg_sources?.[d.k]} />
          </span>
          {d.text.length > 70 || d.text.includes('\n') ? (
            <textarea
              className={cx('input textarea', d.json && 'mono-input')}
              rows={4}
              value={d.text}
              onChange={(e) => setDrafts((xs) => xs.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
            />
          ) : (
            <input
              className={cx('input', d.json && 'mono-input')}
              value={d.text}
              onChange={(e) => setDrafts((xs) => xs.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
            />
          )}
        </label>
      ))}
      <p className="small muted">
        Values you change become reviewer-supplied (trusted). Saving re-runs the shadow run and the policy: the args hash changes and any approval is reset.
      </p>
      {error && <p className="small text-danger">{error}</p>}
      <div className="row gap-sm">
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
          {busy ? 'Re-gating…' : 'Save and re-gate'}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------------------------------ */

function VerificationPanel({ run, agentClaim }: { run: Run; agentClaim?: string }) {
  const v = run.verification
  if (!v) {
    return (
      <Panel title="Verification">
        <p className="muted">Not verified. Verification runs after execution.</p>
      </Panel>
    )
  }
  const judgeId = v.judge ?? v.method
  const judge = judgeLabel(judgeId, v.model)
  const total = v.criteria_total ?? v.criteria?.length ?? 0
  const met = v.criteria_met ?? (v.criteria ?? []).filter((c) => c.met).length
  return (
    <Panel
      title="Verification"
      subtitle="Done-criteria judged against the real outputs of executed effects, not against the plan."
      actions={
        <Badge tone={v.passed ? 'success' : 'danger'} dot>
          {v.passed ? 'Verified' : 'Not verified'} · {met}/{total} criteria met
        </Badge>
      }
      flush
    >
      <div className="panel-body stack-sm">
        {agentClaim && (
          <div className="claim-vs">
            <div className="claim">
              <div className="claim-label">Agent claimed</div>
              <blockquote className="quote">{agentClaim}</blockquote>
            </div>
            <div className={cx('claim', v.passed ? 'is-ok' : 'is-bad')}>
              <div className="claim-label">Gate verdict</div>
              <p>
                <strong className={v.passed ? 'text-success' : 'text-danger'}>{v.passed ? 'Verified done' : 'Not done'}</strong>:{' '}
                {met} of {total} done-criteria met by real outputs.
              </p>
            </div>
          </div>
        )}
        <KeyValue
          rows={[
            [
              'Judge',
              <span>
                {judge}
                {judgeId === 'muse' && v.model ? <span className="mono muted"> ({v.model})</span> : null}
                {judgeId !== 'muse' && <span className="muted"> (effect-ledger state checks)</span>}
              </span>,
            ],
            ['Judge latency', v.judge_latency_ms !== undefined ? `${(v.judge_latency_ms / 1000).toFixed(1)}s` : '—'],
            ['Effects checked against system state', v.effects_verified ? <span className="text-success">all verified</span> : <span className="text-danger">not all verified</span>],
            ['Verified at', formatDateTime(v.verified_at)],
          ]}
        />
        {v.note && <Callout tone="warning">{v.note}</Callout>}
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Criterion</th>
              <th scope="col">Result</th>
              <th scope="col">Evidence</th>
              <th scope="col">Judge</th>
            </tr>
          </thead>
          <tbody>
            {(v.criteria ?? []).map((c, i) => (
              <tr key={i}>
                <td className="cell-wrap">{c.criterion}</td>
                <td className="nowrap">
                  <Badge tone={c.met ? 'success' : 'danger'} dot>
                    {c.met ? 'Met' : 'Not met'}
                  </Badge>
                </td>
                <td className="cell-wrap text-2">{c.evidence ?? '—'}</td>
                <td className="nowrap muted">{judgeLabel(c.judge ?? judgeId, v.model)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

/* ------------------------------------------------------------------------------------------ */

function AuditPanel({
  audit,
  tamper,
  tampered,
  result,
  busy,
  onLoad,
  onTamper,
  onVerify,
  runId,
}: {
  audit: AuditBundle | null
  tamper: boolean
  tampered: ReturnType<typeof tamperPacket> | null
  result: (AuditVerifyResult & { tampered: boolean }) | null
  busy: Busy
  onLoad: () => void
  onTamper: (v: boolean) => void
  onVerify: () => void
  runId: string
}) {
  if (!audit) {
    return (
      <Panel title="Audit packet" subtitle="Plan, diff, decisions, reviewer, effects, verification and every event, signed with HMAC-SHA256.">
        <div className="row gap-sm wrap">
          <button type="button" className="btn" onClick={onLoad} disabled={busy === 'audit'}>
            {busy === 'audit' ? 'Generating…' : 'Generate audit packet'}
          </button>
          <span className="muted small">Evidence for auditors (EU AI Act record keeping, AIUC-1).</span>
        </div>
      </Panel>
    )
  }
  const shown = tamper && tampered ? tampered.packet : audit.packet
  const text = JSON.stringify(shown, null, 2)
  let markLines: Set<number> | undefined
  if (tamper && tampered) {
    const lines = text.split('\n')
    const idx = lines.findIndex((l) => l.includes(tampered.to))
    if (idx >= 0) markLines = new Set([idx + 1])
  }
  return (
    <Panel
      title="Audit packet"
      subtitle="Signed evidence for auditors. Verify recomputes the HMAC on the server; any changed byte fails."
      actions={
        <div className="row gap-sm wrap">
          <button type="button" className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(JSON.stringify({ ...audit, packet: shown }, null, 2))}>
            Copy JSON
          </button>
          <button type="button" className="btn btn-sm" onClick={() => downloadJson(`audit-${runId}.json`, { ...audit, packet: shown })}>
            Download
          </button>
        </div>
      }
    >
      <div className="audit-grid">
        <div className="stack-sm">
          <KeyValue
            rows={[
              ['Schema', <span className="mono">{String(audit.packet.schema ?? '—')}</span>],
              ['Algorithm', audit.algorithm ?? 'HMAC-SHA256'],
              ['Key id', <span className="mono">{audit.key_id ?? '—'}</span>],
              ['Signature', <Hash value={audit.signature} prefix="hmac:" />],
              ['Events', String(Array.isArray(audit.packet.events) ? audit.packet.events.length : 0)],
              ['Effects', String(Array.isArray(audit.packet.effects) ? audit.packet.effects.length : 0)],
            ]}
          />
          <label className="check">
            <input type="checkbox" checked={tamper} onChange={(e) => onTamper(e.target.checked)} />
            <span>
              Tamper: flip one byte
              {tamper && tampered && (
                <span className="muted small">
                  {' '}
                  in <span className="mono">{tampered.path}</span> ({tampered.from.slice(0, 6)} → {tampered.to.slice(0, 6)})
                </span>
              )}
            </span>
          </label>
          <div className="row gap-sm wrap">
            <button type="button" className="btn btn-primary" onClick={onVerify} disabled={busy === 'verify'}>
              {busy === 'verify' ? 'Verifying…' : tamper ? 'Verify tampered packet' : 'Verify signature'}
            </button>
          </div>
          <div aria-live="polite">
            {result && (
              <div className={cx('verify-result', result.valid ? 'is-valid' : 'is-invalid')}>
                <Badge tone={result.valid ? 'success' : 'danger'} dot>
                  {result.valid ? 'Signature valid' : 'Signature invalid'}
                </Badge>
                <span className="small">
                  {result.valid
                    ? 'The packet is byte-for-byte what the gate signed.'
                    : result.tampered
                      ? 'One changed byte breaks the HMAC. Tampering is detectable.'
                      : 'The packet does not match its signature.'}
                </span>
              </div>
            )}
          </div>
        </div>
        <JsonView value={shown} maxHeight={420} markLines={markLines} label="Audit packet JSON" />
      </div>
    </Panel>
  )
}
