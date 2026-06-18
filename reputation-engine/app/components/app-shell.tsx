'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { SalesHeader } from '@/app/components/sales-header'
import { CrewHeader } from '@/app/components/crew-header'
import { useCurrentUser } from '@/lib/hooks/use-current-user'

const FloatingDialer = dynamic(
  () => import('@/app/components/floating-dialer').then(mod => mod.FloatingDialer),
  { ssr: false },
)

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const user = useCurrentUser()
  const [tab, setTab] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    setTab(new URLSearchParams(window.location.search).get('tab'))
  }, [pathname])

  const partnershipInbox = tab !== undefined && pathname.startsWith('/marketing/partners') && (!tab || tab === 'phone' || tab === 'replies')
  const shouldMountDialer =
    pathname.startsWith('/sales') &&
    (user?.role === 'owner' || user?.role === 'manager' || user?.role === 'sales_rep')

  if (pathname.startsWith('/sales') || pathname.startsWith('/admin') || pathname.startsWith('/marketing')) {
    return (
      <div className="min-h-screen bg-[var(--app-bg)] lg:flex">
        <SalesHeader />
        <div className="min-w-0 flex-1">
          <main className={partnershipInbox ? 'px-0 py-0 pb-0 md:px-8 md:py-8 md:pb-8 lg:px-8' : 'px-3 py-4 pb-24 md:px-8 md:py-8 md:pb-8 lg:px-8'}>
            <div className={partnershipInbox ? 'mx-0 max-w-none md:mx-auto md:max-w-[1400px]' : 'mx-auto max-w-[1400px]'}>
              {children}
            </div>
          </main>
        </div>
        {shouldMountDialer && (
          <div className={partnershipInbox ? 'hidden lg:block' : ''}>
            <FloatingDialer />
          </div>
        )}
      </div>
    )
  }

  if (pathname.startsWith('/crew')) {
    return (
      <div className="min-h-screen bg-[var(--app-bg)]">
        <CrewHeader />
        <main className="mx-auto max-w-[800px] px-3 py-4 pb-8 md:px-8 md:py-8">
          {children}
        </main>
      </div>
    )
  }

  return <>{children}</>
}
