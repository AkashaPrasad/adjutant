import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

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

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((t) => t.id !== id)), [])
  const push = useCallback(
    (tone: ToastTone, title: string, body?: string) => {
      const id = nextId++
      setItems((xs) => [...xs.slice(-2), { id, tone, title, body }])
      if (tone !== 'error') window.setTimeout(() => dismiss(id), 5000)
    },
    [dismiss],
  )
  const api = useMemo(() => ({ push }), [push])
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`} role={t.tone === 'error' ? 'alert' : 'status'}>
            <div className="toast-content">
              <div className="toast-title">{t.title}</div>
              {t.body && <div className="toast-body">{t.body}</div>}
            </div>
            <button type="button" className="link-btn toast-dismiss" onClick={() => dismiss(t.id)}>
              Dismiss
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
