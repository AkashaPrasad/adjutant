import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Download,
  FileSignature,
  Lock,
  Pencil,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  XCircle,
} from 'lucide-react'
import { ApiError, api, errorMessage } from '../api/client'
import type { AuditPacket, Run, RunItem } from '../api/types'
import { Badge, RiskBadge, StatusBadge } from '../components/Badge'
import { EffectsTable } from '../components/EffectsTable'
import { Timeline } from '../components/Timeline'
import { useToast } from '../components/Toast'
import { Callout, Code, CopyButton, EmptyState, ErrorState, LoadingBlock, Modal, Skeleton, Spinner } from '../components/ui'
import { flagLabel, formatDateTime, humanize, isTaintFlag, pick, pretty, relativeTime, shortHash, shortId } from '../lib/format'
import { useAsync, useDocumentTitle } from '../lib/hooks'
import { linkHandler } from '../lib/router'
import { runCache } from '../lib/runCache'

const DECIDABLE = ['awaiting_approval', 'blocked']
const EDITABLE = ['awaiting_approval', 'blocked']
const UNDOABLE = ['completed', 'partially_completed', 'failed']
const POLLING = ['approved', 'executing', 'running']

type Busy = null | 'approve' | 'reject' | 'execute' | 'undo' | 'edit'

const itemKey = (it: RunItem) => `${it.node_id}:${it.args_hash ?? ''}`
const isBlocked = (it: RunItem) =>
  (it.status || '').toLowerCase() === 'blocked' || (it.flags ?? []).some((f) => isTaintFlag(f) && /block/i.test(flagLabel(f)))

