'use client'

import type { LucideIcon } from 'lucide-react'

export type CrewNavItem = {
  id: string
  label: string
  href: string
  icon: LucideIcon
}

// Thumb-reachable bottom navigation for crew field surfaces (mobile only).
// Links are in-page anchors to the page's real sections — no invented
// destinations. Desktop keeps its existing navigation.
export default function CrewBottomNav({ items }: { items: CrewNavItem[] }) {
  if (items.length === 0) return null
  return (
    <nav
      aria-label="Job sections"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div
        className="mx-auto grid max-w-2xl"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
        {items.map(item => {
          const Icon = item.icon
          return (
            <a
              key={item.id}
              href={item.href}
              className="flex min-h-[56px] flex-col items-center justify-center gap-1 px-2 py-2 text-[11px] font-semibold text-slate-500 active:text-[#071421]"
            >
              <Icon className="h-5 w-5" aria-hidden />
              {item.label}
            </a>
          )
        })}
      </div>
    </nav>
  )
}
