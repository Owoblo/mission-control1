'use client'

import { useEffect, useRef, useState } from 'react'
import { CATEGORY_LIST } from '@/lib/partner-categories'
import {
  PARTNER_MUNICIPALITIES,
  partnerServiceAreaForCity,
  type PartnerDirectoryCreateInput,
  type PartnerDirectoryEntry,
  type PartnerCompanyOption,
} from '@/lib/partner-directory'

type Props = {
  value?: PartnerDirectoryEntry | null
  disabled?: boolean
  onChange: (value: PartnerDirectoryEntry | null) => void
  defaultCategory?: string
  onCreated?: (value: PartnerDirectoryEntry) => void
}

const EMPTY_CREATE: PartnerDirectoryCreateInput = {
  name: '',
  company: '',
  title: '',
  email: '',
  phone: '',
  city: '',
  category: 'realtor',
  industry: '',
}

export function PartnerReferralSelector({ value, disabled, onChange, defaultCategory, onCreated }: Props) {
  const [query, setQuery] = useState(value?.name || '')
  const [results, setResults] = useState<PartnerDirectoryEntry[]>([])
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createForm, setCreateForm] = useState<PartnerDirectoryCreateInput>({ ...EMPTY_CREATE })
  const [error, setError] = useState('')
  const [companyOptions, setCompanyOptions] = useState<PartnerCompanyOption[]>([])
  const [companyOpen, setCompanyOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchControllerRef = useRef<AbortController | null>(null)
  const latestQueryRef = useRef(query)

  useEffect(() => {
    if (value) setQuery(value.name)
  }, [value?.id, value?.name])

  useEffect(() => {
    if (defaultCategory && !creating) {
      setCreateForm(current => ({ ...current, category: defaultCategory }))
    }
  }, [defaultCategory, creating])

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    searchControllerRef.current?.abort()
  }, [])

  function search(next: string) {
    setQuery(next)
    latestQueryRef.current = next
    if (value && next !== value.name) onChange(null)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (next.trim().length < 2) {
      searchControllerRef.current?.abort()
      setResults([])
      setOpen(false)
      return
    }
    debounceRef.current = setTimeout(async () => {
      searchControllerRef.current?.abort()
      const controller = new AbortController()
      searchControllerRef.current = controller
      setSearching(true)
      setError('')
      try {
        const response = await fetch(`/api/sales/partner-directory?q=${encodeURIComponent(next)}`, {
          credentials: 'include',
          cache: 'no-store',
          signal: controller.signal,
        })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error || 'Search failed')
        if (latestQueryRef.current !== next) return
        setResults(payload.contacts || [])
        setOpen(true)
      } catch (searchError) {
        if (controller.signal.aborted || latestQueryRef.current !== next) return
        setError((searchError as Error).message)
      } finally {
        if (latestQueryRef.current === next) setSearching(false)
      }
    }, 250)
  }

  function select(entry: PartnerDirectoryEntry) {
    onChange(entry)
    setQuery(entry.name)
    setResults([])
    setOpen(false)
    setCreating(false)
    setError('')
  }

  async function createPartner() {
    if (!createForm.name.trim()) {
      setError('Add the partner’s name.')
      return
    }
    setSearching(true)
    setError('')
    try {
      const response = await fetch('/api/sales/partner-directory', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Could not create partner')
      select(payload.contact)
      onCreated?.(payload.contact)
    } catch (createError) {
      setError((createError as Error).message)
    } finally {
      setSearching(false)
    }
  }

  async function searchCompanies(next: string) {
    setCreateForm(current => ({ ...current, company: next, partnerCompanyId: undefined }))
    if (next.trim().length < 2) { setCompanyOptions([]); setCompanyOpen(false); return }
    const response = await fetch(`/api/sales/partner-directory?type=companies&q=${encodeURIComponent(next)}`, { credentials: 'include', cache: 'no-store' })
    const payload = await response.json()
    if (response.ok) { setCompanyOptions(payload.companies || []); setCompanyOpen(true) }
  }

  if (value) {
    return (
      <div className="rounded-[4px] border border-[#d8c477] bg-[#fffdf5] px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#8a6800]">Connected partnership record</div>
            <div className="mt-1 truncate text-sm font-semibold text-[#071421]">{value.name}</div>
            <div className="mt-0.5 text-xs text-[#5d5642]">
              {[value.company, CATEGORY_LIST.find(item => item.id === value.category)?.label || value.category, value.city, partnerServiceAreaForCity(value.city)].filter(Boolean).join(' · ')}
            </div>
          </div>
          <button type="button" disabled={disabled} onClick={() => { onChange(null); setQuery(''); }} className="text-xs font-semibold text-[#8a6800] hover:underline disabled:opacity-50">
            Change
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="relative space-y-2">
      <div className="relative">
        <input
          className="crm-input w-full pr-8"
          value={query}
          disabled={disabled}
          onChange={event => search(event.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Search name, brokerage, email, phone, or city"
          autoComplete="off"
        />
        {searching ? <span className="absolute right-3 top-3 h-3 w-3 animate-spin rounded-full border-2 border-[#C99700] border-t-transparent" /> : null}
      </div>
      {open ? (
        <div className="absolute z-50 max-h-72 w-full overflow-y-auto rounded-[9px] border border-[var(--app-line)] bg-white shadow-xl">
          {results.map(entry => (
            <button key={entry.id} type="button" onMouseDown={() => select(entry)} className="block w-full border-b border-slate-100 px-3 py-2.5 text-left hover:bg-[#fbfaf6]">
              <div className="text-sm font-semibold text-slate-900">{entry.name}</div>
              <div className="text-xs text-slate-500">{[entry.company, entry.title, entry.city].filter(Boolean).join(' · ') || 'Partnership directory record'}</div>
            </button>
          ))}
          <button
            type="button"
            onMouseDown={() => {
              setCreateForm(current => ({ ...current, name: query }))
              setCreating(true)
              setOpen(false)
            }}
            className="block w-full px-3 py-3 text-left text-xs font-semibold text-[#8a6800] hover:bg-[#fbfaf6]"
          >
            + Create “{query}” in partnership hub
          </button>
        </div>
      ) : null}
      {!creating && query.trim().length > 1 && !open ? (
        <button type="button" onClick={() => { setCreateForm(current => ({ ...current, name: query })); setCreating(true); }} className="text-xs font-semibold text-[#8a6800] hover:underline">
          Can’t find them? Create partnership record
        </button>
      ) : null}
      {creating ? (
        <div className="space-y-2 rounded-[4px] border border-[#d8c477] bg-[#fffdf5] p-3">
          <div className="text-xs font-semibold text-[#071421]">New partnership directory record</div>
          <div className="grid grid-cols-2 gap-2">
            <input className="crm-input col-span-2" placeholder="Contact name *" value={createForm.name} onChange={event => setCreateForm(current => ({ ...current, name: event.target.value }))} />
            <select className="crm-input" value={createForm.category} onChange={event => setCreateForm(current => ({ ...current, category: event.target.value }))}>
              {CATEGORY_LIST.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}
            </select>
            <div className="relative">
              <input className="crm-input w-full" placeholder="Search company / brokerage" value={createForm.company} onChange={event => void searchCompanies(event.target.value)} onFocus={() => companyOptions.length > 0 && setCompanyOpen(true)} autoComplete="off" />
              {companyOpen && <div className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded border border-slate-200 bg-white shadow-xl">
                {companyOptions.map(company => <button key={company.id} type="button" onMouseDown={() => { setCreateForm(current => ({ ...current, company: company.name, partnerCompanyId: company.id })); setCompanyOpen(false) }} className="block w-full px-3 py-2 text-left hover:bg-slate-50"><span className="block text-xs font-semibold text-slate-900">{company.name}</span><span className="block text-[10px] text-slate-500">{[company.city, company.industry].filter(Boolean).join(' · ')}</span></button>)}
                <button type="button" onMouseDown={() => setCompanyOpen(false)} className="block w-full border-t px-3 py-2 text-left text-[10px] font-semibold text-[#8a6800]">Use “{createForm.company}” as a new brokerage</button>
              </div>}
              {createForm.partnerCompanyId && <div className="mt-1 text-[10px] font-semibold text-emerald-700">Existing brokerage selected — contact will be linked.</div>}
            </div>
            <input className="crm-input" placeholder="Email" value={createForm.email} onChange={event => setCreateForm(current => ({ ...current, email: event.target.value }))} />
            <input className="crm-input" placeholder="Phone" value={createForm.phone} onChange={event => setCreateForm(current => ({ ...current, phone: event.target.value }))} />
            <label className="col-span-2 text-[10px] font-semibold uppercase tracking-wider text-[#5d5642]">
              Municipality and operating area
              <select className="crm-input mt-1 w-full" value={createForm.city} onChange={event => setCreateForm(current => ({ ...current, city: event.target.value }))}>
                <option value="">Select municipality</option>
                {Array.from(new Set(PARTNER_MUNICIPALITIES.map(option => option.serviceArea))).map(area => (
                  <optgroup key={area} label={area}>
                    {PARTNER_MUNICIPALITIES.filter(option => option.serviceArea === area).map(option => (
                      <option key={option.city} value={option.city}>{option.city}</option>
                    ))}
                  </optgroup>
                ))}
                <option value="Other">Other / outside core areas</option>
              </select>
            </label>
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={searching} onClick={createPartner} className="rounded-[4px] bg-[#071421] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Create &amp; connect</button>
            <button type="button" onClick={() => setCreating(false)} className="px-3 py-2 text-xs font-semibold text-slate-600">Cancel</button>
          </div>
        </div>
      ) : null}
      {error ? <div className="text-xs text-rose-700">{error}</div> : null}
      <div className="text-[10px] leading-4 text-[var(--app-muted)]">Searches the full partnership database, including records not yet contacted or shown in active outreach.</div>
    </div>
  )
}
