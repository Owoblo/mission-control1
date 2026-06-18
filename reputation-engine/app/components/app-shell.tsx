'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { SalesHeader } from '@/app/components/sales-header'
import { CrewHeader } from '@/app/components/crew-header'
import { CRMAppFrame, CRMMainContent, CRMMainViewport, CRMViewport } from '@/app/components/crm-layout'
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
      <CRMAppFrame>
        <SalesHeader />
        <CRMMainViewport>
          <CRMMainContent flush={partnershipInbox}>
            <CRMViewport flush={partnershipInbox}>
              {children}
            </CRMViewport>
          </CRMMainContent>
        </CRMMainViewport>
        {shouldMountDialer && (
          <div className={partnershipInbox ? 'hidden lg:block' : ''}>
            <FloatingDialer />
          </div>
        )}
      </CRMAppFrame>
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
