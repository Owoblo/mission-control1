'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function PWAInit() {
  const pathname = usePathname()
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [showBanner, setShowBanner] = useState(false)
  const isCustomerFacingRoute =
    pathname?.startsWith('/survey') ||
    pathname?.startsWith('/quote-accept') ||
    pathname?.startsWith('/review') ||
    pathname?.startsWith('/affiliate')

  useEffect(() => {
    if (isCustomerFacingRoute) {
      setInstallPrompt(null)
      setShowBanner(false)
      return
    }

    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js', { updateViaCache: 'none' })
        .then(registration => registration.update().catch(() => null))
        .catch(() => null)
    }

    let bannerTimer: number | undefined

    // Capture install prompt
    const handler = (e: Event) => {
      e.preventDefault()
      setInstallPrompt(e as BeforeInstallPromptEvent)
      // Show banner after 30s — don't interrupt immediately
      bannerTimer = window.setTimeout(() => setShowBanner(true), 30_000)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
      if (bannerTimer) window.clearTimeout(bannerTimer)
    }
  }, [isCustomerFacingRoute])

  async function install() {
    if (!installPrompt) return
    await installPrompt.prompt()
    const { outcome } = await installPrompt.userChoice
    if (outcome === 'accepted') setShowBanner(false)
  }

  if (isCustomerFacingRoute || !showBanner || !installPrompt) return null

  return (
    <div className="fixed bottom-4 left-1/2 z-[9999] -translate-x-1/2 w-[calc(100%-32px)] max-w-sm">
      <div className="flex items-center gap-3 rounded-xl bg-[#071421] px-4 py-3.5 shadow-none ring-1 ring-white/10">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#C99700]">
          <span className="text-lg">🚛</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-white">Install Saturn Star OS</div>
          <div className="text-xs text-slate-400">Keep the dialer running in the background</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowBanner(false)}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            Later
          </button>
          <button
            onClick={() => void install()}
            className="rounded-lg bg-[#C99700] px-3 py-1.5 text-xs font-bold text-[#071421] hover:opacity-90 transition-opacity"
          >
            Install
          </button>
        </div>
      </div>
    </div>
  )
}
