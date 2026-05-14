'use client'

import { useEffect, useRef } from 'react'

type Props = {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  destructive = false, onConfirm, onCancel,
}: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) confirmRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-[16px] border border-[var(--app-line)] bg-white p-6 shadow-2xl">
        <h3 className="text-base font-semibold text-[var(--app-ink)]">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-[var(--app-muted)]">{message}</p>
        <div className="mt-5 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="crm-button px-4 text-sm"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className={`rounded-[8px] px-4 py-2 text-sm font-semibold text-white transition ${
              destructive
                ? 'bg-rose-600 hover:bg-rose-700'
                : 'bg-[var(--app-ink)] hover:bg-[#0f1b2d]'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
