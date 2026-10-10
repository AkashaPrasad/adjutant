import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, api, errorMessage } from '../api/client'
import type { ArgSource, PlannedAction, Scenario, ToolDef } from '../api/types'
import { ScenarioList } from '../components/Scenarios'
import { useToast } from '../components/Toast'
import { Badge, Callout, ErrorState, PageHeader, Panel, Skeleton, Spinner, Tabs, cx, toolSystem } from '../components/ui'
import { MODEL_ID, MODEL_NAME } from '../config'
import { useScenarios } from '../lib/data'
import { useAsync, useDocumentTitle, useElapsed } from '../lib/hooks'
import { navigate, useSearchParam } from '../lib/router'
import { runCache } from '../lib/runCache'

const FALLBACK_TOOLS: ToolDef[] = [
  { name: 'email.send', kind: 'write', reversible: false, sensitive_args: ['to', 'cc'], args: [{ name: 'to', type: 'email_list' }, { name: 'cc', type: 'email_list' }, { name: 'subject', type: 'string' }, { name: 'body', type: 'string' }] },
  { name: 'slack.post', kind: 'write', reversible: true, sensitive_args: ['channel'], args: [{ name: 'channel', type: 'string' }, { name: 'text', type: 'string' }] },
  { name: 'crm.update', kind: 'write', reversible: true, sensitive_args: ['record_id'], args: [{ name: 'record_id', type: 'string' }, { name: 'fields', type: 'object' }] },
  { name: 'calendar.create_event', kind: 'write', reversible: true, sensitive_args: ['attendees'], args: [{ name: 'title', type: 'string' }, { name: 'start', type: 'datetime' }, { name: 'end', type: 'datetime' }, { name: 'attendees', type: 'email_list' }, { name: 'description', type: 'string' }] },
  { name: 'http.get', kind: 'read', reversible: false, sensitive_args: ['url'], args: [{ name: 'url', type: 'url' }] },
  { name: 'docs.search', kind: 'read', reversible: false, sensitive_args: [], args: [{ name: 'query', type: 'string' }, { name: 'limit', type: 'integer' }] },
]

interface ArgDraft {
  name: string
  text: string
  json: boolean
  source: ArgSource
}

interface ActionDraft {
  key: number
  node_id: string
  tool: string
  args: ArgDraft[]
}

type PlanOrigin = { kind: 'muse'; model?: string; dropped: number; notes?: string; taint: string[]; latencyMs?: number; effort?: string } | { kind: 'prebuilt'; title: string } | { kind: 'manual' }

let keySeq = 1

function toDraft(a: PlannedAction): ActionDraft {
  return {
    key: keySeq++,
    node_id: a.node_id,
    tool: a.tool,
    args: Object.entries(a.args).map(([name, v]) => ({
      name,
      text: typeof v === 'string' ? v : JSON.stringify(v),
      json: typeof v !== 'string',
      source: a.arg_sources?.[name] ?? 'user',
    })),
  }
}

function fromDraft(d: ActionDraft): PlannedAction {
  const args: Record<string, unknown> = {}
  const arg_sources: Record<string, ArgSource> = {}
  for (const a of d.args) {
    if (!a.name.trim()) continue
    let value: unknown = a.text
    if (a.json) {
      try {
        value = JSON.parse(a.text)
      } catch {
        throw new Error(`${d.node_id}.${a.name} is not valid JSON`)
      }
    }
    args[a.name.trim()] = value
    arg_sources[a.name.trim()] = a.source
  }
  return { node_id: d.node_id.trim(), tool: d.tool, args, arg_sources }
}

const PLAN_PHASES = [
  { at: 0, text: `Sending the goal, context and tool catalog to ${MODEL_NAME}` },
  { at: 3, text: 'Drafting tool calls, constrained to the registered tools' },
  { at: 10, text: 'Labelling every argument as user-supplied or untrusted' },
  { at: 20, text: 'Waiting for the model response' },
]

