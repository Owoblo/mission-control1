'use client'

import { useState } from 'react'
import type { ListingMatch, ListingMatchStatus } from '@/lib/types'

export function ListingMatchPicker({
  status,
  candidates,
  requestedUnit,
  busy,
  onSelect,
  onResolveLink,
}: {
  status?: ListingMatchStatus
  candidates: ListingMatch[]
  requestedUnit?: string | null
  busy?: boolean
  onSelect: (listing: ListingMatch) => void
  onResolveLink: (url: string) => void
}) {
  const [listingUrl, setListingUrl] = useState('')
  const message = status === 'unit_not_found'
    ? `We found this building, but not unit ${requestedUnit || ''}. Do not use another unit unless you confirm it is the same home.`
    : status === 'ambiguous_building'
      ? 'Several units were found at this building. Select the exact home before scanning photos.'
      : status === 'building_only'
        ? 'This looks like a unit property. Confirm the exact unit before scanning photos.'
        : 'No safe automatic listing match was found.'

  return (
    <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div>
        <div className="text-sm font-semibold text-amber-950">Listing confirmation required</div>
        <p className="mt-1 text-xs leading-5 text-amber-800">{message}</p>
      </div>

      {candidates.length > 0 && (
        <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
          {candidates.map(candidate => {
            const photos = candidate.carouselphotos?.length || 0
            const preview = candidate.carouselphotos?.find(Boolean)
            const previewUrl = typeof preview === 'string' ? preview : preview?.url
            return (
              <div key={candidate.zpid} className="flex gap-3 rounded-lg border border-amber-200 bg-white p-3">
                {previewUrl ? <img src={previewUrl} alt="Listing preview" className="h-16 w-20 shrink-0 rounded-md object-cover" /> : <div className="flex h-16 w-20 shrink-0 items-center justify-center rounded-md bg-stone-100 text-[10px] text-stone-500">No photos</div>}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-stone-900">{candidate.address}</div>
                  <div className="mt-1 text-xs text-stone-600">
                    {photos} photos · {candidate.status || candidate.homeStatus || 'status unknown'}
                    {candidate.listingMlsId ? ` · MLS ${candidate.listingMlsId}` : ''}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" disabled={busy} onClick={() => onSelect(candidate)} className="rounded-md bg-stone-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Use this unit</button>
                    {candidate.detailurl && <a href={candidate.detailurl} target="_blank" rel="noreferrer" className="rounded-md border border-stone-300 px-3 py-1.5 text-xs font-semibold text-stone-700">Open listing</a>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="border-t border-amber-200 pt-3">
        <label className="text-xs font-semibold text-amber-950">Or paste a Zillow, Realtor, or MLS listing link/ID</label>
        <div className="mt-2 flex gap-2">
          <input value={listingUrl} onChange={event => setListingUrl(event.target.value)} placeholder="https://… or MLS number" className="crm-input min-w-0 flex-1 bg-white" />
          <button type="button" disabled={busy || listingUrl.trim().length < 5} onClick={() => onResolveLink(listingUrl.trim())} className="rounded-md border border-amber-300 bg-white px-3 text-xs font-semibold text-amber-900 disabled:opacity-50">Find listing</button>
        </div>
        <p className="mt-1 text-[10px] leading-4 text-amber-700">Links are resolved against authorized listing data already stored in Supabase; external pages are not scraped.</p>
      </div>
    </div>
  )
}
