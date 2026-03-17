'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { LogoutButton } from '@/app/components/logout-button'
import { NewLeadModal } from '@/app/components/sales/new-lead-modal'

const NAV_ITEMS = [
  { href: '/sales', label: 'Dashboard', match: (path: string) => path === '/sales' },
  { href: '/sales/pipeline', label: 'Pipeline', match: (path: string) => path.startsWith('/sales/pipeline') },
  { href: '/sales/inbox', label: 'Inbox', match: (path: string) => path.startsWith('/sales/inbox') },
  { href: '/sales/quotes', label: 'Quotes', match: (path: string) => path.startsWith('/sales/quotes') },
  { href: '/sales/booked', label: 'Booked', match: (path: string) => path.startsWith('/sales/booked') },
  { href: '/trigger', label: 'Complete Job', match: (path: string) => path === '/trigger' },
]

export function SalesHeader() {
  const pathname = usePathname()
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [newLeadOpen, setNewLeadOpen] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    setQuery(params.get('q') || '')
  }, [pathname])

  // Allow other components to open the modal via a custom event
  useEffect(() => {
    function onOpen() { setNewLeadOpen(true) }
    window.addEventListener('crm:new-lead', onOpen)
    return () => window.removeEventListener('crm:new-lead', onOpen)
  }, [])

  function updateQuery(nextValue: string) {
    setQuery(nextValue)
    const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
    if (nextValue.trim()) params.set('q', nextValue.trim())
    else params.delete('q')
    const next = params.toString()
    router.replace(next ? `${pathname}?${next}` : pathname)
  }

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-[var(--app-line)] bg-[var(--app-panel-strong)]">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-4 py-4 md:px-8">
          <div className="flex items-center justify-between gap-4">
            <Link href="/sales" className="flex min-w-0 items-center gap-3">
              <div className="flex h-6 w-6 items-center justify-center rounded-[4px] bg-[var(--app-ink)] text-[11px] font-semibold text-white">S</div>
              <div className="truncate font-semibold tracking-tight text-[var(--app-ink)]">Saturn Star OS</div>
            </Link>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setNewLeadOpen(true)}
                className="crm-button-dark h-9 px-3 text-sm"
              >
                New Lead
              </button>
              <div className="hidden h-8 w-8 items-center justify-center rounded bg-[var(--app-line)] text-xs font-semibold text-[var(--app-ink)] sm:flex">SS</div>
              <LogoutButton />
            </div>
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <nav className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1 md:gap-6 md:px-0 md:pb-0">
              {NAV_ITEMS.map(item => {
                const active = item.match(pathname)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`shrink-0 rounded-full border px-3 py-2 text-sm font-medium transition md:rounded-none md:border-x-0 md:border-t-0 md:border-b-2 md:px-0 md:py-1 ${
                      active
                        ? 'border-[var(--app-ink)] bg-[var(--app-ink)] text-white md:bg-transparent md:text-[var(--app-ink)]'
                        : 'border-[var(--app-line)] text-[var(--app-muted)] hover:border-[var(--app-ink)] hover:text-[var(--app-ink)] md:border-transparent'
                    }`}
                  >
                    {item.label}
                  </Link>
                )
              })}
              <Link
                href="/sales/leads"
                className={`shrink-0 rounded-full border px-3 py-2 text-sm font-medium transition md:hidden ${
                  pathname.startsWith('/sales/leads')
                    ? 'border-[var(--app-ink)] bg-[var(--app-ink)] text-white'
                    : 'border-[var(--app-line)] text-[var(--app-muted)] hover:border-[var(--app-ink)] hover:text-[var(--app-ink)]'
                }`}
              >
                Leads
              </Link>
            </nav>

            <div className="relative w-full md:max-w-[280px]">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--app-muted)]">⌕</span>
              <input
                type="text"
                placeholder="Search leads, quotes..."
                value={query}
                onChange={event => updateQuery(event.target.value)}
                className="h-10 w-full rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] pl-9 pr-4 text-sm text-[var(--app-ink)] outline-none transition focus:border-[var(--app-ink)]"
              />
            </div>
          </div>
        </div>
      </header>

      <NewLeadModal open={newLeadOpen} onClose={() => setNewLeadOpen(false)} />
    </>
  )
}
