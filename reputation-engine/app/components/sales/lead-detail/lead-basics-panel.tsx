'use client'

import { formatDate } from '@/lib/sales'
import type { CRMLead } from '@/lib/types'

type Props = {
  lead: CRMLead
  leadName: string
  leadPhone: string
  leadEmail: string
  leadSource: string
  moveDate: string
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
  onMoveDateChange: (value: string) => void
  onMoveTypeChange: (value: CRMLead['moveType']) => void
  onOriginAddressChange: (value: string) => void
  onOriginCityChange: (value: string) => void
  onOriginAccessChange: (value: string) => void
  onDestAddressChange: (value: string) => void
  onDestCityChange: (value: string) => void
  onDestAccessChange: (value: string) => void
  onParkingNotesChange: (value: string) => void
  listingLookupBusy?: boolean
  hasListing?: boolean
  onScanListing?: () => void
}

export function LeadBasicsPanel({
  lead,
  leadName,
  leadPhone,
  leadEmail,
  leadSource,
  moveDate,
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
  onMoveTypeChange,
  onOriginAddressChange,
  onOriginCityChange,
  onOriginAccessChange,
  onDestAddressChange,
  onDestCityChange,
  onDestAccessChange,
  onParkingNotesChange,
  listingLookupBusy,
  hasListing,
  onScanListing,
}: Props) {
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
          <div>{leadEmail || 'No email on file'}</div>
          <div>{leadPhone || 'No phone on file'}</div>
        </div>
        <div className="mt-5 rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-3">
          <div className="crm-label">Customer Summary</div>
          <div className="mt-2 text-sm leading-6 text-[var(--app-ink)]">{customerSummary}</div>
        </div>
      </div>

      <div className="border-b border-[var(--app-line)] p-5">
        <div className="crm-label">Lead Basics</div>
        <div className="mt-4 grid gap-3">
          <input value={leadName} onChange={event => onLeadNameChange(event.target.value)} className="crm-input" placeholder="Add customer name" />
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
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      <div className="border-b border-[var(--app-line)] p-5">
        <div className="crm-label">Move Details</div>
        <div className="mt-4 grid gap-3">
          <input type="date" value={moveDate} onChange={event => onMoveDateChange(event.target.value)} className="crm-input" />
          <select value={moveType} onChange={event => onMoveTypeChange(event.target.value as CRMLead['moveType'])} className="crm-input">
            <option value="residential">Residential</option>
            <option value="long-distance">Long-distance</option>
            <option value="commercial">Commercial</option>
            <option value="senior">Senior</option>
            <option value="labor-only">Labor-only</option>
            <option value="packing">Packing</option>
          </select>
          <input value={originAddress} onChange={event => onOriginAddressChange(event.target.value)} className="crm-input" placeholder="Origin address" />
          <input value={originCity} onChange={event => onOriginCityChange(event.target.value)} className="crm-input" placeholder="Origin city" />
          <input value={originAccess} onChange={event => onOriginAccessChange(event.target.value)} className="crm-input" placeholder="Origin access, stairs, elevator, long carry" />
          {/* MLS Scan Prompt */}
          {(originAddress || originCity) && onScanListing && (
            hasListing ? (
              <div className="flex items-center gap-2 rounded-[8px] border border-emerald-200 bg-emerald-50 px-3 py-2">
                <span className="text-[11px] font-semibold text-emerald-700">📷 Listing matched</span>
                <span className="ml-1 text-[10px] text-emerald-600">— inventory auto-loaded</span>
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
          <input value={destAddress} onChange={event => onDestAddressChange(event.target.value)} className="crm-input" placeholder="Destination address" />
          <input value={destCity} onChange={event => onDestCityChange(event.target.value)} className="crm-input" placeholder="Destination city" />
          <input value={destAccess} onChange={event => onDestAccessChange(event.target.value)} className="crm-input" placeholder="Destination access, stairs, elevator, long carry" />
          <input value={parkingNotes} onChange={event => onParkingNotesChange(event.target.value)} className="crm-input" placeholder="Parking / truck notes" />
        </div>
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
            <div className="text-xs text-[var(--app-muted)]">Access + Parking</div>
            <div className="mt-2 font-medium text-[var(--app-ink)]">{[originAccess, destAccess, parkingNotes].filter(Boolean).join(' • ') || 'Not captured yet'}</div>
          </div>
        </div>
      </div>
    </aside>
  )
}
