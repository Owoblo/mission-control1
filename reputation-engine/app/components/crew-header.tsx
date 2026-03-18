'use client'

import { useCurrentUser } from '@/lib/hooks/use-current-user'
import { LogoutButton } from '@/app/components/logout-button'

export function CrewHeader() {
  const user = useCurrentUser()
  const initials = user?.name ? user.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) : '?'

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--app-line)] bg-[#1a2744]">
      <div className="mx-auto flex max-w-[800px] items-center justify-between px-4 py-4 md:px-8">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f5a623]">
            <span className="text-sm font-bold text-[#1a2744]">S</span>
          </div>
          <div>
            <div className="text-sm font-semibold text-white">Saturn Star OS</div>
            <div className="text-xs text-white/50">Crew Portal</div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {user?.name && (
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-white">
                {initials}
              </div>
              <span className="hidden text-sm text-white/80 sm:block">{user.name}</span>
            </div>
          )}
          <LogoutButton />
        </div>
      </div>
    </header>
  )
}
