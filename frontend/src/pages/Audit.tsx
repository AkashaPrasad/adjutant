import { useRef, useState, type DragEvent } from 'react'
import { api, errorMessage } from '../api/client'
import type { AuditVerifyResult } from '../api/types'
import { StatusChip } from '../components/Badge'
import { JsonView } from '../components/JsonView'
import { useToast } from '../components/Toast'
import { Badge, EmptyState, ErrorState, Hash, KeyValue, PageHeader, Panel, Skeleton, Tabs, cx, truncateMiddle } from '../components/ui'
import { tamperPacket } from '../lib/audit'
import { downloadJson, formatDateTime, relativeTime } from '../lib/format'
import { useAsync, useDocumentTitle } from '../lib/hooks'
import { linkHandler } from '../lib/router'

interface Parsed {
  packet: Record<string, unknown>
  signature: string
  key_id?: string
}

interface Check {
  name: string
  ok: boolean
  detail: string
}

function parseInput(text: string, signature: string): Parsed {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('The input is not valid JSON.')
  }
  if (!data || typeof data !== 'object') throw new Error('Expected a JSON object.')
  const obj = data as Record<string, unknown>
  if (obj.packet && typeof obj.packet === 'object') {
    const sig = signature.trim() || (typeof obj.signature === 'string' ? obj.signature : '')
    if (!sig) throw new Error('No signature found. Paste the full bundle or enter the signature.')
    return { packet: obj.packet as Record<string, unknown>, signature: sig, key_id: typeof obj.key_id === 'string' ? obj.key_id : undefined }
  }
  if (!signature.trim()) throw new Error('This looks like a bare packet. Enter its signature below.')
  return { packet: obj, signature: signature.trim() }
}

function localChecks(p: Parsed, res: AuditVerifyResult): Check[] {
  const packet = p.packet
  const events = Array.isArray(packet.events) ? packet.events : []
  const diff = Array.isArray(packet.diff) ? (packet.diff as { args_hash?: string }[]) : []
  const effects = Array.isArray(packet.effects) ? (packet.effects as { args_hash?: string }[]) : []
  const hashes = new Set(diff.map((d) => d.args_hash))
  const orphan = effects.filter((e) => !hashes.has(e.args_hash))
  return [
    { name: 'Signature valid (HMAC-SHA256, recomputed by the API)', ok: res.valid, detail: res.valid ? `matches ${truncateMiddle(p.signature)}` : 'recomputed HMAC differs from the signature' },
    {
      name: 'Schema recognized',
      ok: packet.schema === 'adjutant.audit.v1',
      detail: String(packet.schema ?? 'missing'),
    },
    {
      name: 'Signing key matches this API',
      ok: !p.key_id || !res.key_id || p.key_id === res.key_id,
      detail: p.key_id ? `${p.key_id} vs ${res.key_id ?? '?'}` : `server key ${res.key_id ?? '?'}`,
    },
    { name: 'Event trail present', ok: events.length > 0, detail: `${events.length} event(s)` },
    {
      name: 'Every effect matches an approved plan item hash',
      ok: orphan.length === 0,
      detail: orphan.length ? `${orphan.length} effect(s) without a matching plan hash` : `${effects.length} effect(s) checked`,
    },
  ]
}

