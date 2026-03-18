'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const MARKET_NAV = [
  { href: '/marketing',           label: 'Overview',  match: (p: string) => p === '/marketing' },
  { href: '/marketing/partners',  label: 'Partners',  match: (p: string) => p.startsWith('/marketing/partners') },
  { href: '/marketing/queue',     label: 'Queue',     match: (p: string) => p.startsWith('/marketing/queue') },
  { href: '/marketing/campaigns', label: 'Campaigns', match: (p: string) => p.startsWith('/marketing/campaigns') },
  { href: '/marketing/signals',   label: 'Signals',   match: (p: string) => p.startsWith('/marketing/signals') },
]

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="space-y-0">
      {/* Sub-nav */}
      <div className="mb-6 flex items-center gap-1 overflow-x-auto rounded-2xl border border-[var(--app-line)] bg-[var(--app-panel)] p-1">
        {MARKET_NAV.map(item => {
          const active = item.match(pathname)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`shrink-0 rounded-xl px-4 py-2 text-sm font-medium transition ${
                active
                  ? 'bg-[#1a2744] text-white'
                  : 'text-[var(--app-muted)] hover:bg-[var(--app-bg)] hover:text-[var(--app-ink)]'
              }`}
            >
              {item.label}
            </Link>
          )
        })}
      </div>
      {children}
    </div>
  )
}
