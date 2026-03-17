import type { Metadata } from 'next'
import { AppShell } from '@/app/components/app-shell'
import './globals.css'

export const metadata: Metadata = {
  title: 'Saturn Star — Mission Control',
  description: 'Sales CRM, quotes, reviews, and referral ops for Saturn Star Movers',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  )
}
