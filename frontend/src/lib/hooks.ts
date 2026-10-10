import { useCallback, useEffect, useRef, useState } from 'react'

export interface AsyncState<T> {
  data: T | undefined
  error: unknown
  loading: boolean
  reload: () => Promise<void>
  setData: (value: T) => void
}

/** Fetch on mount (and when deps change); optional polling interval. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], pollMs?: number): AsyncState<T> {
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState<unknown>(undefined)
  const [loading, setLoading] = useState(true)
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
      if (mine === seq.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    setData(undefined)
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

  return { data, error, loading, reload, setData }
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    const prev = document.title
    document.title = title ? `${title} · Adjutant Gate` : 'Adjutant Gate · Safe actions for AI agents'
    return () => {
      document.title = prev
    }
  }, [title])
}
