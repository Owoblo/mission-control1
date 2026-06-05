'use client'

import { useState } from 'react'

type Party = {
  label: string
  phone: string
}

type Props = {
  open: boolean
  surveyUrl: string
  smsBody: string
  phone?: string
  sending: boolean
  onSmsBodyChange: (value: string) => void
  onSkip: () => void
  onSend: () => void
  // Conjoint support
  conjointMode?: boolean
  partyB?: { label: string; phone?: string }
  onSendToPartyB?: (phone: string, body: string) => void
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
  conjointMode,
  partyB,
  onSendToPartyB,
}: Props) {
  const [activeParty, setActiveParty] = useState<'a' | 'b'>('a')
  const [partyBPhone, setPartyBPhone] = useState(partyB?.phone || '')
  const [partyBSmsBody, setPartyBSmsBody] = useState('')

  if (!open) return null

  const partyBLabel = partyB?.label || 'Party B'
  const partyBBodyDefault = smsBody
    .replace(/Hi\s+\w+!?/, `Hi ${partyBLabel.split(' ')[0]}!`)

  const effectivePartyBBody = partyBSmsBody || partyBBodyDefault

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[16px] border border-[var(--app-line)] bg-white p-6 shadow-2xl">
        <h2 className="font-display text-base font-semibold text-[var(--app-ink)]">📦 Send inventory verification link</h2>
        <p className="mt-1 text-xs text-[var(--app-muted)]">
          {conjointMode
            ? 'Conjoint move — send a separate photo request to each party.'
            : 'Review and edit the message before sending. The link lets the customer confirm inventory, flag wrong-unit matches, and upload missing room photos.'}
        </p>

        {/* Party tabs for conjoint */}
        {conjointMode && onSendToPartyB && (
          <div className="mt-3 flex gap-1 rounded-[8px] bg-[var(--app-bg)] p-1">
            <button
              onClick={() => setActiveParty('a')}
              className={`flex-1 rounded-[6px] py-1.5 text-xs font-semibold transition ${activeParty === 'a' ? 'bg-white shadow-sm text-[var(--app-ink)]' : 'text-[var(--app-muted)]'}`}
            >
              Party A{phone ? ` · ${phone}` : ''}
            </button>
            <button
              onClick={() => setActiveParty('b')}
              className={`flex-1 rounded-[6px] py-1.5 text-xs font-semibold transition ${activeParty === 'b' ? 'bg-white shadow-sm text-[var(--app-ink)]' : 'text-[var(--app-muted)]'}`}
            >
              {partyBLabel}
            </button>
          </div>
        )}

        <div className="mt-3 break-all rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-2 text-xs text-[var(--app-muted)]">
          🔗 {surveyUrl}
        </div>

        {activeParty === 'a' || !conjointMode || !onSendToPartyB ? (
          <>
            <textarea
              value={smsBody}
              onChange={e => onSmsBodyChange(e.target.value)}
              className="mt-3 w-full resize-none rounded-[10px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--app-accent)]"
              rows={5}
            />
            <div className="mt-4 flex items-center justify-end gap-3">
              <button onClick={onSkip} className="crm-button text-sm">Skip SMS</button>
              <button
                onClick={onSend}
                disabled={sending || !smsBody.trim()}
                className="crm-button-dark text-sm disabled:opacity-60"
              >
                {sending ? 'Sending…' : `Send to ${phone || 'customer'}`}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mt-3 space-y-2">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-[var(--app-muted)]">
                {partyBLabel} phone number
              </label>
              <input
                type="tel"
                value={partyBPhone}
                onChange={e => setPartyBPhone(e.target.value)}
                placeholder="e.g. 226-555-0123"
                className="crm-input w-full text-sm"
              />
            </div>
            <textarea
              value={effectivePartyBBody}
              onChange={e => setPartyBSmsBody(e.target.value)}
              className="mt-3 w-full resize-none rounded-[10px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--app-accent)]"
              rows={5}
            />
            <div className="mt-4 flex items-center justify-end gap-3">
              <button onClick={onSkip} className="crm-button text-sm">Skip</button>
              <button
                onClick={() => {
                  if (partyBPhone.trim()) onSendToPartyB(partyBPhone.trim(), effectivePartyBBody)
                }}
                disabled={sending || !partyBPhone.trim() || !effectivePartyBBody.trim()}
                className="crm-button-dark text-sm disabled:opacity-60"
              >
                {sending ? 'Sending…' : `Send to ${partyBLabel}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
