import type { Metadata, Viewport } from 'next'
import { Suspense } from 'react'
import { AppShell } from '@/app/components/app-shell'
import { PWAInit } from '@/app/components/pwa-init'
import './globals.css'

export const metadata: Metadata = {
  title: 'Saturn Star OS',
  description: 'Sales CRM, quotes, operations, and reviews for Saturn Star Moving',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icon-192.png?v=3', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png?v=3', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icon-192.png?v=3',
    shortcut: '/icon-192.png?v=3',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Saturn Star OS',
  },
}

export const viewport: Viewport = {
  themeColor: '#071421',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Manrope:wght@500;600;700&display=swap" rel="stylesheet" />
        <link rel="apple-touch-icon" href="/icon-192.png?v=3" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className="min-h-screen">
        <Suspense fallback={children}>
          <AppShell>{children}</AppShell>
        </Suspense>
        <PWAInit />
      </body>
    </html>
  )
}
