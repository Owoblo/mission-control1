'use client'

import { useMemo, useState } from 'react'
import { PartnerReferralSelector } from './partner-referral-selector'
import {
  ATTRIBUTION_CHANNELS,
  MOVE_RELATIONSHIP_CATEGORY_BY_ROLE,
  MOVE_RELATIONSHIP_ROLE_LABELS,
  OPPORTUNITY_POSITION_LABELS,
  normalizeAttributionSignals,
  normalizeMoveRelationships,
  moveRelationshipLifecycleGaps,
  opportunityHealthLabel,
} from '@/lib/move-relationship'
import { updateSalesLead } from '@/lib/sales-api'
import type { PartnerDirectoryEntry } from '@/lib/partner-directory'
import type {
  AttributionInfluence,
  CRMLead,
  LeadAttributionSignal,
  LeadOpportunityContext,
  MoveRelationship,
  MoveRelationshipRole,
  OpportunityPosition,
} from '@/lib/types'

type Props = {
  lead: CRMLead
  disabled?: boolean
  onUpdated: (lead: CRMLead) => void
}

const nowLocalInput = () => {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000)
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 16)
}

function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function OpportunityNetworkWorkspace({ lead, disabled, onUpdated }: Props) {
  const [context, setContext] = useState<LeadOpportunityContext>(() => lead.opportunityContext || {
    position: lead.stage === 'tentative' ? 'reviewing_estimate' : 'discovery',
    bookingConfidence: lead.leadScore ? Math.min(95, Math.max(10, lead.leadScore)) : 35,
    nextAction: lead.followUpNote || '',
    nextActionDueAt: lead.followUpDate ? `${lead.followUpDate.slice(0, 10)}T09:00` : '',
    nextActionOwner: lead.assignedRepName || lead.assignedRep || '',
    updatedAt: new Date().toISOString(),
  })
  const [signals, setSignals] = useState<LeadAttributionSignal[]>(lead.attributionSignals || [])
  const [relationships, setRelationships] = useState<MoveRelationship[]>(lead.moveRelationships || [])
  const [signalChannel, setSignalChannel] = useState<(typeof ATTRIBUTION_CHANNELS)[number]>('Direct mail')
  const [signalDetail, setSignalDetail] = useState('')
  const [signalInfluence, setSignalInfluence] = useState<AttributionInfluence>('assisted')
  const [selectedPartner, setSelectedPartner] = useState<PartnerDirectoryEntry | null>(null)
  const [relationshipRole, setRelationshipRole] = useState<MoveRelationshipRole>('listing_realtor')
  const [relationshipConfidence, setRelationshipConfidence] = useState<MoveRelationship['confidence']>('confirmed')
  const [relationshipSource, setRelationshipSource] = useState('')
  const [addressConnection, setAddressConnection] = useState<NonNullable<MoveRelationship['addressConnection']>>('origin')
  const [socialHandle, setSocialHandle] = useState('')
  const [preferredChannel, setPreferredChannel] = useState<MoveRelationship['preferredChannel']>('unknown')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [expanded, setExpanded] = useState(false)

  const health = useMemo(() => opportunityHealthLabel(context), [context])
  const lifecycleGaps = useMemo(
    () => moveRelationshipLifecycleGaps({ context, signals }),
    [context, signals],
  )

  function addSignal() {
    const next = normalizeAttributionSignals(signals.concat({
      id: uid('attr'),
      channel: signalChannel,
      detail: signalDetail.trim() || undefined,
      influence: signalInfluence,
      confidence: 'confirmed',
      observedAt: new Date().toISOString(),
    }))
    setSignals(next)
    setSignalDetail('')
  }

  function addRelationship(partner = selectedPartner) {
    if (!partner) return
    const next = normalizeMoveRelationships(relationships.concat({
      id: uid('rel'),
      contactId: partner.id,
      name: partner.name,
      company: partner.company,
      role: relationshipRole,
      category: partner.category,
      email: partner.email,
      phone: partner.phone,
      addressConnection,
      connectedAddress: addressConnection === 'origin'
        ? lead.originAddress
        : addressConnection === 'destination'
          ? lead.destAddress
          : addressConnection === 'both'
            ? [lead.originAddress, lead.destAddress].filter(Boolean).join(' → ')
            : undefined,
      socialHandle: socialHandle.trim() || undefined,
      preferredChannel,
      confidence: relationshipConfidence,
      discoverySource: relationshipSource.trim() || undefined,
      createdAt: new Date().toISOString(),
    }))
    setRelationships(next)
    setSelectedPartner(null)
    setRelationshipSource('')
    setSocialHandle('')
    setPreferredChannel('unknown')
  }

  async function save() {
    setSaving(true)
    setMessage('')
    try {
      const dueAt = context.nextActionDueAt ? new Date(context.nextActionDueAt).toISOString() : undefined
      const nextContext = {
        ...context,
        nextActionDueAt: dueAt,
        updatedAt: new Date().toISOString(),
        lifecycleCompletedAt: lifecycleGaps.length === 0 ? (context.lifecycleCompletedAt || new Date().toISOString()) : undefined,
      }
      const saved = await updateSalesLead(lead.id, {
        opportunityContext: nextContext,
        attributionSignals: normalizeAttributionSignals(signals),
        moveRelationships: normalizeMoveRelationships(relationships),
        ...(dueAt && context.nextAction?.trim() ? {
          followUpDate: dueAt.slice(0, 10),
          followUpStatus: 'pending' as const,
          followUpNote: context.nextAction.trim(),
        } : {}),
      })
      onUpdated(saved)
      setContext(saved.opportunityContext || context)
      setMessage(lifecycleGaps.length === 0 ? 'Lifecycle context completed.' : 'Progress saved. You can finish the remaining items later.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save the workspace.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section id="section-opportunity-network" className="border border-[var(--app-line)] bg-white">
      <button type="button" onClick={() => setExpanded(current => !current)} className={`block w-full bg-[#071421] px-5 text-left text-white md:px-7 ${expanded ? 'py-5' : 'py-4'}`} aria-expanded={expanded}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#d6b53a]">Move Relationship OS</div>
            <h2 className={`mt-0.5 font-display font-semibold ${expanded ? 'text-2xl' : 'text-lg'}`}>Opportunity &amp; network</h2>
            {expanded ? <p className="mt-1 max-w-3xl text-sm leading-5 text-slate-300">Complete this progressively at intake, during estimating, or before customer success—not necessarily when the lead first opens.</p> : null}
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-[9px] uppercase tracking-[0.18em] text-slate-400">{lifecycleGaps.length === 0 ? 'Lifecycle context' : `${lifecycleGaps.length} item${lifecycleGaps.length === 1 ? '' : 's'} remaining`}</div>
              <div className="mt-0.5 text-sm font-semibold text-white">{lifecycleGaps.length === 0 ? 'Complete' : health}</div>
            </div>
            <span className="flex h-9 w-9 items-center justify-center border border-white/20 text-lg" aria-hidden="true">{expanded ? '−' : '+'}</span>
          </div>
        </div>
      </button>

      {expanded ? <>
      <div className="grid gap-px bg-[var(--app-line)] xl:grid-cols-2">
        <div className="space-y-5 bg-white p-5 md:p-7">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#8a6800]">1 · Active opportunity</div>
            <h3 className="mt-1 text-lg font-semibold text-[#071421]">The truth about this sale</h3>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs font-medium text-[#344054]">Current position
              <select className="crm-input mt-1 w-full" value={context.position} disabled={disabled} onChange={event => setContext(current => ({ ...current, position: event.target.value as OpportunityPosition }))}>
                {Object.entries(OPPORTUNITY_POSITION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-[#344054]">Booking confidence · {context.bookingConfidence}%
              <input className="mt-3 w-full accent-[#C99700]" type="range" min="0" max="100" step="5" value={context.bookingConfidence} disabled={disabled} onChange={event => setContext(current => ({ ...current, bookingConfidence: Number(event.target.value) }))} />
            </label>
          </div>
          <label className="block text-xs font-medium text-[#344054]">Sales summary
            <textarea className="crm-input mt-1 min-h-20 w-full resize-y" value={context.summary || ''} disabled={disabled} onChange={event => setContext(current => ({ ...current, summary: event.target.value }))} placeholder="Customer likes the estimate; inventory is nearly complete and spouse is reviewing tonight." />
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs font-medium text-[#344054]">What are we waiting for?
              <input className="crm-input mt-1 w-full" value={context.waitingFor || ''} disabled={disabled} onChange={event => setContext(current => ({ ...current, waitingFor: event.target.value }))} placeholder="Final inventory and photos" />
            </label>
            <label className="text-xs font-medium text-[#344054]">Main hesitation or blocker
              <input className="crm-input mt-1 w-full" value={context.hesitation || ''} disabled={disabled} onChange={event => setContext(current => ({ ...current, hesitation: event.target.value }))} placeholder="Needs spouse approval" />
            </label>
          </div>
          <div className="border-l-2 border-[#C99700] bg-[#fbfaf6] p-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8a6800]">Required next commitment</div>
            <div className="mt-3 grid gap-3">
              <input className="crm-input w-full" value={context.nextAction || ''} disabled={disabled} onChange={event => setContext(current => ({ ...current, nextAction: event.target.value }))} placeholder="Call after the customer sends inventory" />
              <div className="grid gap-3 md:grid-cols-2">
                <input className="crm-input w-full" type="datetime-local" value={context.nextActionDueAt ? context.nextActionDueAt.slice(0, 16) : ''} min={nowLocalInput()} disabled={disabled} onChange={event => setContext(current => ({ ...current, nextActionDueAt: event.target.value }))} />
                <input className="crm-input w-full" value={context.nextActionOwner || ''} disabled={disabled} onChange={event => setContext(current => ({ ...current, nextActionOwner: event.target.value }))} placeholder="Owner of next action" />
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6 bg-[#fbfaf6] p-5 md:p-7">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#8a6800]">2 · Multi-touch attribution</div>
            <h3 className="mt-1 text-lg font-semibold text-[#071421]">Every path that influenced this lead</h3>
            <p className="mt-1 text-xs leading-5 text-[var(--app-muted)]">Keep the original lead source while recording direct mail, search, referrals, social and other assisted touches.</p>
          </div>
          <div className="space-y-2">
            {signals.length ? signals.map(signal => (
              <div key={signal.id} className="flex items-start justify-between gap-3 border border-[var(--app-line)] bg-white px-3 py-3">
                <div>
                  <div className="text-sm font-semibold text-[#071421]">{signal.channel}</div>
                  <div className="mt-0.5 text-xs text-[var(--app-muted)]">{signal.influence.replace('_', ' ')}{signal.detail ? ` · ${signal.detail}` : ''}</div>
                </div>
                <button type="button" disabled={disabled} onClick={() => setSignals(current => current.filter(item => item.id !== signal.id))} className="text-xs font-medium text-[var(--app-muted)] hover:text-[#071421]">Remove</button>
              </div>
            )) : <div className="border border-dashed border-[var(--app-line)] bg-white px-4 py-5 text-sm text-[var(--app-muted)]">No supporting attribution evidence recorded yet.</div>}
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <select className="crm-input" value={signalChannel} disabled={disabled} onChange={event => setSignalChannel(event.target.value as typeof signalChannel)}>
              {ATTRIBUTION_CHANNELS.map(channel => <option key={channel}>{channel}</option>)}
            </select>
            <select className="crm-input" value={signalInfluence} disabled={disabled} onChange={event => setSignalInfluence(event.target.value as AttributionInfluence)}>
              <option value="first_touch">First touch</option>
              <option value="assisted">Assisted touch</option>
              <option value="last_touch">Last touch before enquiry</option>
              <option value="self_reported">Customer reported</option>
            </select>
            <input className="crm-input md:col-span-2" value={signalDetail} disabled={disabled} onChange={event => setSignalDetail(event.target.value)} placeholder="Evidence or detail — postcard, Google search, realtor name…" />
            <button type="button" onClick={addSignal} disabled={disabled} className="crm-button-dark md:col-span-2">Add attribution evidence</button>
          </div>
        </div>
      </div>

      <div className="border-t border-[var(--app-line)] p-5 md:p-7">
        <div className="grid gap-7 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.85fr)]">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#8a6800]">3 · Move relationship graph</div>
            <h3 className="mt-1 text-lg font-semibold text-[#071421]">People and organizations surrounding this move</h3>
            <div className="mt-4 grid gap-2 md:grid-cols-2">
              {relationships.length ? relationships.map(relationship => (
                <div key={relationship.id} className="border border-[var(--app-line)] bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-[#071421]">{relationship.name}</div>
                      <div className="mt-0.5 text-xs text-[var(--app-muted)]">{relationship.company || 'Independent contact'}</div>
                    </div>
                    <button type="button" disabled={disabled} onClick={() => setRelationships(current => current.filter(item => item.id !== relationship.id))} className="text-xs text-[var(--app-muted)] hover:text-[#071421]">Remove</button>
                  </div>
                  <div className="mt-3 border-t border-[var(--app-line)] pt-2 text-xs text-[#344054]">{MOVE_RELATIONSHIP_ROLE_LABELS[relationship.role]} · {relationship.confidence}</div>
                  {relationship.addressConnection ? (
                    <div className="mt-1 text-xs text-[var(--app-muted)]">
                      {relationship.addressConnection === 'origin'
                        ? 'Origin connection'
                        : relationship.addressConnection === 'destination'
                          ? 'Destination connection'
                          : relationship.addressConnection === 'both'
                            ? 'Connected to both addresses'
                            : 'Move-level connection'}
                      {relationship.connectedAddress ? ` · ${relationship.connectedAddress}` : ''}
                    </div>
                  ) : null}
                  {(relationship.preferredChannel && relationship.preferredChannel !== 'unknown') || relationship.socialHandle ? <div className="mt-1 text-xs text-[var(--app-muted)]">{[relationship.preferredChannel !== 'unknown' ? relationship.preferredChannel : '', relationship.socialHandle].filter(Boolean).join(' · ')}</div> : null}
                </div>
              )) : <div className="border border-dashed border-[var(--app-line)] bg-[#fbfaf6] p-5 text-sm text-[var(--app-muted)] md:col-span-2">No surrounding relationships connected yet. Add the realtor, brokerage, building, property manager, mortgage broker or other relevant contact.</div>}
            </div>
          </div>

          <div className="border border-[var(--app-line)] bg-[#fbfaf6] p-4">
            <div className="text-sm font-semibold text-[#071421]">Connect a relationship</div>
            <div className="mt-3 space-y-3">
              <div className="grid gap-2 md:grid-cols-2">
                <select className="crm-input" value={relationshipRole} disabled={disabled} onChange={event => setRelationshipRole(event.target.value as MoveRelationshipRole)}>
                  {Object.entries(MOVE_RELATIONSHIP_ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <select className="crm-input" value={relationshipConfidence} disabled={disabled} onChange={event => setRelationshipConfidence(event.target.value as MoveRelationship['confidence'])}>
                  <option value="confirmed">Confirmed</option>
                  <option value="likely">Likely match</option>
                  <option value="possible">Possible — verify</option>
                </select>
                <label className="md:col-span-2 text-[10px] font-semibold uppercase tracking-wider text-[#5d5642]">
                  Which side of the move?
                  <select className="crm-input mt-1 w-full" value={addressConnection} disabled={disabled} onChange={event => setAddressConnection(event.target.value as NonNullable<MoveRelationship['addressConnection']>)}>
                    <option value="origin">Origin — {lead.originAddress || 'address not entered'}</option>
                    <option value="destination">Destination — {lead.destAddress || 'address not entered'}</option>
                    <option value="both">Both origin and destination</option>
                    <option value="other">Move-level / neither address</option>
                  </select>
                </label>
                <select className="crm-input" value={preferredChannel} disabled={disabled} onChange={event => setPreferredChannel(event.target.value as MoveRelationship['preferredChannel'])}>
                  <option value="unknown">Contact mode unknown</option>
                  <option value="phone">Phone</option>
                  <option value="sms">SMS</option>
                  <option value="email">Email</option>
                  <option value="instagram">Instagram</option>
                  <option value="linkedin">LinkedIn</option>
                  <option value="in_person">In person</option>
                </select>
                <input className="crm-input" value={socialHandle} disabled={disabled} onChange={event => setSocialHandle(event.target.value)} placeholder="@handle or profile URL" />
                <input className="crm-input md:col-span-2" value={relationshipSource} disabled={disabled} onChange={event => setRelationshipSource(event.target.value)} placeholder="How was this connection confirmed or discovered?" />
              </div>
              <PartnerReferralSelector
                value={selectedPartner}
                disabled={disabled}
                onChange={setSelectedPartner}
                defaultCategory={MOVE_RELATIONSHIP_CATEGORY_BY_ROLE[relationshipRole]}
                onCreated={partner => addRelationship(partner)}
              />
              <button type="button" onClick={() => addRelationship()} disabled={disabled || !selectedPartner} className="crm-button-dark w-full disabled:opacity-50">Connect to this move</button>
              <div className="border-t border-[var(--app-line)] pt-3">
                <label className="flex items-start gap-2 text-xs leading-5 text-[#344054]">
                  <input
                    type="checkbox"
                    className="mt-1 accent-[#C99700]"
                    checked={context.relationshipReviewStatus === 'complete'}
                    disabled={disabled}
                    onChange={event => setContext(current => ({
                      ...current,
                      relationshipReviewStatus: event.target.checked ? 'complete' : 'open',
                      lifecycleCompletedAt: undefined,
                    }))}
                  />
                  <span>I reviewed the people and organizations around this move. The connections above are complete for now, or none could reasonably be identified.</span>
                </label>
                <input className="crm-input mt-2 w-full" value={context.relationshipReviewNote || ''} disabled={disabled} onChange={event => setContext(current => ({ ...current, relationshipReviewNote: event.target.value }))} placeholder="Optional note when no relationship was identified" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--app-line)] bg-[#fbfaf6] px-5 py-4 md:px-7">
        <div className="text-xs text-[var(--app-muted)]">{message || (lifecycleGaps.length ? `Progress can be saved now. Before customer success: ${lifecycleGaps.join(', ')}.` : 'All lifecycle context requirements are complete.')}</div>
        <button type="button" onClick={() => void save()} disabled={disabled || saving} className="crm-button-dark min-w-44 disabled:opacity-60">{saving ? 'Saving…' : 'Save opportunity & network'}</button>
      </div>
      </> : (
        <div className="grid gap-px border-t border-[var(--app-line)] bg-[var(--app-line)] sm:grid-cols-4">
          <div className="bg-white px-4 py-3"><div className="text-[9px] uppercase tracking-[0.14em] text-[var(--app-muted)]">Position</div><div className="mt-1 truncate text-sm font-semibold text-[#071421]">{OPPORTUNITY_POSITION_LABELS[context.position]}</div></div>
          <div className="bg-white px-4 py-3"><div className="text-[9px] uppercase tracking-[0.14em] text-[var(--app-muted)]">Next action</div><div className="mt-1 truncate text-sm font-semibold text-[#071421]">{context.nextAction || 'Not set'}</div></div>
          <div className="bg-white px-4 py-3"><div className="text-[9px] uppercase tracking-[0.14em] text-[var(--app-muted)]">Acquisition evidence</div><div className="mt-1 text-sm font-semibold text-[#071421]">{signals.length} touchpoint{signals.length === 1 ? '' : 's'}</div></div>
          <div className="bg-white px-4 py-3"><div className="text-[9px] uppercase tracking-[0.14em] text-[var(--app-muted)]">Connected network</div><div className="mt-1 text-sm font-semibold text-[#071421]">{relationships.length} relationship{relationships.length === 1 ? '' : 's'}</div></div>
        </div>
      )}
    </section>
  )
}
