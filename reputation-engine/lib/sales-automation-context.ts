import { deriveInventoryMetrics } from './sales'
import { hasCanadianPostalCode, hasCompleteMoveAddress, hasStreetType } from './sales-automation-qualification'
import { INVENTORY_PRESETS, matchInventoryPreset } from './item-presets'
import type { CRMLead, InventoryItem } from './types'

const ADDRESS_SPLIT_RE = /\s+(?:to|->|→|drop\s*off\s*(?:is|:)?|dropoff\s*(?:is|:)?)\s+/i
const PICKUP_RE = /\b(pick\s*up|pickup|origin|from)\b/i
const DROPOFF_RE = /\b(drop\s*off|dropoff|destination|to)\b/i
const ADDRESS_HINT_RE = /\b(st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|cres|crescent|ct|court|ln|lane|way|pkwy|parkway|pl|place|terrace|trail|circle|cir|sq|square|hwy|highway|unit|suite|apt|apartment|#)\b/i
const INVENTORY_HINT_RE = /\b(sofa|couch|recliner|chair|table|tv|television|computer|desk|dishwasher|microwave|bicycle|bike|closet|bed|mattress|dresser|armoire|nightstand|bookshelf|shelf|boxes|box|wardrobe|fridge|freezer|stove|washer|dryer|cabinet|pinball)\b/i
const INVENTORY_ITEM_RE = /\b(sofas?|couch(?:es)?|recliners?|chairs?|tables?|stands?|lamps?|tvs?|televisions?|monitors?|computers?|desks?|dishwashers?|microwaves?|bicycles?|bikes?|closets?|beds?|headboards?|mattresses?|dressers?|armoires?|drawers?|nightstands?|night\s+tables?|bookshelves?|shelves?|boxes?|bins?|wardrobes?|fridges?|freezers?|stoves?|washers?|dryers?|cabinets?|pinball|pianos?|benches?|stools?|ottomans?|loveseats?|sectionals?|consoles?|appliances?|suitcases?|hampers?|baskets?|racks?|machines?)\b/i
const QUANTITY_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
}
const QUANTITY_TOKEN = '(?:one|two|three|four|five|six|seven|eight|nine|ten|\\d{1,2})'
const COUNTABLE_ITEM_TOKEN = '(?:beds?|mattresses?|sofas?|couches?|recliners?|chairs?|(?:end|side|coffee|dining|kitchen|night|study|patio)\\s+tables?|tables?|nightstands?|desks?|dressers?|armoires?|bookshelves?|boxes?|bins?|televisions?|tvs?|consoles?|cabinets?|pinball\\s+machines?|lamps?|stools?|suitcases?|baskets?|racks?)'
const INVENTORY_ROOM_TOKEN = '(?:(?:living|dining|family|bed)\\s+room|bedroom|kitchen|office|basement|garage|outdoor|patio)'

function cleanLine(value?: string | null) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function rawText(raw: Record<string, unknown> | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = raw?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function normalizeFormDate(value: string) {
  const iso = value.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/)
  if (iso) return iso[0]
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : undefined
}

function normalizeFormBedrooms(value: string): CRMLead['propertyBedrooms'] {
  const count = Number(value.match(/\d+/)?.[0])
  if (/\bstudio\b/i.test(value)) return 'studio'
  if (count === 1) return '1_bedroom'
  if (count === 2) return '2_bedrooms'
  if (count === 3) return '3_bedrooms'
  if (count === 4) return '4_bedrooms'
  if (count >= 5) return '5_plus'
  return undefined
}

/**
 * Converts website form fields into canonical CRM fields without relying on AI.
 * The message fallbacks cover legacy integrations that only forward a formatted
 * summary while preserving raw_data separately in inbound_leads.
 */
