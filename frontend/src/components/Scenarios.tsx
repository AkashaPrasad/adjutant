import type { Scenario } from '../api/types'
import { MODE_LABEL } from '../samples'
import { linkHandler } from '../lib/router'
import { cx } from './ui'

/** Scenario rows: what it shows, the pain point it answers, what the presenter should expect. */
export function ScenarioList({
  scenarios,
  selectedId,
  onSelect,
  compact,
}: {
  scenarios: Scenario[]
  selectedId?: string | null
  onSelect?: (s: Scenario) => void
  compact?: boolean
}) {
  return (
    <div className={cx('scenarios', compact && 'scenarios-compact')}>
      {scenarios.map((s, i) => {
        const selected = selectedId === s.id
        const href = `/new?scenario=${encodeURIComponent(s.id)}`
        const body = (
          <>
            <div className="scenario-head">
              <span className="scenario-num">{i + 1}</span>
              <span className="scenario-title">{s.title}</span>
              {s.mode && <span className="scenario-mode">{MODE_LABEL[s.mode] ?? s.mode}</span>}
            </div>
            {s.tagline && <div className="scenario-tagline">{s.tagline}</div>}
            {!compact && (
              <dl className="scenario-facts">
                {s.pain_point && (
                  <div>
                    <dt>Pain point</dt>
                    <dd title={s.pain_point}>{s.pain_point}</dd>
                  </div>
                )}
                {s.expected_outcome && (
                  <div>
                    <dt>Expect</dt>
                    <dd title={s.expected_outcome}>{s.expected_outcome}</dd>
                  </div>
                )}
              </dl>
            )}
          </>
        )
        return onSelect ? (
          <button
            key={s.id}
            type="button"
            className={cx('scenario', selected && 'is-selected')}
            aria-pressed={selected}
            onClick={() => onSelect(s)}
          >
            {body}
          </button>
        ) : (
          <a key={s.id} href={href} className="scenario" onClick={linkHandler(href)}>
            {body}
          </a>
        )
      })}
    </div>
  )
}
