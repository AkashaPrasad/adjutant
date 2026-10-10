import { useEffect, useState, type MouseEvent } from 'react'

export type Route =
  | { name: 'new' }
  | { name: 'runs' }
  | { name: 'run'; id: string }
  | { name: 'ledger' }
  | { name: 'not_found' }

export function parseRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/' || path === '/new') return { name: 'new' }
  if (path === '/runs') return { name: 'runs' }
  if (path === '/ledger') return { name: 'ledger' }
  const m = path.match(/^\/runs\/([^/]+)$/)
  if (m) return { name: 'run', id: decodeURIComponent(m[1]) }
  return { name: 'not_found' }
}

const NAV_EVENT = 'adjutant:navigate'

export function navigate(to: string) {
  if (to === window.location.pathname) return
  window.history.pushState({}, '', to)
  window.dispatchEvent(new Event(NAV_EVENT))
  window.scrollTo({ top: 0 })
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname))
  useEffect(() => {
    const update = () => setRoute(parseRoute(window.location.pathname))
    window.addEventListener('popstate', update)
    window.addEventListener(NAV_EVENT, update)
    return () => {
      window.removeEventListener('popstate', update)
      window.removeEventListener(NAV_EVENT, update)
    }
  }, [])
  return route
}

/** onClick handler for <a href> that keeps modifier-click (new tab) working. */
export function linkHandler(to: string) {
  return (e: MouseEvent<HTMLElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    navigate(to)
  }
}
