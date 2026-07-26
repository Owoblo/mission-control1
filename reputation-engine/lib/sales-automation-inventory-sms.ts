import {
  applyInventoryVerificationToInventory,
  buildInventoryVerificationChoiceKeyMap,
  canonicalizeSurveyRoomLabel,
} from './inventory-verification'
import type {
  ConversationChannel,
  CRMLead,
  InventoryItem,
  InventoryVerification,
  InventoryVerificationAddedItem,
  InventoryVerificationDecision,
  InventoryVerificationItemChoice,
} from './types'

export type InventorySmsDecision = {
  itemKey: string
  decision: InventoryVerificationDecision
  note?: string
}

export type InventorySmsUpdate = {
  itemChoices?: InventorySmsDecision[]
  addedItems?: Array<{
    room?: string
    name: string
    qty?: number
    note?: string
  }>
  addressConfirmed?: boolean
  addressMismatchNote?: string
  complete?: boolean
  summary?: string
}

function normalizeItemName(item: InventoryItem) {
  return (item.name || item.item || 'Item').trim() || 'Item'
}

function includedBaseInventory(lead: CRMLead) {
  return (lead.inventory || []).filter(item => item.source !== 'customer_verification' && item.included !== false)
}

function listingBaseInventory(lead: CRMLead) {
  return includedBaseInventory(lead).filter(item =>
    ['mls', 'mls_photo_ai', 'existing_scan', 'fallback_scan'].includes(String(item.source || ''))
  )
}

function visibleBaseInventory(lead: CRMLead) {
  return (lead.inventory || []).filter(item => item.source !== 'customer_verification')
}

function buildRoomBreakdown(items: InventoryItem[]) {
  return (items || []).reduce<Record<string, number>>((rooms, item) => {
    if (item.included === false) return rooms
    const room = canonicalizeSurveyRoomLabel(item.room || 'Unassigned')
    rooms[room] = (rooms[room] || 0) + Math.max(1, Number(item.qty || 1))
    return rooms
  }, {})
}

function totalCubicFeet(items: InventoryItem[]) {
  return Math.round(
    items
      .filter(item => item.included !== false)
      .reduce((sum, item) => sum + (Number(item.cubicFeet || 0) * Math.max(1, Number(item.qty || 1))), 0)
  )
}

function totalWeightLbs(items: InventoryItem[]) {
  return Math.round(
    items
      .filter(item => item.included !== false)
      .reduce((sum, item) => sum + (Number(item.weightLbs || 0) * Math.max(1, Number(item.qty || 1))), 0)
  )
}

function totalItems(items: InventoryItem[]) {
  return items
    .filter(item => item.included !== false)
    .reduce((sum, item) => sum + Math.max(1, Number(item.qty || 1)), 0)
}

export function buildInventorySmsReference(lead: CRMLead) {
  const inventory = visibleBaseInventory(lead)
  const keyMap = buildInventoryVerificationChoiceKeyMap(inventory)
  return inventory.map((item, index) => ({
    itemKey: keyMap.get(index) || '',
    room: canonicalizeSurveyRoomLabel(item.room || 'Unassigned'),
    name: normalizeItemName(item),
    qty: Math.max(1, Number(item.qty || 1)),
  })).filter(item => item.itemKey)
}

export function buildMlsInventoryConfirmationSms(lead: CRMLead) {
  const firstName = (lead.name || 'there').split(' ')[0]
  const grouped = new Map<string, string[]>()
  const listingItems = listingBaseInventory(lead)

  if (listingItems.length === 0) {
    return `Thanks, ${firstName}. I couldn't build a clear starter inventory from the property information in our system, but that's no problem. We can build it together from the main furniture instead.`
  }

  for (const item of listingItems) {
    const room = canonicalizeSurveyRoomLabel(item.room || 'Unassigned')
    const items = grouped.get(room) || []
    const qty = Math.max(1, Number(item.qty || 1))
    items.push(`${qty > 1 ? `${qty} ` : ''}${normalizeItemName(item)}`)
    grouped.set(room, items)
  }

  const roomLines = Array.from(grouped.entries())
    .slice(0, 6)
    .map(([room, items]) => `${room}: ${items.slice(0, 6).join(', ')}${items.length > 6 ? ', more' : ''}`)

  return [
    `Nice, ${firstName}—I was able to build a starter inventory from the property information available in our system, so you don't have to list everything from scratch.`,
    `Here is what I could spot:`,
    ...roomLines,
    `Does that look like the furniture moving, or is anything shown staying behind?`,
  ].join('\n')
}

