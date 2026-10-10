export function LogoMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path
        d="M16 2.5 4.5 6.8v8.4c0 7.2 4.9 12.5 11.5 14.3 6.6-1.8 11.5-7.1 11.5-14.3V6.8L16 2.5Z"
        fill="var(--accent)"
      />
      <path d="M11 22V14.5a5 5 0 0 1 10 0V22" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M16 13.5V22" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  )
}
