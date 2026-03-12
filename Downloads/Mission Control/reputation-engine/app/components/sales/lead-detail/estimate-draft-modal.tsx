'use client'

import Link from 'next/link'
import { formatMoney } from '@/lib/sales'
import type { CRMLead, CRMQuote, InventoryItem, QuoteLineItem } from '@/lib/types'

type GroupedInventory = Array<[string, Array<{ item: InventoryItem; index: number }> ]>

type Props = {
  open: boolean
  quote: CRMQuote | null
  lead: CRMLead
  originAddress: string
  originCity: string
  destCity: string
  listingLookupBusy: boolean
  analysisBusy: boolean
  listingPhotos: string[]
  activePhotoIndex: number
  inventoryMetrics: {
    totalItems: number
    totalCubicFeet: number
    totalWeightLbs: number
  }
  groupedInventory: GroupedInventory
  presetMatches: Array<{ id: string; label: string }>
  quoteLineItems: QuoteLineItem[]
  quoteModalTotals: {
    subtotal: number
    total: number
    deposit: number
  }
  quoteModalBusy: boolean
  onClose: () => void
  onOriginAddressChange: (value: string) => void
  onOriginCityChange: (value: string) => void
  onDestCityChange: (value: string) => void
  onLookupListing: () => void
  onRefreshInventory: () => void
  onAddLineItem: () => void
  onSetActivePhotoIndex: (index: number) => void
  onAddPreset: (presetId: string) => void
  onUpdateLineItem: (index: number, field: keyof QuoteLineItem, value: string) => void
  onRemoveLineItem: (index: number) => void
  onSaveDraft: () => void
}

