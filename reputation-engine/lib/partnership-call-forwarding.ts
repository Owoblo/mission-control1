import { PARTNERSHIP_LINES } from './partnership-lines'
import { normalizePhone } from './sales-phones'

// Temporary owner-directed routing, requested October 6, 2026. Ottawa retains
// its existing branch routing. This applies to inbound calls only.
export function partnershipCellForwardTarget(dialedNumber?: string | null): string | null {
  const line = PARTNERSHIP_LINES.find(item => item.number === normalizePhone(dialedNumber))
  return line && line.market !== 'ottawa' ? '+12267241730' : null
}
