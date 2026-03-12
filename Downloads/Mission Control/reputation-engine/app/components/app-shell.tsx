'use client'

import { usePathname } from 'next/navigation'
import { FloatingDialer } from '@/app/components/floating-dialer'
import { SalesHeader } from '@/app/components/sales-header'

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const showSalesChrome = pathname.startsWith('/sales')

  if (!showSalesChrome) {
    return <>{children}</>
  }

  return (
    <div className="min-h-screen bg-[var(--app-bg)]">
      <SalesHeader />
      <main className="mx-auto max-w-[1400px] px-4 py-6 md:px-8 md:py-8">
        {children}
      </main>
      <FloatingDialer />
    </div>
  )
}