export function RunReview({ id }: { id: string }) {
  const toast = useToast()
  const [pollMs, setPollMs] = useState<number | undefined>(undefined)
  const runQ = useAsync(() => api.getRun(id), [id], pollMs)
  const run = runQ.data ?? runCache.get(id)
  useDocumentTitle(run ? `Run ${shortId(run.id)}` : 'Run')

  const status = (run?.status || '').toLowerCase()
  useEffect(() => {
    setPollMs(POLLING.includes(status) ? 4000 : undefined)
  }, [status])

  const items = useMemo(() => run?.items ?? [], [run])
  const decidable = DECIDABLE.includes(status)
  const decisionItems = items.filter((it) => it.decision_required)
  const selectableItems = decisionItems.filter((it) => !isBlocked(it) && it.args_hash)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const selectionSignature = selectableItems.map(itemKey).join('|')
  useEffect(() => {
    // Default: every approvable item selected. Re-runs whenever any args hash changes (edit re-gates).
    setSelected(new Set(selectionSignature ? selectionSignature.split('|') : []))
  }, [selectionSignature])

  const [reviewer, setReviewer] = useState(() => localStorage.getItem('adjutant.reviewer') || 'operator')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<Busy>(null)
  const [actionError, setActionError] = useState<unknown>(null)
  const [modal, setModal] = useState<null | 'reject' | 'undo' | 'audit'>(null)
  const [editing, setEditing] = useState<string | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem('adjutant.reviewer', reviewer)
    } catch {
      /* ignore */
    }
  }, [reviewer])

  const applyResult = async (result: Run | null) => {
    if (result && Array.isArray(result.items)) {
      runQ.setData(result)
      runCache.set(result.id, result)
    } else {
      await runQ.reload()
    }
  }

  const perform = async (kind: Exclude<Busy, null>, fn: () => Promise<Run | null>, success: string, body?: string) => {
    setBusy(kind)
    setActionError(null)
    try {
      const result = await fn()
      await applyResult(result)
      toast.push('success', success, body)
      return true
    } catch (err) {
      setActionError(err)
      toast.push('error', `${humanize(kind)} failed`, errorMessage(err))
      if (err instanceof ApiError && err.status === 409) void runQ.reload()
      return false
    } finally {
      setBusy(null)
    }
  }

  if (!run) {
    if (runQ.error) {
      const notFound = runQ.error instanceof ApiError && runQ.error.status === 404
      return (
        <div className="page">
          <BackLink />
          {notFound ? (
            <EmptyState title="Run not found" action={<a href="/runs" onClick={linkHandler('/runs')} className="btn">View all runs</a>}>
              No run with id <code>{id}</code> exists on this API.
            </EmptyState>
          ) : (
            <ErrorState error={runQ.error} onRetry={runQ.reload} title="Could not load this run" />
          )}
        </div>
      )
    }
    return (
      <div className="page">
        <BackLink />
        <div className="card card-body">
          <Skeleton rows={2} />
        </div>
        <LoadingBlock label="Loading run…" />
      </div>
    )
  }

  const selectedHashes = selectableItems.filter((it) => selected.has(itemKey(it))).map((it) => it.args_hash as string)
  const blockedItems = items.filter(isBlocked)
  const offending = blockedItems.length ? blockedItems : items.filter((it) => (it.flags ?? []).some(isTaintFlag))
  const canApprove = decidable && (selectedHashes.length > 0 || decisionItems.length === 0) && blockedItems.length < items.length
  const canExecute = status === 'approved'
  const canUndo = UNDOABLE.includes(status)
  const effects = run.effects ?? []
  const reviewerName = reviewer.trim() || 'operator'

  const approve = () =>
    perform(
      'approve',
      () =>
        api.decide(run.id, {
          decision: 'approve',
          reviewer: reviewerName,
          approved_hashes: selectedHashes,
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      'Approved',
      `${selectedHashes.length} item${selectedHashes.length === 1 ? '' : 's'} approved against exact args hashes.`,
    )

  return (
    <div className="page">
      <BackLink />

      <div className="run-head">
        <div className="run-head-main">
          <div className="row gap-sm wrap">
            <StatusBadge status={run.status} />
            <span className="mono muted small row gap-xs">
              {run.id}
              <CopyButton value={run.id} label="Copy run id" />
            </span>
            {run.created_at && (
              <span className="muted small" title={formatDateTime(run.created_at)}>
                Created {relativeTime(run.created_at)}
              </span>
            )}
          </div>
          <h1 className="run-goal">{run.goal || 'Untitled run'}</h1>
        </div>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => void runQ.reload()} disabled={runQ.loading}>
          <RefreshCw size={14} className={runQ.loading ? 'spin' : undefined} aria-hidden="true" /> Refresh
        </button>
      </div>

      <Timeline run={run} />

      {runQ.error != null && runQ.data && (
        <Callout tone="warning" title="Showing last known state">
          {errorMessage(runQ.error)}
        </Callout>
      )}

      {decidable && (blockedItems.length > 0 || status === 'blocked') && (
        <Callout tone="danger" title="Blocked by taint policy">
          {offending.length > 0 ? (
            <>
              <strong className="mono">{offending.map((b) => b.node_id).join(', ')}</strong>{' '}
              {offending.length === 1 ? 'uses' : 'use'} untrusted data in a sensitive argument (recipient, channel or target).
            </>
          ) : (
            'Untrusted data reached a sensitive argument (recipient, channel or target).'
          )}{' '}
          Edit the args to use a trusted value, which re-gates the item, or reject the run.
        </Callout>
      )}

      <div className="split split-review">
        <section className="stack" aria-labelledby="diff-h">
          <div className="section-head">
            <h2 id="diff-h" className="section-title">
              Plan diff <span className="count">{items.length}</span>
            </h2>
            <span className="muted small">
              {decisionItems.length
                ? `${decisionItems.length} need${decisionItems.length === 1 ? 's' : ''} a decision`
                : 'No item needs a decision'}
            </span>
          </div>
          {items.length === 0 ? (
            <EmptyState title="No items">This run has no planned actions.</EmptyState>
          ) : (
            items.map((it) => (
              <ItemCard
                key={it.node_id}
                item={it}
                decidable={decidable}
                selected={selected.has(itemKey(it))}
                onToggle={(on) =>
                  setSelected((s) => {
                    const next = new Set(s)
                    if (on) next.add(itemKey(it))
                    else next.delete(itemKey(it))
                    return next
                  })
                }
                editable={EDITABLE.includes(status)}
                editing={editing === it.node_id}
                onEdit={() => setEditing(it.node_id)}
                onCancelEdit={() => setEditing(null)}
                saving={busy === 'edit'}
                onSave={async (args) => {
                  const ok = await perform('edit', () => api.edit(run.id, it.node_id, args), 'Args updated', 'The item was re-gated with a new args hash.')
                  if (ok) setEditing(null)
                }}
              />
            ))
          )}

          <div className="section-head">
            <h2 className="section-title">
              Effects <span className="count">{effects.length}</span>
            </h2>
            <span className="muted small">Exactly-once ledger entries for this run</span>
          </div>
          {effects.length === 0 ? (
            <div className="card">
              <EmptyState title="No effects yet">Effects appear here after execution. A shadow run never writes to the ledger.</EmptyState>
            </div>
          ) : (
            <div className="card">
              <EffectsTable effects={effects} />
            </div>
          )}
        </section>

        <aside className="stack sticky-col" aria-label="Review controls">
          <section className="card" aria-labelledby="decision-h">
            <div className="card-head">
              <h2 id="decision-h" className="card-title">
                Decision
              </h2>
            </div>
            <div className="card-body stack-sm">
              {decidable ? (
                <>
                  <p className="muted small">
                    Approval binds to each selected item's args hash. Editing args after approval invalidates it.
                  </p>
                  <div className="field">
                    <label htmlFor="reviewer" className="field-label">
                      Reviewer
                    </label>
                    <input id="reviewer" className="input" value={reviewer} onChange={(e) => setReviewer(e.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="note" className="field-label">
                      Note <span className="muted">(optional)</span>
                    </label>
                    <input id="note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason or context" />
                  </div>
                  <div className="row gap-sm">
                    <button type="button" className="btn btn-primary grow" disabled={!canApprove || busy !== null} onClick={approve}>
                      {busy === 'approve' ? <Spinner size={14} /> : <Check size={15} aria-hidden="true" />}
                      Approve selected{decisionItems.length ? ` (${selectedHashes.length})` : ''}
                    </button>
                    <button type="button" className="btn btn-danger-outline" disabled={busy !== null} onClick={() => setModal('reject')}>
                      <XCircle size={15} aria-hidden="true" /> Reject
                    </button>
                  </div>
                </>
              ) : (
                <DecisionSummary run={run} />
              )}
            </div>
          </section>

          <section className="card" aria-labelledby="exec-h">
            <div className="card-head">
              <h2 id="exec-h" className="card-title">
                Execution
              </h2>
            </div>
            <div className="card-body stack-sm">
              <button
                type="button"
                className={`btn ${canExecute ? 'btn-primary' : ''} w-full`}
                disabled={!canExecute || busy !== null}
                onClick={() => perform('execute', () => api.execute(run.id), 'Executed', 'Effects were recorded in the ledger.')}
                title={canExecute ? 'Execute approved items exactly once' : 'Available once the run is approved'}
              >
                {busy === 'execute' ? <Spinner size={14} /> : <Play size={15} aria-hidden="true" />}
                {busy === 'execute' ? 'Executing…' : 'Execute'}
              </button>
              <button
                type="button"
                className="btn w-full"
                disabled={!canUndo || busy !== null}
                onClick={() => setModal('undo')}
                title={canUndo ? 'Compensate effects newest-first' : 'Available after execution'}
              >
                {busy === 'undo' ? <Spinner size={14} /> : <RotateCcw size={15} aria-hidden="true" />}
                Undo
              </button>
              <button type="button" className="btn btn-ghost w-full" onClick={() => setModal('audit')}>
                <FileSignature size={15} aria-hidden="true" /> Signed audit packet
              </button>
              {actionError != null && <ErrorState error={actionError} />}
            </div>
          </section>

          <VerificationCard run={run} />
        </aside>
      </div>

      {modal === 'reject' && (
        <Modal
          title="Reject this run?"
          subtitle="Nothing will be executed. The rejection is recorded in the audit packet."
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy !== null}
                onClick={async () => {
                  const ok = await perform(
                    'reject',
                    () =>
                      api.decide(run.id, {
                        decision: 'reject',
                        reviewer: reviewerName,
                        approved_hashes: [],
                        ...(note.trim() ? { note: note.trim() } : {}),
                      }),
                    'Run rejected',
                  )
                  if (ok) setModal(null)
                }}
              >
                {busy === 'reject' ? <Spinner size={14} /> : <XCircle size={15} aria-hidden="true" />} Reject run
              </button>
            </>
          }
        >
          <div className="field">
            <label htmlFor="reject-note" className="field-label">
              Reason <span className="muted">(optional)</span>
            </label>
            <textarea id="reject-note" className="textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </Modal>
      )}

      {modal === 'undo' && (
        <Modal
          title="Undo this run?"
          subtitle="Reversible effects are compensated newest-first. Irreversible effects (for example a sent email) are reported, not undone."
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy !== null}
                onClick={async () => {
                  const ok = await perform('undo', () => api.undo(run.id), 'Compensation complete', 'Effects were compensated newest-first.')
                  if (ok) setModal(null)
                }}
              >
                {busy === 'undo' ? <Spinner size={14} /> : <RotateCcw size={15} aria-hidden="true" />} Undo effects
              </button>
            </>
          }
        >
          <p className="small">
            {effects.length} effect{effects.length === 1 ? '' : 's'} recorded for this run.
          </p>
        </Modal>
      )}

      {modal === 'audit' && <AuditModal runId={run.id} onClose={() => setModal(null)} />}
    </div>
  )
}

