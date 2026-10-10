import type { RunItem } from '../api/types'
import { CalendarCard, CrmDiff, EmailCard, SlackMessage, WebPageCard, type FieldChange } from './Artifacts'
import { JsonView } from './JsonView'
import { Badge } from './ui'

const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v))
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? [v] : [])

/** The shadow-run preview rendered as the artifact it would create. */
export function PreviewView({ item }: { item: RunItem }) {
  const p = (item.preview ?? {}) as Record<string, unknown>
  const a = item.args
  if (typeof p.error === 'string') {
    return <p className="text-danger">Shadow run failed: {p.error}</p>
  }
  switch (item.tool) {
    case 'email.send': {
      const external = list(p.external_recipients)
      return (
        <EmailCard
          to={list(p.to ?? a.to)}
          cc={list(p.cc ?? a.cc)}
          subject={str(p.subject ?? a.subject)}
          body={str(a.body ?? p.body_preview)}
          status={external.length ? <Badge tone="warning">external</Badge> : undefined}
          note={
            external.length ? (
              <span className="text-warning" title={`External: ${external.join(', ')}`}>
                Cannot be recalled once sent.
              </span>
            ) : undefined
          }
        />
      )
    }
    case 'slack.post':
      return <SlackMessage channel={str(p.channel ?? a.channel)} text={str(a.text ?? p.text)} status={<Badge tone="neutral">preview</Badge>} />
    case 'crm.update': {
      const changes = Array.isArray(p.changes) ? (p.changes as FieldChange[]) : []
      const name = /\(([^)]+)\)\s*$/.exec(str(p.summary))?.[1]
      return <CrmDiff recordId={str(p.record_id ?? a.record_id)} name={name} changes={changes} />
    }
    case 'calendar.create_event': {
      const conflicts = Array.isArray(p.conflicts) ? (p.conflicts as { title?: string }[]).map((c) => c.title ?? '?') : []
      return (
        <CalendarCard
          title={str(p.title ?? a.title)}
          start={str(p.start ?? a.start)}
          end={str(p.end ?? a.end)}
          attendees={list(p.attendees ?? a.attendees)}
          conflicts={conflicts}
        />
      )
    }
    case 'http.get':
      return <WebPageCard url={str(p.url ?? a.url)} status={p.status} content={str(p.content)} />
    case 'docs.search': {
      const results = Array.isArray(p.results) ? (p.results as { id: string; title: string; snippet: string }[]) : []
      return results.length ? (
        <ul className="doc-results">
          {results.map((r) => (
            <li key={r.id} title={r.snippet}>
              <span className="doc-title">{r.title}</span> <span className="mono muted">{r.id}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No documents matched “{str(a.query)}”.</p>
      )
    }
    default:
      return <JsonView value={p} />
  }
}
