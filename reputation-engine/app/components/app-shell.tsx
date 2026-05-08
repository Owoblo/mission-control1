'use client'

import { usePathname } from 'next/navigation'
import { FloatingDialer } from '@/app/components/floating-dialer'
import { SalesHeader } from '@/app/components/sales-header'
import { CrewHeader } from '@/app/components/crew-header'
import { useLeadAlerts } from '@/lib/hooks/use-lead-alerts'

function LeadAlerts() {
  useLeadAlerts()
  return null
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  if (pathname.startsWith('/sales') || pathname.startsWith('/admin') || pathname.startsWith('/marketing')) {
    return (
      <div className="min-h-screen bg-[var(--app-bg)]">
        <LeadAlerts />
        <SalesHeader />
        <main className="mx-auto max-w-[1400px] px-3 py-4 pb-24 md:px-8 md:py-8 md:pb-8">
          {children}
        </main>
        <FloatingDialer />
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
