'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

const MARKET_NAV = [
  { href: '/marketing/partners?tab=today',    label: 'Today',         match: (p: string, tab: string | null) => p.startsWith('/marketing/partners') && (!tab || tab === 'today') },
  { href: '/marketing/partners?tab=phone',    label: 'Conversations', match: (p: string, tab: string | null) => p.startsWith('/marketing/partners') && (tab === 'phone' || tab === 'replies') },
  { href: '/marketing/partners?tab=pipeline', label: 'Relationships', match: (p: string, tab: string | null) => p.startsWith('/marketing/partners') && tab === 'pipeline' },
  { href: '/marketing/partners?tab=partners', label: 'Partners',      match: (p: string, tab: string | null) => p.startsWith('/marketing/partners') && tab === 'partners' },
  { href: '/marketing/signals',               label: 'Signals',       match: (p: string) => p.startsWith('/marketing/signals') },
]

function MarketingNav() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const tab = searchParams.get('tab')
  const partnershipInbox = pathname.startsWith('/marketing/partners') && (!tab || tab === 'phone' || tab === 'replies')

  return (
    <div className={`${partnershipInbox ? 'hidden md:flex' : 'flex'} mb-6 items-center gap-1 overflow-x-auto border-b border-[var(--app-line)] bg-[var(--app-panel)] px-1`}>
      {MARKET_NAV.map(item => {
        const active = item.match(pathname, tab)
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`shrink-0 border-b-2 px-4 py-3 text-sm font-medium transition ${
              active
                ? 'border-[#b68a3a] text-[#14213d]'
                : 'border-transparent text-[var(--app-muted)] hover:text-[var(--app-ink)]'
            }`}
          >
            {item.label}
          </Link>
        )
      })}
    </div>
  )
}

function MarketingNavFallback() {
  return (
    <div className="mb-6 hidden items-center gap-1 overflow-x-auto border-b border-[var(--app-line)] bg-[var(--app-panel)] px-1 md:flex">
      {MARKET_NAV.map(item => (
        <Link
          key={item.href}
          href={item.href}
          className="shrink-0 border-b-2 border-transparent px-4 py-3 text-sm font-medium text-[var(--app-muted)] transition hover:text-[var(--app-ink)]"
        >
          {item.label}
        </Link>
      ))}
    </div>
  )
}

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Suspense fallback={<MarketingNavFallback />}>
        <MarketingNav />
      </Suspense>
      {children}
    </div>
  )
}
