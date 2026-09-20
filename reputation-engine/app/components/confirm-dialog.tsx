'use client'

import { useEffect, useRef } from 'react'

type ConfirmDialogProps = {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

// One shared confirmation pattern for every irreversible action.
// Replaces native window.confirm and ad-hoc per-page improvisation.
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null)
  // Parents pass inline onCancel closures; holding the latest in a ref keeps
  // this effect from re-running (and re-stealing focus) on every parent render.
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel

  useEffect(() => {
    if (!open) return
    confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancelRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[#071421]/50" onClick={onCancel} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl"
      >
        <h2 id="confirm-dialog-title" className="text-lg font-bold tracking-tight text-[#071421]">
          {title}
        </h2>
        <p className="mt-2 text-sm leading-6 text-[#071421]/60">{message}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="min-h-[44px] rounded-lg border border-[#071421]/20 px-4 text-sm font-semibold text-[#071421]/70 hover:border-[#071421]/40 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            ref={confirmRef}
            onClick={onConfirm}
            disabled={busy}
            className={
              destructive
                ? 'min-h-[44px] rounded-lg bg-rose-700 px-4 text-sm font-bold text-white hover:bg-rose-800 disabled:opacity-50'
                : 'min-h-[44px] rounded-lg bg-[#071421] px-4 text-sm font-bold text-white hover:bg-[#243460] disabled:opacity-50'
            }
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
