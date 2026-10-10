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

export function ActivityFeed({ events }: { events: ActivityEvent[] }) {
  return (
    <ul className="feed">
      {events.map((e) => {
        const meta = labelFor(e.type, e.data)
        const detail = eventDetail(e.type, e.data)
        return (
          <li key={`${e.id}-${e.type}`} className="feed-row">
            <span className={cx('feed-dot', `tone-${meta.tone}`)} aria-hidden="true" />
            <div className="feed-main">
              <div className="feed-line">
                <span className="feed-label">{meta.label}</span>
                <time className="feed-time" dateTime={e.at} title={formatDateTime(e.at)}>
                  {relativeTime(e.at)}
                </time>
              </div>
              <a href={`/runs/${e.run_id}`} onClick={linkHandler(`/runs/${e.run_id}`)} className="feed-goal">
                {e.goal || e.run_id}
              </a>
              {detail && <div className="feed-detail">{detail}</div>}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** Vertical event timeline for a single run. */
export function Timeline({ events }: { events: RunEvent[] }) {
  return (
    <ol className="timeline">
      {events.map((e, i) => {
        const meta = eventMeta(e.type, e.data)
        const at = e.at ?? e.created_at
        const detail = eventDetail(e.type, e.data)
        return (
          <li key={`${e.id ?? i}-${e.type}`} className="timeline-row">
            <span className={cx('timeline-dot', `tone-${meta.tone}`)} aria-hidden="true" />
            <div className="timeline-main">
              <div className="timeline-label">{meta.label}</div>
              {detail && <div className="timeline-detail">{detail}</div>}
              <time className="timeline-time" dateTime={at} title={formatDateTime(at)}>
                {formatTime(at)}
              </time>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