export function NewRun() {
  useDocumentTitle('New run')
  const toast = useToast()
  const scenarioParam = useSearchParam('scenario')
  const scenarios = useScenarios()
  const toolsQ = useAsync(() => api.tools(), [])
  const health = useAsync(() => api.health(), [])
  const tools = toolsQ.data?.length ? toolsQ.data : FALLBACK_TOOLS

  const [mode, setMode] = useState<'scenario' | 'free'>('scenario')
  const [scenario, setScenario] = useState<Scenario | null>(null)
  const [goal, setGoal] = useState('')
  const [context, setContext] = useState('')
  const [autoLow, setAutoLow] = useState(true)
  const [actions, setActions] = useState<ActionDraft[] | null>(null)
  const [criteria, setCriteria] = useState('')
  const [origin, setOrigin] = useState<PlanOrigin | null>(null)
  const [planning, setPlanning] = useState(false)
  const [planError, setPlanError] = useState<unknown>(null)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<unknown>(null)
  const abortRef = useRef<AbortController | null>(null)
  const elapsed = useElapsed(planning)
  const planRef = useRef<HTMLDivElement>(null)

  const pick = (s: Scenario) => {
    setScenario(s)
    setGoal(s.goal)
    setContext(s.context ?? '')
    setAutoLow(s.auto_approve_low_risk ?? true)
    setActions(null)
    setOrigin(null)
    setPlanError(null)
    setCreateError(null)
  }

  // Preselect from ?scenario=
  const list = scenarios.data?.list
  useEffect(() => {
    if (!list) return
    const s = list.find((x) => x.id === scenarioParam) ?? null
    if (s) {
      setMode('scenario')
      pick(s)
    }
  }, [list, scenarioParam])

  useEffect(() => () => abortRef.current?.abort(), [])

  const loadPlan = (planActions: PlannedAction[], doneCriteria: string[], o: PlanOrigin) => {
    setActions(planActions.map(toDraft))
    setCriteria(doneCriteria.join('\n'))
    setOrigin(o)
    window.setTimeout(() => planRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  const plan = async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setPlanning(true)
    setPlanError(null)
    try {
      const res = await api.plan(goal.trim(), context.trim() || undefined, ctrl.signal)
      if (!res.actions?.length) throw new ApiError(502, 'empty_plan', 'The planner returned no usable actions for this goal.')
      loadPlan(res.actions, res.done_criteria ?? [], {
        kind: 'muse',
        model: res.model,
        dropped: res.dropped?.length ?? 0,
        notes: res.notes,
        taint: (res.taint_propagated ?? []).map((t) => (typeof t === 'string' ? t : [t.node_id, t.arg].filter(Boolean).join('.') || String(t.value ?? ''))),
        latencyMs: res.latency_ms,
        effort: res.reasoning_effort,
      })
      toast.push('success', 'Plan drafted', `${res.actions.length} action(s) from ${MODEL_NAME}. Review, then run the shadow run.`)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'cancelled') return
      setPlanError(err)
    } finally {
      if (abortRef.current === ctrl) {
        setPlanning(false)
        abortRef.current = null
      }
    }
  }

  const usePrebuilt = () => {
    if (!scenario) return
    abortRef.current?.abort()
    setPlanning(false)
    setPlanError(null)
    loadPlan(scenario.actions, scenario.done_criteria, { kind: 'prebuilt', title: scenario.title })
  }

  const runNow = async () => {
    if (!scenario) return
    abortRef.current?.abort()
    setPlanning(false)
    setCreating(true)
    setCreateError(null)
    try {
      let run
      try {
        run = await api.runScenario(scenario.id)
      } catch (err) {
        if (!(err instanceof ApiError && (err.status === 404 || err.status === 405))) throw err
        run = await api.createRun({
          goal: scenario.goal,
          actions: scenario.actions,
          done_criteria: scenario.done_criteria,
          auto_approve_low_risk: scenario.auto_approve_low_risk ?? true,
        })
      }
      runCache.set(run.id, run)
      const s = run.summary
      toast.push('success', 'Shadow run complete', s ? `${s.total} actions previewed: ${s.auto_approved} auto, ${s.needs_approval} need approval, ${s.blocked} blocked.` : undefined)
      navigate(`/runs/${encodeURIComponent(run.id)}`)
    } catch (err) {
      setCreateError(err)
      toast.push('error', 'Shadow run failed', errorMessage(err))
    } finally {
      setCreating(false)
    }
  }

  const manual = () => {
    setPlanError(null)
    loadPlan([{ node_id: 'n1', tool: 'slack.post', args: { channel: '#general', text: '' }, arg_sources: {} }], [], { kind: 'manual' })
  }

  const create = async () => {
    if (!actions) return
    setCreateError(null)
    let body
    try {
      const planned = actions.map(fromDraft)
      const ids = planned.map((a) => a.node_id)
      if (ids.some((i) => !i)) throw new Error('Every action needs a node id')
      if (new Set(ids).size !== ids.length) throw new Error('Node ids must be unique')
      body = {
        goal: goal.trim(),
        actions: planned,
        done_criteria: criteria
          .split('\n')
          .map((c) => c.trim())
          .filter(Boolean),
        auto_approve_low_risk: autoLow,
      }
    } catch (err) {
      setCreateError(err)
      return
    }
    setCreating(true)
    try {
      const run = await api.createRun(body)
      runCache.set(run.id, run)
      const s = run.summary
      toast.push(
        'success',
        'Shadow run complete',
        s ? `${s.total} actions previewed: ${s.auto_approved} auto, ${s.needs_approval} need approval, ${s.blocked} blocked.` : undefined,
      )
      navigate(`/runs/${encodeURIComponent(run.id)}`)
    } catch (err) {
      setCreateError(err)
      toast.push('error', 'Shadow run failed', errorMessage(err))
    } finally {
      setCreating(false)
    }
  }

  const llmOff = health.data?.llm_configured === false
  const phase = [...PLAN_PHASES].reverse().find((p) => elapsed >= p.at) ?? PLAN_PHASES[0]
  const slow = planning && elapsed >= 20
  const canPlan = goal.trim().length > 0 && !planning

  return (
    <div className="page page-narrow">
      <PageHeader
        crumbs={[{ label: 'Runs', href: '/runs' }, { label: 'New run' }]}
        title="New run"
        subtitle="Describe a task. Muse drafts a plan from the registered tools; the gate shadow-runs it so you review real previews before anything is written."
      />

      <Panel title="1. Task">
        <Tabs
          label="Run source"
          value={mode}
          onChange={(m) => {
            setMode(m)
            if (m === 'free') {
              setScenario(null)
              setActions(null)
              setOrigin(null)
            }
          }}
          tabs={[
            { id: 'scenario', label: 'Demo scenario' },
            { id: 'free', label: 'Free-form' },
          ]}
        />
        {mode === 'scenario' && (
          <div className="field">
            <span className="field-label">Scenario</span>
            {scenarios.initialLoading ? (
              <Skeleton rows={5} height={36} />
            ) : (
              <ScenarioList scenarios={list ?? []} selectedId={scenario?.id} onSelect={pick} compact />
            )}
          </div>
        )}
        {mode === 'scenario' && scenario && (
          <dl className="scenario-brief">
            {scenario.pain_point && (
              <div>
                <dt>Pain point</dt>
                <dd>{scenario.pain_point}</dd>
              </div>
            )}
            {scenario.expected_outcome && (
              <div>
                <dt>Expected outcome</dt>
                <dd>{scenario.expected_outcome}</dd>
              </div>
            )}
          </dl>
        )}
        <label className="field">
          <span className="field-label">Goal</span>
          <textarea
            className="input textarea"
            rows={3}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="e.g. Follow up with Acme Supplies on pricing, tell #sales, and move acct-1001 to qualified."
          />
        </label>
        <label className="field">
          <span className="field-label">
            Context <span className="muted">optional · inbound email or document text, treated as untrusted</span>
          </span>
          <textarea
            className="input textarea mono-input"
            rows={context ? 7 : 3}
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="Paste an inbound email or page. Values the planner takes from here are labelled untrusted."
          />
        </label>
        <label className="check">
          <input type="checkbox" checked={autoLow} onChange={(e) => setAutoLow(e.target.checked)} />
          <span>Auto-approve low-risk reversible writes (reads are always auto)</span>
        </label>
        <div className="form-actions">
          <button type="button" className="btn btn-primary" disabled={!canPlan || llmOff} onClick={() => void plan()}>
            {planning ? 'Planning…' : 'Plan with Muse'}
          </button>
          {scenario && (
            <>
              <button type="button" className="btn" onClick={usePrebuilt} disabled={creating}>
                Use pre-built plan
              </button>
              <button type="button" className="btn" onClick={() => void runNow()} disabled={creating}>
                {creating && !actions ? 'Running shadow run…' : 'Run scenario now'}
              </button>
            </>
          )}
          {mode === 'free' && !actions && (
            <button type="button" className="btn btn-ghost" onClick={manual}>
              Write actions manually
            </button>
          )}
          <span className="muted small">
            Planner: {MODEL_NAME} <span className="mono">({MODEL_ID})</span>
            {llmOff && <span className="text-warning"> · not configured on this API</span>}
          </span>
        </div>

        {planning && (
          <div className="progress-block" role="status" aria-live="polite">
            <div className="progress-bar" aria-hidden="true">
              <span />
            </div>
            <div className="progress-row">
              <Spinner />
              <span>{phase.text}</span>
              <span className="mono muted">{elapsed}s</span>
              <button type="button" className="link-btn" onClick={() => abortRef.current?.abort()}>
                Cancel
              </button>
            </div>
            <ol className="progress-steps">
              {PLAN_PHASES.slice(0, 3).map((p) => (
                <li key={p.at} className={cx(elapsed >= p.at && 'is-reached')}>
                  {p.text}
                </li>
              ))}
            </ol>
          </div>
        )}
        {createError != null && !actions && <ErrorState error={createError} title="Could not start the shadow run" />}
        {slow && scenario && (
          <Callout
            tone="warning"
            title="The planner is taking longer than 20 seconds"
            action={
              <button type="button" className="btn btn-sm" onClick={usePrebuilt}>
                Use pre-built plan
              </button>
            }
          >
            The scenario ships with the same plan the planner is expected to draft. It goes through the identical gate.
          </Callout>
        )}
        {planError != null && (
          <div className="stack-sm">
            <ErrorState error={planError} title="Planning failed" onRetry={() => void plan()} />
            {scenario ? (
              <button type="button" className="btn" onClick={usePrebuilt}>
                Use pre-built plan instead
              </button>
            ) : (
              <button type="button" className="btn" onClick={manual}>
                Write actions manually
              </button>
            )}
          </div>
        )}
      </Panel>

      {actions && (
        <div ref={planRef}>
          <Panel
            title="2. Plan"
            subtitle="Edit anything before the shadow run. Each argument carries its source: the policy blocks untrusted values in a recipient, channel or record id."
            actions={
              origin?.kind === 'muse' ? (
                <Badge tone="info">Drafted by {MODEL_NAME}</Badge>
              ) : origin?.kind === 'prebuilt' ? (
                <Badge tone="neutral">Pre-built plan</Badge>
              ) : (
                <Badge tone="neutral">Manual</Badge>
              )
            }
          >
            {origin?.kind === 'muse' && (
              <div className="plan-meta">
                <span className="muted small">
                  {origin.latencyMs !== undefined ? `Planned in ${(origin.latencyMs / 1000).toFixed(1)}s` : 'Planned'}
                  {origin.effort ? ` · reasoning effort ${origin.effort}` : ''} · <span className="mono">{origin.model ?? MODEL_ID}</span>
                </span>
                {origin.taint.length > 0 && (
                  <span className="row gap-sm wrap">
                    <span className="small">Relabelled untrusted by taint propagation:</span>
                    {origin.taint.map((t) => (
                      <Badge key={t} tone="warning">
                        {t}
                      </Badge>
                    ))}
                  </span>
                )}
                {origin.notes && <blockquote className="quote">{origin.notes}</blockquote>}
              </div>
            )}
            {origin?.kind === 'muse' && origin.dropped > 0 && (
              <Callout tone="warning" title={`${origin.dropped} drafted action(s) dropped`}>
                They referenced tools that are not registered with the gate.
              </Callout>
            )}
            <ActionEditor actions={actions} tools={tools} onChange={setActions} />
            <label className="field">
              <span className="field-label">
                Done criteria <span className="muted">one per line · judged against real outputs after execution</span>
              </span>
              <textarea className="input textarea" rows={3} value={criteria} onChange={(e) => setCriteria(e.target.value)} />
            </label>
            {createError != null && <ErrorState error={createError} title="Could not start the shadow run" />}
            <div className="form-actions">
              <button type="button" className="btn btn-primary" disabled={creating || !goal.trim() || actions.length === 0} onClick={() => void create()}>
                {creating ? 'Running shadow run…' : 'Run shadow run'}
              </button>
              <span className="muted small">Reads run for real. Writes are only previewed. Nothing is sent yet.</span>
            </div>
          </Panel>
        </div>
      )}
    </div>
  )
}

