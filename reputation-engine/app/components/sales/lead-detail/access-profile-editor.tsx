'use client'

import { useMemo, useState } from 'react'
import { accessProfilesForStops, calculateMoveAccessPlan, createStandardAccessProfile } from '@/lib/access-profile'
import type { AccessEvidenceStatus, AccessProfile, AccessPropertyType, AccessTruckPosition, AccessVerticalMode, AccessWalkBucket, CRMLead, JobFactors, QuoteLeg } from '@/lib/types'

const WALK_OPTIONS: Array<[AccessWalkBucket, string]> = [['under_1', 'Under 1 min'], ['1_2', '1–2 min'], ['2_4', '2–4 min'], ['4_6', '4–6 min'], ['6_8', '6–8 min'], ['over_8', 'Over 8 min'], ['unknown', 'Unknown']]
const PROPERTY_OPTIONS: Array<[AccessPropertyType, string]> = [['detached', 'Detached house'], ['semi_detached', 'Semi-detached'], ['townhouse', 'Townhouse'], ['multiplex', 'Duplex / multiplex'], ['low_rise', 'Low-rise apartment'], ['high_rise', 'High-rise apartment'], ['condo', 'Condo'], ['storage', 'Storage facility'], ['commercial', 'Commercial building'], ['other', 'Other']]
const PROPERTY_QUICK_OPTIONS: Array<{ value: AccessPropertyType; label: string; hint: string }> = [
  { value: 'detached', label: 'House', hint: 'Detached or semi-detached' },
  { value: 'townhouse', label: 'Townhouse', hint: 'Row or stacked townhouse' },
  { value: 'low_rise', label: 'Apartment / Condo', hint: 'Floor and elevator questions' },
  { value: 'storage', label: 'Storage / Commercial', hint: 'Dock and facility access' },
]

