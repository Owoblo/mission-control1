'use client'

import { useEffect } from 'react'

export default function SurveyError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[survey] Customer survey failed', error)
  }, [error])

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f0f2f5] p-6">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-xl font-bold text-amber-700">
          !
        </div>
        <h1 className="mt-4 text-lg font-bold text-[#1a2744]">We could not keep this review open.</h1>
        <p className="mt-2 text-sm leading-relaxed text-gray-500">
          Please try loading it again. If it still does not work, call Saturn Star Movers at (226) 773-2993.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          className="mt-5 w-full rounded-xl bg-[#1a2744] px-4 py-3 text-sm font-semibold text-white"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
