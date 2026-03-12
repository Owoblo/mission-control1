import type { Metadata } from 'next'
import { FloatingDialer } from '@/app/components/floating-dialer'
import { SalesHeader } from '@/app/components/sales-header'
import './globals.css'

export const metadata: Metadata = {
  title: 'Saturn Star — Mission Control',
  description: 'Sales CRM, quotes, reviews, and referral ops for Saturn Star Movers',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <div className="min-h-screen bg-[var(--app-bg)]">
          <SalesHeader />
          <main className="mx-auto max-w-[1400px] px-4 py-6 md:px-8 md:py-8">
            {children}
          </main>
        </div>
        <FloatingDialer />
      </body>
    </html>
  )
}
