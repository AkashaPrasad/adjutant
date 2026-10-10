import { useState } from 'react'
import { errorMessage } from '../api/client'
import type { Scenario } from '../api/types'
import { MODE_LABEL } from '../samples'
import { predictDecision, startScenario, type Predicted } from '../lib/predict'
import { linkHandler, navigate } from '../lib/router'
import { runCache } from '../lib/runCache'
import { ChevronGlyph } from './Glyphs'
import { useToast } from './Toast'
import { cx } from './ui'

const LABEL: Record<Predicted, string> = { auto: 'Auto', ask: 'Needs approval', block: 'Blocked' }

/** One dot per action: gray auto, amber needs approval, red blocked. Tooltip names each action. */
export function DecisionStrip({ s, crmIds }: { s: Scenario; crmIds?: Set<string> }) {
  const marks = s.actions.map((a) => ({ a, d: predictDecision(a, s.auto_approve_low_risk ?? true, crmIds) }))
  const summary = (['auto', 'ask', 'block'] as Predicted[])
    .map((d) => [d, marks.filter((m) => m.d === d).length] as const)
    .filter(([, n]) => n)
    .map(([d, n]) => `${n} ${LABEL[d].toLowerCase()}`)
    .join(', ')
  return (
    <span className="strip" role="img" aria-label={`Expected gate decisions: ${summary}`} title={marks.map((m) => `${m.a.tool}: ${LABEL[m.d]}`).join('\n')}>
      {marks.map((m, i) => (
        <span key={i} className={cx('strip-dot', `is-${m.d}`)} />
      ))}
    </span>
  )
}

/** Compact scenario rows: number, title, mode tag, decision strip, Run, and a chevron for details. */
export function ScenarioList({
  scenarios,
  selectedId,
  onSelect,
  crmIds,
}: {
  scenarios: Scenario[]
  selectedId?: string | null
  onSelect?: (s: Scenario) => void
  crmIds?: Set<string>
}) {
  const toast = useToast()
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const run = async (s: Scenario) => {
    setBusy(s.id)
    try {
      const r = await startScenario(s)
      runCache.set(r.id, r)
      const sum = r.summary
      toast.push('success', 'Shadow run complete', sum ? `${sum.auto_approved} auto, ${sum.needs_approval} need approval, ${sum.blocked} blocked.` : undefined)
      navigate(`/runs/${encodeURIComponent(r.id)}`)
    } catch (err) {
      toast.push('error', 'Could not start the scenario', errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <ul className="scen">
      {scenarios.map((s, i) => {
        const selected = selectedId === s.id
        const isOpen = open === s.id
        const mode = s.mode ? (MODE_LABEL[s.mode] ?? s.mode) : ''
        const head = (
          <>
            <span className="scen-num">{i + 1}</span>
            <span className="scen-title" title={s.title}>
              {s.title}
            </span>
            {mode && <span className="scen-mode">{mode}</span>}
            <DecisionStrip s={s} crmIds={crmIds} />
          </>
        )
        return (
          <li key={s.id} className={cx('scen-row', selected && 'is-selected', isOpen && 'is-open')}>
            <div className="scen-line">
              {onSelect ? (
                <button type="button" className="scen-main" aria-pressed={selected} onClick={() => onSelect(s)}>
                  {head}
                </button>
              ) : (
                <div className="scen-main">{head}</div>
              )}
              {!onSelect && (
                <button type="button" className="btn btn-sm" disabled={busy !== null} onClick={() => void run(s)}>
                  {busy === s.id ? 'Running…' : 'Run'}
                </button>
              )}
              <button
                type="button"
                className="icon-toggle"
                aria-expanded={isOpen}
                aria-label={`${isOpen ? 'Hide' : 'Show'} details for ${s.title}`}
                onClick={() => setOpen(isOpen ? null : s.id)}
              >
                <ChevronGlyph size={12} className={cx('chev', isOpen && 'is-open')} />
              </button>
            </div>
            {isOpen && (
              <dl className="scen-detail">
                {s.tagline && (
                  <div>
                    <dt>Shows</dt>
                    <dd>{s.tagline}</dd>
                  </div>
                )}
                {s.pain_point && (
                  <div>
                    <dt>Pain point</dt>
                    <dd>{s.pain_point}</dd>
                  </div>
                )}
                {s.expected_outcome && (
                  <div>
                    <dt>Expect</dt>
                    <dd>{s.expected_outcome}</dd>
                  </div>
                )}
                {s.description && (
                  <div>
                    <dt>About</dt>
                    <dd>{s.description}</dd>
                  </div>
                )}
                {!onSelect && (
                  <div>
                    <dt />
                    <dd>
                      <a href={`/new?scenario=${encodeURIComponent(s.id)}`} onClick={linkHandler(`/new?scenario=${encodeURIComponent(s.id)}`)}>
                        Open in New run to plan with Muse
                      </a>
                    </dd>
                  </div>
                )}
              </dl>
            )}
          </li>
        )
      })}
    </ul>
  )
}
