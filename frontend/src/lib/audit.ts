/** Flip one character in a deterministic field of the packet, returning the modified copy and its path. */
export function tamperPacket(packet: Record<string, unknown>): { packet: Record<string, unknown>; path: string; from: string; to: string } {
  const copy = JSON.parse(JSON.stringify(packet)) as Record<string, unknown>
  const flip = (s: string) => {
    const i = 0
    const c = s[i]
    const n = c === 'a' ? 'b' : c === '0' ? '1' : /[0-9]/.test(c) ? '0' : c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()
    return s.slice(0, i) + (n === c ? (c === 'x' ? 'y' : 'x') : n) + s.slice(i + 1)
  }
  const diff = Array.isArray(copy.diff) ? (copy.diff as Record<string, unknown>[]) : []
  if (diff[0] && typeof diff[0].args_hash === 'string') {
    const from = diff[0].args_hash as string
    const to = flip(from)
    diff[0].args_hash = to
    return { packet: copy, path: 'diff[0].args_hash', from, to }
  }
  const from = String(copy.goal ?? '')
  const to = flip(from || 'x')
  copy.goal = to
  return { packet: copy, path: 'goal', from, to }
}

