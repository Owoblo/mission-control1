'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { SalesAddressAutocompleteInput } from '@/app/components/sales/address-autocomplete-input'
import { createSalesLead } from '@/lib/sales-api'

interface Props {
  open: boolean
  onClose: () => void
  prefillPhone?: string  // from inbound call detection
}

type Step = 'form' | 'loading' | 'done'

export function QuickScanModal({ open, onClose, prefillPhone = '' }: Props) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('form')
  const [phone, setPhone] = useState(prefillPhone)
  const [originAddress, setOriginAddress] = useState('')
  const [originCity, setOriginCity] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [surveyUrl, setSurveyUrl] = useState<string | null>(null)
  const [leadId, setLeadId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [smsSending, setSmsSending] = useState(false)
  const [smsSent, setSmsSent] = useState(false)
  const addressRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setStep('form')
      setPhone(prefillPhone)
      setOriginAddress('')
      setOriginCity('')
      setError(null)
      setSurveyUrl(null)
      setLeadId(null)
      setCopied(false)
      setTimeout(() => addressRef.current?.focus(), 80)
    }
  }, [open, prefillPhone])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  async function handleScan() {
    if (!originAddress && !originCity) {
      setError('Enter the origin address to scan.')
      return
    }
    setError(null)
    setStep('loading')

    try {
      // 1. Create minimal lead — name + (phone or email) required by API
      const placeholderName = originCity.trim() || originAddress.split(',')[0]?.trim() || 'New Lead'
      const cleanPhone = phone.trim()
      const lead = await createSalesLead({
        name: placeholderName,
        // phone or email must be present — use a placeholder email if no phone
        phone: cleanPhone || undefined,
        email: !cleanPhone ? 'pending@update.local' : undefined,
        originAddress: originAddress.trim(),
        originCity: originCity.trim(),
        source: 'inbound_call',
        stage: 'new',
      })

      setLeadId(lead.id)

      // 2. Generate survey token (no SMS)
      const surveyRes = await fetch(`/api/sales/leads/${lead.id}/survey`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ skipSms: true }),
      })
      const surveyData = await surveyRes.json() as { surveyUrl?: string; error?: string }
      if (!surveyRes.ok || surveyData.error) throw new Error(surveyData.error || 'Could not generate link')

      setSurveyUrl(surveyData.surveyUrl || null)
      setStep('done')

      // Auto-copy
      if (surveyData.surveyUrl) {
        void navigator.clipboard.writeText(surveyData.surveyUrl).catch(() => {})
        setCopied(true)
        setTimeout(() => setCopied(false), 3000)
      }
    } catch (err) {
      setError((err as Error).message)
      setStep('form')
    }
  }

  function openLead() {
    if (!leadId) return
    onClose()
    router.push(`/sales/leads/${leadId}`)
  }

  async function sendSms() {
    if (!surveyUrl || !phone.trim() || !leadId) return
    const digits = phone.replace(/\D/g, '')
    const e164 = digits.startsWith('1') ? `+${digits}` : `+1${digits}`
    const body = `Hi! Saturn Star Moving here. To get you an accurate estimate, please review your inventory here: ${surveyUrl}`
    setSmsSending(true)
    try {
      await fetch('/api/sales/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ channel: 'sms', to: e164, body, leadId, notes: 'Inventory verification link sent via Quick Scan' }),
      })
      setSmsSent(true)
    } catch {
      // fail silently — link is already copied
    } finally {
      setSmsSending(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-[20px] border border-[var(--app-line)] bg-[var(--app-panel)] shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--app-line)] px-5 py-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-widest text-[var(--app-muted)]">Fast Lane</div>
            <h2 className="mt-0.5 text-lg font-semibold text-[var(--app-ink)]">Quick Inventory Scan</h2>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-muted)] hover:bg-[var(--app-line)] hover:text-[var(--app-ink)] transition">✕</button>
        </div>

        <div className="px-5 py-4">
          {step === 'form' && (
            <div className="space-y-4">
              <p className="text-xs text-[var(--app-muted)]">
                Get their address → scan MLS → send them an inventory link while still on the call.
              </p>

              {error && (
                <div className="rounded-[8px] border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
              )}

              <label className="block">
                <span className="crm-label">Origin address</span>
                <SalesAddressAutocompleteInput
                  value={originAddress}
                  placeholder="123 Main St, Windsor, ON"
                  onSelect={(addr, city) => {
                    setOriginAddress(addr)
                    if (city) setOriginCity(city)
                  }}
                />
              </label>

              <label className="block">
                <span className="crm-label">Customer phone <span className="font-normal text-[var(--app-muted)]">(optional — to send SMS later)</span></span>
                <input
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="(226) 555-0100"
                  className="crm-input mt-1.5 w-full"
                />
              </label>

              <button
                onClick={() => void handleScan()}
                disabled={!originAddress && !originCity}
                className="crm-button-dark w-full justify-center disabled:opacity-60"
              >
                ⚡ Get Inventory Link
              </button>
            </div>
          )}

          {step === 'loading' && (
            <div className="flex flex-col items-center gap-3 py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#1a2744] border-t-transparent" />
              <p className="text-sm text-[var(--app-muted)]">Scanning address and generating link…</p>
            </div>
          )}

          {step === 'done' && surveyUrl && (
            <div className="space-y-3">
              <div className="rounded-[10px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-center">
                <div className="text-2xl mb-1">🔗</div>
                <div className="text-sm font-semibold text-emerald-800">Link ready — {copied ? '✓ Copied to clipboard!' : 'copy and share now'}</div>
                <div className="mt-1 text-[10px] text-emerald-700 break-all">{surveyUrl}</div>
              </div>

              <button
                onClick={() => {
                  void navigator.clipboard.writeText(surveyUrl)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                }}
                className={`w-full rounded-[8px] py-2.5 text-sm font-semibold transition ${copied ? 'bg-emerald-600 text-white' : 'bg-[#1a2744] text-white hover:bg-[#1a2744]/90'}`}
              >
                {copied ? '✓ Copied!' : 'Copy Link'}
              </button>

              {phone.trim() && (
                <button
                  onClick={() => void sendSms()}
                  disabled={smsSending || smsSent}
                  className={`w-full rounded-[8px] py-2.5 text-sm font-medium transition disabled:opacity-70 ${
                    smsSent
                      ? 'border border-emerald-300 bg-emerald-50 text-emerald-700'
                      : 'border border-[var(--app-line)] text-[var(--app-muted)] hover:border-[var(--app-ink)] hover:text-[var(--app-ink)]'
                  }`}
                >
                  {smsSent ? '✓ SMS sent!' : smsSending ? 'Sending…' : `Send via SMS to ${phone}`}
                </button>
              )}

              <div className="border-t border-[var(--app-line)] pt-3 flex gap-2">
                <button
                  onClick={openLead}
                  className="flex-1 rounded-[8px] border border-[var(--app-line)] py-2 text-xs font-medium text-[var(--app-muted)] hover:border-[var(--app-ink)] hover:text-[var(--app-ink)] transition"
                >
                  Fill in full details →
                </button>
                <button
                  onClick={() => { setStep('form'); setOriginAddress(''); setOriginCity(''); setPhone('') }}
                  className="flex-1 rounded-[8px] border border-[var(--app-line)] py-2 text-xs font-medium text-[var(--app-muted)] hover:border-[var(--app-ink)] hover:text-[var(--app-ink)] transition"
                >
                  New scan
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
