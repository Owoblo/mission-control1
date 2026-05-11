'use client'

import { useEffect, useRef, useState } from 'react'
import { formatListingPropertySummary } from '@/lib/listing'
import { formatDate, getSalesBranchLabel } from '@/lib/sales'
import type { CRMLead } from '@/lib/types'
import { SALES_BRANCHES } from '@/lib/sales'

type AddressSuggestion = {
  label: string
  city?: string
  placeType?: 'house' | 'apartment' | 'commercial' | 'unknown'
}

type ApartmentInfo = { floor: number; hasElevator: boolean }

type Props = {
  lead: CRMLead
  leadName: string
  leadPhone: string
  leadEmail: string
  leadSource: string
  moveDate: string
  branch?: CRMLead['branch']
  moveType: CRMLead['moveType']
  originAddress: string
  originCity: string
  originAccess: string
  destAddress: string
  destCity: string
  destAccess: string
  parkingNotes: string
  moveReason: string
  totalCubicFeet: number
  onLeadNameChange: (value: string) => void
  onLeadPhoneChange: (value: string) => void
  onLeadEmailChange: (value: string) => void
  onLeadSourceChange: (value: string) => void
  moveDateFlexible: boolean
  moveDateFlexibleReason: string
  onMoveDateChange: (value: string) => void
  onMoveDateFlexibleChange: (value: boolean) => void
  onMoveDateFlexibleReasonChange: (value: string) => void
  onMoveTypeChange: (value: CRMLead['moveType']) => void
  onBranchChange: (value: CRMLead['branch']) => void
  onOriginAddressChange: (value: string) => void
  onOriginCityChange: (value: string) => void
  onOriginAccessChange: (value: string) => void
  onDestAddressChange: (value: string) => void
  onDestCityChange: (value: string) => void
  onDestAccessChange: (value: string) => void
  onParkingNotesChange: (value: string) => void
  onApartmentDetected?: (field: 'origin' | 'dest', info: ApartmentInfo) => void
  listingLookupBusy?: boolean
  hasListing?: boolean
  onScanListing?: () => void
  disabled?: boolean
}

