import { useEffect, useState, type MouseEvent } from 'react'

export type Route =
  | { name: 'overview' }
  | { name: 'runs' }
  | { name: 'run'; id: string }
  | { name: 'new' }
  | { name: 'ledger' }
  | { name: 'systems' }
  | { name: 'audit' }
  | { name: 'how' }
  | { name: 'not_found' }

export function parseRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/'
  switch (path) {
    case '/':
    case '/overview':
      return { name: 'overview' }
    case '/runs':
      return { name: 'runs' }
    case '/new':
      return { name: 'new' }
    case '/ledger':
      return { name: 'ledger' }
    case '/systems':
      return { name: 'systems' }
    case '/audit':
      return { name: 'audit' }
    case '/how-it-works':
      return { name: 'how' }
  }
  const m = path.match(/^\/runs\/([^/]+)$/)
  if (m) return { name: 'run', id: decodeURIComponent(m[1]) }
  return { name: 'not_found' }
}

const NAV_EVENT = 'adjutant:navigate'

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  const current = window.location.pathname + window.location.search
  if (to === current) return
  if (opts.replace) window.history.replaceState({}, '', to)
  else window.history.pushState({}, '', to)
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

export function useSearchParam(name: string): string | null {
  const read = () => new URLSearchParams(window.location.search).get(name)
  const [value, setValue] = useState<string | null>(read)
  useEffect(() => {
    const update = () => setValue(new URLSearchParams(window.location.search).get(name))
    window.addEventListener('popstate', update)
    window.addEventListener(NAV_EVENT, update)
    return () => {
      window.removeEventListener('popstate', update)
      window.removeEventListener(NAV_EVENT, update)
    }
  }, [name])
  return value
}

/** onClick handler for <a href> that keeps modifier-click (new tab) working. */
export function linkHandler(to: string) {
  return (e: MouseEvent<HTMLElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    navigate(to)
  }
}
