'use client'

import { usePathname } from 'next/navigation'
import { FloatingDialer } from '@/app/components/floating-dialer'
import { SalesHeader } from '@/app/components/sales-header'
import { CrewHeader } from '@/app/components/crew-header'

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  if (pathname.startsWith('/sales') || pathname.startsWith('/admin') || pathname.startsWith('/marketing')) {
    return (
      <div className="min-h-screen bg-[var(--app-bg)] lg:flex">
        <SalesHeader />
        <div className="min-w-0 flex-1">
          <main className="px-3 py-4 pb-24 md:px-8 md:py-8 md:pb-8 lg:px-8">
            <div className="mx-auto max-w-[1400px]">
              {children}
            </div>
          </main>
        </div>
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