function AddressInput({
  value,
  placeholder,
  disabled,
  currentCity,
  onChange,
  onCityChange,
  onApartmentDetected,
}: {
  value: string
  placeholder: string
  disabled?: boolean
  currentCity?: string
  onChange: (v: string) => void
  onCityChange?: (city: string) => void
  onApartmentDetected?: (isApt: boolean) => void
}) {
  // Local raw state so typing doesn't trigger heavy parent re-renders on every keystroke
  const [raw, setRaw] = useState(value)
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [fetching, setFetching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Sync when parent resets the value (e.g. form clear)
  useEffect(() => { setRaw(value) }, [value])

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  function handleInput(val: string) {
    setRaw(val)
    // Defer parent state update to after suggestions settle — avoids INP lag
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (val.length < 4) {
      onChange(val)  // still sync short values immediately
      setSuggestions([])
      setOpen(false)
      return
    }
    debounceRef.current = setTimeout(async () => {
      onChange(val)  // now update parent (after 380ms)
      setFetching(true)
      try {
        const res = await fetch(`/api/sales/address-suggest?q=${encodeURIComponent(val)}`, { credentials: 'include' })
        const data = (await res.json()) as { suggestions?: AddressSuggestion[] }
        const list = data.suggestions || []
        setSuggestions(list)
        if (list.length > 0) setOpen(true)
      } catch { setSuggestions([]) }
      finally { setFetching(false) }
    }, 380)
  }

  function select(s: AddressSuggestion) {
    setRaw(s.label)
    onChange(s.label)
    // Only auto-fill city when the field is empty — never silently overwrite a rep's entered city
    if (s.city && onCityChange && !currentCity) onCityChange(s.city)
    setSuggestions([])
    setOpen(false)
    if (onApartmentDetected) onApartmentDetected(s.placeType === 'apartment')
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        value={raw}
        onChange={e => handleInput(e.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={() => { if (!open) onChange(raw) }}  // sync on blur in case user typed without selecting
        className="crm-input w-full pr-6"
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
      />
      {fetching && (
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
          <span className="block h-3 w-3 animate-spin rounded-full border-2 border-[var(--app-accent)] border-t-transparent" />
        </span>
      )}
      {open && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-[8px] border border-[var(--app-line)] bg-white shadow-xl">
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              onMouseDown={() => select(s)}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-[var(--app-bg)]"
            >
              <span className="text-[10px]">
                {s.placeType === 'apartment' ? '🏢' : s.placeType === 'commercial' ? '🏬' : '🏠'}
              </span>
              <span className="min-w-0 flex-1 truncate text-[var(--app-ink)]">{s.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ApartmentPrompt({
  field,
  onApply,
  onDismiss,
}: {
  field: 'origin' | 'dest'
  onApply: (info: ApartmentInfo) => void
  onDismiss: () => void
}) {
  const [floor, setFloor] = useState(1)
  const [hasElevator, setHasElevator] = useState(true)

  return (
    <div className="rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold text-amber-900">🏢 Apartment detected at {field === 'dest' ? 'destination' : 'origin'}</span>
        <button type="button" onClick={onDismiss} className="text-amber-600 hover:text-amber-900 text-xs">✕</button>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-[10px] font-medium text-amber-800 whitespace-nowrap">Floor #</label>
        <input
          type="number"
          min={1}
          max={60}
          value={floor}
          onChange={e => setFloor(Math.max(1, Number(e.target.value)))}
          className="w-16 rounded-[6px] border border-amber-300 bg-white px-2 py-1 text-sm text-center focus:outline-none"
        />
        <label className="flex cursor-pointer items-center gap-1.5 text-[10px] font-medium text-amber-800">
          <input
            type="checkbox"
            checked={hasElevator}
            onChange={e => setHasElevator(e.target.checked)}
            className="h-3 w-3 accent-amber-600"
          />
          Elevator
        </label>
        <button
          type="button"
          onClick={() => onApply({ floor, hasElevator })}
          className="ml-auto rounded-[6px] bg-amber-600 px-3 py-1 text-[10px] font-semibold text-white hover:bg-amber-700"
        >
          Apply
        </button>
      </div>
      {!hasElevator && floor >= 2 && (
        <div className="mt-1.5 text-[10px] text-amber-700">
          +{((floor - 1) * 0.35).toFixed(2)} hrs stair penalty will be added to estimate
        </div>
      )}
    </div>
  )
}

export function LeadBasicsPanel({
  lead,
  leadName,
  leadPhone,
  leadEmail,
  leadSource,
  moveDate,
  branch,
  moveDateFlexible,
  moveDateFlexibleReason,
  moveType,
  originAddress,
  originCity,
  originAccess,
  destAddress,
  destCity,
  destAccess,
  parkingNotes,
  moveReason,
  totalCubicFeet,
  onLeadNameChange,
  onLeadPhoneChange,
  onLeadEmailChange,
  onLeadSourceChange,
  onMoveDateChange,
  onMoveDateFlexibleChange,
  onMoveDateFlexibleReasonChange,
  onMoveTypeChange,
  onBranchChange,
  onOriginAddressChange,
  onOriginCityChange,
  onOriginAccessChange,
  onDestAddressChange,
  onDestCityChange,
  onDestAccessChange,
  onParkingNotesChange,
  onApartmentDetected,
  listingLookupBusy,
  hasListing,
  onScanListing,
  disabled,
}: Props) {
  const listingPropertySummary = formatListingPropertySummary(lead.supabaseListing)

  const [originAptPending, setOriginAptPending] = useState(false)
  const [destAptPending, setDestAptPending] = useState(false)

  function applyApartment(field: 'origin' | 'dest', info: ApartmentInfo) {
    const label = `Apt — Floor ${info.floor} — ${info.hasElevator ? 'Elevator available' : 'No elevator (stairs)'}`
    if (field === 'origin') { onOriginAccessChange(label); setOriginAptPending(false) }
    else { onDestAccessChange(label); setDestAptPending(false) }
    onApartmentDetected?.(field, info)
  }

  const activeContactLabel =
    lead.leadKind === 'realtor_opportunity' && lead.primaryContactRole !== 'customer'
      ? 'Realtor contact'
      : 'Customer contact'
  const customerSummary = [
    leadName || lead.name || 'New contact',
    moveType ? `${moveType} move` : 'Move type pending',
    moveDate ? `Move date ${formatDate(moveDate)}` : 'Move date pending',
    destCity || destAddress ? `Heading to ${destCity || destAddress}` : 'Destination pending',
  ].join(' • ')

  return (
    <aside className="border-r border-[var(--app-line)] bg-[var(--app-panel)]">
      <div className="border-b border-[var(--app-line)] p-5">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[rgba(34,72,56,0.12)] text-lg font-semibold text-[var(--app-accent)]">
            {(lead.name || 'L').slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="font-display text-[1.8rem] font-semibold tracking-tight text-[var(--app-ink)]">{leadName || lead.name}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--app-muted)]">
              <span className="rounded-full bg-[rgba(34,72,56,0.08)] px-2 py-0.5 font-medium text-[var(--app-accent)] capitalize">{lead.stage}</span>
              <span>ID: {lead.id}</span>
            </div>
          </div>
        </div>
        <div className="mt-5 space-y-3 text-sm text-[var(--app-ink)]">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">{activeContactLabel}</div>
          <div>{leadEmail || 'No email on file'}</div>
          <div>{leadPhone || 'No phone on file'}</div>
          {branch ? (
            <div className="text-xs text-[var(--app-muted)]">Branch: {getSalesBranchLabel(branch)}</div>
          ) : null}
        </div>
        <div className="mt-5 rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-3">
          <div className="crm-label">Contact Summary</div>
          <div className="mt-2 text-sm leading-6 text-[var(--app-ink)]">{customerSummary}</div>
        </div>
      </div>

      <div className="border-b border-[var(--app-line)] p-5">
        <div className="crm-label">Lead Basics</div>
        <fieldset disabled={disabled} className="mt-4 grid gap-3">
          <input value={leadName} onChange={event => onLeadNameChange(event.target.value)} className="crm-input" placeholder={lead.leadKind === 'realtor_opportunity' ? 'Add active contact name' : 'Add customer name'} />
          <input value={leadPhone} onChange={event => onLeadPhoneChange(event.target.value)} className="crm-input" placeholder="Phone number" />
          <input value={leadEmail} onChange={event => onLeadEmailChange(event.target.value)} className="crm-input" placeholder="Email address" />
          <select value={leadSource} onChange={event => onLeadSourceChange(event.target.value)} className="crm-input">
            <option value="">Lead source</option>
            <option value="twilio_call">Inbound call</option>
            <option value="twilio_sms">SMS</option>
            <option value="website_form">Web form</option>
            <option value="email">Email</option>
            <option value="referral">Referral</option>
            <option value="direct_mail">Direct mail</option>
            <option value="destination_opportunity">Destination opportunity</option>
            <option value="other">Other</option>
          </select>
        </fieldset>
      </div>

      <div className="border-b border-[var(--app-line)] p-5">
        <div className="crm-label">Move Details</div>
        <fieldset disabled={disabled} className="mt-4 grid gap-3">
          <input type="date" value={moveDate} onChange={event => onMoveDateChange(event.target.value)} className="crm-input" />
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={moveDateFlexible}
              onChange={e => onMoveDateFlexibleChange(e.target.checked)}
              className="h-3.5 w-3.5 rounded accent-[#1a2744]"
            />
            <span className="text-xs font-medium text-[var(--app-muted)]">Date TBD — waiting on house closing / sale</span>
          </label>
          {moveDateFlexible && (
            <input
              value={moveDateFlexibleReason}
              onChange={e => onMoveDateFlexibleReasonChange(e.target.value)}
              className="crm-input text-xs"
              placeholder="Context (e.g. Waiting on buyer, new house not closed yet)"
            />
          )}
          <select value={moveType} onChange={event => onMoveTypeChange(event.target.value as CRMLead['moveType'])} className="crm-input">
            <option value="residential">Residential</option>
            <option value="long-distance">Long-distance</option>
            <option value="commercial">Commercial</option>
            <option value="senior">Senior</option>
            <option value="labor-only">Labor-only</option>
            <option value="packing">Packing</option>
          </select>
          <select value={branch || ''} onChange={event => onBranchChange((event.target.value || undefined) as CRMLead['branch'])} className="crm-input">
            <option value="">Auto-detect branch / service area</option>
            {SALES_BRANCHES.map(option => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>

          {/* Origin address with autocomplete */}
          <AddressInput
            value={originAddress}
            placeholder="Origin address"
            disabled={disabled}
            currentCity={originCity}
            onChange={onOriginAddressChange}
            onCityChange={onOriginCityChange}
            onApartmentDetected={isApt => { if (isApt && !disabled) setOriginAptPending(true) }}
          />
          {originAptPending && !disabled && (
            <ApartmentPrompt
              field="origin"
              onApply={info => applyApartment('origin', info)}
              onDismiss={() => setOriginAptPending(false)}
            />
          )}
          <input value={originCity} onChange={event => onOriginCityChange(event.target.value)} className="crm-input" placeholder="Origin city" />
          <input value={originAccess} onChange={event => onOriginAccessChange(event.target.value)} className="crm-input" placeholder="Origin access, stairs, elevator, long carry" />

          {/* MLS Scan Prompt */}
          {(originAddress || originCity) && onScanListing && (
            hasListing ? (
              <div className="flex items-center gap-2 rounded-[8px] border border-emerald-200 bg-emerald-50 px-3 py-2">
                <span className="text-[11px] font-semibold text-emerald-700">📷 Listing matched</span>
                <span className="ml-1 text-[10px] text-emerald-600">
                  — {listingPropertySummary ? `${listingPropertySummary} · ` : ''}inventory auto-loaded
                </span>
                <button onClick={onScanListing} disabled={listingLookupBusy} className="ml-auto text-[10px] font-semibold text-emerald-700 hover:text-emerald-900 disabled:opacity-60">
                  {listingLookupBusy ? 'Rescanning...' : 'Rescan'}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-[8px] border border-dashed border-[var(--app-accent)] bg-[rgba(34,72,56,0.04)] px-3 py-2.5">
                <span className="flex-1 text-[11px] text-[var(--app-accent)]">
                  <span className="font-semibold">📷 Scan MLS photos</span>
                  <span className="ml-1 opacity-70">— auto-build inventory from listing</span>
                </span>
                <button
                  onClick={onScanListing}
                  disabled={listingLookupBusy}
                  className="shrink-0 rounded-[6px] bg-[var(--app-accent)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white transition hover:bg-[#0a5b47] disabled:opacity-60"
                >
                  {listingLookupBusy ? 'Scanning...' : 'Scan'}
                </button>
              </div>
            )
          )}

          {/* Destination address with autocomplete */}
          <AddressInput
            value={destAddress}
            placeholder="Destination address"
            disabled={disabled}
            currentCity={destCity}
            onChange={onDestAddressChange}
            onCityChange={onDestCityChange}
            onApartmentDetected={isApt => { if (isApt && !disabled) setDestAptPending(true) }}
          />
          {destAptPending && !disabled && (
            <ApartmentPrompt
              field="dest"
              onApply={info => applyApartment('dest', info)}
              onDismiss={() => setDestAptPending(false)}
            />
          )}
          <input value={destCity} onChange={event => onDestCityChange(event.target.value)} className="crm-input" placeholder="Destination city" />
          <input value={destAccess} onChange={event => onDestAccessChange(event.target.value)} className="crm-input" placeholder="Destination access, stairs, elevator, long carry" />
          <input value={parkingNotes} onChange={event => onParkingNotesChange(event.target.value)} className="crm-input" placeholder="Parking / truck notes" />
        </fieldset>
        <div className="relative mt-5 pl-4">
          <div className="absolute bottom-0 left-0 top-2 w-px bg-[rgba(228,226,220,1)]" />
          <div className="relative mb-6 pl-4">
            <div className="absolute left-[-5px] top-1 h-2.5 w-2.5 rounded-full border-2 border-[var(--app-accent)] bg-white" />
            <div className="text-xs font-medium text-[var(--app-muted)]">Origin ({formatDate(moveDate || lead.moveDate)})</div>
            <div className="mt-2 text-sm font-medium text-[var(--app-ink)]">{originAddress || originCity || 'Origin TBD'}</div>
            <div className="mt-1 text-sm text-[var(--app-muted)]">{[originCity || 'City TBD', originAccess].filter(Boolean).join(' • ')}</div>
          </div>
          <div className="relative pl-4">
            <div className="absolute left-[-5px] top-1 h-2.5 w-2.5 rounded-full border-2 border-stone-400 bg-white" />
            <div className="text-xs font-medium text-[var(--app-muted)]">Destination</div>
            <div className="mt-2 text-sm font-medium text-[var(--app-ink)]">{destAddress || destCity || 'Destination TBD'}</div>
            <div className="mt-1 text-sm text-[var(--app-muted)]">{[destCity || 'City TBD', destAccess || moveType || 'Move type TBD'].filter(Boolean).join(' • ')}</div>
          </div>
        </div>
      </div>

      <div className="p-5">
        <div className="crm-label">Logistics</div>
        <div className="mt-5 grid grid-cols-2 gap-5 text-sm">
          <div>
            <div className="text-xs text-[var(--app-muted)]">Move Size</div>
            <div className="mt-2 font-medium text-[var(--app-ink)]">{lead.moveType || 'TBD'}</div>
          </div>
          <div>
            <div className="text-xs text-[var(--app-muted)]">Lead Score</div>
            <div className="mt-2 font-medium text-[var(--app-ink)]">{lead.leadScore && lead.leadScore >= 70 ? 'Hot' : lead.leadScore && lead.leadScore >= 40 ? 'Warm' : 'Cold'}</div>
          </div>
          <div>
            <div className="text-xs text-[var(--app-muted)]">Est. Volume</div>
            <div className="mt-2 font-medium text-[var(--app-ink)]">{totalCubicFeet || 0} cu ft</div>
          </div>
          <div>
            <div className="text-xs text-[var(--app-muted)]">MLS Context</div>
            <div className="mt-2 font-medium text-[var(--app-ink)]">{listingPropertySummary || 'Not matched yet'}</div>
          </div>
          <div>
            <div className="text-xs text-[var(--app-muted)]">Access + Parking</div>
            <div className="mt-2 font-medium text-[var(--app-ink)]">{[originAccess, destAccess, parkingNotes].filter(Boolean).join(' • ') || 'Not captured yet'}</div>
          </div>
        </div>
      </div>
    </aside>
  )
}
