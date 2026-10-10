import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Eye,
  FileSignature,
  Lock,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react'
import { ApiError, api, errorMessage } from '../api/client'
import type { ArgSource, Health, PlannedAction, ToolDef } from '../api/types'
import { Badge } from '../components/Badge'
import { useToast } from '../components/Toast'
import { Callout, ErrorState, Skeleton, Spinner } from '../components/ui'
import { useAsync, useDocumentTitle } from '../lib/hooks'
import { navigate } from '../lib/router'
import { runCache } from '../lib/runCache'
import { SAMPLES, resolveTool } from '../samples'

interface DraftAction {
  uid: number
  node_id: string
  tool: string
  argsText: string
  arg_sources: Record<string, ArgSource>
}

interface Draft {
  goal: string
  actions: DraftAction[]
  done: string[]
  autoApprove: boolean
}

const STORAGE_KEY = 'adjutant.draft.v1'
let uidSeq = 1

function emptyDraft(): Draft {
  return { goal: '', actions: [], done: [''], autoApprove: false }
}

function loadDraft(): Draft {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyDraft()
    const d = JSON.parse(raw) as Draft
    d.actions = (d.actions || []).map((a) => ({ ...a, uid: uidSeq++ }))
    if (!d.done?.length) d.done = ['']
    return d
  } catch {
    return emptyDraft()
  }
}

function parseArgs(text: string): { value?: Record<string, unknown>; error?: string } {
  if (!text.trim()) return { value: {} }
  try {
    const v = JSON.parse(text)
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { error: 'Args must be a JSON object.' }
    return { value: v as Record<string, unknown> }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Invalid JSON' }
  }
}

function toDraftAction(a: PlannedAction, idx: number): DraftAction {
  const args = a.args && typeof a.args === 'object' ? a.args : {}
  const sources: Record<string, ArgSource> = {}
  for (const k of Object.keys(args)) sources[k] = a.arg_sources?.[k] === 'untrusted' ? 'untrusted' : 'user'
  return {
    uid: uidSeq++,
    node_id: a.node_id || `n${idx + 1}`,
    tool: a.tool || '',
    argsText: JSON.stringify(args, null, 2),
    arg_sources: sources,
  }
}

const GATE_STEPS = [
  { icon: Eye, title: 'Preview', body: 'Every side effect is shadow-run first. Nothing touches a real system yet.' },
  { icon: ShieldCheck, title: 'Approve', body: 'Only risky items need a human. Approval binds to the exact args hash.' },
  { icon: Zap, title: 'Execute once', body: 'An effect ledger with idempotency keys guarantees exactly-once.' },
  { icon: RotateCcw, title: 'Undo', body: 'Reversible effects are compensated newest-first.' },
  { icon: CheckCircle2, title: 'Verify', body: 'Done means verified against the done criteria, not just “no error”.' },
  { icon: FileSignature, title: 'Sign', body: 'Each run produces a signed audit packet.' },
]

