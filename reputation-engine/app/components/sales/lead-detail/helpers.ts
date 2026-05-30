import type { InventoryItem } from '@/lib/types'

export const DEFAULT_ROOM_OPTIONS = [
  'Living Room',
  'Primary Bedroom',
  'Bedroom',
  'Kitchen',
  'Dining Room',
  'Basement',
  'Garage',
  'Storage',
  'Office',
  'Outdoor',
  'Other',
]

export function normalizeRoomName(value?: string) {
  return value?.trim() || 'Unassigned'
}

export function buildRoomBreakdown(inventory: InventoryItem[]) {
  return inventory.reduce<Record<string, number>>((rooms, item) => {
    if (item.included === false) return rooms
    const room = normalizeRoomName(item.room)
    rooms[room] = (rooms[room] || 0) + Math.max(1, Number(item.qty || 1))
    return rooms
  }, {})
}

export function buildLeadSignature(payload: {
  name: string
  phone: string
  email: string
  moveDate: string
  moveDateFlexible?: boolean
  moveDateFlexibleReason?: string
  moveType?: string
  branch?: string
  source: string
  originAddress: string
  originCity: string
  originAccess?: string
  destAddress?: string
  destCity: string
  destAccess?: string
  parkingNotes?: string
  realtorBrokerage?: string
  moveReason: string
  notes: string
  stage?: string
  contextFlag?: string
  followUpDate: string
  assignedRepName?: string
  assignedRepUserId?: string
  estimateDate?: string
  estimateTime?: string
  lostReason?: string
  lostNotes?: string
  jobFactors?: unknown
  inventory: InventoryItem[]
}) {
  return JSON.stringify(payload)
}

export function inventoryCategoryCode(itemName?: string) {
  const value = (itemName || '').toLowerCase()
  if (value.includes('sofa') || value.includes('sectional') || value.includes('couch') || value.includes('loveseat')) return 'SF'
  if (value.includes('bed') || value.includes('mattress') || value.includes('nightstand')) return 'BD'
  if (value.includes('dresser') || value.includes('wardrobe') || value.includes('cabinet') || value.includes('hutch')) return 'DR'
  if (value.includes('table') || value.includes('desk')) return 'TB'
  if (value.includes('chair') || value.includes('stool')) return 'CH'
  if (value.includes('box') || value.includes('bin') || value.includes('tote')) return 'BX'
  if (value.includes('tv') || value.includes('monitor')) return 'TV'
  if (value.includes('freezer') || value.includes('fridge')) return 'AP'
  if (value.includes('piano') || value.includes('safe') || value.includes('treadmill')) return 'SP'
  return 'IT'
}