function Select<T extends string>({ label, value, options, onChange }: { label: string; value?: T; options: Array<[T, string]>; onChange: (value: T) => void }) {
  return <label className="block text-[10px] font-semibold text-[var(--app-muted)]"><span>{label}</span><select className="crm-input mt-1 w-full py-1.5 text-xs" value={value || ''} onChange={event => onChange(event.target.value as T)}><option value="">Choose…</option>{options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
}

export function AccessProfileEditor({ lead, factors, legs, singleLocation, stopRole, compact = false, baseHours, currentUserName, onChange }: { lead: CRMLead; factors: JobFactors; legs?: QuoteLeg[]; singleLocation?: boolean; stopRole?: 'pickup' | 'dropoff'; compact?: boolean; baseHours: { origin: number; destination: number }; currentUserName?: string; onChange: (next: JobFactors) => void }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const allProfiles = useMemo(() => accessProfilesForStops({ lead: { ...lead, jobFactors: factors }, legs }), [factors, lead, legs])
  const profiles = useMemo(() => allProfiles.filter(profile => (!singleLocation || profile.stopRole !== 'dropoff') && (!stopRole || profile.stopRole === stopRole)), [allProfiles, singleLocation, stopRole])
  const plan = calculateMoveAccessPlan(profiles, baseHours)

  function saveProfile(next: AccessProfile) {
    const nextProfiles = allProfiles.some(item => item.stopId === next.stopId) ? allProfiles.map(item => item.stopId === next.stopId ? next : item) : [...allProfiles, next]
    onChange({ ...factors, accessProfiles: nextProfiles })
  }

  function patch(profile: AccessProfile, values: Partial<AccessProfile>) {
    saveProfile({ ...profile, ...values, standardAccessConfirmed: values.standardAccessConfirmed ?? (Object.keys(values).some(key => !['evidenceStatus', 'evidenceNote'].includes(key)) ? false : profile.standardAccessConfirmed), verifiedAt: new Date().toISOString(), verifiedBy: currentUserName || 'Sales' })
  }

  function inferredPropertyType(profile: AccessProfile): AccessPropertyType | undefined {
    if (profile.propertyType) return profile.propertyType
    if (profile.stopId === 'primary-origin' || profile.stopId === 'legacy-origin') {
      const leadPropertyType: Record<NonNullable<CRMLead['propertyType']>, AccessPropertyType> = {
        apartment: 'low_rise',
        condo: 'condo',
        townhouse: 'townhouse',
        detached_house: 'detached',
        commercial: 'commercial',
        storage_unit: 'storage',
      }
      if (lead.propertyType && leadPropertyType[lead.propertyType]) return leadPropertyType[lead.propertyType]
    }
    if (profile.standardAccessConfirmed) return 'detached'
    if (profile.verticalMode === 'elevator') return 'low_rise'
    if ((profile.stairFlights || 0) > 0) return 'townhouse'
    return undefined
  }

  function choosePropertyType(profile: AccessProfile, propertyType: AccessPropertyType) {
    if (propertyType === 'detached') {
      saveProfile({
        ...createStandardAccessProfile({ id: profile.id, stopId: profile.stopId, stopRole: profile.stopRole, label: profile.label, addressSnapshot: profile.addressSnapshot, verifiedBy: currentUserName || 'Sales' }),
        propertyType,
        evidenceStatus: 'customer_estimated',
        evidenceNote: 'Typical house access selected from the address review; override if parking, stairs, or carrying distance differ.',
      })
      setExpanded(current => ({ ...current, [profile.stopId]: false }))
      return
    }
    const multiUnit = propertyType === 'low_rise' || propertyType === 'high_rise' || propertyType === 'condo'
    patch(profile, {
      propertyType,
      standardAccessConfirmed: false,
      truckPosition: profile.truckPosition === 'driveway' ? undefined : profile.truckPosition,
      verticalMode: multiUnit ? (profile.verticalMode && profile.verticalMode !== 'ground_floor' ? profile.verticalMode : 'unknown') : profile.verticalMode,
      evidenceStatus: profile.evidenceStatus === 'customer_confirmed' ? profile.evidenceStatus : 'customer_estimated',
      evidenceNote: `${PROPERTY_OPTIONS.find(([value]) => value === propertyType)?.[1] || 'Property'} selected during address review.`,
    })
    setExpanded(current => ({ ...current, [profile.stopId]: true }))
  }

  return <div className={`space-y-3 rounded-[10px] border border-[var(--app-line)] bg-white p-4 ${compact ? '' : 'lg:col-span-3'}`}>
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--app-line)] pb-3"><div><div className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--app-ink)]">Access plan</div><p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--app-muted)]">Confirm how the crew gets from the truck to the inventory. Carry distance, stairs, elevators, and building procedures are planned for each stop.</p></div><div className={`rounded-full border px-3 py-1 text-xs font-bold ${plan.ready ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : plan.manualReviewReasons.length ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-[#C99700]/40 bg-[#C99700]/10 text-[#725700]'}`}>{plan.manualReviewReasons.length ? 'MANUAL REVIEW' : plan.ready ? 'ACCESS READY' : 'VERIFY ACCESS'}</div></div>
    <div className="grid gap-3 xl:grid-cols-2">
      {profiles.map(profile => {
        const result = plan.stops.find(stop => stop.stopId === profile.stopId)
        const open = expanded[profile.stopId]
        const propertyType = inferredPropertyType(profile)
        const mapUrl = profile.addressSnapshot ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(profile.addressSnapshot)}` : null
        return <div key={profile.stopId} className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] p-3">
          <div className="flex items-start justify-between gap-3"><div><div className="text-sm font-bold text-[var(--app-ink)]">{profile.label}</div><div className="mt-0.5 text-[10px] text-[var(--app-muted)]">{profile.addressSnapshot || 'Address pending'}</div></div>{mapUrl ? <a href={mapUrl} target="_blank" rel="noreferrer" className="shrink-0 rounded-[6px] border border-[var(--app-line)] bg-white px-2.5 py-1.5 text-[10px] font-semibold text-[var(--app-ink)] hover:border-[#C99700]">Check map ↗</a> : null}</div>
          <div className="mt-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--app-muted)]">Property type {propertyType ? <span className="normal-case tracking-normal text-[#725700]">· detected, override if needed</span> : null}</div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {PROPERTY_QUICK_OPTIONS.map(option => {
                const selected = option.value === propertyType || (option.value === 'low_rise' && (propertyType === 'high_rise' || propertyType === 'condo')) || (option.value === 'storage' && propertyType === 'commercial')
                return <button key={option.value} type="button" onClick={() => choosePropertyType(profile, option.value)} className={`rounded-[7px] border px-3 py-2 text-left ${selected ? 'border-[#071421] bg-[#071421] text-white' : 'border-[var(--app-line)] bg-white text-[var(--app-ink)] hover:border-[#C99700]'}`}><span className="block text-xs font-semibold">{selected ? '✓ ' : ''}{option.label}</span><span className={`mt-0.5 block text-[9px] ${selected ? 'text-white/65' : 'text-[var(--app-muted)]'}`}>{option.hint}</span></button>
              })}
            </div>
          </div>
          {propertyType ? <div className="mt-3 flex flex-wrap items-center gap-2"><button type="button" onClick={() => setExpanded(current => ({ ...current, [profile.stopId]: !open }))} className="rounded-[6px] border border-[var(--app-line)] bg-white px-3 py-2 text-xs font-semibold text-[var(--app-ink)] hover:border-[#C99700]">{open ? 'Hide access questions' : propertyType === 'detached' ? 'Parking or access is different' : 'Review access questions'}</button>{profile.standardAccessConfirmed ? <span className="text-[10px] text-[var(--app-muted)]">Typical nearby parking and ground-floor route applied.</span> : null}</div> : <div className="mt-3 rounded-[6px] border border-[#C99700]/35 bg-[#C99700]/8 px-3 py-2 text-xs text-[#725700]">Choose the closest property type to continue. The next questions will adapt automatically.</div>}
          {open ? <div className="mt-3 grid gap-3 border-t border-[var(--app-line)] pt-3 sm:grid-cols-2">
            <Select label="Property type" value={profile.propertyType} options={PROPERTY_OPTIONS} onChange={value => patch(profile, { propertyType: value })}/>
            <Select label="Truck position" value={profile.truckPosition} options={([['driveway', 'Driveway beside entrance'], ['curb', 'Curb outside entrance'], ['loading_dock', 'Loading dock'], ['parking_lot', 'Parking lot near entrance'], ['street_unconfirmed', 'Street space not guaranteed'], ['cannot_reach', 'Truck cannot reach building'], ['unknown', 'Unknown']] as Array<[AccessTruckPosition, string]>)} onChange={value => patch(profile, { truckPosition: value })}/>
            <Select label="Truck → entrance" value={profile.walkToEntrance} options={WALK_OPTIONS} onChange={value => patch(profile, { walkToEntrance: value })}/>
            <Select label="Entrance → elevator/stairs" value={profile.entranceToVerticalAccess} options={WALK_OPTIONS} onChange={value => patch(profile, { entranceToVerticalAccess: value })}/>
            <Select label="Elevator/stairs → unit" value={profile.verticalAccessToUnit} options={WALK_OPTIONS} onChange={value => patch(profile, { verticalAccessToUnit: value })}/>
            <Select label="Vertical access" value={profile.verticalMode} options={([['ground_floor', 'Ground floor'], ['stairs', 'Stairs only'], ['elevator', 'Elevator only'], ['stairs_or_elevator', 'Choice of stairs/elevator'], ['elevator_and_stairs', 'Elevator + stairs'], ['unknown', 'Unknown']] as Array<[AccessVerticalMode, string]>)} onChange={value => patch(profile, { verticalMode: value })}/>
            {(propertyType === 'low_rise' || propertyType === 'high_rise' || propertyType === 'condo') ? <label className="text-[10px] font-semibold text-[var(--app-muted)]">Unit floor<input type="number" min="0" className="crm-input mt-1 w-full py-1.5 text-xs" value={profile.unitFloor ?? ''} onChange={event => patch(profile, { unitFloor: Number(event.target.value || 0) })}/></label> : null}
            {(propertyType === 'detached' || propertyType === 'semi_detached' || propertyType === 'townhouse' || propertyType === 'multiplex') ? <label className="text-[10px] font-semibold text-[var(--app-muted)]">Exterior steps<input type="number" min="0" className="crm-input mt-1 w-full py-1.5 text-xs" value={profile.exteriorSteps ?? ''} onChange={event => patch(profile, { exteriorSteps: Number(event.target.value || 0) })}/></label> : null}
            {profile.verticalMode?.includes('stairs') || profile.verticalMode === 'stairs_or_elevator' ? <><label className="text-[10px] font-semibold text-[var(--app-muted)]">Stair flights<input type="number" min="0" className="crm-input mt-1 w-full py-1.5 text-xs" value={profile.stairFlights ?? ''} onChange={event => patch(profile, { stairFlights: Number(event.target.value || 0) })}/></label><Select label="Shipment using stairs" value={profile.stairExposure} options={([['entire_shipment', 'Entire shipment'], ['half_shipment', 'About half'], ['specific_items', 'Specific items only']] as Array<[NonNullable<AccessProfile['stairExposure']>, string]>)} onChange={value => patch(profile, { stairExposure: value })}/></> : null}
            {profile.verticalMode?.includes('elevator') || profile.verticalMode === 'stairs_or_elevator' ? <><Select label="Elevator" value={profile.elevatorType} options={([['freight', 'Freight elevator'], ['passenger', 'Passenger elevator'], ['unknown', 'Unknown']] as Array<[NonNullable<AccessProfile['elevatorType']>, string]>)} onChange={value => patch(profile, { elevatorType: value })}/><Select label="Elevator availability" value={profile.elevatorReservation} options={([['confirmed', 'Reserved and confirmed'], ['requested', 'Requested, not confirmed'], ['shared', 'Shared / unreserved'], ['not_available', 'No usable elevator'], ['unknown', 'Unknown']] as Array<[NonNullable<AccessProfile['elevatorReservation']>, string]>)} onChange={value => patch(profile, { elevatorReservation: value })}/></> : null}
            <label className="text-[10px] font-semibold text-[var(--app-muted)]">Fixed building delay (minutes)<input type="number" min="0" className="crm-input mt-1 w-full py-1.5 text-xs" value={profile.expectedDelayMinutes ?? ''} onChange={event => patch(profile, { expectedDelayMinutes: Number(event.target.value || 0) })}/></label>
            <Select label="Evidence" value={profile.evidenceStatus} options={([['customer_confirmed', 'Confirmed by customer'], ['photo_video_confirmed', 'Confirmed by photo/video'], ['building_confirmed', 'Confirmed by building'], ['customer_estimated', 'Estimated by customer'], ['unknown', 'Unknown']] as Array<[AccessEvidenceStatus, string]>)} onChange={value => patch(profile, { evidenceStatus: value })}/>
            <label className="sm:col-span-2 text-[10px] font-semibold text-[var(--app-muted)]">Evidence note<input className="crm-input mt-1 w-full py-1.5 text-xs" value={profile.evidenceNote || ''} onChange={event => patch(profile, { evidenceNote: event.target.value })} placeholder="Who confirmed it, relevant restrictions, or estimate basis"/></label>
            <div className="sm:col-span-2 flex flex-wrap gap-3 text-[10px] text-slate-700">{([['narrowDoor', 'Narrow door'], ['tightTurn', 'Tight turn'], ['buildingCheckIn', 'Security/check-in'], ['elevatorPadding', 'Elevator padding'], ['multipleTransfers', 'Multiple transfers'], ['shuttleMayBeRequired', 'Shuttle may be required'], ['unsafeAccess', 'Unsafe access']] as Array<[keyof AccessProfile, string]>).map(([key, label]) => <label key={key} className="flex items-center gap-1"><input type="checkbox" checked={Boolean(profile[key])} onChange={event => patch(profile, { [key]: event.target.checked } as Partial<AccessProfile>)}/>{label}</label>)}</div>
          </div> : null}
          {propertyType && open && result?.manualReviewReasons.map(item => <div key={item} className="mt-2 rounded-[6px] border border-rose-200 bg-rose-50 px-2.5 py-2 text-[10px] font-semibold text-rose-700">Needs operations review: {item.replace(`${profile.label}: `, '')}</div>)}
        </div>
      })}
    </div>
    {profiles.every(profile => inferredPropertyType(profile)) ? <div className="rounded-[6px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-2 text-xs text-[var(--app-muted)]"><strong className="text-[var(--app-ink)]">Access captured for {profiles.length} stop{profiles.length === 1 ? '' : 's'}.</strong> Detailed carrying time remains internal and feeds scheduling and price review.</div> : null}
  </div>
}
