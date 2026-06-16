'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

const MARKET_NAV = [
  { href: '/marketing/partners?tab=queue',    label: 'SMS Queue', match: (p: string, tab: string | null) => p.startsWith('/marketing/partners') && (!tab || tab === 'queue') },
  { href: '/marketing/partners?tab=replies',  label: 'Replies',   match: (p: string, tab: string | null) => p.startsWith('/marketing/partners') && tab === 'replies' },
  { href: '/marketing/partners?tab=phone',    label: 'Inbox',     match: (p: string, tab: string | null) => p.startsWith('/marketing/partners') && tab === 'phone' },
  { href: '/marketing/partners?tab=pipeline', label: 'Pipeline',  match: (p: string, tab: string | null) => p.startsWith('/marketing/partners') && tab === 'pipeline' },
  { href: '/marketing/signals',               label: 'Signals',   match: (p: string) => p.startsWith('/marketing/signals') },
]

function MarketingNav() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const tab = searchParams.get('tab')

  return (
    <div className="mb-6 flex items-center gap-1 overflow-x-auto rounded-2xl border border-[var(--app-line)] bg-[var(--app-panel)] p-1">
      {MARKET_NAV.map(item => {
        const active = item.match(pathname, tab)
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
  )
}

function MarketingNavFallback() {
  return (
    <div className="mb-6 flex items-center gap-1 overflow-x-auto rounded-2xl border border-[var(--app-line)] bg-[var(--app-panel)] p-1">
      {MARKET_NAV.map(item => (
        <Link
          key={item.href}
          href={item.href}
          className="shrink-0 rounded-xl px-4 py-2 text-sm font-medium text-[var(--app-muted)] transition hover:bg-[var(--app-bg)] hover:text-[var(--app-ink)]"
        >
          {item.label}
        </Link>
      ))}
    </div>
  )
}

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-0">
      <Suspense fallback={<MarketingNavFallback />}>
        <MarketingNav />
      </Suspense>
      {children}
    </div>
  )
}
