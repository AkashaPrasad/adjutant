import type { ActivityEvent, RunEvent } from '../api/types'
import { formatDateTime, formatTime, relativeTime } from '../lib/format'
import { eventDetail, eventMeta, runStatusMeta } from '../lib/labels'
import { linkHandler } from '../lib/router'
import { cx } from './ui'

function labelFor(type: string, data?: Record<string, unknown> | null) {
  if (type === 'run.status') {
    const meta = runStatusMeta(String(data?.status ?? ''))
    return { label: `Status: ${meta.label}`, tone: meta.tone }
  }
  return eventMeta(type, data)
}

/** One line per event: status dot, short label, relative time. Run goal and detail on hover. */
export function ActivityFeed({ events }: { events: ActivityEvent[] }) {
  return (
    <ul className="feed">
      {events.map((e) => {
        const meta = labelFor(e.type, e.data)
        const detail = eventDetail(e.type, e.data)
        const tip = [e.goal || e.run_id, detail, formatDateTime(e.at)].filter(Boolean).join('\n')
        return (
          <li key={`${e.id}-${e.type}`}>
            <a href={`/runs/${e.run_id}`} onClick={linkHandler(`/runs/${e.run_id}`)} className="feed-row" title={tip}>
              <span className={cx('feed-dot', `tone-${meta.tone}`)} aria-hidden="true" />
              <span className="feed-label">{meta.label}</span>
              <time className="feed-time" dateTime={e.at}>
                {relativeTime(e.at)}
              </time>
            </a>
          </li>
        )
      })}
    </ul>
  )
}

/** Vertical event timeline for a single run, one line per event; detail on hover. */
export function Timeline({ events }: { events: RunEvent[] }) {
  return (
    <ol className="timeline">
      {events.map((e, i) => {
        const meta = eventMeta(e.type, e.data)
        const at = e.at ?? e.created_at
        const detail = eventDetail(e.type, e.data)
        return (
          <li key={`${e.id ?? i}-${e.type}`} className="timeline-row" title={[detail, formatDateTime(at)].filter(Boolean).join('\n')}>
            <span className={cx('timeline-dot', `tone-${meta.tone}`)} aria-hidden="true" />
            <span className="timeline-label">{meta.label}</span>
            <time className="timeline-time" dateTime={at}>
              {formatTime(at)}
            </time>
            {detail && <span className="sr-only">{detail}</span>}
          </li>
        )
      })}
    </ol>
  )
}