export function extractStructuredInboundLeadFields(
  raw?: Record<string, unknown>,
  message?: string | null,
): Partial<CRMLead> {
  const text = String(message || '')
  const originAddress =
    rawText(raw, 'move_from', 'moveFrom', 'originAddress', 'origin_address', 'pickup_address') ||
    text.match(/(?:^|\|)\s*(?:from|pickup|origin)\s*:\s*(.*?)(?=\s*\||$)/i)?.[1]?.trim() ||
    ''
  const destAddress =
    rawText(raw, 'move_to', 'moveTo', 'destAddress', 'destination_address', 'dropoff_address') ||
    text.match(/(?:^|\|)\s*(?:to|dropoff|destination)\s*:\s*(.*?)(?=\s*\||$)/i)?.[1]?.trim() ||
    ''
  const moveDateText =
    rawText(raw, 'move_date', 'moveDate', 'date') ||
    text.match(/(?:^|\|)\s*(?:move\s*)?date\s*:\s*(.*?)(?=\s*\||$)/i)?.[1]?.trim() ||
    ''
  const homeSize =
    rawText(raw, 'home_size', 'homeSize', 'propertyBedrooms', 'bedrooms') ||
    text.match(/(?:^|\|)\s*(?:home|property)\s*size\s*:\s*(.*?)(?=\s*\||$)/i)?.[1]?.trim() ||
    ''
  const serviceType =
    rawText(raw, 'service_type', 'serviceType', 'service') ||
    text.match(/(?:^|\|)\s*service\s*:\s*(.*?)(?=\s*\||$)/i)?.[1]?.trim() ||
    ''
  const notes =
    rawText(raw, 'message', 'notes', 'additional_notes') ||
    text.match(/(?:^|\|)\s*notes?\s*:\s*(.*?)(?=\s*\||$)/i)?.[1]?.trim() ||
    ''
  const propertyBedrooms = normalizeFormBedrooms(homeSize)
  const hasStairs = /\bstairs?\b/i.test(notes)
  const usableOrigin = originAddress && !/\b(?:tbd|to be confirmed|unknown|not sure)\b/i.test(originAddress)
  const usableDestination = destAddress && !/\b(?:tbd|to be confirmed|unknown|not sure)\b/i.test(destAddress)
  const originIsStreetAddress = usableOrigin && /\d/.test(originAddress)
  const destinationIsStreetAddress = usableDestination && /\d/.test(destAddress)

  return {
    ...(originIsStreetAddress ? { originAddress } : usableOrigin ? { originCity: originAddress } : {}),
    ...(destinationIsStreetAddress ? { destAddress } : usableDestination ? { destCity: destAddress } : {}),
    ...(moveDateText && normalizeFormDate(moveDateText) ? { moveDate: normalizeFormDate(moveDateText) } : {}),
    ...(propertyBedrooms ? { propertyBedrooms } : {}),
    ...(/\b(local|residential)\b/i.test(serviceType) ? { moveType: 'residential' as const } : {}),
    ...(hasStairs ? {
      originAccess: 'Stairs reported on website form; flight count to confirm',
    } : {}),
  }
}

export function extractDeterministicReplyFields(message?: string | null): Partial<CRMLead> {
  const text = cleanLine(message)
  if (!text) return {}
  const flexible = /\b(date|day|timing)\b.{0,35}\b(flexible|any day|whenever)\b|\b(any day|weekend|monday|friday)\b/i.test(text)
  return flexible
    ? {
        moveDateFlexible: true,
        moveDateFlexibleReason: text.slice(0, 240),
      }
    : {}
}

function cleanInventoryText(value?: string | null) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

function trimAddressCandidate(value: string) {
  return value
    .replace(/^[^\d]*(?=\d)/, '')
    .replace(/\s+(?:and|also|that is|that’s|thats)\b.*$/i, '')
    .replace(/[.;]+$/g, '')
    .trim()
}

function firstCompleteAddress(value?: string | null) {
  const text = trimAddressCandidate(cleanLine(value))
  if (!text || !/\d{1,6}/.test(text) || (!hasStreetType(text) && !hasCanadianPostalCode(text) && !ADDRESS_HINT_RE.test(text))) return ''
  if (!hasCompleteMoveAddress(text)) return ''
  return text
}

