import { api } from '../api/client'
import { Badge, PageHeader, Panel, Skeleton } from '../components/ui'
import { CollapsiblePanel } from '../components/Glyphs'
import { MODEL_FULL_NAME, MODEL_ID, MODEL_NAME } from '../config'
import { useAsync, useDocumentTitle } from '../lib/hooks'
import { linkHandler } from '../lib/router'

const STAGES = [
  { title: 'Shadow run', lines: ['Reads run for real,', 'writes are previewed'] },
  { title: 'Plan diff', lines: ['One batched review', 'per task, not per call'] },
  { title: 'Calibrated gate', lines: ['AUTO / ASK / BLOCK,', 'approval bound to hash'] },
  { title: 'Effect ledger', lines: ['Exactly once,', 'undo newest first'] },
  { title: 'Proof of done', lines: ['Criteria judged on', 'real outputs, signed'] },
]

function DataPlane() {
  const W = 1150
  const boxW = 160
  const gap = 18
  const y = 64
  const h = 64
  const x0 = 120
  const end = x0 + STAGES.length * (boxW + gap) - gap
  return (
    <div className="diagram-wrap">
      <svg className="diagram" viewBox={`0 0 ${W} 210`} role="img" aria-labelledby="dp-title dp-desc">
        <title id="dp-title">Adjutant Gate data plane</title>
        <desc id="dp-desc">
          An agent's plan flows through five stages, shadow run, plan diff, calibrated gate, effect ledger and proof of done,
          before it reaches real systems. Only approved actions with a matching args hash cross into the systems.
        </desc>
        <defs>
          <marker id="dp-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="dg-arrowhead" />
          </marker>
        </defs>

        {/* agent */}
        <rect x="8" y={y} width="88" height={h} rx="6" className="dg-ext" />
        <text x="52" y={y + 28} textAnchor="middle" className="dg-title">
          AI agent
        </text>
        <text x="52" y={y + 46} textAnchor="middle" className="dg-sub">
          proposes plan
        </text>
        <line x1="96" y1={y + h / 2} x2={x0 - 4} y2={y + h / 2} className="dg-line" markerEnd="url(#dp-arrow)" />

        {/* gate boundary */}
        <rect x={x0 - 12} y="20" width={end - x0 + 24} height="168" rx="8" className="dg-boundary" />
        <text x={x0} y="40" className="dg-label">
          Adjutant Gate
        </text>
        <text x={end} y="40" textAnchor="end" className="dg-label dg-muted">
          deterministic policy · {MODEL_NAME} plans and judges
        </text>

        {STAGES.map((s, i) => {
          const x = x0 + i * (boxW + gap)
          return (
            <g key={s.title}>
              <rect x={x} y={y} width={boxW} height={h} rx="6" className={i === 2 ? 'dg-box dg-key' : 'dg-box'} />
              <text x={x + 12} y={y + 22} className="dg-num">
                {i + 1}
              </text>
              <text x={x + 26} y={y + 22} className="dg-title">
                {s.title}
              </text>
              <text x={x + 12} y={y + 40} className="dg-sub">
                {s.lines[0]}
              </text>
              <text x={x + 12} y={y + 54} className="dg-sub">
                {s.lines[1]}
              </text>
              {i < STAGES.length - 1 && (
                <line x1={x + boxW} y1={y + h / 2} x2={x + boxW + gap - 2} y2={y + h / 2} className="dg-line" markerEnd="url(#dp-arrow)" />
              )}
            </g>
          )
        })}

        {/* blocked branch out of the gate */}
        <path d={`M ${x0 + 2 * (boxW + gap) + boxW / 2} ${y + h} V ${y + h + 34}`} className="dg-line dg-danger" markerEnd="url(#dp-arrow)" />
        <text x={x0 + 2 * (boxW + gap) + boxW / 2} y={y + h + 50} textAnchor="middle" className="dg-sub dg-danger-text">
          BLOCK: taint in recipient, channel or id
        </text>

        {/* systems */}
        <line x1={end} y1={y + h / 2} x2={end + 30} y2={y + h / 2} className="dg-line" markerEnd="url(#dp-arrow)" />
        <rect x={end + 32} y={y} width={W - end - 40} height={h} rx="6" className="dg-ext" />
        <text x={end + 32 + (W - end - 40) / 2} y={y + 28} textAnchor="middle" className="dg-title">
          Real systems
        </text>
        <text x={end + 32 + (W - end - 40) / 2} y={y + 46} textAnchor="middle" className="dg-sub">
          email · Slack · CRM
        </text>
      </svg>
    </div>
  )
}

