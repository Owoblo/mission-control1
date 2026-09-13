'use client'

import { useState } from 'react'
import { PARTNER_BUSINESS_CARDS, findPartnerBusinessCard, businessCardUrl, type PartnerBusinessCard } from '@/lib/partner-business-cards'

export function BusinessCardPicker({ city, disabled, onAdd, onNotice }: {
  city?: string | null
  disabled?: boolean
  onAdd: (card: PartnerBusinessCard) => void
  onNotice: (message: string) => void
}) {
  const matched = findPartnerBusinessCard(city)
  const [slug, setSlug] = useState(matched?.slug || '')
  const [expanded, setExpanded] = useState(false)
  const card = PARTNER_BUSINESS_CARDS.find(item => item.slug === slug)
  return <div className="mb-2 rounded-xl border border-emerald-100 bg-emerald-50 p-2">
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-xs font-semibold text-emerald-950" htmlFor="partner-card-city">Digital card</label>
      <select id="partner-card-city" aria-label="Business card city" value={slug} onChange={event => setSlug(event.target.value)} className="min-w-[180px] flex-1 rounded-lg border border-emerald-200 bg-white px-2 py-1.5 text-xs text-slate-900">
        <option value="">Choose a city ({PARTNER_BUSINESS_CARDS.length} cards)</option>
        {PARTNER_BUSINESS_CARDS.map(item => <option key={item.slug} value={item.slug}>{item.city} · {item.business}</option>)}
      </select>
      <button type="button" disabled={!card || disabled} onClick={() => card && onAdd(card)} className="rounded-lg bg-emerald-800 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">Add card to message</button>
      <button type="button" disabled={!card} onClick={() => setExpanded(value => !value)} className="px-1 py-1.5 text-xs font-semibold text-emerald-900 disabled:opacity-40" aria-expanded={expanded}>{expanded ? 'Hide preview' : 'Preview'}</button>
    </div>
    {!matched && !card && <p className="mt-1 text-xs text-slate-600">Choose the city your contact serves.</p>}
    {card && expanded && <div className="mt-2 flex flex-wrap items-start gap-3 border-t border-emerald-100 pt-2">
      <a href={businessCardUrl(card)} target="_blank" rel="noopener noreferrer"><img src={businessCardUrl(card)} alt={`${card.business} business card for ${card.city}`} className="max-h-36 w-auto sm:max-h-56 rounded-lg border border-slate-200" /></a>
      <div className="space-y-2 text-xs text-slate-700">
        <p className="font-semibold">{card.business} · {card.city}</p>
        <p>{card.phone}<br />{card.email}</p>
        <div className="flex gap-3">
          <button type="button" onClick={() => void navigator.clipboard.writeText(businessCardUrl(card)).then(() => onNotice('Card link copied')).catch(() => onNotice('Open the card and copy its link from your browser.'))} className="font-semibold text-emerald-900 underline">Copy card link</button>
          <a href={businessCardUrl(card, 'pdf')} target="_blank" rel="noopener noreferrer" className="font-semibold text-emerald-900 underline">Open PDF</a>
        </div>
        <p>Adds the card and a short reply. Review them, then press Send.</p>
      </div>
    </div>}
  </div>
}