export function buildPhotoSurveyFallbackMessage(lead: CRMLead, surveyUrl: string, channel: ConversationChannel = 'sms') {
  const firstName = (lead.name || 'there').split(' ')[0]
  if (channel === 'email') {
    return `Hi ${firstName},\n\nI couldn't confirm the inventory from the property information in our system. That’s completely fine—please upload a few room photos and we’ll build it for you.\n\n${surveyUrl}\n\nOr simply reply with the main furniture—whichever is easier.\n\nSaturn Star Moving`
  }
  return `Hi ${firstName}, I couldn't confirm the inventory from the property information in our system. That’s completely fine—please upload a few room photos and we’ll build it for you.\n\n${surveyUrl}\n\nOr text the main furniture here. Which is easier for you?`
}

export function buildVerifiedInventorySms(lead: CRMLead) {
  const grouped = new Map<string, string[]>()
  for (const item of (lead.inventory || []).filter(entry => entry.included !== false)) {
    const room = canonicalizeSurveyRoomLabel(item.room || 'Unassigned')
    const items = grouped.get(room) || []
    const qty = Math.max(1, Number(item.qty || 1))
    items.push(`${qty > 1 ? `${qty} ` : ''}${normalizeItemName(item)}`)
    grouped.set(room, items)
  }

  const lines = Array.from(grouped.entries())
    .slice(0, 6)
    .map(([room, items]) => `${room}: ${items.slice(0, 6).join(', ')}${items.length > 6 ? ', more' : ''}`)

  return [
    `Got it. I updated the move inventory:`,
    ...lines,
    `Please review this and text any other edits.`,
  ].join('\n')
}

export function mergeInventorySmsUpdate(lead: CRMLead, update: InventorySmsUpdate, now = new Date().toISOString()) {
  const existing = lead.inventoryVerification || {}
  const existingChoices = new Map((existing.itemChoices || []).map(choice => [choice.itemKey, choice]))

  for (const choice of update.itemChoices || []) {
    if (!choice.itemKey || !['going', 'not_going', 'unsure'].includes(choice.decision)) continue
    existingChoices.set(choice.itemKey, {
      itemKey: choice.itemKey,
      decision: choice.decision,
      note: choice.note?.trim() || undefined,
      updatedAt: now,
      updatedBy: 'customer',
    } satisfies InventoryVerificationItemChoice)
  }

  const addedItems: InventoryVerificationAddedItem[] = [
    ...(existing.addedItems || []),
    ...(update.addedItems || [])
      .filter(item => item.name?.trim())
      .map(item => ({
        id: `sms_added_${now.replace(/\D/g, '')}_${Math.random().toString(36).slice(2, 7)}`,
        room: canonicalizeSurveyRoomLabel(item.room || 'Unassigned'),
        name: item.name.trim(),
        qty: Math.max(1, Math.min(50, Number(item.qty || 1) || 1)),
        note: item.note?.trim() || undefined,
        createdAt: now,
        createdBy: 'customer' as const,
      })),
  ]

  const verification: InventoryVerification = {
    startedAt: existing.startedAt || now,
    lastUpdatedAt: now,
    completedAt: update.complete ? (existing.completedAt || now) : existing.completedAt,
    addressConfirmed:
      typeof update.addressConfirmed === 'boolean'
        ? update.addressConfirmed
        : existing.addressConfirmed,
    addressMismatchNote:
      typeof update.addressMismatchNote === 'string'
        ? (update.addressMismatchNote.trim() || undefined)
        : existing.addressMismatchNote,
    itemChoices: Array.from(existingChoices.values()),
    addedItems,
  }

  const inventory = applyInventoryVerificationToInventory(lead.inventory || [], verification)
  return {
    ...lead,
    inventory,
    inventoryVerification: verification,
    roomBreakdown: buildRoomBreakdown(inventory),
    totalItems: totalItems(inventory),
    totalCubicFeet: totalCubicFeet(inventory),
    totalWeightLbs: totalWeightLbs(inventory),
  }
}
