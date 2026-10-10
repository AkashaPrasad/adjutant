import { Fragment, useEffect, useRef, type ReactNode } from 'react'
import { cx } from './ui'

const TOKEN = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)|([{}[\],:])/g

function renderLine(line: string, highlight?: (path: string) => boolean): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  TOKEN.lastIndex = 0
  while ((m = TOKEN.exec(line))) {
    if (m.index > last) out.push(line.slice(last, m.index))
    if (m[1] && m[2]) {
      out.push(
        <span key={m.index} className="j-key">
          {m[1]}
        </span>,
      )
      out.push(
        <span key={`${m.index}p`} className="j-punct">
          {m[2]}
        </span>,
      )
    } else if (m[1] || m[3]) {
      const text = m[1] ?? m[3]
      out.push(
        <span key={m.index} className={cx('j-val', highlight?.(text) && 'j-mark')}>
          {text}
        </span>,
      )
    } else {
      out.push(
        <span key={m.index} className="j-punct">
          {m[4]}
        </span>,
      )
    }
    last = TOKEN.lastIndex
  }
  if (last < line.length) out.push(line.slice(last))
  return out
}

/** Pretty-printed JSON with a line-number gutter and three token classes (key, value, punctuation). */
export function JsonView({
  value,
  maxHeight,
  markLines,
  label,
}: {
  value: unknown
  maxHeight?: number
  /** 1-based line numbers to mark as changed. */
  markLines?: Set<number>
  label?: string
}) {
  let text: string
  try {
    text = JSON.stringify(value, null, 2) ?? 'undefined'
  } catch {
    text = String(value)
  }
  const lines = text.split('\n')
  const ref = useRef<HTMLDivElement>(null)
  const markKey = markLines ? [...markLines].join(',') : ''
  useEffect(() => {
    const box = ref.current
    const mark = box?.querySelector<HTMLElement>('.json-mark')
    if (box && mark) box.scrollTop = Math.max(0, mark.offsetTop - 60)
  }, [markKey])
  return (
    <div className="json" ref={ref} style={maxHeight ? { maxHeight } : undefined} role="region" aria-label={label ?? 'JSON'} tabIndex={0}>
      <table className="json-table">
        <tbody>
          {lines.map((line, i) => (
            <Fragment key={i}>
              <tr className={markLines?.has(i + 1) ? 'json-mark' : undefined}>
                <td className="json-gutter" aria-hidden="true">
                  {i + 1}
                </td>
                <td className="json-line">{renderLine(line)}</td>
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}