export function Audit() {
  useDocumentTitle('Audit')
  const toast = useToast()
  const runs = useAsync(() => api.listRuns(20), [], 15_000)
  const [tab, setTab] = useState<'file' | 'paste'>('paste')
  const [text, setText] = useState('')
  const [signature, setSignature] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [tamper, setTamper] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [result, setResult] = useState<{ parsed: Parsed; res: AuditVerifyResult; checks: Check[]; tampered: string | null } | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const resultRef = useRef<HTMLDivElement>(null)

  const readFile = async (f: File) => {
    setText(await f.text())
    setFileName(f.name)
    setResult(null)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files?.[0]
    if (f) void readFile(f)
  }

  const verify = async (overrideText?: string) => {
    setError(null)
    setBusy(true)
    try {
      const parsed = parseInput(overrideText ?? text, signature)
      let packet = parsed.packet
      let tampered: string | null = null
      if (tamper) {
        const t = tamperPacket(packet)
        packet = t.packet
        tampered = `${t.path}: ${t.from.slice(0, 8)} → ${t.to.slice(0, 8)}`
      }
      const res = await api.verifyAudit(packet, parsed.signature)
      const checks = localChecks({ ...parsed, packet }, res)
      setResult({ parsed: { ...parsed, packet }, res, checks, tampered })
      toast.push(res.valid ? 'success' : 'error', res.valid ? 'Packet verified' : 'Verification failed', res.valid ? 'Signature valid.' : 'The packet does not match its signature.')
      window.setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
    } catch (err) {
      setError(err)
      setResult(null)
    } finally {
      setBusy(false)
    }
  }

  const loadRun = async (id: string, download: boolean) => {
    try {
      const bundle = await api.audit(id)
      if (download) {
        downloadJson(`audit-${id}.json`, bundle)
        toast.push('success', 'Audit packet downloaded', `audit-${id}.json`)
      } else {
        const t = JSON.stringify(bundle, null, 2)
        setText(t)
        setSignature('')
        setFileName(null)
        setTab('paste')
        setResult(null)
        toast.push('info', 'Packet loaded into the verifier', `Run ${id}`)
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    } catch (err) {
      toast.push('error', 'Could not fetch the packet', errorMessage(err))
    }
  }

  const allOk = result ? result.checks.every((c) => c.ok) : false

  return (
    <div className="page">
      <PageHeader
        title="Verify audit packet"
        subtitle="Each run produces a signed packet: plan, policy diff, decision and reviewer, effects, verification and the full event trail. Auditors can check it without trusting the console."
      />
      <div className="audit-page">
        <Panel title="Packet">
          <Tabs
            label="Input method"
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'paste', label: 'Paste JSON' },
              { id: 'file', label: 'Choose file' },
            ]}
          />
          {tab === 'file' ? (
            <div
              className={cx('dropzone', dragging && 'is-dragging')}
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <span>{fileName ? `Loaded ${fileName}` : 'Drop a packet file here or choose a file'}</span>
              <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
                Choose file
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void readFile(f)
                }}
              />
            </div>
          ) : (
            <label className="field">
              <span className="field-label">Packet JSON (full bundle from GET /v1/runs/&#123;id&#125;/audit, or a bare packet)</span>
              <textarea
                className="input textarea mono-input"
                rows={8}
                value={text}
                onChange={(e) => {
                  setText(e.target.value)
                  setResult(null)
                }}
                placeholder='{"packet": {...}, "signature": "...", "algorithm": "HMAC-SHA256", "key_id": "..."}'
              />
            </label>
          )}
          <label className="field">
            <span className="field-label">
              Signature <span className="muted">optional when the bundle includes it</span>
            </span>
            <input className="input mono-input" value={signature} onChange={(e) => setSignature(e.target.value)} placeholder="64 hex characters" />
          </label>
          <label className="check">
            <input type="checkbox" checked={tamper} onChange={(e) => setTamper(e.target.checked)} />
            <span>Tamper: flip one byte in the packet before verifying (shows that any change is detected)</span>
          </label>
          {error != null && <ErrorState error={error} title="Could not verify" />}
          <div className="form-actions">
            <button type="button" className="btn btn-primary" disabled={busy || !text.trim()} onClick={() => void verify()}>
              {busy ? 'Verifying…' : 'Verify'}
            </button>
          </div>
        </Panel>

        <div ref={resultRef} aria-live="polite">
          {busy && !result && (
            <Panel title="Result">
              <Skeleton rows={5} />
            </Panel>
          )}
          {result && (
            <Panel
              title="Result"
              flush
              actions={
                <Badge tone={allOk ? 'success' : 'danger'} dot>
                  {allOk ? 'Verified' : 'Failed'}
                </Badge>
              }
            >
              {result.tampered && (
                <p className="panel-body small text-warning">Tampered before verifying: {result.tampered}</p>
              )}
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Check</th>
                      <th scope="col">Result</th>
                      <th scope="col">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.checks.map((c) => (
                      <tr key={c.name}>
                        <td>{c.name}</td>
                        <td className="nowrap">
                          <Badge tone={c.ok ? 'success' : 'danger'} dot>
                            {c.ok ? 'Pass' : 'Fail'}
                          </Badge>
                        </td>
                        <td className="mono small">{c.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="panel-body stack">
                <KeyValue
                  rows={[
                    [
                      'Run id',
                      <a className="mono" href={`/runs/${String(result.parsed.packet.run_id)}`} onClick={linkHandler(`/runs/${String(result.parsed.packet.run_id)}`)}>
                        {String(result.parsed.packet.run_id ?? '—')}
                      </a>,
                    ],
                    ['Run status', <StatusChip status={String(result.parsed.packet.status ?? '')} />],
                    ['Created', formatDateTime(result.parsed.packet.created_at)],
                    ['Reviewer', String(result.parsed.packet.reviewer ?? '—')],
                    ['Entries', `${Array.isArray(result.parsed.packet.events) ? result.parsed.packet.events.length : 0} events, ${Array.isArray(result.parsed.packet.effects) ? result.parsed.packet.effects.length : 0} effects`],
                    ['Signature', <Hash value={result.parsed.signature} prefix="hmac:" />],
                    ['Key id', <span className="mono">{result.res.key_id ?? '—'}</span>],
                  ]}
                />
                <JsonView value={result.parsed.packet} maxHeight={320} label="Verified packet" />
              </div>
            </Panel>
          )}
        </div>

        <Panel title="Recent runs" subtitle="Download a run's signed packet, or load it into the verifier above." flush>
          {runs.initialLoading ? (
            <div className="panel-body">
              <Skeleton rows={5} />
            </div>
          ) : runs.error != null && !runs.data ? (
            <div className="panel-body">
              <ErrorState error={runs.error} onRetry={() => void runs.reload()} />
            </div>
          ) : runs.data && runs.data.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Run</th>
                    <th scope="col">State</th>
                    <th scope="col">Started</th>
                    <th scope="col" className="num">
                      Packet
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {runs.data.map((r) => (
                    <tr key={r.id}>
                      <td className="cell-truncate" title={r.goal}>
                        <a href={`/runs/${r.id}`} onClick={linkHandler(`/runs/${r.id}`)}>
                          {r.goal}
                        </a>
                      </td>
                      <td className="nowrap">
                        <StatusChip status={r.status} />
                      </td>
                      <td className="muted nowrap" title={formatDateTime(r.created_at)}>
                        {relativeTime(r.created_at)}
                      </td>
                      <td className="num nowrap">
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => void loadRun(r.id, false)}>
                          Load
                        </button>
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => void loadRun(r.id, true)}>
                          Download
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No runs yet">Packets are available for every run, including rejected ones.</EmptyState>
          )}
        </Panel>
      </div>
    </div>
  )
}
