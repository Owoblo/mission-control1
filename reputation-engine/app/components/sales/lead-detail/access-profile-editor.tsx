'use client'

import { useMemo, useState } from 'react'
import { accessProfilesForStops, calculateMoveAccessPlan, createStandardAccessProfile, STANDARD_ACCESS_ASSUMPTION } from '@/lib/access-profile'
import type { AccessEvidenceStatus, AccessProfile, AccessPropertyType, AccessTruckPosition, AccessVerticalMode, AccessWalkBucket, CRMLead, JobFactors, QuoteLeg } from '@/lib/types'

const WALK_OPTIONS: Array<[AccessWalkBucket, string]> = [['under_1', 'Under 1 min'], ['1_2', '1–2 min'], ['2_4', '2–4 min'], ['4_6', '4–6 min'], ['6_8', '6–8 min'], ['over_8', 'Over 8 min'], ['unknown', 'Unknown']]
const PROPERTY_OPTIONS: Array<[AccessPropertyType, string]> = [['detached', 'Detached house'], ['semi_detached', 'Semi-detached'], ['townhouse', 'Townhouse'], ['multiplex', 'Duplex / multiplex'], ['low_rise', 'Low-rise apartment'], ['high_rise', 'High-rise apartment'], ['condo', 'Condo'], ['storage', 'Storage facility'], ['commercial', 'Commercial building'], ['other', 'Other']]

