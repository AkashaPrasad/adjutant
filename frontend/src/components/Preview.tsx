import type { ReactNode } from 'react'
import type { RunItem } from '../api/types'
import { formatDateTime, inlineValue } from '../lib/format'
import { JsonView } from './JsonView'
import { KeyValue } from './ui'

const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : inlineValue(v))
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? [v] : [])

function Diff({ rows }: { rows: { field: string; from: unknown; to: unknown }[] }) {
  if (!rows.length) return <p className="muted">No field changes: the record already holds these values.</p>
  return (
    <div className="diff" role="table" aria-label="Field changes">
      {rows.map((r) => (
        <div key={r.field} className="diff-hunk" role="rowgroup">
          <div className="diff-head" role="row">
            <span role="cell">{r.field}</span>
          </div>
          <div className="diff-line diff-del" role="row">
            <span className="diff-sign" aria-label="removed">
              -
            </span>
            <span role="cell">{r.from === undefined || r.from === null ? '(empty)' : inlineValue(r.from)}</span>
          </div>
          <div className="diff-line diff-add" role="row">
            <span className="diff-sign" aria-label="added">
              +
            </span>
            <span role="cell">{inlineValue(r.to)}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

/** Human-readable rendering of the shadow-run preview for each tool. */
export function PreviewView({ item }: { item: RunItem }) {
  const p = (item.preview ?? {}) as Record<string, unknown>
  if (typeof p.error === 'string') {
    return <p className="text-danger">Shadow run failed: {p.error}</p>
  }
  let body: ReactNode
  switch (item.tool) {
    case 'email.send': {
      const external = list(p.external_recipients)
      body = (
        <div className="mail">
          <KeyValue
            rows={[
              ['To', <span className="mono">{list(p.to ?? item.args.to).join(', ')}</span>],
              ...(list(p.cc).length ? ([['Cc', <span className="mono">{list(p.cc).join(', ')}</span>]] as [string, ReactNode][]) : []),
              ['Subject', str(p.subject ?? item.args.subject)],
            ]}
          />
          <pre className="mail-body">{str(item.args.body ?? p.body_preview)}</pre>
          {external.length > 0 && (
            <p className="small text-warning">
              External recipient{external.length > 1 ? 's' : ''}: <span className="mono">{external.join(', ')}</span>. Email cannot be recalled once sent.
            </p>
          )}
        </div>
      )
      break
    }
    case 'slack.post':
      body = (
        <div className="mail">
          <KeyValue rows={[['Channel', <span className="mono">{str(p.channel ?? item.args.channel)}</span>]]} />
          <pre className="mail-body">{str(item.args.text ?? p.text)}</pre>
        </div>
      )
      break
    case 'crm.update': {
      const changes = Array.isArray(p.changes) ? (p.changes as { field: string; from: unknown; to: unknown }[]) : []
      body = (
        <div className="stack-sm">
          <KeyValue rows={[['Record', <span className="mono">{str(p.record_id ?? item.args.record_id)}</span>]]} />
          <Diff rows={changes} />
        </div>
      )
      break
    }
    case 'calendar.create_event': {
      const conflicts = Array.isArray(p.conflicts) ? (p.conflicts as { title?: string }[]) : []
      body = (
        <div className="stack-sm">
          <KeyValue
            rows={[
              ['Title', str(p.title)],
              ['Start', formatDateTime(p.start)],
              ['End', formatDateTime(p.end)],
              ['Attendees', <span className="mono">{list(p.attendees).join(', ')}</span>],
              ['Conflicts', conflicts.length ? <span className="text-warning">{conflicts.map((c) => c.title).join(', ')}</span> : 'None'],
            ]}
          />
        </div>
      )
      break
    }
    case 'http.get':
      body = (
        <div className="stack-sm">
          <KeyValue
            rows={[
              ['URL', <span className="mono">{str(p.url)}</span>],
              ['Status', str(p.status)],
              ['Trust', <span className="text-warning">untrusted content</span>],
            ]}
          />
          {str(p.content) && <blockquote className="quote">{str(p.content)}</blockquote>}
        </div>
      )
      break
    case 'docs.search': {
      const results = Array.isArray(p.results) ? (p.results as { id: string; title: string; snippet: string }[]) : []
      body = results.length ? (
        <ul className="doc-results">
          {results.map((r) => (
            <li key={r.id}>
              <div className="doc-title">
                {r.title} <span className="mono muted">{r.id}</span>
              </div>
              <div className="muted small">{r.snippet}</div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No documents matched.</p>
      )
      break
    }
    default:
      body = <JsonView value={p} />
  }
  return (
    <div className="preview">
      {typeof p.summary === 'string' && <p className="preview-summary">{p.summary}</p>}
      {body}
    </div>
  )
}
