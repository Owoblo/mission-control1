import type { Metadata, Viewport } from 'next'
import { AppShell } from '@/app/components/app-shell'
import { PWAInit } from '@/app/components/pwa-init'
import './globals.css'

export const metadata: Metadata = {
  title: 'Saturn Star OS',
  description: 'Sales CRM, quotes, operations, and reviews for Saturn Star Moving',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/saturn-star-logo.png',
    apple: '/saturn-star-logo.png',
    shortcut: '/saturn-star-logo.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Saturn Star OS',
  },
}

export const viewport: Viewport = {
  themeColor: '#1a2744',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/saturn-star-logo.png" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className="min-h-screen">
        <AppShell>{children}</AppShell>
        <PWAInit />
      </body>
    </html>
  )
}
