import type { Metadata, Viewport } from 'next'
import { Inter, Manrope } from 'next/font/google'
import { Suspense } from 'react'
import { AppShell } from '@/app/components/app-shell'
import { PWAInit } from '@/app/components/pwa-init'
import './globals.css'

const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-inter', display: 'swap' })
const manrope = Manrope({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-manrope', display: 'swap' })

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
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/icon-192.png?v=3" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className={`min-h-screen ${inter.variable} ${manrope.variable}`}>
        <Suspense fallback={children}>
          <AppShell>{children}</AppShell>
        </Suspense>
        <PWAInit />
      </body>
    </html>
  )
}
