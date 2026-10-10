import type { ReactNode } from 'react'
import { cx } from './ui'

/** Small functional glyphs drawn inline (check, cross, lock, undo arrow, arrow, chevron). Never decorative. */
function Svg({ children, size = 14, label, className }: { children: ReactNode; size?: number; label?: string; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cx('glyph', className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {label && <title>{label}</title>}
      {children}
    </svg>
  )
}

export const CheckGlyph = (p: { size?: number; label?: string; className?: string }) => (
  <Svg {...p}>
    <path d="M3.5 8.5l3 3 6-7" />
  </Svg>
)

export const CrossGlyph = (p: { size?: number; label?: string; className?: string }) => (
  <Svg {...p}>
    <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
  </Svg>
)

export const LockGlyph = (p: { size?: number; label?: string; className?: string }) => (
  <Svg {...p}>
    <rect x="3.5" y="7" width="9" height="6.5" rx="1.2" />
    <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" />
  </Svg>
)

export const UndoGlyph = (p: { size?: number; label?: string; className?: string }) => (
  <Svg {...p}>
    <path d="M5 4.5L2.5 7 5 9.5" />
    <path d="M2.5 7h7a3.5 3.5 0 0 1 0 7H7" />
  </Svg>
)

export const ArrowGlyph = (p: { size?: number; label?: string; className?: string }) => (
  <Svg {...p}>
    <path d="M3 8h10M9.5 4.5L13 8l-3.5 3.5" />
  </Svg>
)

export const ChevronGlyph = (p: { size?: number; label?: string; className?: string }) => (
  <Svg {...p}>
    <path d="M6 4l4 4-4 4" />
  </Svg>
)

/** Reversibility of a tool: lock = irreversible, undo arrow = reversible, arrow = read only. */
export function ReversibilityGlyph({ kind, reversible }: { kind?: string | null; reversible?: boolean | null }) {
  if (kind === 'read')
    return (
      <span className="rev rev-read" title="Read only: no side effect">
        <ArrowGlyph size={13} label="Read only" />
      </span>
    )
  if (reversible)
    return (
      <span className="rev rev-undo" title="Reversible: Undo compensates it">
        <UndoGlyph size={13} label="Reversible" />
      </span>
    )
  return (
    <span className="rev rev-lock" title="Irreversible: cannot be undone once it runs">
      <LockGlyph size={13} label="Irreversible" />
    </span>
  )
}

/** 3-segment risk meter: low fills 1, medium 2, high 3. */
export function RiskMeter({ risk }: { risk?: string | null }) {
  const level = risk === 'high' ? 3 : risk === 'medium' ? 2 : risk === 'low' ? 1 : 0
  const label = `${risk ? risk.charAt(0).toUpperCase() + risk.slice(1) : 'Unknown'} risk`
  return (
    <span className={cx('meter', `meter-${risk ?? 'unknown'}`)} title={label} role="img" aria-label={label}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={cx('meter-seg', i <= level && 'is-on')} />
      ))}
    </span>
  )
}

/** Expandable row: summary line always visible, content on click. Native <details> for keyboard + a11y. */
export function Disclosure({
  summary,
  children,
  className,
  defaultOpen,
}: {
  summary: ReactNode
  children: ReactNode
  className?: string
  defaultOpen?: boolean
}) {
  return (
    <details className={cx('disclosure', className)} open={defaultOpen}>
      <summary>
        <ChevronGlyph size={12} className="disclosure-chevron" />
        <span className="disclosure-summary">{summary}</span>
      </summary>
      <div className="disclosure-body">{children}</div>
    </details>
  )
}

/** A panel whose body is collapsed by default; the header row stays visible. */
export function CollapsiblePanel({ title, subtitle, children, defaultOpen }: { title: string; subtitle?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="panel cpanel" open={defaultOpen}>
      <summary className="cpanel-head">
        <ChevronGlyph size={12} className="disclosure-chevron" />
        <span className="panel-title">{title}</span>
        {subtitle && <span className="panel-subtitle">{subtitle}</span>}
      </summary>
      <div className="cpanel-body">{children}</div>
    </details>
  )
}
