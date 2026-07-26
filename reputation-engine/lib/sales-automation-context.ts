import { deriveInventoryMetrics } from './sales'
import { hasCanadianPostalCode, hasCompleteMoveAddress, hasStreetType } from './sales-automation-qualification'
import { matchInventoryPreset } from './item-presets'
import type { CRMLead, InventoryItem } from './types'

const ADDRESS_SPLIT_RE = /\s+(?:to|->|→|drop\s*off\s*(?:is|:)?|dropoff\s*(?:is|:)?)\s+/i
const PICKUP_RE = /\b(pick\s*up|pickup|origin|from)\b/i
const DROPOFF_RE = /\b(drop\s*off|dropoff|destination|to)\b/i
const ADDRESS_HINT_RE = /\b(st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|cres|crescent|ct|court|ln|lane|way|pkwy|parkway|pl|place|terrace|trail|circle|cir|sq|square|hwy|highway|unit|suite|apt|apartment|#)\b/i
const INVENTORY_HINT_RE = /\b(sofa|couch|recliner|chair|table|tv|television|computer|desk|dishwasher|microwave|bicycle|bike|closet|bed|mattress|dresser|nightstand|bookshelf|shelf|boxes|box|wardrobe|fridge|freezer|stove|washer|dryer|cabinet)\b/i
const QUANTITY_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
}
const QUANTITY_TOKEN = '(?:one|two|three|four|five|six|seven|eight|nine|ten|\\d{1,2})'
const COUNTABLE_ITEM_TOKEN = '(?:beds?|mattresses?|sofas?|couches?|recliners?|chairs?|tables?|nightstands?|night\\s+tables?|desks?|dressers?|bookshelves?|boxes?|televisions?|tvs?|consoles?|cabinets?)'

function cleanLine(value?: string | null) {
  return String(value || '').replace(/\s+/g, ' ').trim()
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
    .replace(/\bthere are\b|\bthere is\b|\bsome\b|\bitems?\b|\balso\b|\bthe\b|\ba\b|\ban\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (/closet/.test(text)) text = 'closet items'
  if (!text || text.length < 3) return ''
  return titleCase(text)
}

function matchCustomerInventoryPreset(name: string) {
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
  const trimmed = value.trim()
  const quantityMatch = trimmed.match(/^(?:i (?:have|am moving)\s+)?(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})\b\s*/i)
  const rawQuantity = quantityMatch?.[1]?.toLowerCase()
  const qty = rawQuantity ? (QUANTITY_WORDS[rawQuantity] || Number(rawQuantity) || 1) : 1
  const name = normalizeInventoryName(quantityMatch ? trimmed.slice(quantityMatch[0].length) : trimmed)
  return { name, qty: Math.max(1, qty) }
}

export function extractCustomerInventoryItems(message?: string | null): InventoryItem[] {
  const text = cleanLine(message)
  if (!text || !INVENTORY_HINT_RE.test(text)) return []
  if (/\b(address|pick\s*up|pickup|drop\s*off|dropoff|postal|zip)\b/i.test(text) && !/\b(sofa|couch|chair|table|boxes|closet|packing|pack)\b/i.test(text)) return []

  const inventoryFocused = text
    .replace(new RegExp(`^[\\s\\S]*?\\bi (?:have|am moving)\\s+(?=${QUANTITY_TOKEN}\\s+${COUNTABLE_ITEM_TOKEN})`, 'i'), '')
  const normalized = inventoryFocused
    .replace(/\bcoffee\s*,\s*table\b/gi, 'coffee table')
    .replace(/\bstudy\s*,\s*chair\b/gi, 'study chair')
    .replace(/\band\b/gi, ',')
    .replace(new RegExp(`\\s+(?=${QUANTITY_TOKEN}\\s+${COUNTABLE_ITEM_TOKEN}\\b)`, 'gi'), ', ')

  const seen = new Set<string>()
  return normalized
    .split(/[,;\n.]+/)
    .map(parseInventoryCandidate)
    .filter(candidate => {
      const key = candidate.name.toLowerCase()
      if (!candidate.name || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map(({ name, qty }, index) => ({
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
              ].filter(Boolean).join(' '),
            }
          : {
              cubicFeet: 0,
              weightLbs: 0,
              room: 'Packing scope',
              notes: 'Captured from customer SMS; dimensions still need enrichment.',
            }
      })(),
      id: `customer-sms-${Date.now()}-${index}`,
      name,
      item: name,
      qty,
      included: true,
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
  const parsedInventory = extractCustomerInventoryItems(message)
  const nextInventory = mergeInventory(lead.inventory, parsedInventory)
  const inventoryMetrics = parsedInventory.length ? deriveInventoryMetrics(nextInventory) : null

  return {
    ...lead,
    ...(route.originAddress ? { originAddress: route.originAddress } : {}),
    ...(route.destAddress ? { destAddress: route.destAddress } : {}),
    ...(parsedInventory.length ? {
      inventory: inventoryMetrics!.inventory,
      totalItems: inventoryMetrics!.totalItems,
      totalCubicFeet: lead.totalCubicFeet || inventoryMetrics!.totalCubicFeet,
      totalWeightLbs: lead.totalWeightLbs || inventoryMetrics!.totalWeightLbs,
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
