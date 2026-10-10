import { useCallback, useEffect, useState } from 'react'

export type ThemePref = 'dark' | 'light' | 'system'
const KEY = 'adjutant.theme'
const EVENT = 'adjutant:theme'

export function initialTheme(): ThemePref {
  try {
    const stored = window.localStorage.getItem(KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    /* ignore */
  }
  return 'dark'
}

export function resolvedTheme(pref: ThemePref): 'dark' | 'light' {
  if (pref !== 'system') return pref
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** Light tokens live on :root; dark applies via [data-theme="dark"] or the OS media query when no theme is stamped. */
export function applyTheme(pref: ThemePref) {
  const root = document.documentElement
  if (pref === 'system') delete root.dataset.theme
  else root.dataset.theme = pref
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', resolvedTheme(pref) === 'dark' ? '#0E1116' : '#F6F7F9')
}

export function useTheme(): [ThemePref, (p: ThemePref) => void, () => void] {
  const [pref, setPref] = useState<ThemePref>(initialTheme)
  useEffect(() => {
    const sync = () => setPref(initialTheme())
    window.addEventListener(EVENT, sync)
    return () => window.removeEventListener(EVENT, sync)
  }, [])
  const set = useCallback((p: ThemePref) => {
    applyTheme(p)
    try {
      window.localStorage.setItem(KEY, p)
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event(EVENT))
  }, [])
  const toggle = useCallback(() => set(resolvedTheme(initialTheme()) === 'dark' ? 'light' : 'dark'), [set])
  return [pref, set, toggle]
}
