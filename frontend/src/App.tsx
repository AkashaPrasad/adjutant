import { api } from './api/client'
import { Header } from './components/Header'
import { EmptyState } from './components/ui'
import { BUILD_TIME, FRONTEND_SHA } from './config'
import { shortSha } from './lib/format'
import { useAsync } from './lib/hooks'
import { linkHandler, useRoute } from './lib/router'
import { Ledger } from './pages/Ledger'
import { NewRun } from './pages/NewRun'
import { RunReview } from './pages/RunReview'
import { Runs } from './pages/Runs'

export default function App() {
  const route = useRoute()
  const health = useAsync(() => api.health(), [], 15_000)

  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Header route={route} health={health} />
      <main id="main" className="main" tabIndex={-1}>
        {route.name === 'new' && <NewRun health={health.data} />}
        {route.name === 'runs' && <Runs />}
        {route.name === 'run' && <RunReview key={route.id} id={route.id} />}
        {route.name === 'ledger' && <Ledger />}
        {route.name === 'not_found' && (
          <div className="page">
            <EmptyState
              title="Page not found"
              action={
                <a href="/" className="btn btn-primary" onClick={linkHandler('/')}>
                  Go to console
                </a>
              }
            >
              There is nothing at this address.
            </EmptyState>
          </div>
        )}
      </main>
      <footer className="footer">
        <span>Adjutant Gate · preview, approve, execute once, undo, verify</span>
        <span className="mono">
          web {shortSha(FRONTEND_SHA)}
          {BUILD_TIME ? ` · built ${BUILD_TIME}` : ''}
        </span>
      </footer>
    </>
  )
}
