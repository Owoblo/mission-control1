'use client'

type Props = {
  open: boolean
  surveyUrl: string
  smsBody: string
  phone?: string
  sending: boolean
  onSmsBodyChange: (value: string) => void
  onSkip: () => void
  onSend: () => void
}

export function PhotoRequestDialog({
  open,
  surveyUrl,
  smsBody,
  phone,
  sending,
  onSmsBodyChange,
  onSkip,
  onSend,
}: Props) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[16px] border border-[var(--app-line)] bg-white p-6 shadow-2xl">
        <h2 className="font-display text-base font-semibold text-[var(--app-ink)]">📦 Send inventory verification link</h2>
        <p className="mt-1 text-xs text-[var(--app-muted)]">
          Review and edit the message before sending. The link lets the customer confirm inventory, flag wrong-unit matches, and upload missing room photos.
        </p>
        <div className="mt-3 break-all rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-2 text-xs text-[var(--app-muted)]">
          🔗 {surveyUrl}
        </div>
        <textarea
          value={smsBody}
          onChange={event => onSmsBodyChange(event.target.value)}
          className="mt-3 w-full resize-none rounded-[10px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--app-accent)]"
          rows={5}
        />
        <div className="mt-4 flex items-center justify-end gap-3">
          <button onClick={onSkip} className="crm-button text-sm">
            Skip SMS
          </button>
          <button
            onClick={onSend}
            disabled={sending || !smsBody.trim()}
            className="crm-button-dark text-sm disabled:opacity-60"
          >
            {sending ? 'Sending…' : `Send to ${phone || 'customer'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
