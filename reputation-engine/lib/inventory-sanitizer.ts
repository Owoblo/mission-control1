/**
 * Post-scan sanity pass: re-categorizes inventory items into their most likely room.
 * No AI — pure rule-based corrections for obvious misclassifications like
 * "sofa in kitchen" or "refrigerator in living room".
 */
import type { InventoryItem } from '@/lib/types'

// Items that strongly belong to a specific room
const ROOM_ANCHORS: Array<{ patterns: RegExp[]; correctRoom: string; allowedRooms?: string[] }> = [
  // Bedroom-only items
  {
    patterns: [/\bbed\s*frame\b/i, /\bqueen\s*bed\b/i, /\bking\s*bed\b/i, /\btwin\s*bed\b/i, /\bdouble\s*bed\b/i, /\bmattress\b/i, /\bnightstand\b/i, /\bnight\s*stand\b/i, /\bbedside\b/i],
    correctRoom: 'Bedroom',
    allowedRooms: ['bedroom', 'master bedroom', 'guest bedroom', 'kids bedroom', 'primary bedroom'],
  },
  // Dresser / wardrobe — bedroom
  {
    patterns: [/\bdresser\b/i, /\bwardrobe\b/i, /\barmoire\b/i, /\bchest\s*of\s*drawers\b/i],
    correctRoom: 'Bedroom',
    allowedRooms: ['bedroom', 'master bedroom', 'guest bedroom', 'closet', 'walk-in'],
  },
  // Sofa, sectional, armchair, loveseat — living room
  {
    patterns: [/\bsectional\b/i, /\b3[\s-]?seat\s*sofa\b/i, /\b2[\s-]?seat\s*sofa\b/i, /\bloveseat\b/i, /\bcouch\b/i, /\bsofa\b/i],
    correctRoom: 'Living Room',
    allowedRooms: ['living room', 'family room', 'great room', 'den', 'basement', 'rec room', 'sitting room', 'lounge'],
  },
  // Coffee table, end table, TV stand — living room
  {
    patterns: [/\bcoffee\s*table\b/i, /\bcenter\s*table\b/i, /\btv\s*stand\b/i, /\bmedia\s*console\b/i, /\bentertainment\s*center\b/i, /\bentertainment\s*unit\b/i],
    correctRoom: 'Living Room',
    allowedRooms: ['living room', 'family room', 'great room', 'den', 'basement', 'rec room', 'bedroom', 'office'],
  },
  // Dining table / dining chairs — dining room
  {
    patterns: [/\bdining\s*table\b/i, /\bdining\s*chair\b/i, /\bdining\s*bench\b/i, /\bdining\s*set\b/i],
    correctRoom: 'Dining Room',
    allowedRooms: ['dining room', 'eat-in kitchen', 'kitchen', 'dining area', 'breakfast nook'],
  },
  // Kitchen appliances — kitchen
  {
    patterns: [/\brefrigerator\b/i, /\bfridge\b/i, /\bstove\b/i, /\boven\b/i, /\bdishwasher\b/i, /\bmicrowave\b/i, /\brange\b/i, /\bkitchen\s*island\b/i],
    correctRoom: 'Kitchen',
    allowedRooms: ['kitchen', 'eat-in kitchen', 'kitchenette'],
  },
  // Washer / dryer — laundry
  {
    patterns: [/\bwasher\b/i, /\bdryer\b/i, /\bwashing\s*machine\b/i],
    correctRoom: 'Laundry',
    allowedRooms: ['laundry', 'laundry room', 'utility room', 'basement'],
  },
  // Outdoor / garage items
  {
    patterns: [/\bbicycle\b/i, /\bbike\b/i, /\blawn\s*mower\b/i, /\bsnow\s*blower\b/i, /\bgrill\b/i, /\bbarbecue\b/i, /\bpatio\s*set\b/i, /\bpatio\s*chair\b/i],
    correctRoom: 'Garage / Outdoor',
    allowedRooms: ['garage', 'outdoor', 'backyard', 'patio', 'basement'],
  },
]

function normalizeRoom(room: string) {
  return room.toLowerCase().trim()
}

function isAllowedRoom(itemRoom: string, allowedRooms: string[]) {
  const normalized = normalizeRoom(itemRoom)
  return allowedRooms.some(allowed => normalized.includes(allowed.toLowerCase()))
}

function matchesPattern(itemName: string, patterns: RegExp[]) {
  return patterns.some(p => p.test(itemName))
}

/**
 * Returns a corrected room label for an item if the current assignment is clearly wrong.
 * Returns null if no correction is needed.
 */
function correctRoom(item: InventoryItem): string | null {
  const name = item.name || item.item || ''
  const currentRoom = item.room || ''

  for (const anchor of ROOM_ANCHORS) {
    if (!matchesPattern(name, anchor.patterns)) continue
    if (!anchor.allowedRooms || isAllowedRoom(currentRoom, anchor.allowedRooms)) continue
    // Item is in a wrong room — suggest the correct one
    return anchor.correctRoom
  }
  return null
}

/**
 * Runs a sanity pass over the full inventory and corrects obvious room misclassifications.
 * Does not deduplicate, does not add/remove items — only moves items to the right room.
 */
export function sanitizeInventoryRooms(inventory: InventoryItem[]): InventoryItem[] {
  return inventory.map(item => {
    const correction = correctRoom(item)
    if (!correction) return item
    return { ...item, room: correction }
  })
}

/** Returns a summary of corrections made, for debugging/logging */
export function auditInventoryRooms(inventory: InventoryItem[]): Array<{ name: string; from: string; to: string }> {
  const corrections: Array<{ name: string; from: string; to: string }> = []
  for (const item of inventory) {
    const correction = correctRoom(item)
    if (correction) {
      corrections.push({ name: item.name || item.item || '', from: item.room || '', to: correction })
    }
  }
  return corrections
}
