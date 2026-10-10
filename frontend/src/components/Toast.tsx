import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

type ToastTone = 'success' | 'error' | 'info'
interface ToastItem {
  id: number
  tone: ToastTone
  title: string
  body?: string
}

interface ToastApi {
  push: (tone: ToastTone, title: string, body?: string) => void
}

const ToastContext = createContext<ToastApi>({ push: () => {} })

export const useToast = () => useContext(ToastContext)

let nextId = 1

const MAX_VISIBLE = 2
const lifetimeMs = (tone: ToastTone) => (tone === 'error' ? 8000 : 4000)

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false)
  const remaining = useRef(lifetimeMs(toast.tone))
  useEffect(() => {
    if (paused) return
    const started = Date.now()
    const timer = window.setTimeout(() => onDismiss(toast.id), remaining.current)
    return () => {
      window.clearTimeout(timer)
      remaining.current = Math.max(0, remaining.current - (Date.now() - started))
    }
  }, [paused, toast.id, onDismiss])
  return (
    <div
      className={`toast toast-${toast.tone}`}
      role={toast.tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="toast-content">
        <div className="toast-title" title={toast.title}>
          {toast.title}
        </div>
        {toast.body && (
          <div className="toast-body" title={toast.body}>
            {toast.body}
          </div>
        )}
      </div>
      <button type="button" className="link-btn toast-dismiss" onClick={() => onDismiss(toast.id)}>
        Dismiss
      </button>
    </div>
  )
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((t) => t.id !== id)), [])
  const push = useCallback(
    (tone: ToastTone, title: string, body?: string) => {
      const id = nextId++
      setItems((xs) => [...xs.slice(-(MAX_VISIBLE - 1)), { id, tone, title, body }])
    },
    [],
  )
  const api = useMemo(() => ({ push }), [push])
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}