function Select<T extends string>({ label, value, options, onChange }: { label: string; value?: T; options: Array<[T, string]>; onChange: (value: T) => void }) {
  return <label className="block text-[10px] font-semibold text-[var(--app-muted)]"><span>{label}</span><select className="crm-input mt-1 w-full py-1.5 text-xs" value={value || ''} onChange={event => onChange(event.target.value as T)}><option value="">Choose…</option>{options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
}

export function AccessProfileEditor({ lead, factors, legs, singleLocation, baseHours, currentUserName, onChange }: { lead: CRMLead; factors: JobFactors; legs?: QuoteLeg[]; singleLocation?: boolean; baseHours: { origin: number; destination: number }; currentUserName?: string; onChange: (next: JobFactors) => void }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const profiles = useMemo(() => accessProfilesForStops({ lead: { ...lead, jobFactors: factors }, legs }).filter(profile => !singleLocation || profile.stopRole !== 'dropoff'), [factors, lead, legs, singleLocation])
  const plan = calculateMoveAccessPlan(profiles, baseHours)

  function saveProfile(next: AccessProfile) {
    const nextProfiles = profiles.some(item => item.stopId === next.stopId) ? profiles.map(item => item.stopId === next.stopId ? next : item) : [...profiles, next]
    onChange({ ...factors, accessProfiles: nextProfiles })
  }

  function patch(profile: AccessProfile, values: Partial<AccessProfile>) {
    saveProfile({ ...profile, ...values, standardAccessConfirmed: values.standardAccessConfirmed ?? (Object.keys(values).some(key => !['evidenceStatus', 'evidenceNote'].includes(key)) ? false : profile.standardAccessConfirmed), verifiedAt: new Date().toISOString(), verifiedBy: currentUserName || 'Sales' })
  }

  return <div className="space-y-3 rounded-[8px] border-2 border-sky-200 bg-sky-50 p-4 lg:col-span-3">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-xs font-bold uppercase tracking-[0.14em] text-sky-950">Per-stop access profiles</div><p className="mt-1 max-w-3xl text-xs text-sky-900/70">Access is measured as repeated carrying time—not a flat apartment or floor fee. New results are shown in shadow mode and do not alter pricing yet.</p></div><div className={`rounded-full px-3 py-1 text-xs font-bold ${plan.ready ? 'bg-emerald-600 text-white' : plan.manualReviewReasons.length ? 'bg-rose-600 text-white' : 'bg-white text-sky-950'}`}>{plan.manualReviewReasons.length ? 'MANUAL REVIEW' : plan.ready ? 'ACCESS READY' : 'VERIFY ACCESS'}</div></div>
    <div className="grid gap-3 xl:grid-cols-2">
      {profiles.map(profile => {
        const result = plan.stops.find(stop => stop.stopId === profile.stopId)
        const open = expanded[profile.stopId]
        return <div key={profile.stopId} className="rounded-[8px] border border-sky-200 bg-white p-3">
          <div className="flex items-start justify-between gap-3"><div><div className="text-sm font-bold text-[var(--app-ink)]">{profile.label}</div><div className="mt-0.5 text-[10px] text-[var(--app-muted)]">{profile.addressSnapshot || 'Address pending'}</div></div><div className="text-right"><div className="text-xs font-bold text-sky-900">Shadow: +{result?.additionalAccessHours || 0}h</div><div className="text-[9px] uppercase tracking-wide text-[var(--app-muted)]">not priced yet</div></div></div>
          <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => saveProfile(createStandardAccessProfile({ id: profile.id, stopId: profile.stopId, stopRole: profile.stopRole, label: profile.label, addressSnapshot: profile.addressSnapshot, verifiedBy: currentUserName || 'Sales' }))} className={`rounded-[6px] border px-3 py-2 text-xs font-semibold ${profile.standardAccessConfirmed ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-emerald-300 bg-emerald-50 text-emerald-800'}`}>✓ Confirm standard access</button><button type="button" onClick={() => setExpanded(current => ({ ...current, [profile.stopId]: !open }))} className="rounded-[6px] border border-sky-300 bg-white px-3 py-2 text-xs font-semibold text-sky-900">{open ? 'Hide details' : 'Something is different'}</button></div>
          {profile.standardAccessConfirmed ? <p className="mt-2 text-[10px] leading-4 text-emerald-800">{STANDARD_ACCESS_ASSUMPTION}</p> : null}
          {open ? <div className="mt-3 grid gap-3 border-t border-sky-100 pt-3 sm:grid-cols-2">
            <Select label="Property type" value={profile.propertyType} options={PROPERTY_OPTIONS} onChange={value => patch(profile, { propertyType: value })}/>
            <Select label="Truck position" value={profile.truckPosition} options={([['driveway', 'Driveway beside entrance'], ['curb', 'Curb outside entrance'], ['loading_dock', 'Loading dock'], ['parking_lot', 'Parking lot near entrance'], ['street_unconfirmed', 'Street space not guaranteed'], ['cannot_reach', 'Truck cannot reach building'], ['unknown', 'Unknown']] as Array<[AccessTruckPosition, string]>)} onChange={value => patch(profile, { truckPosition: value })}/>
            <Select label="Truck → entrance" value={profile.walkToEntrance} options={WALK_OPTIONS} onChange={value => patch(profile, { walkToEntrance: value })}/>
            <Select label="Entrance → elevator/stairs" value={profile.entranceToVerticalAccess} options={WALK_OPTIONS} onChange={value => patch(profile, { entranceToVerticalAccess: value })}/>
            <Select label="Elevator/stairs → unit" value={profile.verticalAccessToUnit} options={WALK_OPTIONS} onChange={value => patch(profile, { verticalAccessToUnit: value })}/>
            <Select label="Vertical access" value={profile.verticalMode} options={([['ground_floor', 'Ground floor'], ['stairs', 'Stairs only'], ['elevator', 'Elevator only'], ['stairs_or_elevator', 'Choice of stairs/elevator'], ['elevator_and_stairs', 'Elevator + stairs'], ['unknown', 'Unknown']] as Array<[AccessVerticalMode, string]>)} onChange={value => patch(profile, { verticalMode: value })}/>
            {profile.verticalMode?.includes('stairs') || profile.verticalMode === 'stairs_or_elevator' ? <><label className="text-[10px] font-semibold text-[var(--app-muted)]">Stair flights<input type="number" min="0" className="crm-input mt-1 w-full py-1.5 text-xs" value={profile.stairFlights ?? ''} onChange={event => patch(profile, { stairFlights: Number(event.target.value || 0) })}/></label><Select label="Shipment using stairs" value={profile.stairExposure} options={([['entire_shipment', 'Entire shipment'], ['half_shipment', 'About half'], ['specific_items', 'Specific items only']] as Array<[NonNullable<AccessProfile['stairExposure']>, string]>)} onChange={value => patch(profile, { stairExposure: value })}/></> : null}
            {profile.verticalMode?.includes('elevator') || profile.verticalMode === 'stairs_or_elevator' ? <><Select label="Elevator" value={profile.elevatorType} options={([['freight', 'Freight elevator'], ['passenger', 'Passenger elevator'], ['unknown', 'Unknown']] as Array<[NonNullable<AccessProfile['elevatorType']>, string]>)} onChange={value => patch(profile, { elevatorType: value })}/><Select label="Elevator availability" value={profile.elevatorReservation} options={([['confirmed', 'Reserved and confirmed'], ['requested', 'Requested, not confirmed'], ['shared', 'Shared / unreserved'], ['not_available', 'No usable elevator'], ['unknown', 'Unknown']] as Array<[NonNullable<AccessProfile['elevatorReservation']>, string]>)} onChange={value => patch(profile, { elevatorReservation: value })}/></> : null}
            <label className="text-[10px] font-semibold text-[var(--app-muted)]">Fixed building delay (minutes)<input type="number" min="0" className="crm-input mt-1 w-full py-1.5 text-xs" value={profile.expectedDelayMinutes ?? ''} onChange={event => patch(profile, { expectedDelayMinutes: Number(event.target.value || 0) })}/></label>
            <Select label="Evidence" value={profile.evidenceStatus} options={([['customer_confirmed', 'Confirmed by customer'], ['photo_video_confirmed', 'Confirmed by photo/video'], ['building_confirmed', 'Confirmed by building'], ['customer_estimated', 'Estimated by customer'], ['unknown', 'Unknown']] as Array<[AccessEvidenceStatus, string]>)} onChange={value => patch(profile, { evidenceStatus: value })}/>
            <label className="sm:col-span-2 text-[10px] font-semibold text-[var(--app-muted)]">Evidence note<input className="crm-input mt-1 w-full py-1.5 text-xs" value={profile.evidenceNote || ''} onChange={event => patch(profile, { evidenceNote: event.target.value })} placeholder="Who confirmed it, relevant restrictions, or estimate basis"/></label>
            <div className="sm:col-span-2 flex flex-wrap gap-3 text-[10px] text-slate-700">{([['narrowDoor', 'Narrow door'], ['tightTurn', 'Tight turn'], ['buildingCheckIn', 'Security/check-in'], ['elevatorPadding', 'Elevator padding'], ['multipleTransfers', 'Multiple transfers'], ['shuttleMayBeRequired', 'Shuttle may be required'], ['unsafeAccess', 'Unsafe access']] as Array<[keyof AccessProfile, string]>).map(([key, label]) => <label key={key} className="flex items-center gap-1"><input type="checkbox" checked={Boolean(profile[key])} onChange={event => patch(profile, { [key]: event.target.checked } as Partial<AccessProfile>)}/>{label}</label>)}</div>
          </div> : null}
          {result?.warnings.map(item => <div key={item} className="mt-2 text-[10px] text-amber-800">⚠ {item}</div>)}
          {result?.manualReviewReasons.map(item => <div key={item} className="mt-2 text-[10px] font-semibold text-rose-700">● {item}</div>)}
          {result && !profile.standardAccessConfirmed ? <div className="mt-2 rounded-[6px] bg-slate-50 px-2.5 py-2 text-[10px] leading-4 text-slate-600">Base handling {result.baseHandlingHours}h · long carry +{Math.round(result.longCarryFactor * 100)}% · vertical +{Math.round(result.verticalFactor * 100)}% · obstructions +{Math.round(result.obstructionFactor * 100)}% · fixed delay {result.fixedDelayHours}h</div> : null}
        </div>
      })}
    </div>
    <div className="rounded-[6px] border border-sky-200 bg-white px-3 py-2 text-xs text-sky-950"><strong>Shadow access total: +{plan.additionalAccessHours} crew hours.</strong> This comparison is visible internally while existing quote pricing remains unchanged.</div>
  </div>
}
