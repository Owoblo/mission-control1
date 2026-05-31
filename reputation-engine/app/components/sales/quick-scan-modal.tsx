'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { SalesAddressAutocompleteInput } from '@/app/components/sales/address-autocomplete-input'
import { createSalesLead, updateSalesLead } from '@/lib/sales-api'
import { sanitizeInventoryRooms } from '@/lib/inventory-sanitizer'
import type { InventoryItem } from '@/lib/types'

interface Props {
  open: boolean
  onClose: () => void
  prefillPhone?: string
}

type Step = 'form' | 'loading' | 'done'

interface ScanProgress {
  status: string
  batch: number
  totalBatches: number
  totalPhotos: number
  itemsFound: number
}

export function QuickScanModal({ open, onClose, prefillPhone = '' }: Props) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('form')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState(prefillPhone)
  const [originAddress, setOriginAddress] = useState('')
  const [originCity, setOriginCity] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [surveyUrl, setSurveyUrl] = useState<string | null>(null)
  const [leadId, setLeadId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [smsSending, setSmsSending] = useState(false)
  const [smsSent, setSmsSent] = useState(false)
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null)
  const [scanDone, setScanDone] = useState<'done' | 'no-listing' | null>(null)
  const addressRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setStep('form')
      setName('')
      setPhone(prefillPhone)
      setOriginAddress('')
      setOriginCity('')
      setError(null)
      setSurveyUrl(null)
      setLeadId(null)
      setCopied(false)
      setScanProgress(null)
      setScanDone(null)
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
    if (!phone.trim()) {
      setError('Customer phone is required to send the inventory link.')
      return
    }
    setError(null)
    setStep('loading')

    try {
      // 1. Create minimal lead
      const resolvedName = name.trim() || originCity.trim() || originAddress.split(',')[0]?.trim() || 'New Lead'
      const cleanPhone = phone.trim()
      const lead = await createSalesLead({
        name: resolvedName,
        phone: cleanPhone || undefined,
        email: !cleanPhone ? 'pending@update.local' : undefined,
        originAddress: originAddress.trim(),
        originCity: originCity.trim(),
        source: 'inbound_call',
        stage: 'new',
      })
      const savedLeadId = lead.id
      setLeadId(savedLeadId)

      // 2. Generate survey token immediately — show link to rep right away
      const surveyRes = await fetch(`/api/sales/leads/${savedLeadId}/survey`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ skipSms: true }),
      })
      const surveyData = await surveyRes.json() as { surveyUrl?: string; error?: string }
      if (!surveyRes.ok || surveyData.error) throw new Error(surveyData.error || 'Could not generate link')

      const url = surveyData.surveyUrl || null
      setSurveyUrl(url)
      setStep('done')
      if (url) void navigator.clipboard.writeText(url).catch(() => {})
      setCopied(true)
      setTimeout(() => setCopied(false), 3000)

      // 3. Get MLS listing for this address (fast, no AI)
      setScanProgress({ status: 'Looking up MLS listing…', batch: 0, totalBatches: 0, totalPhotos: 0, itemsFound: 0 })
      const fullAddress = [originAddress.trim(), originCity.trim()].filter(Boolean).join(', ')
      const enrichRes = await fetch('/api/sales/enrich/address', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ address: fullAddress, analyze: false }),
      })
      const enrichData = await enrichRes.json() as { listing?: unknown; scan?: unknown }
      if (!enrichData.listing) {
        setScanProgress(null)
        setScanDone('no-listing')
        return
      }

      // Save listing to lead so scan-stream can read it
      await updateSalesLead(savedLeadId, { supabaseListing: enrichData.listing as Parameters<typeof updateSalesLead>[1]['supabaseListing'] })

      // 4. Stream the AI scan — shows photo progress in real time
      const streamRes = await fetch(`/api/sales/leads/${savedLeadId}/scan-stream`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!streamRes.ok || !streamRes.body) {
        setScanDone('no-listing')
        setScanProgress(null)
        return
      }

      const reader = streamRes.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let allItems: InventoryItem[] = []
      let totalPhotos = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6)) as {
              type: string; batch?: number; totalBatches?: number; totalPhotos?: number
              status?: string; items?: InventoryItem[]; allItems?: InventoryItem[]
              scan?: { inventory?: InventoryItem[]; totalCubicFeet?: number; totalWeightLbs?: number; totalItems?: number }
            }

            if (event.type === 'start') {
              totalPhotos = event.totalPhotos ?? 0
              setScanProgress({ status: `Scanning ${totalPhotos} listing photos…`, batch: 0, totalBatches: event.totalBatches ?? 0, totalPhotos, itemsFound: 0 })
            } else if (event.type === 'progress') {
              setScanProgress(p => p ? { ...p, batch: event.batch ?? p.batch, totalBatches: event.totalBatches ?? p.totalBatches, status: event.status ?? p.status } : null)
            } else if (event.type === 'batch') {
              allItems = [...allItems, ...(event.items ?? [])]
              setScanProgress(p => p ? { ...p, batch: event.batch ?? p.batch, totalBatches: event.totalBatches ?? p.totalBatches, status: `Photo ${event.batch}/${event.totalBatches} — ${allItems.length} items found`, itemsFound: allItems.length } : null)
              // Save intermediate results so customer sees items appear in real time
              void updateSalesLead(savedLeadId, { inventory: allItems, totalItems: allItems.length }).catch(() => {})
            } else if (event.type === 'done') {
              const finalInventory = sanitizeInventoryRooms(event.scan?.inventory || allItems)
              await updateSalesLead(savedLeadId, {
                inventory: finalInventory,
                totalItems: event.scan?.totalItems ?? finalInventory.length,
                totalCubicFeet: event.scan?.totalCubicFeet ?? 0,
                totalWeightLbs: event.scan?.totalWeightLbs ?? 0,
                listingScanSnapshot: event.scan as Parameters<typeof updateSalesLead>[1]['listingScanSnapshot'],
              })
              setScanProgress(null)
              setScanDone('done')
            }
          } catch { /* skip malformed event */ }
        }
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
            <h2 className="mt-0.5 text-lg font-semibold text-[var(--app-ink)]">MLS Quick Inventory Scan</h2>
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
                <span className="crm-label">Customer name <span className="font-normal text-[var(--app-muted)]">(optional)</span></span>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Sarah Johnson"
                  className="crm-input mt-1.5 w-full"
                />
              </label>

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
                <span className="crm-label">Customer phone <span className="font-normal text-rose-500">*</span></span>
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

              {/* Live scan progress */}
              {scanProgress && (
                <div className="rounded-[8px] border border-blue-200 bg-blue-50 px-3 py-2.5 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 animate-spin rounded-full border-2 border-blue-500 border-t-transparent shrink-0" />
                    <span className="text-[11px] font-medium text-blue-700">{scanProgress.status}</span>
                  </div>
                  {scanProgress.totalBatches > 0 && (
                    <>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-blue-100">
                        <div
                          className="h-full rounded-full bg-blue-500 transition-all duration-500"
                          style={{ width: `${Math.round((scanProgress.batch / scanProgress.totalBatches) * 100)}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] text-blue-600">
                        <span>{scanProgress.batch}/{scanProgress.totalBatches} photos</span>
                        {scanProgress.itemsFound > 0 && <span>{scanProgress.itemsFound} items found so far</span>}
                      </div>
                    </>
                  )}
                  <p className="text-[10px] text-blue-600">Items appear on the customer link as each photo is scanned.</p>
                </div>
              )}
              {scanDone === 'done' && (
                <div className="rounded-[8px] bg-emerald-50 border border-emerald-200 px-3 py-2 text-[11px] text-emerald-700">
                  ✅ Scan complete — customer sees their full inventory on the link.
                </div>
              )}
              {scanDone === 'no-listing' && (
                <div className="rounded-[8px] bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-700">
                  ⚠ No MLS listing found. Customer sees empty rooms — they can add items manually.
                </div>
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
