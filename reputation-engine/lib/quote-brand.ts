import { detectSalesBranchFromLocation } from './sales'
import type { CRMLead, QuoteLeg } from './types'

export type QuoteBrandRoute = {
  branch?: CRMLead['branch']
  originCity?: string
  originAddress?: string
  destCity?: string
  destAddress?: string
  legs?: QuoteLeg[]
}

export function getCustomerFacingQuoteBranch(quote: QuoteBrandRoute) {
  const routeParts = [
    quote.originCity,
    quote.originAddress,
    quote.destCity,
    quote.destAddress,
    ...(quote.legs || []).flatMap(leg => [
      leg.originCity,
      leg.originAddress,
      leg.destCity,
      leg.destAddress,
    ]),
  ]

  // The actual route is current operational truth. The stored branch remains a
  // fallback for incomplete routes, not an override for customer branding.
  return detectSalesBranchFromLocation(...routeParts) || quote.branch
}
