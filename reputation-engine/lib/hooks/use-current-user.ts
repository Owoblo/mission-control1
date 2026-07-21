'use client'

import { useEffect, useState } from 'react'
import type { UserRole } from '@/lib/auth'

export interface CurrentUser {
  role: UserRole
  name: string
  userId: string | null
  branch: string | null
}

let cached: CurrentUser | null = null

export function useCurrentUser() {
  const [user, setUser] = useState<CurrentUser | null>(cached)

  useEffect(() => {
    if (cached) return
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then((data: CurrentUser | null) => {
        if (data) {
          cached = data
          setUser(data)
        }
      })
      .catch(() => null)
  }, [])

  return user
}
