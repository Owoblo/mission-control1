'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { SalesAddressAutocompleteInput } from '@/app/components/sales/address-autocomplete-input'
import { createSalesLead } from '@/lib/sales-api'
import { CRM_LEAD_SOURCES } from '@/lib/sales'
import type { CRMLead } from '@/lib/types'

function digitsOnly(v: string) { return v.replace(/\D/g, '') }
function phonesMatch(a: string, b: string) {
  const da = digitsOnly(a); const db = digitsOnly(b)
  return da.length >= 10 && db.length >= 10 && (da === db || da.endsWith(db) || db.endsWith(da))
}

const MOVE_TYPES: CRMLead['moveType'][] = [
  'residential',
  'long-distance',
  'commercial',
  'senior',
  'labor-only',
  'packing',
]

interface Props {
  open: boolean
  onClose: () => void
}

const EMPTY = {
  name: '',
  phone: '',
  email: '',
  source: 'other',
  referralCustomerName: '',
  moveDate: '',
  moveType: 'residential',
  originAddress: '',
  originCity: '',
  destAddress: '',
  destCity: '',
  notes: '',
}

export function NewLeadModal({ open, onClose }: Props) {
  const router = useRouter()
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [existingLead, setExistingLead] = useState<CRMLead | null>(null)
  const [lookingUp, setLookingUp] = useState(false)
  const phoneDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const firstInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setForm({ ...EMPTY })
      setError(null)
      setSaving(false)
      setExistingLead(null)
      setTimeout(() => firstInputRef.current?.focus(), 80)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm(f => ({ ...f, [key]: value }))
    if (key === 'phone') lookupPhone(value)
    if (key === 'email') lookupEmail(value)
  }

  const lookupPhone = useCallback((phone: string) => {
    if (phoneDebounceRef.current) clearTimeout(phoneDebounceRef.current)
    if (digitsOnly(phone).length < 10) { setExistingLead(null); return }
    phoneDebounceRef.current = setTimeout(async () => {
      setLookingUp(true)
      try {
        const res = await fetch(`/api/sales/leads/match-phone?phone=${encodeURIComponent(phone)}`, { credentials: 'include' })
        if (res.ok) {
          const data = await res.json() as { lead?: CRMLead | null }
          setExistingLead(data.lead || null)
        }
      } catch { /* non-fatal */ }
      finally { setLookingUp(false) }
    }, 500)
  }, [])

  const lookupEmail = useCallback((email: string) => {
    if (!email.includes('@') || email.length < 5) return
    // If we already found via phone, skip email lookup
    if (existingLead) return
    // Email lookup via same match-phone endpoint isn't available directly,
    // but the server dedup will catch it on save
  }, [existingLead])

  async function save(openEstimate = false) {
    if (!form.name.trim() && !form.phone.trim()) {
      setError('Add at least a name or phone number.')
      return
    }
    try {
      setSaving(true)
      setError(null)
      // No forceNew — server dedup finds existing lead by phone/email and merges
      const lead = await createSalesLead({
        name: form.name,
        source: form.source,
        referralCustomerName: form.source === 'customer_referral' ? form.referralCustomerName : undefined,
        phone: form.phone,
        email: form.email,
        moveDate: form.moveDate || undefined,
        moveType: form.moveType as CRMLead['moveType'],
        originAddress: form.originAddress,
        originCity: form.originCity,
        destAddress: form.destAddress,
        destCity: form.destCity,
        notes: form.notes,
      } as Partial<CRMLead>)
      onClose()
      router.push(openEstimate ? `/sales/leads/${lead.id}?estimate=1` : `/sales/leads/${lead.id}`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  function openExisting() {
    if (!existingLead) return
    onClose()
    router.push(`/sales/leads/${existingLead.id}`)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />

      <div className="relative w-full max-w-lg rounded-xl border border-[var(--app-line)] bg-[var(--app-panel)] shadow-none">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--app-line)] px-5 py-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-widest text-[var(--app-muted)]">Sales CRM</div>
            <h2 className="mt-0.5 text-lg font-semibold text-[var(--app-ink)]">New lead</h2>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-muted)] transition hover:bg-[var(--app-line)] hover:text-[var(--app-ink)]"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 px-5 py-4">
          {error && (
            <div className="rounded-[10px] border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
              {error}
            </div>
          )}

          {/* Existing lead match banner */}
          {existingLead && (
            <div className="rounded-[10px] border border-amber-300 bg-amber-50 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">Existing lead found</div>
                  <div className="mt-0.5 text-sm font-semibold text-amber-900 truncate">
                    {existingLead.name || 'Unnamed'} · {existingLead.stage?.replace(/_/g, ' ')}
                  </div>
                  <div className="mt-0.5 text-xs text-amber-700">
                    {existingLead.phone} {existingLead.email ? `· ${existingLead.email}` : ''}
                    {existingLead.originCity ? ` · ${existingLead.originCity}` : ''}
                    {(existingLead.destAddress || existingLead.destCity) ? ` → ${existingLead.destAddress || existingLead.destCity}` : ''}
                  </div>
                  <div className="mt-1 text-[10px] text-amber-600">Saving will update this lead with any new info you add.</div>
                </div>
                <button
                  onClick={openExisting}
                  className="shrink-0 rounded-[8px] bg-amber-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-amber-700 transition-colors whitespace-nowrap"
                >
                  Open lead →
                </button>
              </div>
            </div>
          )}
          {lookingUp && (
            <div className="text-[11px] text-[var(--app-muted)] flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--app-accent)] border-t-transparent" />
              Checking for existing lead…
            </div>
          )}

          {/* Row 1: Name + Source */}
          <div className="grid grid-cols-2 gap-3">
            <label className="col-span-2 sm:col-span-1">
              <span className="crm-label">Full Name</span>
              <input
                ref={firstInputRef}
                className="crm-input mt-1.5"
                placeholder="Sarah Johnson"
                value={form.name}
                onChange={e => set('name', e.target.value)}
              />
            </label>
            <label>
              <span className="crm-label">Source</span>
              <select className="crm-input mt-1.5" value={form.source} onChange={e => set('source', e.target.value)}>
                {CRM_LEAD_SOURCES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </label>
            {form.source === 'customer_referral' ? (
              <label className="col-span-2 sm:col-span-1">
                <span className="crm-label">Referring Customer</span>
                <input
                  className="crm-input mt-1.5"
                  placeholder="Customer name"
                  value={form.referralCustomerName}
                  onChange={e => set('referralCustomerName', e.target.value)}
                />
              </label>
            ) : null}
          </div>

          {/* Row 2: Phone + Email */}
          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className="crm-label">Phone</span>
              <input
                className="crm-input mt-1.5"
                placeholder="226-555-0100"
                value={form.phone}
                onChange={e => set('phone', e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void save(false) }}
              />
            </label>
            <label>
              <span className="crm-label">Email</span>
              <input
                className="crm-input mt-1.5"
                placeholder="sarah@email.com"
                value={form.email}
                onChange={e => set('email', e.target.value)}
              />
            </label>
          </div>

          {/* Row 3: Move Date + Move Type */}
          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className="crm-label">Move Date</span>
              <input
                type="date"
                className="crm-input mt-1.5"
                value={form.moveDate}
                onChange={e => set('moveDate', e.target.value)}
              />
            </label>
            <label>
              <span className="crm-label">Move Type</span>
              <select className="crm-input mt-1.5" value={form.moveType} onChange={e => set('moveType', e.target.value)}>
                {MOVE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
          </div>

          {/* Row 4: Origin + Dest — both with autocomplete */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="crm-label">Origin Address</span>
              <SalesAddressAutocompleteInput
                value={form.originAddress}
                placeholder="5145 Colbourne Dr"
                onSelect={(address, city) => {
                  set('originAddress', address)
                  if (city) set('originCity', city)
                }}
              />
            </div>
            <div>
              <span className="crm-label">Destination Address</span>
              <SalesAddressAutocompleteInput
                value={form.destAddress}
                placeholder="225 King St W, Kitchener"
                onSelect={(address, city) => {
                  set('destAddress', address)
                  if (city) set('destCity', city)
                }}
              />
            </div>
          </div>

          {/* Notes */}
          <label>
            <span className="crm-label">Quick notes</span>
            <textarea
              className="crm-input mt-1.5 min-h-[64px] resize-none text-sm"
              placeholder="Anything mentioned on the call..."
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
            />
          </label>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 border-t border-[var(--app-line)] px-5 py-4">
          <button
            onClick={() => void save(true)}
            disabled={saving}
            className="crm-button-dark flex-1 justify-center disabled:opacity-60"
          >
            {saving ? 'Creating…' : 'Create + Build Estimate →'}
          </button>
          <button
            onClick={() => void save(false)}
            disabled={saving}
            className="crm-button flex-1 justify-center disabled:opacity-60"
          >
            {saving ? 'Creating…' : 'Create Lead'}
          </button>
        </div>
      </div>
    </div>
  )
}
