'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { formatListingContextSummary, formatListingPropertySummary, getListingDescription, getListingOperationalHighlights } from '@/lib/listing'
import { getListingSideContactDisplayName } from '@/lib/realtor-opportunity'
import { CRM_LEAD_SOURCES, formatDate, getSalesBranchLabel } from '@/lib/sales'
import type { CRMLead } from '@/lib/types'
import { SALES_BRANCHES } from '@/lib/sales'

type AddressSuggestion = {
  label: string
  city?: string
  placeType?: 'house' | 'apartment' | 'commercial' | 'unknown'
}

type ApartmentInfo = { floor: number; hasElevator: boolean }

type PropertyAccessApplication = {
  accessText: string
  floor: number | null
  hasElevator: boolean | null
  elevatorReserved: boolean | undefined
  parkingOk: boolean | undefined
  parkingType: 'driveway' | 'street' | 'lot' | 'underground' | 'unknown'
}

type Props = {
  lead: CRMLead
  leadName: string
  leadPhone: string
  leadEmail: string
  leadSource: string
  referralCustomerName?: string
  moveDate: string
  branch?: CRMLead['branch']
  moveType: CRMLead['moveType']
  propertyBedrooms?: CRMLead['propertyBedrooms']
  propertyType?: CRMLead['propertyType']
  originStairFlights?: number
  destStairFlights?: number
  originElevatorAccess?: boolean
  destElevatorAccess?: boolean
  originAddress: string
  originCity: string
  originAccess: string
  destAddress: string
  destCity: string
  destAccess: string
  parkingNotes: string
  moveReason: string
  customerPriority?: string
  totalCubicFeet: number
  onLeadNameChange: (value: string) => void
  onLeadPhoneChange: (value: string) => void
  onLeadEmailChange: (value: string) => void
  onLeadSourceChange: (value: string) => void
  onReferralCustomerNameChange?: (value: string) => void
  moveDateFlexible: boolean
  moveDateFlexibleReason: string
  onCustomerPriorityChange?: (value: string) => void
  onMoveDateChange: (value: string) => void
  onMoveDateFlexibleChange: (value: boolean) => void
  onMoveDateFlexibleReasonChange: (value: string) => void
  onMoveTypeChange: (value: CRMLead['moveType']) => void
  onBranchChange: (value: CRMLead['branch']) => void
  onPropertyBedroomsChange?: (value: CRMLead['propertyBedrooms'] | undefined) => void
  onPropertyTypeChange?: (value: CRMLead['propertyType'] | undefined) => void
  onOriginStairFlightsChange?: (value: number) => void
  onDestStairFlightsChange?: (value: number) => void
  onOriginElevatorAccessChange?: (value: boolean | undefined) => void
  onDestElevatorAccessChange?: (value: boolean | undefined) => void
  onOriginAddressChange: (value: string) => void
  onOriginCityChange: (value: string) => void
  onOriginAccessChange: (value: string) => void
  onDestAddressChange: (value: string) => void
  onDestCityChange: (value: string) => void
  onDestAccessChange: (value: string) => void
  onParkingNotesChange: (value: string) => void
  onApartmentDetected?: (field: 'origin' | 'dest', info: ApartmentInfo) => void
  onPropertyIntelligenceDetected?: (field: 'origin' | 'dest', info: PropertyAccessApplication) => void
  listingLookupBusy?: boolean
  hasListing?: boolean
  onScanListing?: () => void
  onOverrideListing?: (address: string) => void
  onClearListing?: () => void
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
  const focusedRef = useRef(false)
  const latestQueryRef = useRef('')

  // Sync when parent resets the value (e.g. form clear)
  useEffect(() => {
    if (!focusedRef.current) setRaw(value)
  }, [value])

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  function handleInput(val: string) {
    setRaw(val)
    latestQueryRef.current = val
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
        if (latestQueryRef.current !== val) return
        const list = data.suggestions || []
        setSuggestions(list)
        if (list.length > 0) setOpen(true)
      } catch {
        if (latestQueryRef.current === val) setSuggestions([])
      }
      finally {
        if (latestQueryRef.current === val) setFetching(false)
      }
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
        onFocus={() => {
          focusedRef.current = true
          if (suggestions.length > 0) setOpen(true)
        }}
        onBlur={() => {
          focusedRef.current = false
          onChange(raw)
        }}
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
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-[8px] border border-[var(--app-line)] bg-white shadow-none">
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

// ── Property Intelligence Card ────────────────────────────────────────────────
type PropertyAccess = {
  propertyType: string
  propertyTypeLabel: string
  estimatedFloors: number
  unitFloor: number | null
  hasElevator: boolean | null
  elevatorReservationLikely: boolean
  parkingType: 'driveway' | 'street' | 'lot' | 'underground' | 'unknown'
  carryDistanceEstimate: string
  stairsEstimate: number
  notes: string[]
  confidence: 'high' | 'medium' | 'low'
  source: string[]
  rawAddress?: string
  placeId?: string
}

const PROPERTY_ICONS: Record<string, string> = {
  house_detached: '🏠',
  house_semi: '🏠',
  townhouse: '🏘️',
  condo_lowrise: '🏢',
  condo_highrise: '🏢',
  apartment: '🏢',
  unknown: '📍',
}

function PropertyIntelligenceCard({
  field,
  access,
  onApplyToAccess,
  onDismiss,
}: {
  field: 'origin' | 'dest'
  access: PropertyAccess
  onApplyToAccess: (application: PropertyAccessApplication) => void
  onDismiss: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [floorOverride, setFloorOverride] = useState<string>(String(access.unitFloor ?? ''))
  const [elevatorOverride, setElevatorOverride] = useState<boolean | null>(access.hasElevator)
  const [applied, setApplied] = useState(false)

  function buildAccessApplication(): PropertyAccessApplication {
    const parts: string[] = []
    parts.push(access.propertyTypeLabel)
    const floor = floorOverride ? parseInt(floorOverride, 10) : access.unitFloor
    if (floor && floor > 0) parts.push(`Floor ${floor}`)
    const elevator = elevatorOverride !== null ? elevatorOverride : access.hasElevator
    if (elevator === true) parts.push(access.elevatorReservationLikely ? 'Elevator (reservation needed)' : 'Elevator available')
    else if (elevator === false && access.stairsEstimate > 0) parts.push(`${access.stairsEstimate} flight${access.stairsEstimate > 1 ? 's' : ''} of stairs`)
    if (access.parkingType === 'driveway') parts.push('Driveway access')
    else if (access.parkingType === 'street') parts.push('Street parking')
    else if (access.parkingType === 'underground') parts.push('Underground parking')
    return {
      accessText: parts.join(' · '),
      floor: floor && floor > 0 ? floor : (access.unitFloor ?? access.estimatedFloors ?? null),
      hasElevator: elevator,
      elevatorReserved: elevator === true ? false : undefined,
      parkingOk:
        access.parkingType === 'unknown'
          ? undefined
          : access.parkingType === 'driveway' || access.parkingType === 'underground',
      parkingType: access.parkingType,
    }
  }

  function apply() {
    onApplyToAccess(buildAccessApplication())
    setApplied(true)
    setTimeout(() => setApplied(false), 2000)
  }

  const icon = PROPERTY_ICONS[access.propertyType] ?? '📍'
  const confidenceColor = access.confidence === 'high' ? 'emerald' : access.confidence === 'medium' ? 'sky' : 'amber'

  return (
    <div className={`rounded-[8px] border border-${confidenceColor}-200 bg-${confidenceColor}-50 px-3 py-2.5`}>
      <div className="flex items-start gap-2">
        <span className="text-base leading-none mt-0.5">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-slate-800">
              {access.propertyTypeLabel}
              <span className={`ml-1.5 text-[10px] font-normal text-${confidenceColor}-700`}>
                {access.confidence === 'high' ? '· confirmed' : access.confidence === 'medium' ? '· likely' : '· estimated'}
              </span>
            </span>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => setExpanded(v => !v)} className={`text-[10px] text-${confidenceColor}-700 hover:underline`}>
                {expanded ? 'Less' : 'Details'}
              </button>
              <button type="button" onClick={onDismiss} className="text-slate-400 hover:text-slate-700 text-xs leading-none">✕</button>
            </div>
          </div>
          <div className={`mt-0.5 text-[10px] text-${confidenceColor}-800`}>
            {access.notes.slice(0, 2).join(' · ')}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="mt-2.5 space-y-2 border-t border-slate-200 pt-2">
          <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-700">
            <div>
              <span className="font-semibold">Floors in building: </span>
              {access.estimatedFloors}
            </div>
            <div>
              <span className="font-semibold">Parking: </span>
              {access.parkingType}
            </div>
            <div>
              <span className="font-semibold">Carry distance: </span>
              {access.carryDistanceEstimate}
            </div>
            <div>
              <span className="font-semibold">Source: </span>
              {access.source.join(', ')}
            </div>
          </div>
          <div className="text-[10px] font-semibold text-slate-600 mt-1">Override</div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <label className="text-[10px] text-slate-700">Unit floor</label>
              <input
                type="number" min={1} max={60}
                value={floorOverride}
                onChange={e => setFloorOverride(e.target.value)}
                placeholder="—"
                className="w-12 rounded-[6px] border border-slate-300 bg-white px-1.5 py-0.5 text-xs text-center"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-[10px] text-slate-700">Elevator</label>
              <select
                value={elevatorOverride === null ? '' : elevatorOverride ? 'yes' : 'no'}
                onChange={e => setElevatorOverride(e.target.value === '' ? null : e.target.value === 'yes')}
                className="rounded-[6px] border border-slate-300 bg-white px-1.5 py-0.5 text-[10px]"
              >
                <option value="">Auto</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>
          </div>
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={apply}
          className="rounded-[6px] bg-[#071421] px-3 py-1 text-[10px] font-semibold text-white hover:bg-[#243460] transition"
        >
          {applied ? '✓ Applied' : `Apply to ${field} access`}
        </button>
        <span className="text-[10px] text-slate-500 truncate">{buildAccessApplication().accessText}</span>
      </div>
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
  const [floor, setFloor] = useState('1')
  const [hasElevator, setHasElevator] = useState(true)
  const floorNumber = Math.max(1, Number(floor) || 1)

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
          onChange={e => setFloor(e.target.value)}
          onBlur={() => setFloor(String(floorNumber))}
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
          onClick={() => onApply({ floor: floorNumber, hasElevator })}
          className="ml-auto rounded-[6px] bg-amber-600 px-3 py-1 text-[10px] font-semibold text-white hover:bg-amber-700"
        >
          Apply
        </button>
      </div>
      {!hasElevator && floorNumber >= 2 && (
        <div className="mt-1.5 text-[10px] text-amber-700">
          +{((floorNumber - 1) * 0.35).toFixed(2)} hrs stair penalty will be added to estimate
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
  referralCustomerName,
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
  customerPriority,
  totalCubicFeet,
  onLeadNameChange,
  onLeadPhoneChange,
  onLeadEmailChange,
  onLeadSourceChange,
  onReferralCustomerNameChange,
  onCustomerPriorityChange,
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
  onPropertyIntelligenceDetected,
  listingLookupBusy,
  hasListing,
  onScanListing,
  onOverrideListing,
  onClearListing,
  disabled,
}: Props) {
  const listingPropertySummary = formatListingPropertySummary(lead.supabaseListing)
  const listingContextSummary = formatListingContextSummary(lead.supabaseListing)
  const listingHighlights = getListingOperationalHighlights(lead.supabaseListing).slice(0, 3)
  const listingDescription = getListingDescription(lead.supabaseListing)
  const scanWatchouts = [
    ...(lead.listingScanSnapshot?.duplicateRisks || []),
    ...(lead.listingScanSnapshot?.confirmationQuestions || []),
  ]

  const [originAptPending, setOriginAptPending] = useState(false)
  const [destAptPending, setDestAptPending] = useState(false)
  const [listingOverrideOpen, setListingOverrideOpen] = useState(false)
  const [listingOverrideAddress, setListingOverrideAddress] = useState('')
  const [originIntelligence, setOriginIntelligence] = useState<PropertyAccess | null>(null)
  const [destIntelligence, setDestIntelligence] = useState<PropertyAccess | null>(null)
  const originIntelTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const destIntelTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const originAutoAppliedKey = useRef<string | null>(null)
  const destAutoAppliedKey = useRef<string | null>(null)

  // Fetch property intelligence when a full address is entered (debounced 1.5s)
  const fetchIntelligence = useCallback(async (address: string, side: 'origin' | 'dest') => {
    if (!address || address.trim().length < 8) return
    try {
      const res = await fetch(`/api/sales/property-intelligence?address=${encodeURIComponent(address)}`, { credentials: 'include' })
      if (!res.ok) return
      const data = (await res.json()) as PropertyAccess
      if (data.propertyType !== 'unknown') {
        if (side === 'origin') setOriginIntelligence(data)
        else setDestIntelligence(data)
      }
    } catch { /* non-fatal */ }
  }, [])

  // Trigger intelligence fetch when address fields change
  useEffect(() => {
    if (originIntelTimer.current) clearTimeout(originIntelTimer.current)
    setOriginIntelligence(null)
    originAutoAppliedKey.current = null
    if (originAddress.length >= 8) {
      // If the matched listing has a unit-prefixed address (e.g. "601-203 Catherine St"),
      // use that for property-intelligence — autocomplete strips unit numbers so the bare
      // address would be misclassified as a house.
      const listingAddr = lead.supabaseListing?.address
      const addressForIntel =
        listingAddr && /^[a-z]?\d+[a-z]?-\d+/i.test(listingAddr.trim())
          ? listingAddr
          : originAddress
      originIntelTimer.current = setTimeout(() => void fetchIntelligence(addressForIntel, 'origin'), 1500)
    }
    return () => { if (originIntelTimer.current) clearTimeout(originIntelTimer.current) }
  }, [originAddress, lead.supabaseListing?.address, fetchIntelligence])

  useEffect(() => {
    if (destIntelTimer.current) clearTimeout(destIntelTimer.current)
    setDestIntelligence(null)
    destAutoAppliedKey.current = null
    if (destAddress.length >= 8) {
      destIntelTimer.current = setTimeout(() => void fetchIntelligence(destAddress, 'dest'), 1500)
    }
    return () => { if (destIntelTimer.current) clearTimeout(destIntelTimer.current) }
  }, [destAddress, fetchIntelligence])

  useEffect(() => {
    if (!originIntelligence || disabled) return
    const key = originIntelligence.placeId || originIntelligence.rawAddress || originAddress
    if (originAutoAppliedKey.current === key) return
    originAutoAppliedKey.current = key

    const application: PropertyAccessApplication = {
      accessText: [
        originIntelligence.propertyTypeLabel,
        originIntelligence.unitFloor ? `Floor ${originIntelligence.unitFloor}` : null,
        originIntelligence.hasElevator === true
          ? (originIntelligence.elevatorReservationLikely ? 'Elevator (reservation needed)' : 'Elevator available')
          : originIntelligence.hasElevator === false && originIntelligence.stairsEstimate > 0
            ? `${originIntelligence.stairsEstimate} flight${originIntelligence.stairsEstimate > 1 ? 's' : ''} of stairs`
            : null,
        originIntelligence.parkingType === 'driveway'
          ? 'Driveway access'
          : originIntelligence.parkingType === 'street'
            ? 'Street parking'
            : originIntelligence.parkingType === 'underground'
              ? 'Underground parking'
              : null,
      ].filter(Boolean).join(' · '),
      floor: originIntelligence.unitFloor ?? originIntelligence.estimatedFloors ?? null,
      hasElevator: originIntelligence.hasElevator,
      elevatorReserved: originIntelligence.hasElevator === true ? false : undefined,
      parkingOk:
        originIntelligence.parkingType === 'unknown'
          ? undefined
          : originIntelligence.parkingType === 'driveway' || originIntelligence.parkingType === 'underground',
      parkingType: originIntelligence.parkingType,
    }

    onPropertyIntelligenceDetected?.('origin', application)
    if (!originAccess.trim() && application.accessText) {
      onOriginAccessChange(application.accessText)
    }
  }, [disabled, onOriginAccessChange, onPropertyIntelligenceDetected, originAccess, originAddress, originIntelligence])

  useEffect(() => {
    if (!destIntelligence || disabled) return
    const key = destIntelligence.placeId || destIntelligence.rawAddress || destAddress
    if (destAutoAppliedKey.current === key) return
    destAutoAppliedKey.current = key

    const application: PropertyAccessApplication = {
      accessText: [
        destIntelligence.propertyTypeLabel,
        destIntelligence.unitFloor ? `Floor ${destIntelligence.unitFloor}` : null,
        destIntelligence.hasElevator === true
          ? (destIntelligence.elevatorReservationLikely ? 'Elevator (reservation needed)' : 'Elevator available')
          : destIntelligence.hasElevator === false && destIntelligence.stairsEstimate > 0
            ? `${destIntelligence.stairsEstimate} flight${destIntelligence.stairsEstimate > 1 ? 's' : ''} of stairs`
            : null,
        destIntelligence.parkingType === 'driveway'
          ? 'Driveway access'
          : destIntelligence.parkingType === 'street'
            ? 'Street parking'
            : destIntelligence.parkingType === 'underground'
              ? 'Underground parking'
              : null,
      ].filter(Boolean).join(' · '),
      floor: destIntelligence.unitFloor ?? destIntelligence.estimatedFloors ?? null,
      hasElevator: destIntelligence.hasElevator,
      elevatorReserved: destIntelligence.hasElevator === true ? false : undefined,
      parkingOk:
        destIntelligence.parkingType === 'unknown'
          ? undefined
          : destIntelligence.parkingType === 'driveway' || destIntelligence.parkingType === 'underground',
      parkingType: destIntelligence.parkingType,
    }

    onPropertyIntelligenceDetected?.('dest', application)
    if (!destAccess.trim() && application.accessText) {
      onDestAccessChange(application.accessText)
    }
  }, [destAccess, destAddress, destIntelligence, disabled, onDestAccessChange, onPropertyIntelligenceDetected])

  function applyApartment(field: 'origin' | 'dest', info: ApartmentInfo) {
    const label = `Apt — Floor ${info.floor} — ${info.hasElevator ? 'Elevator available' : 'No elevator (stairs)'}`
    if (field === 'origin') { onOriginAccessChange(label); setOriginAptPending(false) }
    else { onDestAccessChange(label); setDestAptPending(false) }
    onApartmentDetected?.(field, info)
  }

  const isListingSideLead = lead.leadKind === 'realtor_opportunity' && lead.primaryContactRole !== 'customer'
  const activeContactLabel = isListingSideLead ? 'Listing-side contact' : 'Customer contact'
  const activeContactName = isListingSideLead
    ? (leadName || getListingSideContactDisplayName(lead))
    : (leadName || lead.name || 'New contact')
  const customerSummary = [
    activeContactName,
    moveType ? `${moveType} move` : 'Move type pending',
    moveDate ? `Move date ${formatDate(moveDate)}` : 'Move date pending',
    destCity || destAddress ? `Heading to ${destCity || destAddress}` : 'Destination pending',
  ].join(' • ')

  return (
    <aside className="border-r border-[var(--app-line)] bg-[var(--app-panel)]">
      <div className="border-b border-[var(--app-line)] p-5">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[rgba(34,72,56,0.12)] text-lg font-semibold text-[var(--app-accent)]">
            {(activeContactName || 'L').slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="font-display text-[1.8rem] font-semibold tracking-tight text-[var(--app-ink)]">{activeContactName}</div>
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
            {CRM_LEAD_SOURCES.map(option => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
          {leadSource === 'customer_referral' ? (
            <input
              value={referralCustomerName || ''}
              onChange={event => onReferralCustomerNameChange?.(event.target.value)}
              className="crm-input"
              placeholder="Referring customer name"
            />
          ) : null}
        </fieldset>
      </div>

      <div className="border-b border-[var(--app-line)] p-5">
        <div className="crm-label">Move Details</div>
        <fieldset disabled={disabled} className="mt-4 grid gap-3">
          <input type="date" value={moveDate} onChange={event => onMoveDateChange(event.target.value)} className="crm-input" min="2024-01-01" />
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={moveDateFlexible}
              onChange={e => onMoveDateFlexibleChange(e.target.checked)}
              className="h-3.5 w-3.5 rounded accent-[#071421]"
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
          <div>
            <label className="crm-label">Customer Priority</label>
            <select
              value={customerPriority || ''}
              onChange={e => onCustomerPriorityChange?.(e.target.value)}
              className="crm-input mt-1 w-full"
            >
              <option value="">Not specified</option>
              <option value="price">Price — most budget-conscious</option>
              <option value="speed">Speed — needs it done fast</option>
              <option value="care">Care — careful with belongings</option>
              <option value="full_service">Full service — wants everything handled</option>
            </select>
          </div>
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
          {originIntelligence && !disabled && (
            <PropertyIntelligenceCard
              field="origin"
              access={originIntelligence}
              onApplyToAccess={application => {
                onOriginAccessChange(application.accessText)
                onPropertyIntelligenceDetected?.('origin', application)
                setOriginIntelligence(null)
              }}
              onDismiss={() => setOriginIntelligence(null)}
            />
          )}
          {originAptPending && !originIntelligence && !disabled && (
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
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 rounded-[8px] border border-emerald-200 bg-emerald-50 px-3 py-2">
                  <span className="text-[11px] font-semibold text-emerald-700">📷 Listing matched</span>
                  <span className="ml-1 text-[10px] text-emerald-600">
                    — {listingPropertySummary ? `${listingPropertySummary} · ` : ''}inventory auto-loaded
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      onClick={() => { setListingOverrideOpen(o => !o); setListingOverrideAddress('') }}
                      className="text-[10px] font-semibold text-amber-600 hover:text-amber-800"
                    >
                      Wrong listing?
                    </button>
                    <button onClick={onScanListing} disabled={listingLookupBusy} className="text-[10px] font-semibold text-emerald-700 hover:text-emerald-900 disabled:opacity-60">
                      {listingLookupBusy ? 'Rescanning...' : 'Rescan'}
                    </button>
                  </div>
                </div>
                {listingOverrideOpen && (
                  <div className="rounded-[8px] border border-amber-200 bg-amber-50 p-3 space-y-2">
                    <div className="text-[10px] font-semibold text-amber-800">Re-scan with a different address (e.g. correct unit number)</div>
                    <div className="flex gap-2">
                      <input
                        value={listingOverrideAddress}
                        onChange={e => setListingOverrideAddress(e.target.value)}
                        placeholder="e.g. 601-203 Catherine St W, Windsor"
                        className="flex-1 rounded-[6px] border border-amber-200 bg-white px-2.5 py-1.5 text-[11px] text-[var(--app-ink)] outline-none focus:border-amber-400"
                      />
                      <button
                        disabled={listingLookupBusy || listingOverrideAddress.trim().length < 5}
                        onClick={() => {
                          if (listingOverrideAddress.trim().length >= 5) {
                            onOverrideListing?.(listingOverrideAddress.trim())
                            setListingOverrideOpen(false)
                          }
                        }}
                        className="shrink-0 rounded-[6px] bg-amber-600 px-2.5 py-1.5 text-[10px] font-semibold text-white disabled:opacity-50 hover:bg-amber-700"
                      >
                        {listingLookupBusy ? 'Scanning…' : 'Re-scan'}
                      </button>
                    </div>
                    <button
                      onClick={() => { onClearListing?.(); setListingOverrideOpen(false) }}
                      className="text-[10px] font-semibold text-rose-600 hover:text-rose-800"
                    >
                      Clear MLS data + inventory — start fresh manually
                    </button>
                  </div>
                )}
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
          {destIntelligence && !disabled && (
            <PropertyIntelligenceCard
              field="dest"
              access={destIntelligence}
              onApplyToAccess={application => {
                onDestAccessChange(application.accessText)
                onPropertyIntelligenceDetected?.('dest', application)
                setDestIntelligence(null)
              }}
              onDismiss={() => setDestIntelligence(null)}
            />
          )}
          {destAptPending && !destIntelligence && !disabled && (
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
            <div className="mt-2 font-medium text-[var(--app-ink)]">{listingContextSummary || 'Not matched yet'}</div>
          </div>
          <div>
            <div className="text-xs text-[var(--app-muted)]">Listing Intel</div>
            <div className="mt-2 space-y-1 text-sm text-[var(--app-ink)]">
              {listingHighlights.length > 0 ? (
                listingHighlights.map(item => (
                  <div key={item}>{item}</div>
                ))
              ) : (
                <div className="font-medium text-[var(--app-ink)]">No structured listing intel yet</div>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs text-[var(--app-muted)]">Access + Parking</div>
            <div className="mt-2 font-medium text-[var(--app-ink)]">{[originAccess, destAccess, parkingNotes].filter(Boolean).join(' • ') || 'Not captured yet'}</div>
          </div>
        </div>
        {scanWatchouts.length > 0 ? (
          <div className="mt-4 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700">MLS Watchouts</div>
            <div className="mt-2 space-y-1 text-xs leading-5 text-amber-900">
              {scanWatchouts.slice(0, 3).map(item => (
                <div key={item}>{item}</div>
              ))}
            </div>
          </div>
        ) : null}
        {listingDescription ? (
          <div className="mt-4 rounded-[10px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">Listing Description</div>
            <div className="mt-2 text-xs leading-5 text-[var(--app-ink)]">
              {listingDescription.length > 260 ? `${listingDescription.slice(0, 257)}...` : listingDescription}
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  )
}
