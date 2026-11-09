'use client'

import dynamic from 'next/dynamic'
import { SessionRecovery } from './session-recovery'
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
    (user?.role === 'owner' || user?.role === 'manager' || user?.role === 'sales_rep')

  if (pathname.startsWith('/sales') || pathname.startsWith('/admin') || pathname.startsWith('/marketing')) {
    return (
      <CRMAppFrame>
        {process.env.NEXT_PUBLIC_CRM_SYNTHETIC_PREVIEW === '1' && <div className="pointer-events-none fixed right-3 top-2 z-[100] rounded bg-amber-100 px-3 py-1 text-xs text-amber-950">Synthetic preview · no real data or sending</div>}
        <SessionRecovery />
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
        <SessionRecovery />
        <CrewHeader />
        <main className="mx-auto max-w-[800px] px-3 py-4 pb-8 md:px-8 md:py-8">
          {children}
        </main>
      </div>
    )
  }

  return <>{children}</>
}