function BackLink() {
  return (
    <a href="/runs" className="back-link" onClick={linkHandler('/runs')}>
      <ArrowLeft size={14} aria-hidden="true" /> All runs
    </a>
  )
}

function DecisionSummary({ run }: { run: Run }) {
  const s = (run.status || '').toLowerCase()
  const reviewer = pick<string>(run, ['reviewer', 'approved_by', 'decided_by'])
  const decidedAt = pick(run, ['decided_at', 'approved_at'])
  const note = pick<string>(run, ['note', 'decision_note'])
  const label =
    s === 'rejected' ? 'Rejected' : s === 'awaiting_approval' ? 'Pending' : ['blocked'].includes(s) ? 'Blocked' : 'Approved'
  return (
    <div className="stack-xs">
      <div className="row gap-xs">
        {label === 'Rejected' ? (
          <XCircle size={16} className="danger-text" aria-hidden="true" />
        ) : (
          <CheckCircle2 size={16} className="ok-text" aria-hidden="true" />
        )}
        <strong>{label}</strong>
        {reviewer && <span className="muted">by {reviewer}</span>}
      </div>
      {decidedAt != null && <div className="muted small">{formatDateTime(decidedAt)}</div>}
      {note && <div className="small">“{note}”</div>}
    </div>
  )
}

