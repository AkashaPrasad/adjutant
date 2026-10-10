import { linkHandler } from '../lib/router'
import { cx } from './ui'

/** "Runs" / "Effects" tabs shown under the page header of both list pages. */
export function ListTabs({ active }: { active: 'runs' | 'effects' }) {
  return (
    <nav className="tabs" aria-label="Lists">
      <a href="/runs" className={cx('tab', active === 'runs' && 'is-active')} aria-current={active === 'runs' ? 'page' : undefined} onClick={linkHandler('/runs')}>
        Runs
      </a>
      <a href="/ledger" className={cx('tab', active === 'effects' && 'is-active')} aria-current={active === 'effects' ? 'page' : undefined} onClick={linkHandler('/ledger')}>
        Effects
      </a>
    </nav>
  )
}
