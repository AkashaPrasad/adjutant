import type { ReactNode } from 'react'
import { formatDateTime, inlineValue } from '../lib/format'
import { cx } from './ui'

/** Mocks of the real artifacts an action produces, so a reviewer sees the thing, not a field list. */

export function EmailCard({
  from = 'ops@ourco.example',
  to,
  cc,
  subject,
  body,
  status,
  note,
  compact,
}: {
  from?: string
  to: string[]
  cc?: string[]
  subject: string
  body?: string
  status?: ReactNode
  note?: ReactNode
  compact?: boolean
}) {
  return (
    <article className={cx('art art-email', compact && 'is-compact')} aria-label={`Email: ${subject}`}>
      <header className="art-email-head">
        <div className="art-email-subject">{subject || '(no subject)'}</div>
        {status}
      </header>
      <dl className="art-email-meta">
        <div>
          <dt>From</dt>
          <dd className="mono">{from}</dd>
        </div>
        <div>
          <dt>To</dt>
          <dd className="mono">{to.join(', ')}</dd>
        </div>
        {cc && cc.length > 0 && (
          <div>
            <dt>Cc</dt>
            <dd className="mono">{cc.join(', ')}</dd>
          </div>
        )}
      </dl>
      {body !== undefined && <div className={cx('art-email-body', compact && 'clamp-3')}>{body}</div>}
      {note && <footer className="art-note">{note}</footer>}
    </article>
  )
}

export function SlackMessage({
  channel,
  text,
  author = 'adjutant-bot',
  at,
  deleted,
  status,
}: {
  channel: string
  text: string
  author?: string
  at?: string
  deleted?: boolean
  status?: ReactNode
}) {
  return (
    <article className={cx('art art-slack', deleted && 'is-deleted')} aria-label={`Slack message in ${channel}`}>
      <header className="art-slack-channel">
        <span className="mono">{channel}</span>
        {status}
      </header>
      <div className="art-slack-msg">
        <span className="art-slack-avatar" aria-hidden="true">
          {author.charAt(0).toUpperCase()}
        </span>
        <div className="art-slack-content">
          <div className="art-slack-author">
            <strong>{author}</strong>
            {at && <span className="muted small">{formatDateTime(at)}</span>}
          </div>
          <div className="art-slack-text">{text}</div>
        </div>
      </div>
    </article>
  )
}

export interface FieldChange {
  field: string
  from: unknown
  to: unknown
}

/** CRM record, before -> after, changed fields highlighted. */
export function CrmDiff({ recordId, name, changes }: { recordId: string; name?: string; changes: FieldChange[] }) {
  return (
    <article className="art art-crm" aria-label={`CRM record ${recordId}`}>
      <header className="art-crm-head">
        <span className="art-crm-name">{name || 'CRM record'}</span>
        <span className="mono muted">{recordId}</span>
      </header>
      {changes.length === 0 ? (
        <p className="muted small art-pad">No field changes: the record already holds these values.</p>
      ) : (
        <table className="art-crm-table">
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">Before</th>
              <th scope="col" aria-hidden="true" />
              <th scope="col">After</th>
            </tr>
          </thead>
          <tbody>
            {changes.map((c) => (
              <tr key={c.field}>
                <th scope="row" className="mono">
                  {c.field}
                </th>
                <td className="art-before">{c.from === undefined || c.from === null ? <span className="muted">(empty)</span> : inlineValue(c.from)}</td>
                <td className="art-arrow" aria-label="becomes">
                  →
                </td>
                <td className="art-after">{inlineValue(c.to)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </article>
  )
}

/** CRM record as it is now (Systems view). */
export function CrmRecordCard({ id, data, status }: { id: string; data: Record<string, unknown>; status?: ReactNode }) {
  const { name, ...rest } = data
  return (
    <article className="art art-crm" aria-label={`CRM record ${id}`}>
      <header className="art-crm-head">
        <span className="art-crm-name">{String(name ?? id)}</span>
        <span className="mono muted">{id}</span>
        {status}
      </header>
      <dl className="art-fields">
        {Object.entries(rest).map(([k, v]) => (
          <div key={k}>
            <dt className="mono">{k}</dt>
            <dd>{k === 'arr' && typeof v === 'number' ? `$${v.toLocaleString()}` : inlineValue(v)}</dd>
          </div>
        ))}
      </dl>
    </article>
  )
}

export function CalendarCard({
  title,
  start,
  end,
  attendees,
  status,
  cancelled,
  conflicts,
}: {
  title: string
  start?: string
  end?: string
  attendees: string[]
  status?: ReactNode
  cancelled?: boolean
  conflicts?: string[]
}) {
  const d = start ? new Date(start) : null
  const valid = d && !Number.isNaN(d.getTime())
  return (
    <article className={cx('art art-cal', cancelled && 'is-deleted')} aria-label={`Calendar event ${title}`}>
      <div className="art-cal-date" aria-hidden="true">
        <span className="art-cal-month">{valid ? d.toLocaleDateString(undefined, { month: 'short' }) : '—'}</span>
        <span className="art-cal-day">{valid ? d.getDate() : ''}</span>
      </div>
      <div className="art-cal-main">
        <div className="art-cal-title">
          <strong>{title}</strong>
          {status}
        </div>
        <div className="muted small">
          {valid ? d.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
          {end ? ` – ${new Date(end).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : ''}
        </div>
        <div className="mono small art-cal-people">{attendees.join(', ')}</div>
        {conflicts && conflicts.length > 0 && <div className="small text-warning">Conflicts: {conflicts.join(', ')}</div>}
      </div>
    </article>
  )
}

export function WebPageCard({ url, status, content }: { url: string; status?: unknown; content?: string }) {
  return (
    <article className="art art-web" aria-label={`Web page ${url}`}>
      <header className="art-web-bar">
        <span className="mono">{url}</span>
        <span className="muted small">HTTP {String(status ?? '—')}</span>
      </header>
      {content && <div className="art-web-body clamp-4">{content}</div>}
      <footer className="art-note text-warning">Returned content is untrusted.</footer>
    </article>
  )
}