function renderValue(v: unknown) {
  if (typeof v === 'string') return <span className="arg-text">{v}</span>
  if (v === null || v === undefined) return <span className="muted">null</span>
  if (typeof v === 'object') return <code className="arg-json">{JSON.stringify(v, null, 2)}</code>
  return <code>{String(v)}</code>
}

function Preview({ value }: { value: unknown }) {
  if (value === undefined || value === null || value === '') return <p className="muted small">No preview returned.</p>
  if (typeof value === 'string') return <div className="preview-text">{value}</div>
  if (typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>
    const summary = pick<string>(o, ['summary', 'description', 'text', 'message'])
    const rest = Object.fromEntries(Object.entries(o).filter(([k]) => !['summary', 'description', 'text', 'message'].includes(k)))
    return (
      <div className="stack-xs">
        {typeof summary === 'string' && <div className="preview-text">{summary}</div>}
        {Object.keys(rest).length > 0 && <Code value={rest} maxHeight={260} />}
      </div>
    )
  }
  return <Code value={value} maxHeight={260} />
}

function ItemCard({
  item,
  decidable,
  selected,
  onToggle,
  editable,
  editing,
  onEdit,
  onCancelEdit,
  onSave,
  saving,
}: {
  item: RunItem
  decidable: boolean
  selected: boolean
  onToggle: (on: boolean) => void
  editable: boolean
  editing: boolean
  onEdit: () => void
  onCancelEdit: () => void
  onSave: (args: Record<string, unknown>) => void
  saving: boolean
}) {
  const [text, setText] = useState('')
  const [parseError, setParseError] = useState<string | null>(null)
  const blocked = isBlocked(item)
  const flags = item.flags ?? []
  const args = item.args ?? {}
  const sources = item.arg_sources ?? {}
  const checkId = `chk-${item.node_id}`
  const showCheckbox = decidable && item.decision_required

  useEffect(() => {
    if (editing) {
      setText(JSON.stringify(item.args ?? {}, null, 2))
      setParseError(null)
    }
  }, [editing, item.args])

  const save = () => {
    try {
      const v = JSON.parse(text)
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Args must be a JSON object.')
      setParseError(null)
      onSave(v)
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Invalid JSON')
    }
  }

  return (
    <article
      className={`item-card${blocked ? ' item-blocked' : ''}${showCheckbox && selected ? ' item-selected' : ''}`}
      aria-label={`Action ${item.node_id}`}
    >
      <header className="item-head">
        <div className="row gap-sm wrap grow">
          {showCheckbox && (
            <input
              id={checkId}
              type="checkbox"
              className="item-check"
              checked={selected && !blocked}
              disabled={blocked || !item.args_hash}
              onChange={(e) => onToggle(e.target.checked)}
              aria-label={`Approve ${item.node_id}`}
            />
          )}
          <label htmlFor={showCheckbox ? checkId : undefined} className="item-title">
            <span className="mono">{item.node_id}</span>
            <code className="tool-name">{item.tool}</code>
          </label>
          <RiskBadge risk={item.risk} />
          {item.status && <StatusBadge status={item.status} />}
          {decidable && item.decision_required && !blocked && <Badge tone="warning">Needs decision</Badge>}
        </div>
        <div className="row gap-xs">
          {item.args_hash && (
            <span className="hash" title={`args hash: ${item.args_hash}`}>
              <span className="muted">#</span>
              {shortHash(item.args_hash)}
              <CopyButton value={item.args_hash} label="Copy args hash" />
            </span>
          )}
          {editable && !editing && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={onEdit}>
              <Pencil size={13} aria-hidden="true" /> Edit args
            </button>
          )}
        </div>
      </header>

      {flags.length > 0 && (
        <div className="flags">
          {flags.map((f, i) => (
            <span key={i} className={`flag${isTaintFlag(f) ? ' flag-taint' : ''}`}>
              {isTaintFlag(f) ? <ShieldAlert size={12} aria-hidden="true" /> : null}
              {flagLabel(f)}
            </span>
          ))}
        </div>
      )}

      {editing ? (
        <div className="item-body stack-sm">
          <div className="field">
            <label htmlFor={`edit-${item.node_id}`} className="field-label">
              Args (JSON). Saving re-gates this item with a new hash.
            </label>
            <textarea
              id={`edit-${item.node_id}`}
              className="textarea mono code-input"
              rows={Math.min(16, Math.max(5, text.split('\n').length + 1))}
              spellCheck={false}
              value={text}
              aria-invalid={!!parseError}
              onChange={(e) => setText(e.target.value)}
            />
            {parseError && <div className="field-error">{parseError}</div>}
          </div>
          <div className="row gap-sm end">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onCancelEdit} disabled={saving}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
              {saving ? <Spinner size={13} /> : <Check size={14} aria-hidden="true" />} Save and re-gate
            </button>
          </div>
        </div>
      ) : (
        <div className="item-body item-grid">
          <div>
            <div className="pane-label">Args</div>
            {Object.keys(args).length === 0 ? (
              <p className="muted small">No args.</p>
            ) : (
              <dl className="args">
                {Object.entries(args).map(([k, v]) => (
                  <div key={k} className="arg-row">
                    <dt>
                      <code>{k}</code>
                      {sources[k] === 'untrusted' && (
                        <span className="src-tag" title="Value derived from untrusted input">
                          <Lock size={10} aria-hidden="true" /> untrusted
                        </span>
                      )}
                    </dt>
                    <dd>{renderValue(v)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
          <div>
            <div className="pane-label">Preview (shadow run)</div>
            <Preview value={item.preview} />
          </div>
        </div>
      )}
    </article>
  )
}

function VerificationCard({ run }: { run: Run }) {
  const v = run.verification
  const criteria = run.done_criteria ?? []
  const details = v?.details
  return (
    <section className="card" aria-labelledby="verify-h">
      <div className="card-head">
        <h2 id="verify-h" className="card-title">
          Verification
        </h2>
        {v?.passed === true && <Badge tone="success">Verified</Badge>}
        {v?.passed === false && <Badge tone="danger">Not verified</Badge>}
      </div>
      <div className="card-body stack-sm">
        {v?.passed === true ? (
          <Callout tone="success" title="Done means verified">
            The outcome was checked against the done criteria.
          </Callout>
        ) : v?.passed === false ? (
          <Callout tone="danger" title="Verification failed">
            Execution finished but the outcome did not meet the done criteria.
          </Callout>
        ) : (
          <p className="muted small">Runs after execution. The gate checks the real outcome, not just the absence of errors.</p>
        )}
        {details !== undefined && details !== null && <VerificationDetails details={details} />}
        {criteria.length > 0 && (
          <div>
            <div className="pane-label">Done criteria</div>
            <ul className="criteria">
              {criteria.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}

function VerificationDetails({ details }: { details: unknown }) {
  if (typeof details === 'string') return <div className="preview-text">{details}</div>
  if (Array.isArray(details)) {
    return (
      <ul className="checks">
        {details.map((d, i) => {
          if (d && typeof d === 'object') {
            const o = d as Record<string, unknown>
            const passed = pick<boolean>(o, ['passed', 'ok', 'met', 'success'])
            const label = pick<string>(o, ['criterion', 'name', 'check', 'description', 'label']) ?? `Check ${i + 1}`
            const evidence = pick<unknown>(o, ['evidence', 'detail', 'details', 'reason', 'message'])
            return (
              <li key={i} className="check">
                {passed === false ? (
                  <XCircle size={14} className="danger-text" aria-label="failed" />
                ) : passed === true ? (
                  <CheckCircle2 size={14} className="ok-text" aria-label="passed" />
                ) : (
                  <span className="check-dot" aria-hidden="true" />
                )}
                <div>
                  <div className="small">{String(label)}</div>
                  {evidence !== undefined && <div className="muted small">{pretty(evidence)}</div>}
                </div>
              </li>
            )
          }
          return (
            <li key={i} className="check small">
              {pretty(d)}
            </li>
          )
        })}
      </ul>
    )
  }
  if (typeof details === 'object') {
    const entries = Object.entries(details as Record<string, unknown>)
    if (entries.every(([, x]) => typeof x === 'boolean')) {
      return (
        <ul className="checks">
          {entries.map(([k, x]) => (
            <li key={k} className="check">
              {x ? <CheckCircle2 size={14} className="ok-text" aria-label="passed" /> : <XCircle size={14} className="danger-text" aria-label="failed" />}
              <span className="small">{humanize(k)}</span>
            </li>
          ))}
        </ul>
      )
    }
  }
  return <Code value={details} maxHeight={240} />
}

function AuditModal({ runId, onClose }: { runId: string; onClose: () => void }) {
  const audit = useAsync<AuditPacket>(() => api.audit(runId), [runId])
  const download = () => {
    if (!audit.data) return
    const blob = new Blob([JSON.stringify(audit.data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `adjutant-audit-${runId}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }
  return (
    <Modal
      wide
      title="Signed audit packet"
      subtitle={<span className="mono">run {runId}</span>}
      onClose={onClose}
      footer={
        <>
          {audit.data && <CopyButton value={JSON.stringify(audit.data, null, 2)} label="Copy packet JSON" />}
          <button type="button" className="btn btn-primary" onClick={download} disabled={!audit.data}>
            <Download size={15} aria-hidden="true" /> Download JSON
          </button>
        </>
      }
    >
      {audit.loading && !audit.data ? (
        <LoadingBlock label="Fetching signed packet…" />
      ) : audit.error != null && !audit.data ? (
        <ErrorState error={audit.error} onRetry={audit.reload} title="Could not load the audit packet" />
      ) : audit.data ? (
        <div className="stack-sm">
          <dl className="kv kv-wide">
            <dt>Algorithm</dt>
            <dd className="mono">{audit.data.algorithm ?? '—'}</dd>
            <dt>Signature</dt>
            <dd className="mono sig">
              <span>{audit.data.signature ?? '—'}</span>
              {audit.data.signature && <CopyButton value={audit.data.signature} label="Copy signature" />}
            </dd>
          </dl>
          <div className="pane-label">Packet</div>
          <Code value={audit.data.packet ?? audit.data} maxHeight={420} />
        </div>
      ) : null}
    </Modal>
  )
}
