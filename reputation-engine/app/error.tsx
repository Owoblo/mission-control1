'use client'

import { useEffect } from 'react'
import Link from 'next/link'

// Root error boundary — every route segment without its own error.tsx
// falls back to this branded page instead of a blank screen or raw dump.
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Keep the console record for debugging; never show internals to the user.
    console.error('Root error boundary caught:', error)
  }, [error])

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F7F4ED] px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#071421] text-2xl font-black text-[#C99700]">
          S
        </div>
        <h1 className="mt-5 text-xl font-bold tracking-tight text-[#071421]">Something went wrong</h1>
        <p className="mt-2 text-sm leading-6 text-[#071421]/60">
          This page hit an unexpected error. Your work is safe — try again, or head back to the dashboard.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => reset()}
            className="min-h-[44px] rounded-lg bg-[#071421] px-4 text-sm font-bold text-white hover:bg-[#243460]"
          >
            Try again
          </button>
          <Link
            href="/sales"
            className="flex min-h-[44px] items-center justify-center rounded-lg border border-[#071421]/20 px-4 text-sm font-semibold text-[#071421]/70 hover:border-[#071421]/40"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
