'use client'

import { useEffect, useState } from 'react'
import type { UserRole } from '@/lib/auth'
import { SESSION_RESTORED } from '@/lib/session-recovery'

export interface CurrentUser {
  role: UserRole
  name: string
  userId: string | null
  branch: string | null
}
let cached: CurrentUser | null = null
let inFlight: Promise<void> | null = null
const listeners = new Set<(user: CurrentUser | null) => void>()
async function refresh() {
  if (inFlight) return inFlight
  inFlight = (async () => {
    try {
      const response = await fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' })
      if (response.ok || response.status === 401) {
        cached = response.ok ? await response.json() : null
        listeners.forEach(listener => listener(cached))
      }
    } catch { /* Keep the last known profile during a temporary network outage. */ }
    finally { inFlight = null }
  })()
  return inFlight
}
export function useCurrentUser() {
  const [user, setUser] = useState<CurrentUser | null>(cached)
  useEffect(() => {
    listeners.add(setUser)
    const check = () => { if (document.visibilityState === 'visible') void refresh() }
    void refresh()
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    window.addEventListener(SESSION_RESTORED, check)
    const timer = window.setInterval(check, 5 * 60_000)
    return () => {
      listeners.delete(setUser); clearInterval(timer)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener(SESSION_RESTORED, check)
    }
  }, [])
  return user
}