export function NewRun({ health }: { health: Health | undefined }) {
  useDocumentTitle('New run')
  const toast = useToast()
  const tools = useAsync(() => api.tools(), [])
  const toolList = useMemo(() => tools.data ?? [], [tools.data])
  const toolMap = useMemo(() => new Map(toolList.map((t) => [t.name, t])), [toolList])

  const [draft, setDraft] = useState<Draft>(loadDraft)
  const [planning, setPlanning] = useState(false)
  const [planError, setPlanError] = useState<unknown>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<unknown>(null)
  const [showErrors, setShowErrors] = useState(false)

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft))
    } catch {
      /* storage unavailable */
    }
  }, [draft])

  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))
  const updateAction = (uid: number, patch: Partial<DraftAction>) =>
    setDraft((d) => ({ ...d, actions: d.actions.map((a) => (a.uid === uid ? { ...a, ...patch } : a)) }))

  const addAction = () =>
    setDraft((d) => ({
      ...d,
      actions: [
        ...d.actions,
        {
          uid: uidSeq++,
          node_id: `n${d.actions.length + 1}`,
          tool: toolList.find((t) => t.kind === 'write')?.name ?? toolList[0]?.name ?? '',
          argsText: '{\n  \n}',
          arg_sources: {},
        },
      ],
    }))

  const loadSample = (id: string) => {
    const s = SAMPLES.find((x) => x.id === id)
    if (!s) return
    setPlanError(null)
    setSubmitError(null)
    setShowErrors(false)
    setDraft({
      goal: s.goal,
      actions: s.actions.map((a, i) =>
        toDraftAction(
          { node_id: a.node_id, tool: resolveTool(a.toolHints, toolList), args: a.args, arg_sources: a.arg_sources },
          i,
        ),
      ),
      done: [...s.done_criteria],
      autoApprove: !!s.auto_approve_low_risk,
    })
  }

  const draftPlan = async () => {
    if (!draft.goal.trim()) {
      setShowErrors(true)
      return
    }
    setPlanning(true)
    setPlanError(null)
    try {
      const plan = await api.plan(draft.goal.trim())
      const actions = (plan.actions ?? []).map(toDraftAction)
      setDraft((d) => ({
        ...d,
        actions,
        done: plan.done_criteria?.length ? [...plan.done_criteria] : d.done,
      }))
      toast.push('success', 'Plan drafted', `${actions.length} action${actions.length === 1 ? '' : 's'} proposed. Review before running.`)
    } catch (err) {
      setPlanError(err)
    } finally {
      setPlanning(false)
    }
  }

  const parsed = draft.actions.map((a) => parseArgs(a.argsText))
  const goalError = !draft.goal.trim() ? 'Describe the goal for this run.' : null
  const actionsError = draft.actions.length === 0 ? 'Add at least one action, draft a plan, or load a sample.' : null
  const hasArgErrors = parsed.some((p) => p.error) || draft.actions.some((a) => !a.tool.trim() || !a.node_id.trim())
  const nodeIds = draft.actions.map((a) => a.node_id.trim())
  const dupIds = nodeIds.filter((id, i) => id && nodeIds.indexOf(id) !== i)

  const submit = async () => {
    setShowErrors(true)
    if (goalError || actionsError || hasArgErrors || dupIds.length) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const actions: PlannedAction[] = draft.actions.map((a, i) => {
        const args = parsed[i].value ?? {}
        const arg_sources: Record<string, ArgSource> = {}
        for (const k of Object.keys(args)) arg_sources[k] = a.arg_sources[k] ?? 'user'
        return { node_id: a.node_id.trim(), tool: a.tool.trim(), args, arg_sources }
      })
      const done = draft.done.map((d) => d.trim()).filter(Boolean)
      const run = await api.createRun({
        goal: draft.goal.trim(),
        actions,
        ...(done.length ? { done_criteria: done } : {}),
        auto_approve_low_risk: draft.autoApprove,
      })
      runCache.set(run.id, run)
      toast.push('success', 'Shadow run created', 'Nothing has been executed. Review the plan diff.')
      navigate(`/runs/${encodeURIComponent(run.id)}`)
    } catch (err) {
      setSubmitError(err)
    } finally {
      setSubmitting(false)
    }
  }

  const plannerOff = health?.llm_configured === false
  const planUnavailable = planError instanceof ApiError && planError.status === 503

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">New run</h1>
          <p className="page-sub">
            Describe a goal, review the proposed actions, then shadow-run them. Nothing executes until it is approved.
          </p>
        </div>
      </div>

      <div className="split">
        <div className="stack">
          <section className="card" aria-labelledby="goal-h">
            <div className="card-head">
              <h2 id="goal-h" className="card-title">
                Goal
              </h2>
              <div className="row gap-sm wrap">
                <label className="sr-only" htmlFor="sample-select">
                  Load sample
                </label>
                <select
                  id="sample-select"
                  className="select select-sm"
                  value=""
                  onChange={(e) => {
                    loadSample(e.target.value)
                    e.target.value = ''
                  }}
                >
                  <option value="" disabled>
                    Load sample…
                  </option>
                  {SAMPLES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
                {(draft.goal || draft.actions.length > 0) && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setDraft(emptyDraft())
                      setPlanError(null)
                      setSubmitError(null)
                      setShowErrors(false)
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
            <div className="card-body stack-sm">
              <label htmlFor="goal" className="sr-only">
                Goal
              </label>
              <textarea
                id="goal"
                className="textarea"
                rows={3}
                placeholder="e.g. Follow up with Northwind about the delayed PO-4417 shipment, update #procurement and the CRM."
                value={draft.goal}
                onChange={(e) => update({ goal: e.target.value })}
                aria-invalid={showErrors && !!goalError}
                aria-describedby={showErrors && goalError ? 'goal-err' : undefined}
              />
              {showErrors && goalError && (
                <div id="goal-err" className="field-error">
                  {goalError}
                </div>
              )}
              <div className="row gap-sm wrap between">
                <button type="button" className="btn btn-accent-soft" onClick={draftPlan} disabled={planning}>
                  {planning ? <Spinner size={14} /> : <Sparkles size={15} aria-hidden="true" />}
                  {planning ? 'Drafting plan…' : 'Draft plan with Muse Spark'}
                </button>
                <span className="muted small">
                  {plannerOff
                    ? 'Planner is not configured on this API. Use a sample or add actions by hand.'
                    : `Planner: ${health?.model ?? 'Muse Spark 1.3 Contributor'}`}
                </span>
              </div>
              {planError != null &&
                (planUnavailable ? (
                  <Callout tone="warning" title="Planner unavailable" onDismiss={() => setPlanError(null)}>
                    The Muse Spark planner is not configured on this API (503). You can still load a sample or build the
                    action list by hand; the gate works the same either way.
                  </Callout>
                ) : (
                  <Callout tone="danger" title="Could not draft a plan" onDismiss={() => setPlanError(null)}>
                    {errorMessage(planError)}
                  </Callout>
                ))}
            </div>
          </section>

          <section className="card" aria-labelledby="actions-h">
            <div className="card-head">
              <h2 id="actions-h" className="card-title">
                Actions <span className="count">{draft.actions.length}</span>
              </h2>
              <button type="button" className="btn btn-sm" onClick={addAction}>
                <Plus size={14} aria-hidden="true" /> Add action
              </button>
            </div>
            <div className="card-body stack-sm">
              {tools.error != null && !tools.data && (
                <Callout tone="warning" title="Tool catalog unavailable">
                  {errorMessage(tools.error)} Tool names can still be typed by hand.
                </Callout>
              )}
              {draft.actions.length === 0 ? (
                <div className={`empty-inline${showErrors && actionsError ? ' empty-inline-error' : ''}`}>
                  <p>No actions yet.</p>
                  <p className="muted small">Draft a plan with Muse Spark, load a sample, or add actions manually.</p>
                </div>
              ) : (
                draft.actions.map((a, i) => (
                  <ActionEditor
                    key={a.uid}
                    index={i}
                    action={a}
                    tools={toolList}
                    toolDef={toolMap.get(a.tool)}
                    parsed={parsed[i]}
                    duplicate={dupIds.includes(a.node_id.trim())}
                    showErrors={showErrors}
                    onChange={(patch) => updateAction(a.uid, patch)}
                    onRemove={() => setDraft((d) => ({ ...d, actions: d.actions.filter((x) => x.uid !== a.uid) }))}
                  />
                ))
              )}
            </div>
          </section>

          <section className="card" aria-labelledby="done-h">
            <div className="card-head">
              <h2 id="done-h" className="card-title">
                Done criteria
              </h2>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => update({ done: [...draft.done, ''] })}>
                <Plus size={14} aria-hidden="true" /> Add
              </button>
            </div>
            <div className="card-body stack-xs">
              <p className="muted small">After execution, the gate verifies each criterion. A run is only done when verified.</p>
              {draft.done.map((d, i) => (
                <div className="row gap-xs" key={i}>
                  <label className="sr-only" htmlFor={`done-${i}`}>
                    Done criterion {i + 1}
                  </label>
                  <input
                    id={`done-${i}`}
                    className="input"
                    value={d}
                    placeholder="e.g. Slack message is posted in #procurement"
                    onChange={(e) => update({ done: draft.done.map((x, j) => (j === i ? e.target.value : x)) })}
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Remove criterion ${i + 1}`}
                    onClick={() => update({ done: draft.done.length > 1 ? draft.done.filter((_, j) => j !== i) : [''] })}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </section>

          <div className="submit-bar">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={draft.autoApprove}
                onChange={(e) => update({ autoApprove: e.target.checked })}
              />
              <span>
                Auto-approve low-risk items
                <span className="muted small block">Medium and high risk still require a reviewer.</span>
              </span>
            </label>
            <div className="row gap-sm wrap end">
              {showErrors && (actionsError || hasArgErrors || dupIds.length > 0) && (
                <span className="field-error" role="alert">
                  {actionsError ??
                    (dupIds.length ? `Duplicate node id: ${dupIds[0]}` : 'Fix the highlighted actions first.')}
                </span>
              )}
              <button type="button" className="btn btn-primary" onClick={submit} disabled={submitting}>
                {submitting ? <Spinner size={14} /> : <Eye size={15} aria-hidden="true" />}
                {submitting ? 'Running shadow preview…' : 'Run shadow preview'}
                {!submitting && <ArrowRight size={15} aria-hidden="true" />}
              </button>
            </div>
          </div>
          {submitError != null && <ErrorState error={submitError} title="Could not create the run" />}
        </div>

        <aside className="stack">
          <section className="card" aria-labelledby="how-h">
            <div className="card-head">
              <h2 id="how-h" className="card-title">
                How the gate works
              </h2>
            </div>
            <ol className="steps">
              {GATE_STEPS.map((s) => (
                <li key={s.title} className="step">
                  <span className="step-icon" aria-hidden="true">
                    <s.icon size={15} />
                  </span>
                  <div>
                    <div className="step-title">{s.title}</div>
                    <div className="step-body">{s.body}</div>
                  </div>
                </li>
              ))}
            </ol>
            <div className="card-foot">
              <Lock size={13} aria-hidden="true" />
              <span>
                <strong>Taint rule:</strong> untrusted data may fill a body, never a recipient, channel or target.
              </span>
            </div>
          </section>

          <section className="card" aria-labelledby="tools-h">
            <div className="card-head">
              <h2 id="tools-h" className="card-title">
                <BookOpen size={15} aria-hidden="true" /> Tool catalog
              </h2>
              {tools.data && <span className="count">{tools.data.length}</span>}
            </div>
            <div className="card-body">
              {tools.loading && !tools.data ? (
                <Skeleton rows={4} />
              ) : tools.error != null && !tools.data ? (
                <ErrorState error={tools.error} onRetry={tools.reload} title="Could not load tools" />
              ) : toolList.length === 0 ? (
                <p className="muted small">This API exposes no tools.</p>
              ) : (
                <ul className="tool-list">
                  {toolList.map((t) => (
                    <li key={t.name} className="tool-item">
                      <div className="row gap-xs wrap">
                        <code className="tool-name">{t.name}</code>
                        {t.kind && <Badge tone={t.kind === 'write' ? 'accent' : 'neutral'}>{t.kind}</Badge>}
                        {t.kind === 'write' &&
                          (t.reversible ? <Badge tone="success">reversible</Badge> : <Badge tone="warning">irreversible</Badge>)}
                      </div>
                      {t.description && <div className="muted small">{t.description}</div>}
                      {!!t.sensitive_args?.length && (
                        <div className="small sensitive-line">
                          <Lock size={11} aria-hidden="true" /> {t.sensitive_args.join(', ')}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}

function ActionEditor({
  index,
  action,
  tools,
  toolDef,
  parsed,
  duplicate,
  showErrors,
  onChange,
  onRemove,
}: {
  index: number
  action: DraftAction
  tools: ToolDef[]
  toolDef: ToolDef | undefined
  parsed: { value?: Record<string, unknown>; error?: string }
  duplicate: boolean
  showErrors: boolean
  onChange: (patch: Partial<DraftAction>) => void
  onRemove: () => void
}) {
  const id = `act-${action.uid}`
  const keys = parsed.value ? Object.keys(parsed.value) : []
  const sensitive = new Set(toolDef?.sensitive_args ?? [])
  const knownTool = tools.some((t) => t.name === action.tool)
  const taintedSensitive = keys.filter((k) => sensitive.has(k) && action.arg_sources[k] === 'untrusted')
  const lines = Math.min(14, Math.max(4, action.argsText.split('\n').length + 1))

  return (
    <div className={`action-editor${parsed.error && showErrors ? ' has-error' : ''}`}>
      <div className="action-editor-head">
        <span className="action-index" aria-hidden="true">
          {index + 1}
        </span>
        <div className="field grow">
          <label htmlFor={`${id}-tool`} className="field-label">
            Tool
          </label>
          {tools.length > 0 ? (
            <select
              id={`${id}-tool`}
              className="select mono"
              value={knownTool ? action.tool : '__custom'}
              onChange={(e) => e.target.value !== '__custom' && onChange({ tool: e.target.value })}
            >
              {!knownTool && <option value="__custom">{action.tool || 'Select a tool'} (unknown)</option>}
              {tools.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                  {t.kind ? ` · ${t.kind}` : ''}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={`${id}-tool`}
              className="input mono"
              value={action.tool}
              placeholder="tool.name"
              onChange={(e) => onChange({ tool: e.target.value })}
            />
          )}
        </div>
        <div className="field node-field">
          <label htmlFor={`${id}-node`} className="field-label">
            Node id
          </label>
          <input
            id={`${id}-node`}
            className="input mono"
            value={action.node_id}
            aria-invalid={duplicate || (showErrors && !action.node_id.trim())}
            onChange={(e) => onChange({ node_id: e.target.value })}
          />
        </div>
        <button type="button" className="icon-btn action-remove" aria-label={`Remove action ${index + 1}`} onClick={onRemove}>
          <Trash2 size={15} />
        </button>
      </div>
      {toolDef?.description && <p className="muted small action-desc">{toolDef.description}</p>}

      <div className="field">
        <label htmlFor={`${id}-args`} className="field-label">
          Args <span className="muted">(JSON)</span>
        </label>
        <textarea
          id={`${id}-args`}
          className="textarea mono code-input"
          rows={lines}
          spellCheck={false}
          value={action.argsText}
          aria-invalid={!!parsed.error}
          aria-describedby={parsed.error ? `${id}-args-err` : undefined}
          onChange={(e) => onChange({ argsText: e.target.value })}
        />
        {parsed.error && (
          <div id={`${id}-args-err`} className="field-error">
            {parsed.error}
          </div>
        )}
      </div>

      {keys.length > 0 && (
        <div className="field">
          <div className="field-label" id={`${id}-src`}>
            Arg sources
          </div>
          <div className="source-grid" role="group" aria-labelledby={`${id}-src`}>
            {keys.map((k) => {
              const src = action.arg_sources[k] ?? 'user'
              return (
                <div key={k} className="source-row">
                  <code className="source-key">
                    {sensitive.has(k) && <Lock size={11} aria-label="sensitive argument" />} {k}
                  </code>
                  <div className="segmented" role="radiogroup" aria-label={`Source of ${k}`}>
                    {(['user', 'untrusted'] as const).map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        role="radio"
                        aria-checked={src === opt}
                        className={`seg${src === opt ? ` seg-on seg-${opt}` : ''}`}
                        onClick={() => onChange({ arg_sources: { ...action.arg_sources, [k]: opt } })}
                      >
                        {opt === 'user' ? 'User' : 'Untrusted'}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
          {taintedSensitive.length > 0 && (
            <div className="taint-note">
              <Lock size={12} aria-hidden="true" /> Untrusted data in {taintedSensitive.join(', ')}. The gate will block this
              item.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
