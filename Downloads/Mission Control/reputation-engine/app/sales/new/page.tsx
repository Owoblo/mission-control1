'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createSalesLead, enrichSalesAddress } from '@/lib/sales-api'
import type { CRMLead } from '@/lib/types'

const SOURCES = [
  { id: 'referral', label: 'Referral' },
  { id: 'google', label: 'Google' },
  { id: 'direct_mail', label: 'Direct Mail' },
  { id: 'cold_call', label: 'Cold Call' },
  { id: 'walk_in', label: 'Walk-In' },
  { id: 'other', label: 'Other' },
] as const

const MOVE_TYPES: CRMLead['moveType'][] = ['residential', 'long-distance', 'commercial', 'senior', 'labor-only', 'packing']

const MOVE_REASONS = [
  'Downsizing',
  'Upsizing / Growing family',
  'Job relocation',
  'New home purchase',
  'End of lease',
  'Divorce / Separation',
  'Retirement',
  'School / University',
  'Investment property',
  'Senior living transition',
  'Other',
]

export default function NewSalesLeadPage() {
  const router = useRouter()
  const [form, setForm] = useState({
    name: '',
    source: 'other',
    phone: '',
    email: '',
    moveDate: '',
    moveType: 'residential',
    originAddress: '',
    originCity: '',
    destCity: '',
    moveReason: '',
    moveReasonCustom: '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [lookupBusy, setLookupBusy] = useState(false)
  const [analysisBusy, setAnalysisBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [listingMatch, setListingMatch] = useState<CRMLead['supabaseListing']>(null)
  const [inventoryDraft, setInventoryDraft] = useState<{
    inventory: NonNullable<CRMLead['inventory']>
    totalItems: number
    totalCubicFeet: number
    totalWeightLbs?: number
    roomBreakdown?: Record<string, number>
    source: string
    confidence?: string
    specialtyFlags?: string[]
    notes?: string
  } | null>(null)
  const [analysisAvailable, setAnalysisAvailable] = useState(false)

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm(current => ({ ...current, [key]: value }))
  }

  async function buildPayload() {
    const resolvedCity = listingMatch?.city || form.originCity || ''
    const resolvedReason = form.moveReason === 'Other' ? form.moveReasonCustom : form.moveReason
    return createSalesLead({
      name: form.name,
      source: form.source,
      phone: form.phone,
      email: form.email,
      moveDate: form.moveDate || undefined,
      moveType: form.moveType as CRMLead['moveType'],
      originAddress: form.originAddress,
      originCity: resolvedCity,
      destCity: form.destCity,
      supabaseListing: listingMatch || undefined,
      moveReason: resolvedReason,
      notes: form.notes,
      directMailAttributed: !!listingMatch,
      inventory: inventoryDraft?.inventory || [],
      totalItems: inventoryDraft?.totalItems || 0,
      totalCubicFeet: inventoryDraft?.totalCubicFeet || 0,
      totalWeightLbs: inventoryDraft?.totalWeightLbs || 0,
      roomBreakdown: inventoryDraft?.roomBreakdown || {},
      forceNew: true,
    } as Partial<CRMLead> & { forceNew: boolean })
  }

  async function submit() {
    try {
      setSaving(true)
      const lead = await buildPayload()
      router.push(`/sales/leads/${lead.id}`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function submitAndEstimate() {
    try {
      setSaving(true)
      const lead = await buildPayload()
      router.push(`/sales/leads/${lead.id}?estimate=1`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function lookupAddress(analyze = false) {
    if (!form.originAddress || form.originAddress.trim().length < 5) {
      setError('Enter at least 5 characters of the origin address first.')
      return
    }

    try {
      analyze ? setAnalysisBusy(true) : setLookupBusy(true)
      const result = await enrichSalesAddress(form.originAddress, analyze)
      setListingMatch(result.listing)
      setInventoryDraft(result.scan)
      setAnalysisAvailable(result.analysisAvailable)
      // Auto-fill origin city from matched listing
      if (result.listing?.city && !form.originCity) {
        setField('originCity', result.listing.city)
      }
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLookupBusy(false)
      setAnalysisBusy(false)
    }
  }

  return (
    <div className="crm-shell space-y-6">
      <div>
        <Link href="/sales" className="text-sm text-stone-500 hover:text-stone-900">Sales CRM</Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl">New lead.</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 crm-muted">
          Fast intake for phone calls, form fills, referrals, and walk-ins. Capture the move cleanly, then price it.
        </p>
      </div>

      {error && <div className="rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">{error}</div>}

      <div className="crm-panel">
        <div className="mb-6 grid gap-3 md:grid-cols-3">
          <div className="crm-surface">
            <div className="crm-label">Step 1</div>
            <div className="mt-2 text-lg font-semibold text-stone-900">Lead basics</div>
            <div className="mt-2 text-sm crm-muted">Name, source, move type, and contact info.</div>
          </div>
          <div className="crm-surface">
            <div className="crm-label">Step 2</div>
            <div className="mt-2 text-lg font-semibold text-stone-900">Address intelligence</div>
            <div className="mt-2 text-sm crm-muted">Match the listing and pull inventory before pricing.</div>
          </div>
          <div className="crm-surface">
            <div className="crm-label">Step 3</div>
            <div className="mt-2 text-lg font-semibold text-stone-900">Save to CRM</div>
            <div className="mt-2 text-sm crm-muted">Open the lead detail and move into quote building.</div>
          </div>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <label>
            <span className="crm-label">Full Name</span>
            <input className="crm-input mt-2" value={form.name} onChange={e => setField('name', e.target.value)} />
          </label>
          <label>
            <span className="crm-label">Source</span>
            <select className="crm-input mt-2" value={form.source} onChange={e => setField('source', e.target.value)}>
              {SOURCES.map(source => (
                <option key={source.id} value={source.id}>{source.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="crm-label">Phone</span>
            <input className="crm-input mt-2" value={form.phone} onChange={e => setField('phone', e.target.value)} />
          </label>
          <label>
            <span className="crm-label">Email</span>
            <input className="crm-input mt-2" value={form.email} onChange={e => setField('email', e.target.value)} />
          </label>
          <label>
            <span className="crm-label">Move Date</span>
            <input type="date" className="crm-input mt-2" value={form.moveDate} onChange={e => setField('moveDate', e.target.value)} />
          </label>
          <label>
            <span className="crm-label">Move Type</span>
            <select className="crm-input mt-2" value={form.moveType} onChange={e => setField('moveType', e.target.value)}>
              {MOVE_TYPES.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </label>
          <label className="md:col-span-2">
            <span className="crm-label">Origin Address</span>
            <input className="crm-input mt-2" value={form.originAddress} onChange={e => setField('originAddress', e.target.value)} />
          </label>
          <div className="md:col-span-2 rounded-[28px] border border-stone-200 bg-[linear-gradient(180deg,#fbf6ef,#f6efe6)] p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <button type="button" onClick={() => void lookupAddress(false)} disabled={lookupBusy} className="crm-button w-full justify-center disabled:opacity-60 sm:w-auto">
                {lookupBusy ? 'Looking up...' : 'Lookup listing'}
              </button>
              {analysisAvailable && (
                <button type="button" onClick={() => void lookupAddress(true)} disabled={analysisBusy} className="crm-button-dark w-full justify-center disabled:opacity-60 sm:w-auto">
                  {analysisBusy ? 'Analyzing photos...' : inventoryDraft ? 'Re-analyze with photos ↑' : 'Analyze MLS photos'}
                </button>
              )}
            </div>
            <div className="mt-4 space-y-3">
              {listingMatch ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
                  Matched listing: {listingMatch.address}{listingMatch.city ? `, ${listingMatch.city}` : ''}
                  {listingMatch.furniture_scan_date ? ' · inventory scan available' : ''}
                </div>
              ) : (
                <div className="text-sm text-stone-500">No listing linked yet.</div>
              )}
              {inventoryDraft && (
                <div className="rounded-2xl border border-stone-200 bg-white px-4 py-4">
                  <div className="crm-label">Inventory Draft</div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-4">
                    <div>
                      <div className="text-2xl font-semibold text-stone-900">{inventoryDraft.totalItems}</div>
                      <div className="text-xs text-stone-500">Items</div>
                    </div>
                    <div>
                      <div className="text-2xl font-semibold text-stone-900">{inventoryDraft.totalCubicFeet}</div>
                      <div className="text-xs text-stone-500">Cubic feet</div>
                    </div>
                    <div>
                      <div className="text-2xl font-semibold text-stone-900">{inventoryDraft.totalWeightLbs || 0}</div>
                      <div className="text-xs text-stone-500">Weight lbs</div>
                    </div>
                    <div>
                      <div className="text-sm font-medium text-stone-900 capitalize">{inventoryDraft.source.replace(/_/g, ' ')}</div>
                      <div className="text-xs text-stone-500">Confidence: {inventoryDraft.confidence || 'n/a'}</div>
                    </div>
                  </div>
                  {inventoryDraft.specialtyFlags && inventoryDraft.specialtyFlags.length > 0 && (
                    <div className="mt-3 text-sm text-stone-700">
                      Specialty flags: {inventoryDraft.specialtyFlags.join(', ')}
                    </div>
                  )}
                  {inventoryDraft.notes && <div className="mt-2 text-xs leading-5 text-stone-500">{inventoryDraft.notes}</div>}
                </div>
              )}
            </div>
          </div>
          <label>
            <span className="crm-label">Origin City</span>
            <input className="crm-input mt-2" placeholder="Auto-filled from listing" value={form.originCity} onChange={e => setField('originCity', e.target.value)} />
          </label>
          <label>
            <span className="crm-label">Destination City</span>
            <input className="crm-input mt-2" placeholder="e.g. Toronto, London" value={form.destCity} onChange={e => setField('destCity', e.target.value)} />
          </label>
          <label className="md:col-span-2">
            <span className="crm-label">Move Reason</span>
            <select className="crm-input mt-2" value={form.moveReason} onChange={e => setField('moveReason', e.target.value)}>
              <option value="">— Select reason —</option>
              {MOVE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            {form.moveReason === 'Other' && (
              <input className="crm-input mt-2" placeholder="Describe reason..." value={form.moveReasonCustom} onChange={e => setField('moveReasonCustom', e.target.value)} />
            )}
          </label>
          <label className="md:col-span-2">
            <span className="crm-label">Notes</span>
            <textarea className="crm-input mt-2 min-h-32" value={form.notes} onChange={e => setField('notes', e.target.value)} />
          </label>
        </div>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button onClick={() => void submitAndEstimate()} disabled={saving} className="crm-button-dark w-full justify-center disabled:opacity-60 sm:w-auto">
            {saving ? 'Saving...' : 'Create + Build Estimate →'}
          </button>
          <button onClick={() => void submit()} disabled={saving} className="crm-button w-full justify-center disabled:opacity-60 sm:w-auto">
            {saving ? 'Saving...' : 'Create lead'}
          </button>
          <Link href="/sales" className="crm-button w-full justify-center sm:w-auto">Cancel</Link>
        </div>
      </div>
    </div>
  )
}
