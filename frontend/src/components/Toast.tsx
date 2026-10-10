import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { CheckCircle2, Info, X, XCircle } from 'lucide-react'

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
      setItems((xs) => [...xs.slice(-3), { id, tone, title, body }])
      window.setTimeout(() => dismiss(id), tone === 'error' ? 8000 : 4500)
    },
    [dismiss],
  )
  const api = useMemo(() => ({ push }), [push])
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite" aria-atomic="false">
        {items.map((t) => {
          const Icon = t.tone === 'success' ? CheckCircle2 : t.tone === 'error' ? XCircle : Info
          return (
            <div key={t.id} className={`toast toast-${t.tone}`} role={t.tone === 'error' ? 'alert' : 'status'}>
              <Icon size={16} className="toast-icon" aria-hidden="true" />
              <div className="toast-content">
                <div className="toast-title">{t.title}</div>
                {t.body && <div className="toast-body">{t.body}</div>}
              </div>
              <button type="button" className="icon-btn" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}>
                <X size={14} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
