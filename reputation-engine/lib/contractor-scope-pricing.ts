export type TaxTreatment = 'included' | 'additional' | 'not_registered' | 'unspecified'
export type ScopePrice = { amount: number; tax: TaxTreatment; notes: string; mode?: 'flat' | 'hourly' }
export type PricingEvent = {
  id: string; at: string; actor: 'staff' | 'contractor'; action: string
  price?: ScopePrice; notes: string
}
export type ScopePricing = {
  revision: number
  status: 'request_price' | 'offered' | 'submitted' | 'countered' | 'agreed' | 'declined'
  offer?: ScopePrice
  response?: ScopePrice
  agreed?: ScopePrice
  events: PricingEvent[]
}
export const initialScopePricing = (): ScopePricing => ({ revision: 0, status: 'request_price', events: [] })
export const taxLabels: Record<TaxTreatment, string> = { unspecified: '', included: 'Tax included', additional: 'Applicable tax additional', not_registered: 'No tax charged — not registered' }
export const priceLabel = (price: ScopePrice) => `${new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(price.amount)} CAD${price.mode === 'hourly' ? '/hour' : ''}${price.tax !== 'unspecified' ? ` · ${taxLabels[price.tax]}` : ''}`
export const pricingStatusLabels: Record<ScopePricing['status'], string> = { request_price: 'Awaiting contractor price', offered: 'Offer awaiting response', submitted: 'Price submitted for review', countered: 'Counteroffer awaiting review', agreed: 'Price agreed — assignment pending', declined: 'Declined' }
const text = (value: unknown) => {
  if (value == null) return ''
  if (typeof value !== 'string' || value.length > 2000) throw Error('Keep notes under 2,000 characters.')
  return value.trim()
}
function parsePrice(input: Record<string, unknown>): ScopePrice {
  const amount = input.amount
  const mode = input.mode ?? 'flat'
  if (!['flat', 'hourly'].includes(String(mode))) throw Error('Choose a flat total or hourly rate.')
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > 100000 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001) throw Error(`Enter a valid ${mode === 'hourly' ? 'hourly rate' : 'flat price'} between $0.01 and $100,000, with at most two decimal places.`)
  const tax = input.tax ?? 'unspecified'
  if (!['included', 'additional', 'not_registered', 'unspecified'].includes(String(tax))) throw Error('Choose how tax is handled.')
  return { amount, tax: tax as TaxTreatment, notes: text(input.notes), mode: mode as 'flat' | 'hourly' }
}
// A price agreement is a negotiation result only. It never assigns a crew or approves dispatch.
export function transitionScopePricing(current: ScopePricing, actor: 'staff' | 'contractor', input: Record<string, unknown>, now = new Date().toISOString()): ScopePricing {
  if (typeof input.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(input.requestId)) throw Error('Invalid request. Refresh and try again.')
  if (current.events.some(e => e.id === input.requestId && e.actor === actor)) return current
  if (input.revision !== current.revision) throw Error('The price or response changed. Refresh and review the latest terms.')
  if (current.events.length >= 100) throw Error('Please contact John to continue this review.')
  const action = input.action, notes = text(input.notes)
  let next: ScopePricing = { ...current, revision: current.revision + 1, events: [...current.events] }
  let price: ScopePrice | undefined
  if (actor === 'staff') {
    if (action === 'offer') {
      price = parsePrice(input)
      next = { ...next, status: 'offered', offer: price, response: undefined, agreed: undefined }
    } else if (action === 'request_price') {
      next = { ...next, status: 'request_price', offer: undefined, response: undefined, agreed: undefined }
    } else if (action === 'accept_price' && ['submitted', 'countered'].includes(current.status) && current.response) {
      price = current.response
      next = { ...next, status: 'agreed', agreed: price }
    } else if (action === 'decline' && ['submitted', 'countered', 'offered', 'request_price'].includes(current.status)) {
      next = { ...next, status: 'declined', agreed: undefined }
    } else throw Error('This action is not available for the current response.')
  } else {
    if (action === 'accept' && current.status === 'offered' && current.offer) {
      if (input.confirm !== true) throw Error('Confirm you reviewed the full scope and offer terms.')
      price = current.offer
      next = { ...next, status: 'agreed', agreed: price }
    } else if ((action === 'submit' && current.status === 'request_price') || (action === 'counter' && current.status === 'offered')) {
      if (input.confirm !== true) throw Error('Confirm you reviewed the full scope and price terms.')
      price = parsePrice(input)
      next = { ...next, status: action === 'submit' ? 'submitted' : 'countered', response: price }
    } else if (action === 'decline' && ['request_price', 'offered'].includes(current.status)) {
      next = { ...next, status: 'declined' }
    } else throw Error('Your response is already recorded or these terms have changed. Refresh to see the latest status.')
  }
  next.events.push({ id: input.requestId, at: now, actor, action: String(action), price, notes })
  return next
}
