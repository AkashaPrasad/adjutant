import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api/client'
import { ErrorBoundary } from './components/ErrorBoundary'
import { DemoDrawer, ShortcutsPanel, Sidebar, Topbar } from './components/Shell'
import { EmptyState } from './components/ui'
import { API_BASE } from './config'
import { useAsync } from './lib/hooks'
import { linkHandler, navigate, useRoute } from './lib/router'
import { useTheme } from './lib/theme'
import { Audit } from './pages/Audit'
import { HowItWorks } from './pages/HowItWorks'
import { Ledger } from './pages/Ledger'
import { NewRun } from './pages/NewRun'
import { Overview } from './pages/Overview'
import { RunReview } from './pages/RunReview'
import { Runs } from './pages/Runs'
import { Systems } from './pages/Systems'

const GO: Record<string, string> = { o: '/', r: '/runs', e: '/ledger', l: '/ledger', s: '/systems', a: '/audit', h: '/how-it-works', n: '/new' }

export default function App() {
  const route = useRoute()
  const health = useAsync(() => api.health(), [], 15_000)
  const runs = useAsync(() => api.listRuns(100), [], 10_000)
  const pending = (runs.data ?? []).filter((r) => r.status === 'awaiting_approval' || r.status === 'blocked').length
  const [, , toggleTheme] = useTheme()
  const [menu, setMenu] = useState(false)
  const [shortcuts, setShortcuts] = useState(false)
  const [demo, setDemo] = useState(false)
  const gPressed = useRef<number>(0)
  const offline = health.error != null && !health.loading

  const closeMenu = useCallback(() => setMenu(false), [])
  const closeShortcuts = useCallback(() => setShortcuts(false), [])
  const closeDemo = useCallback(() => setDemo(false), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest('input,textarea,select,[contenteditable]')) return
      if (e.key === '?') {
        e.preventDefault()
        setShortcuts((v) => !v)
        return
      }
      if (e.key === '/') {
        const search = document.querySelector<HTMLInputElement>('[data-search]')
        if (search) {
          e.preventDefault()
          search.focus()
        }
        return
      }
      if (Date.now() - gPressed.current < 900 && GO[e.key]) {
        e.preventDefault()
        gPressed.current = 0
        navigate(GO[e.key])
        return
      }
      if (e.key === 'g') {
        gPressed.current = Date.now()
        return
      }
      // j/k/a/r/e belong to the run review; n stays off there so it cannot be hit mid-review.
      if (e.key === 'n' && route.name !== 'run') navigate('/new')
      else if (e.key === 't') toggleTheme()
      else if (e.key === 'd') setDemo((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [route.name, toggleTheme])

  // Re-check health immediately after a reconnect so the banner clears fast.
  useEffect(() => {
    const onOnline = () => void health.reload()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [health])

  return (
    <div className="app">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Sidebar
        route={route}
        open={menu}
        pending={pending}
        health={health.data}
        onClose={closeMenu}
        onDemo={() => setDemo(true)}
        onShortcuts={() => setShortcuts(true)}
      />
      <div className="main-col">
        <Topbar health={health.data} healthError={offline} onMenu={() => setMenu(true)} onShortcuts={() => setShortcuts(true)} />
        {offline && (
          <div className="offline-banner" role="status">
            API unreachable at <span className="mono">{API_BASE}</span>. Showing the last loaded data; retrying every 15s.
            <button type="button" className="link-btn" onClick={() => void health.reload()}>
              Retry now
            </button>
          </div>
        )}
        <main id="main" className="main" tabIndex={-1}>
          <ErrorBoundary key={route.name === 'run' ? `run-${route.id}` : route.name}>
            {route.name === 'overview' && <Overview env={health.data?.env} />}
            {route.name === 'runs' && <Runs />}
            {route.name === 'run' && <RunReview key={route.id} id={route.id} />}
            {route.name === 'new' && <NewRun />}
            {route.name === 'ledger' && <Ledger />}
            {route.name === 'systems' && <Systems />}
            {route.name === 'audit' && <Audit />}
            {route.name === 'how' && <HowItWorks />}
            {route.name === 'not_found' && (
              <div className="page">
                <EmptyState
                  title="Page not found"
                  action={
                    <a href="/" className="btn btn-primary" onClick={linkHandler('/')}>
                      Go to overview
                    </a>
                  }
                >
                  There is nothing at this address.
                </EmptyState>
              </div>
            )}
          </ErrorBoundary>
        </main>
      </div>
      <ShortcutsPanel open={shortcuts} onClose={closeShortcuts} />
      <DemoDrawer open={demo} onClose={closeDemo} />
    </div>
  )
}