const PAINS: [string, string, string, string][] = [
  ['Actions cannot be taken back', 'Effect ledger, newest-first undo', 'No double sends', 'Effect ledger keyed on (run, node, args hash); compensation runs newest first. No double sends on retry; undo where the system allows it.'],
  ['Review fails at volume (93-97% rubber-stamped)', 'Shadow run, one batched plan diff', 'One review per task', 'Shadow run first, then one batched plan diff; policy auto-approves low-risk reversible writes. One review per task, only for actions that need it.'],
  ['Approved one thing, ran another', 'Approval bound to args hash', 'What you saw runs', 'Approval is bound to the args hash; any edit goes back through the gate.'],
  ['Injected content choosing a recipient', 'Per-argument taint', 'Inbound text cannot redirect', 'Untrusted data may fill a body, never `to`, `channel` or a record id. Inbound mail and web pages cannot redirect an action.'],
  ['Agents report work they did not do', 'Criteria judged on real outputs', 'Done means verified', 'Checkable done-criteria judged against the real outputs of executed effects.'],
  ['No evidence for auditors', 'Signed audit packet (HMAC)', 'Audit-ready evidence', 'HMAC-SHA256 over canonical JSON: plan, diff, decision, reviewer, effects, events. Evidence for EU AI Act record keeping and AIUC-1.'],
]

const RULES = [
  ['1', 'Shadow run failed (invalid arguments)', 'Block', 'High'],
  ['2', 'Untrusted value in a sensitive argument (taint)', 'Block', 'High'],
  ['3', 'Read', 'Auto', 'Low'],
  ['4', 'Irreversible write (email)', 'Ask', 'High'],
  ['5', 'Reversible write carrying untrusted content', 'Ask', 'Medium'],
  ['6', 'Reversible write with trusted arguments', 'Auto (if enabled)', 'Low'],
]


export function HowItWorks() {
  useDocumentTitle('How it works')
  const tools = useAsync(() => api.tools(), [])
  return (
    <div className="page page-narrow">
      <PageHeader
        title="How it works"
        subtitle="The action layer between an AI agent and real systems."
        actions={
          <a href="/new?scenario=vendor-followup" className="btn btn-primary" onClick={linkHandler('/new?scenario=vendor-followup')}>
            Try a scenario
          </a>
        }
      />

      <Panel title="Data plane">
        <DataPlane />
      </Panel>

      <Panel title="Problems it removes" flush>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Problem</th>
                <th scope="col">Gate mechanism</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {PAINS.map(([p, d, r, full]) => (
                <tr key={p} title={full.replace(/`/g, '')}>
                  <td className="nowrap w-500">{p}</td>
                  <td className="nowrap text-2">{d}</td>
                  <td className="nowrap">{r}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid-1-1">
        <CollapsiblePanel title="Policy rules" subtitle="Deterministic, evaluated in order">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col" className="num">
                    #
                  </th>
                  <th scope="col">Condition</th>
                  <th scope="col">Decision</th>
                  <th scope="col">Risk</th>
                </tr>
              </thead>
              <tbody>
                {RULES.map(([n, c, d, r]) => (
                  <tr key={n}>
                    <td className="num">{n}</td>
                    <td className="cell-wrap">{c}</td>
                    <td className="nowrap">
                      <Badge tone={d === 'Block' ? 'danger' : d === 'Ask' ? 'warning' : 'neutral'} dot>
                        {d}
                      </Badge>
                    </td>
                    <td className={r === 'High' ? 'risk risk-high' : r === 'Medium' ? 'risk risk-medium' : 'risk'}>{r}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CollapsiblePanel>
        <CollapsiblePanel title="Why Muse" subtitle={`${MODEL_FULL_NAME} · ${MODEL_ID}`}>
          <div className="prose">
            <p>
              The model is used for the two jobs that need language understanding, and nothing else:
            </p>
            <ul>
              <li>
                <strong className="w-500">Planner.</strong> Turns a goal and context into tool calls, constrained by JSON schema to the
                registered tools, and labels every argument as user-supplied or untrusted. Unlabelled output is treated as untrusted.
              </li>
              <li>
                <strong className="w-500">Judge.</strong> After execution, decides whether each done-criterion is met, citing the
                executed effects and their real outputs, not the plan. If the model is unavailable the judge falls back to deterministic
                state checks and says so.
              </li>
            </ul>
            <p>
              Risk policy, taint, hashing, the ledger and signing are deterministic code, so the gate behaves the same whatever the
              model says.
            </p>
          </div>
        </CollapsiblePanel>
      </div>

      <CollapsiblePanel title="Registered tools" subtitle="GET /v1/tools">
        {tools.initialLoading ? (
          <div className="panel-body">
            <Skeleton rows={6} />
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Tool</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Undo</th>
                  <th scope="col">Sensitive arguments</th>
                  <th scope="col">Description</th>
                </tr>
              </thead>
              <tbody>
                {(tools.data ?? []).map((t) => (
                  <tr key={t.name}>
                    <td className="mono nowrap">{t.name}</td>
                    <td>{t.kind}</td>
                    <td>{t.kind === 'read' ? '—' : t.reversible ? 'Reversible' : <span className="text-warning">Irreversible</span>}</td>
                    <td className="mono">{(t.sensitive_args ?? []).join(', ') || '—'}</td>
                    <td className="cell-wrap text-2">{t.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsiblePanel>
    </div>
  )
}