function ActionEditor({
  actions,
  tools,
  onChange,
}: {
  actions: ActionDraft[]
  tools: ToolDef[]
  onChange: (a: ActionDraft[]) => void
}) {
  const toolMap = useMemo(() => new Map(tools.map((t) => [t.name, t])), [tools])
  const update = (key: number, fn: (a: ActionDraft) => ActionDraft) => onChange(actions.map((a) => (a.key === key ? fn(a) : a)))

  const addAction = () => {
    const ids = new Set(actions.map((a) => a.node_id))
    let n = actions.length + 1
    while (ids.has(`n${n}`)) n++
    const tool = tools.find((t) => t.name === 'slack.post') ?? tools[0]
    onChange([
      ...actions,
      {
        key: keySeq++,
        node_id: `n${n}`,
        tool: tool.name,
        args: (tool.args ?? []).filter((a) => a.required !== false).map((a) => ({ name: a.name, text: '', json: a.type === 'object' || a.type === 'integer', source: 'user' })),
      },
    ])
  }

  return (
    <div className="action-editor">
      {actions.map((a, idx) => {
        const def = toolMap.get(a.tool)
        const sensitive = new Set(def?.sensitive_args ?? [])
        const unused = (def?.args ?? []).filter((x) => !a.args.some((y) => y.name === x.name))
        return (
          <div key={a.key} className="ae-item">
            <div className="ae-head">
              <span className="ae-seq mono">{idx + 1}</span>
              <input
                className="input input-sm mono ae-node"
                value={a.node_id}
                aria-label="Node id"
                onChange={(e) => update(a.key, (x) => ({ ...x, node_id: e.target.value }))}
              />
              <select
                className="select select-sm"
                value={a.tool}
                aria-label="Tool"
                onChange={(e) => update(a.key, (x) => ({ ...x, tool: e.target.value }))}
              >
                {tools.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>
              <span className="muted small">
                {toolSystem(a.tool)} · {def?.kind === 'read' ? 'read' : def?.reversible ? 'reversible write' : 'irreversible write'}
              </span>
              <button type="button" className="link-btn ae-remove" onClick={() => onChange(actions.filter((x) => x.key !== a.key))}>
                Remove
              </button>
            </div>
            <table className="ae-args">
              <thead className="sr-only">
                <tr>
                  <th>Argument</th>
                  <th>Value</th>
                  <th>Source</th>
                  <th>Remove</th>
                </tr>
              </thead>
              <tbody>
                {a.args.map((arg, i) => (
                  <tr key={i}>
                    <th scope="row" className="ae-arg-name mono">
                      {arg.name}
                      {sensitive.has(arg.name) && (
                        <span className="ae-sensitive" title="Sensitive argument: an untrusted value here is blocked">
                          sensitive
                        </span>
                      )}
                    </th>
                    <td className="ae-arg-value">
                      {arg.text.length > 70 || arg.text.includes('\n') ? (
                        <textarea
                          className={cx('input textarea', arg.json && 'mono-input')}
                          rows={Math.min(6, Math.max(2, Math.ceil(arg.text.length / 80)))}
                          value={arg.text}
                          aria-label={`${a.node_id} ${arg.name}`}
                          onChange={(e) =>
                            update(a.key, (x) => ({ ...x, args: x.args.map((y, j) => (j === i ? { ...y, text: e.target.value } : y)) }))
                          }
                        />
                      ) : (
                        <input
                          className={cx('input input-sm', arg.json && 'mono-input')}
                          value={arg.text}
                          aria-label={`${a.node_id} ${arg.name}`}
                          onChange={(e) =>
                            update(a.key, (x) => ({ ...x, args: x.args.map((y, j) => (j === i ? { ...y, text: e.target.value } : y)) }))
                          }
                        />
                      )}
                    </td>
                    <td className="ae-arg-source">
                      <div className="source-toggle" role="radiogroup" aria-label={`Source of ${arg.name}`}>
                        {(['user', 'untrusted'] as ArgSource[]).map((src) => (
                          <button
                            key={src}
                            type="button"
                            role="radio"
                            aria-checked={arg.source === src}
                            className={cx('source-opt', arg.source === src && `is-${src}`)}
                            onClick={() =>
                              update(a.key, (x) => ({ ...x, args: x.args.map((y, j) => (j === i ? { ...y, source: src } : y)) }))
                            }
                          >
                            {src}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="ae-arg-remove">
                      <button
                        type="button"
                        className="link-btn"
                        aria-label={`Remove argument ${arg.name}`}
                        onClick={() => update(a.key, (x) => ({ ...x, args: x.args.filter((_, j) => j !== i) }))}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {unused.length > 0 && (
              <div className="ae-add-arg">
                <span className="muted small">Add argument:</span>
                {unused.map((u) => (
                  <button
                    key={u.name}
                    type="button"
                    className="link-btn mono"
                    onClick={() =>
                      update(a.key, (x) => ({
                        ...x,
                        args: [...x.args, { name: u.name, text: '', json: u.type === 'object' || u.type === 'integer', source: 'user' }],
                      }))
                    }
                  >
                    {u.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
      <button type="button" className="btn btn-sm" onClick={addAction}>
        Add action
      </button>
    </div>
  )
}