function extractRouteAddresses(message?: string | null) {
  const text = cleanLine(message)
  if (!text) return {}

  // Never flatten a second pickup into the canonical origin field.
  const labeledMultiStop = text.match(
    /pickup\s+addresses?\s*:\s*(.+?)\s*,?\s+then\s+(.+?)\s*,?\s+drop\s*-?\s*off\s+address\s*:\s*(.+?)(?=\s*[.;]\s*(?:the\s+)?(?:majority|items?|no\s+assembly|all\s+items?)\b|$)/i,
  )
  if (labeledMultiStop) {
    const originAddress = firstCompleteAddress(labeledMultiStop[1])
    const destAddress = firstCompleteAddress(labeledMultiStop[3])
    if (originAddress && destAddress) return { originAddress, destAddress }
  }

  const splitParts = text.split(ADDRESS_SPLIT_RE).map(part => part.trim()).filter(Boolean)
  if (splitParts.length >= 2) {
    const originAddress = firstCompleteAddress(splitParts[0])
    const destAddress = firstCompleteAddress(splitParts.slice(1).join(' '))
    if (originAddress && destAddress) return { originAddress, destAddress }
  }

  const single = firstCompleteAddress(text)
  if (!single) return {}
  if (PICKUP_RE.test(text) && !DROPOFF_RE.test(text.replace(PICKUP_RE, ''))) return { originAddress: single }
  if (DROPOFF_RE.test(text) && !PICKUP_RE.test(text.replace(DROPOFF_RE, ''))) return { destAddress: single }
  return {}
}

function titleCase(value: string) {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, char => char.toUpperCase())
}

function normalizeInventoryName(value: string) {
  let text = value
    .toLowerCase()
    .replace(/\b(recline)\b/g, 'recliner')
    .replace(/\b(tv)\b/g, 'television')
    .replace(/\b(?:was|were)\s+(?:missed|forgotten|left off|not included)\b/g, ' ')
    .replace(/\bthere are\b|\bthere is\b|\bsome\b|\bitems?\b|\balso\b|\bthe\b|\ba\b|\ban\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (/closet/.test(text)) text = 'closet items'
  if (!text || text.length < 3) return ''
  return titleCase(text)
}

function matchCustomerInventoryPreset(name: string) {
  // A reclining couch is still a multi-seat sofa. Generic fuzzy matching sees
  // "recliner" first and otherwise misclassifies it as a one-seat chair.
  if (/\b(?:recliner|reclining|lazy\s*boy|la-z-boy)\b.*\b(?:couch|sofa)\b|\b(?:couch|sofa)\b.*\b(?:recliner|reclining)\b/i.test(name)) {
    return INVENTORY_PRESETS.find(preset => preset.id === 'sofa-standard')
  }
  const aliases = name
    .replace(/\bbeds?\b/i, 'bed frame queen')
    .replace(/\bcouch(?:es)?\b/i, 'sofa')
    .replace(/\bnight tables?\b/i, 'nightstand')
    .replace(/\btelevision console\b/i, 'tv stand')
    .replace(/\btv console\b/i, 'tv stand')
    .replace(/\bpatio furniture\b/i, 'patio dining set')
    .replace(/\b(?:midsize|medium)(?:-sized)? storage furniture\b/i, 'metal storage cabinet')
    .replace(/\bstorage furniture (?:midsize|medium)\b/i, 'metal storage cabinet')
  return matchInventoryPreset(aliases)
}

function parseInventoryCandidate(value: string) {
  const trimmed = value
    .replace(/^(?:>+\s*)+/, '')
    .replace(/^[•●▪◦*-]\s*/, '')
    .replace(/^(?:i (?:have|am moving)\s+)/i, '')
    .replace(new RegExp(`^(?:in|from)\\s+(?:the\\s+)?${INVENTORY_ROOM_TOKEN}\\s*[:—-]?\\s*`, 'i'), '')
    .replace(new RegExp(`^(?:the\\s+)?${INVENTORY_ROOM_TOKEN}\\s+(?:also\\s+)?has\\s+`, 'i'), '')
    .replace(/^(?:there\s+(?:are|is)|(?:it|this room)\s+(?:also\s+)?has|(?:we|i)\s+(?:also\s+)?have)\s+/i, '')
    .replace(/^(?:also\s+)?has\s+/i, '')
    .trim()
  const quantityMatch = trimmed.match(new RegExp(
    `^(one|two|three|four|five|six|seven|eight|nine|ten)\\b\\s+|^(\\d{1,2})\\s*[x×]\\s*|^(\\d{1,2})\\s+(?=${COUNTABLE_ITEM_TOKEN}\\b)`,
    'i',
  ))
  const rawQuantity = (quantityMatch?.[1] || quantityMatch?.[2] || quantityMatch?.[3])?.toLowerCase()
  const qty = rawQuantity ? (QUANTITY_WORDS[rawQuantity] || Number(rawQuantity) || 1) : 1
  const rawName = quantityMatch ? trimmed.slice(quantityMatch[0].length) : trimmed
  const parentheticalNotes = Array.from(rawName.matchAll(/\(([^)]+)\)/g))
    .map(match => match[1]?.trim())
    .filter(Boolean)
  const name = normalizeInventoryName(rawName.replace(/\s*\([^)]+\)\s*/g, ' '))
  const uncertainDisposition = parentheticalNotes.some(note =>
    /\b(?:might|may|maybe|not sure|unsure|possibly|probably)\b.*\b(?:move|take|carry|keep|sell|leave)\b/i.test(note)
  )
  return {
    name,
    qty: Math.max(1, qty),
    notes: parentheticalNotes.join(' — '),
    status: uncertainDisposition ? 'needs_confirmation' as const : undefined,
    confirmReason: uncertainDisposition
      ? 'Confirm whether the customer wants Saturn Star to move this item.'
      : undefined,
  }
}

