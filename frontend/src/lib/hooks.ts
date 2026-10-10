import { useCallback, useEffect, useRef, useState } from 'react'

export interface AsyncState<T> {
  data: T | undefined
  error: unknown
  loading: boolean
  /** True only until the first response (success or error) arrives. */
  initialLoading: boolean
  reload: () => Promise<void>
  setData: (value: T) => void
}

/** Fetch on mount (and when deps change); optional polling while the tab is visible. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], pollMs?: number): AsyncState<T> {
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState<unknown>(undefined)
  const [loading, setLoading] = useState(true)
  const [settled, setSettled] = useState(false)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const seq = useRef(0)

  const reload = useCallback(async () => {
    const mine = ++seq.current
    setLoading(true)
    try {
      const result = await fnRef.current()
      if (mine === seq.current) {
        setData(result)
        setError(undefined)
      }
    } catch (err) {
      if (mine === seq.current) setError(err)
    } finally {
      if (mine === seq.current) {
        setLoading(false)
        setSettled(true)
      }
    }
  }, [])

  useEffect(() => {
    setData(undefined)
    setSettled(false)
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    if (!pollMs) return
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void reload()
    }, pollMs)
    return () => window.clearInterval(id)
  }, [pollMs, reload])

  const set = useCallback((value: T) => {
    seq.current++
    setData(value)
    setError(undefined)
    setLoading(false)
    setSettled(true)
  }, [])

  return { data, error, loading, initialLoading: !settled && data === undefined, reload, setData: set }
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · Adjutant Gate` : 'Adjutant Gate · Safe actions for AI agents'
  }, [title])
}

/** Seconds elapsed since `running` became true; resets when it turns false. */
export function useElapsed(running: boolean): number {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!running) {
      setElapsed(0)
      return
    }
    const start = Date.now()
    setElapsed(0)
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 250)
    return () => window.clearInterval(id)
  }, [running])
  return elapsed
}

export function useLocalStorage<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key)
      return raw === null ? initial : (JSON.parse(raw) as T)
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* storage unavailable: keep in memory */
    }
  }, [key, value])
  return [value, setValue]
}
