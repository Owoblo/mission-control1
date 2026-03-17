'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSalesLead } from '@/lib/sales-api'
import type { CRMLead } from '@/lib/types'

const SOURCES = [
  { id: 'referral', label: 'Referral' },
  { id: 'google', label: 'Google' },
  { id: 'direct_mail', label: 'Direct Mail' },
  { id: 'cold_call', label: 'Cold Call' },
  { id: 'walk_in', label: 'Walk-In' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'other', label: 'Other' },
] as const

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
  moveDate: '',
  moveType: 'residential',
  originAddress: '',
  originCity: '',
  destCity: '',
  notes: '',
}

export function NewLeadModal({ open, onClose }: Props) {
  const router = useRouter()
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const firstInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setForm({ ...EMPTY })
      setError(null)
      setSaving(false)
      setTimeout(() => firstInputRef.current?.focus(), 80)
    }
  }, [open])

  // Close on Escape
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
  }

  async function save(openEstimate = false) {
    if (!form.name.trim() && !form.phone.trim()) {
      setError('Add at least a name or phone number.')
      return
    }
    try {
      setSaving(true)
      setError(null)
      const lead = await createSalesLead({
        name: form.name,
        source: form.source,
        phone: form.phone,
        email: form.email,
        moveDate: form.moveDate || undefined,
        moveType: form.moveType as CRMLead['moveType'],
        originAddress: form.originAddress,
        originCity: form.originCity,
        destCity: form.destCity,
        notes: form.notes,
        forceNew: true,
      } as Partial<CRMLead> & { forceNew: boolean })
      onClose()
      router.push(openEstimate ? `/sales/leads/${lead.id}?estimate=1` : `/sales/leads/${lead.id}`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative w-full max-w-lg rounded-[20px] border border-[var(--app-line)] bg-[var(--app-panel)] shadow-2xl">
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
                {SOURCES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </label>
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

          {/* Row 4: Origin + Dest */}
          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className="crm-label">Origin Address</span>
              <input
                className="crm-input mt-1.5"
                placeholder="5145 Colbourne Dr"
                value={form.originAddress}
                onChange={e => set('originAddress', e.target.value)}
              />
            </label>
            <label>
              <span className="crm-label">Destination City</span>
              <input
                className="crm-input mt-1.5"
                placeholder="Toronto"
                value={form.destCity}
                onChange={e => set('destCity', e.target.value)}
              />
            </label>
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