export function extractCustomerInventoryItems(message?: string | null): InventoryItem[] {
  const text = cleanInventoryText(message)
  if (!text || !INVENTORY_HINT_RE.test(text)) return []
  if (/\b(address|pick\s*up|pickup|drop\s*off|dropoff|postal|zip)\b/i.test(text) && !/\b(sofa|couch|chair|table|boxes|closet|packing|pack)\b/i.test(text)) return []

  const inventoryFocused = text
    .replace(new RegExp(`^[\\s\\S]*?\\bi (?:have|am moving)\\s+(?=${QUANTITY_TOKEN}\\s+${COUNTABLE_ITEM_TOKEN})`, 'i'), '')
  const normalized = inventoryFocused
    .replace(/\b(\d{1,3})\s*["”]\b/g, '$1 inch ')
    .replace(/\bcoffee\s*,\s*table\b/gi, 'coffee table')
    .replace(/\bstudy\s*,\s*chair\b/gi, 'study chair')
    // Customer corrections are frequently written as prose. A sentence
    // boundary must never allow two furniture items to become one inventory
    // name (and therefore inherit one item's dimensions).
    .replace(/[.!?]+(?=\s|$)/g, ',')
    .replace(/\band\b/gi, ',')
    .replace(new RegExp(`\\s+(?=${QUANTITY_TOKEN}\\s+${COUNTABLE_ITEM_TOKEN}\\b)`, 'gi'), ', ')

  const seen = new Set<string>()
  return normalized
    .split(/[,;\n]+|(?:\s+>\s+)|(?:\s+[•●▪◦]\s*)/)
    .map(part => part
      .replace(/\b(?:approx(?:imately)?\.?|standard size|freestanding|fabric upholstery|includes? attached cushions?)\b[\s\S]*$/i, '')
      .replace(/^[\s>:;—–.-]+|[\s>:;—–.-]+$/g, '')
      .trim())
    .filter(part => INVENTORY_ITEM_RE.test(part))
    .map(parseInventoryCandidate)
    .filter(candidate => {
      const key = candidate.name.toLowerCase()
      if (!candidate.name || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map(({ name, qty, notes, status, confirmReason }, index) => ({
      ...(() => {
        const preset = matchCustomerInventoryPreset(name)
        return preset
          ? {
              cubicFeet: preset.item.cubicFeet,
              weightLbs: preset.item.weightLbs,
              icon: preset.icon,
              room: preset.room || 'Packing scope',
              notes: [
                preset.item.notes,
                'Dimensions matched from Saturn Star inventory presets; confirm size if atypical.',
                notes,
              ].filter(Boolean).join(' '),
            }
          : {
              cubicFeet: 0,
              weightLbs: 0,
              room: 'Packing scope',
              notes: [
                'Captured from customer SMS; dimensions still need enrichment.',
                notes,
              ].filter(Boolean).join(' '),
            }
      })(),
      id: `customer-sms-${Date.now()}-${index}`,
      name,
      item: name,
      qty,
      included: true,
      status,
      confirmReason,
      source: 'customer_verification' as const,
    }))
}

function mergeInventory(existing: InventoryItem[] | undefined, incoming: InventoryItem[]) {
  if (!incoming.length) return existing || []
  const seen = new Set((existing || []).map(item => String(item.name || item.item || '').toLowerCase().trim()).filter(Boolean))
  const merged = [...(existing || [])]
  for (const item of incoming) {
    const key = String(item.name || item.item || '').toLowerCase().trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    merged.push(item)
  }
  return merged
}

export function resolveInboundSalesContext(lead: CRMLead, inboundMessage?: string | null): CRMLead {
  const message = cleanLine(inboundMessage)
  if (!message) return lead

  let route = extractRouteAddresses(message)
  if (!route.originAddress && !route.destAddress) {
    const singleAddress = firstCompleteAddress(message)
    if (singleAddress) {
      if (lead.originAddress && !hasCompleteMoveAddress(lead.originAddress)) route = { originAddress: singleAddress }
      else if (lead.destAddress && !hasCompleteMoveAddress(lead.destAddress)) route = { destAddress: singleAddress }
    }
  }
  const parsedInventory = extractCustomerInventoryItems(message).map(item => ({
    ...item,
    status: 'needs_confirmation' as const,
    confirmReason: 'Automatically parsed from customer text. A rep must confirm the item, quantity, room, and dimensions before relying on it.',
    notes: [
      item.notes,
      'Automatically parsed from customer SMS; rep review required.',
    ].filter(Boolean).join(' '),
  }))
  const nextInventory = mergeInventory(lead.inventory, parsedInventory)
  const inventoryMetrics = parsedInventory.length ? deriveInventoryMetrics(nextInventory) : null

  return {
    ...lead,
    ...(route.originAddress ? { originAddress: route.originAddress } : {}),
    ...(route.destAddress ? { destAddress: route.destAddress } : {}),
    ...(parsedInventory.length ? {
      inventory: inventoryMetrics!.inventory,
      totalItems: inventoryMetrics!.totalItems,
      totalCubicFeet: inventoryMetrics!.totalCubicFeet,
      totalWeightLbs: inventoryMetrics!.totalWeightLbs,
      roomBreakdown: {
        ...(lead.roomBreakdown || {}),
        'Packing scope': inventoryMetrics!.inventory
          .filter(item => item.room === 'Packing scope' && item.included !== false)
          .reduce((sum, item) => sum + Math.max(1, Number(item.qty || 1)), 0),
      },
      notes: [
        lead.notes,
        `Automation capture: Customer listed packing/moving items by SMS: ${parsedInventory.map(item => item.name || item.item).join(', ')}`,
      ].filter(Boolean).join('\n\n'),
    } : {}),
  }
}