export function EstimateDraftModal({
  open,
  quote,
  lead,
  originAddress,
  originCity,
  destCity,
  listingLookupBusy,
  analysisBusy,
  listingPhotos,
  activePhotoIndex,
  inventoryMetrics,
  groupedInventory,
  presetMatches,
  quoteLineItems,
  quoteModalTotals,
  quoteModalBusy,
  onClose,
  onOriginAddressChange,
  onOriginCityChange,
  onDestCityChange,
  onLookupListing,
  onRefreshInventory,
  onAddLineItem,
  onSetActivePhotoIndex,
  onAddPreset,
  onUpdateLineItem,
  onRemoveLineItem,
  onSaveDraft,
}: Props) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/35 px-4 py-6" onClick={onClose}>
      <div
        className="mx-auto my-4 flex min-h-0 w-full max-w-5xl flex-col overflow-hidden rounded-[12px] border border-[var(--app-line)] bg-[var(--app-panel)] shadow-2xl"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--app-line)] px-6 py-4">
          <div>
            <div className="crm-label">Estimate Draft</div>
            <div className="mt-1 text-2xl font-semibold text-[var(--app-ink)]">{quote?.number || 'Preparing draft...'}</div>
            <div className="mt-1 text-sm text-[var(--app-muted)]">
              {originAddress || originCity || lead.originAddress || lead.originCity || 'Origin TBD'} → {destCity || lead.destCity || 'Destination TBD'} • {inventoryMetrics.totalCubicFeet} cu ft • {inventoryMetrics.totalWeightLbs} lbs
            </div>
          </div>
          <div className="flex items-center gap-3">
            {quote ? <Link href={`/sales/quotes/${quote.id}`} className="crm-button">Open Full Workspace</Link> : null}
            <button onClick={onClose} className="crm-button">Close</button>
          </div>
        </div>
        <div className="grid xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="overflow-y-auto p-6">
            <div className="mb-5 grid gap-4 sm:grid-cols-2">
              <div className="crm-kpi">
                <div className="crm-label">Origin Address</div>
                <input value={originAddress} onChange={event => onOriginAddressChange(event.target.value)} className="mt-3 crm-input" placeholder="Search or enter origin address" />
                <input value={originCity} onChange={event => onOriginCityChange(event.target.value)} className="mt-2 crm-input" placeholder="Origin city" />
                <button onClick={onLookupListing} disabled={listingLookupBusy} className="mt-3 crm-button disabled:opacity-60">
                  {listingLookupBusy ? 'Matching...' : 'Match Listing'}
                </button>
              </div>
              <div className="crm-kpi">
                <div className="crm-label">Destination + Scope</div>
                <input value={destCity} onChange={event => onDestCityChange(event.target.value)} className="mt-3 crm-input" placeholder="Destination city" />
                <div className="mt-3 flex gap-2">
                  <button onClick={onRefreshInventory} disabled={analysisBusy || !lead.supabaseListing?.address} className="crm-button disabled:opacity-60">
                    {analysisBusy ? 'Refreshing...' : 'Refresh Inventory'}
                  </button>
                  <button onClick={onAddLineItem} className="crm-button">Add Line Item</button>
                </div>
              </div>
            </div>
            <div className="mb-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] p-4">
                <div className="crm-label">Inventory Snapshot</div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="crm-kpi">
                    <div className="crm-label">Items</div>
                    <div className="crm-value">{inventoryMetrics.totalItems}</div>
                  </div>
                  <div className="crm-kpi">
                    <div className="crm-label">Cubic Feet</div>
                    <div className="crm-value">{inventoryMetrics.totalCubicFeet}</div>
                  </div>
                  <div className="crm-kpi">
                    <div className="crm-label">Weight</div>
                    <div className="crm-value">{inventoryMetrics.totalWeightLbs}</div>
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  {groupedInventory.slice(0, 4).map(([room, items]) => (
                    <div key={room} className="flex items-center justify-between rounded-[6px] border border-[var(--app-line)] bg-[var(--app-panel)] px-3 py-2">
                      <div className="text-sm font-medium text-[var(--app-ink)]">{room}</div>
                      <div className="text-xs text-[var(--app-muted)]">{items.length} items</div>
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-2 pt-2">
                    {presetMatches.slice(0, 4).map(preset => (
                      <button key={preset.id} onClick={() => onAddPreset(preset.id)} className="crm-button">
                        + {preset.label}
                      </button>
                    ))}
                  </div>
                  {groupedInventory.length === 0 ? (
                    <div className="rounded-[6px] border border-dashed border-[var(--app-line)] px-3 py-4 text-sm text-[var(--app-muted)]">
                      No inventory on this lead yet. Add the address or run the MLS scan to populate it.
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] p-4">
                <div className="crm-label">Listing Photos</div>
                {listingPhotos.length > 0 ? (
                  <>
                    <div className="mt-3 overflow-hidden rounded-[8px] border border-[var(--app-line)]">
                      <img src={listingPhotos[activePhotoIndex]} alt="MLS reference" className="h-40 w-full object-cover" />
                    </div>
                    <div className="mt-3 grid grid-cols-4 gap-2">
                      {listingPhotos.slice(0, 8).map((photo, index) => (
                        <button key={`${photo}-${index}`} onClick={() => onSetActivePhotoIndex(index)} className={`overflow-hidden rounded-[6px] border ${activePhotoIndex === index ? 'border-[var(--app-ink)]' : 'border-[var(--app-line)]'}`}>
                          <img src={photo} alt={`MLS thumb ${index + 1}`} className="h-14 w-full object-cover" />
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="mt-3 rounded-[6px] border border-dashed border-[var(--app-line)] px-3 py-8 text-sm text-[var(--app-muted)]">
                    No MLS photos are linked yet. Add the address on the lead to match a listing.
                  </div>
                )}
              </div>
            </div>
            <div className="mb-4 flex items-center justify-between">
              <div className="crm-label">Estimate Line Items</div>
            </div>
            <div className="space-y-3">
              {quoteLineItems.map((item, index) => (
                <div key={`${item.description}-${index}`} className="grid gap-3 rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] p-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_140px_44px]">
                  <input value={item.description} onChange={event => onUpdateLineItem(index, 'description', event.target.value)} className="crm-input" placeholder="Line item" />
                  <input value={item.details || ''} onChange={event => onUpdateLineItem(index, 'details', event.target.value)} className="crm-input" placeholder="Details" />
                  <input type="number" value={item.amount} onChange={event => onUpdateLineItem(index, 'amount', event.target.value)} className="crm-input text-right" placeholder="Amount" />
                  <button onClick={() => onRemoveLineItem(index)} className="crm-button justify-center text-rose-700 hover:bg-rose-50">×</button>
                </div>
              ))}
              {quoteLineItems.length === 0 ? (
                <div className="rounded-[8px] border border-dashed border-[var(--app-line)] px-4 py-12 text-center text-sm text-[var(--app-muted)]">
                  No draft line items yet. Create the draft and shape the estimate here without leaving the lead.
                </div>
              ) : null}
            </div>
          </div>
          <aside className="border-l border-[var(--app-line)] bg-[var(--app-bg)] p-6">
            <div className="crm-label">Draft Summary</div>
            <div className="mt-5 space-y-4">
              <div>
                <div className="text-xs text-[var(--app-muted)]">Subtotal</div>
                <div className="mt-1 text-2xl font-semibold text-[var(--app-ink)]">{formatMoney(quoteModalTotals.subtotal)}</div>
              </div>
              <div>
                <div className="text-xs text-[var(--app-muted)]">Total</div>
                <div className="mt-1 text-2xl font-semibold text-[var(--app-ink)]">{formatMoney(quoteModalTotals.total)}</div>
              </div>
              <div>
                <div className="text-xs text-[var(--app-muted)]">Deposit</div>
                <div className="mt-1 text-lg font-medium text-[var(--app-ink)]">{formatMoney(quoteModalTotals.deposit)}</div>
              </div>
            </div>
            <div className="mt-6 space-y-3">
              <button onClick={onSaveDraft} disabled={quoteModalBusy || !quote} className="crm-button-dark w-full justify-center disabled:opacity-60">
                {quoteModalBusy ? 'Saving...' : 'Save Draft'}
              </button>
              <button onClick={onClose} disabled={quoteModalBusy} className="crm-button w-full justify-center">
                Save + Close
              </button>
            </div>
            <p className="mt-4 text-xs leading-6 text-[var(--app-muted)]">
              Click outside the modal or close it and the current draft will stay tied to the lead instead of forcing you into a separate screen.
            </p>
          </aside>
        </div>
      </div>
    </div>
  )
}
