'use client'

import dynamic from 'next/dynamic'
import { usePathname, useSearchParams } from 'next/navigation'
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
  const searchParams = useSearchParams()
  const user = useCurrentUser()
  const tab = searchParams.get('tab')
  const partnershipInbox = pathname.startsWith('/marketing/partners') && (!tab || tab === 'phone' || tab === 'replies')
  const shouldMountDialer =
    pathname.startsWith('/sales') &&
    (user?.role === 'owner' || user?.role === 'manager' || user?.role === 'sales_rep' ||
      (user?.role === 'operations_lead' && pathname.startsWith('/sales/operations/sms')))

  if (pathname.startsWith('/sales') || pathname.startsWith('/admin') || pathname.startsWith('/marketing')) {
    return (
      <CRMAppFrame>
        <SalesHeader />
        <CRMMainViewport fixed={partnershipInbox}>
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
