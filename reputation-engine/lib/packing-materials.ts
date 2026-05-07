import type { InventoryItem } from './types'

export type PackingMaterialPreset = {
  id: string
  label: string
  description: string
  unitPrice: number
  tvMinInches?: number
  tvMaxInches?: number
}

export type PackingMaterialsEstimateSource = 'customer_estimate' | 'inventory_boxes' | 'volume_inference'

export type PackingMaterialsEstimateLine = {
  presetId: string
  label: string
  quantity: number
  unitPrice: number
  amount: number
  note?: string
}

export type PackingMaterialsEstimate = {
  plannedBoxes: number
  recommendedDeliveryBoxes: number
  recommendedBufferBoxes: number
  source: PackingMaterialsEstimateSource
  lines: PackingMaterialsEstimateLine[]
  subtotal: number
  total: number
  note: string
  billingNote: string
}

// Seeded from current-ish U-Haul supply pricing. Adjust as vendor pricing changes.
export const PACKING_MATERIAL_PRESETS: PackingMaterialPreset[] = [
  { id: 'box-small', label: 'Small Box', description: 'U-Haul small moving box + 10%', unitPrice: 1.53 },
  { id: 'box-medium', label: 'Medium Box', description: 'U-Haul medium moving box + 10%', unitPrice: 2.24 },
  { id: 'box-large', label: 'Large Box', description: 'U-Haul large moving box + 10%', unitPrice: 2.73 },
  { id: 'tv-box-32', label: 'TV Box · 32–54"', description: 'TV moving box for screens up to 54 inches', unitPrice: 29.95, tvMinInches: 32, tvMaxInches: 54 },
  { id: 'tv-box-55', label: 'TV Box · 55–65"', description: 'TV moving box for 55 to 65 inch screens', unitPrice: 39.95, tvMinInches: 55, tvMaxInches: 65 },
  { id: 'tv-box-70', label: 'TV Box · 70–86"', description: 'Large-format TV moving box for 70 to 86 inch screens', unitPrice: 59.95, tvMinInches: 70, tvMaxInches: 86 },
  { id: 'mirror-box', label: 'Mirror / Picture Box', description: 'Flat art, mirrors, framed items', unitPrice: 8.95 },
  { id: 'box-wardrobe', label: 'Wardrobe Box', description: 'U-Haul wardrobe box + 10%', unitPrice: 23.65 },
  { id: 'packing-paper', label: 'Packing Paper Bundle', description: 'U-Haul packing paper bundle + 10%', unitPrice: 18.65 },
  { id: 'tape-roll', label: 'Tape Roll', description: 'U-Haul packing tape + 10%', unitPrice: 7.98 },
  { id: 'mattress-bag', label: 'Mattress Bag', description: 'U-Haul mattress bag + 10%', unitPrice: 10.95 },
  { id: 'stretch-wrap', label: 'Stretch Wrap', description: 'U-Haul stretch wrap + 10%', unitPrice: 12.08 },
  { id: 'recbox-bin', label: 'Reusable Moving Bin', description: 'U-Haul RecBox reusable bin + 10%', unitPrice: 16.45 },
]

export function parseSizeInches(value?: string | null) {
  if (!value) return null
  const match = value.match(/(\d{2,3})/)
  if (!match) return null
  const inches = Number(match[1])
  return Number.isFinite(inches) ? inches : null
}

export function getTvBoxMaterialPresetForSize(value?: string | null) {
  const inches = parseSizeInches(value)
  if (!inches) return PACKING_MATERIAL_PRESETS.find(item => item.id === 'tv-box-55') || null

  return (
    PACKING_MATERIAL_PRESETS.find(
      item =>
        typeof item.tvMinInches === 'number' &&
        typeof item.tvMaxInches === 'number' &&
        inches >= item.tvMinInches &&
        inches <= item.tvMaxInches
    ) ||
    PACKING_MATERIAL_PRESETS.find(item => item.id === 'tv-box-70') ||
    null
  )
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100
}

function getPreset(id: string) {
  return PACKING_MATERIAL_PRESETS.find(item => item.id === id) || null
}

function normalizeInventoryName(item: InventoryItem) {
  return (item.name || item.item || '').trim().toLowerCase()
}

function getIncludedInventory(inventory: InventoryItem[]) {
  return inventory.filter(item => item.included !== false)
}

function getInventoryQuantity(item: InventoryItem) {
  return Math.max(1, Number(item.qty || 1))
}

function countInventoryMatches(inventory: InventoryItem[], matcher: (name: string, item: InventoryItem) => boolean) {
  return inventory.reduce((sum, item) => {
    const name = normalizeInventoryName(item)
    if (!name || !matcher(name, item)) return sum
    return sum + getInventoryQuantity(item)
  }, 0)
}

function roundToNearestFive(value: number) {
  return Math.max(5, Math.round(value / 5) * 5)
}

function allocateByRatio(total: number, ratios: number[]) {
  if (total <= 0) return ratios.map(() => 0)
  const raw = ratios.map(ratio => ratio * total)
  const whole = raw.map(value => Math.floor(value))
  let remainder = total - whole.reduce((sum, value) => sum + value, 0)
  const ranked = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction)

  for (const item of ranked) {
    if (remainder <= 0) break
    whole[item.index] += 1
    remainder -= 1
  }

  return whole
}

function addLine(lines: PackingMaterialsEstimateLine[], presetId: string, quantity: number, note?: string) {
  if (quantity <= 0) return
  const preset = getPreset(presetId)
  if (!preset) return
  lines.push({
    presetId,
    label: preset.label,
    quantity,
    unitPrice: preset.unitPrice,
    amount: roundCurrency(preset.unitPrice * quantity),
    note,
  })
}

function estimateStandardBoxes(input: { inventory: InventoryItem[]; estimatedBoxes?: number }): {
  plannedBoxes: number
  source: PackingMaterialsEstimateSource
} {
  const directEstimate = Number(input.estimatedBoxes || 0)
  if (directEstimate > 0) {
    return {
      plannedBoxes: Math.max(1, Math.round(directEstimate)),
      source: 'customer_estimate',
    }
  }

  const inventoryBoxCount = countInventoryMatches(input.inventory, name => {
    if (!name.includes('box')) return false
    if (name.includes('tv box') || name.includes('mirror box') || name.includes('wardrobe box')) return false
    return true
  })
  if (inventoryBoxCount > 0) {
    return {
      plannedBoxes: inventoryBoxCount,
      source: 'inventory_boxes',
    }
  }

  const totalCubicFeet = getIncludedInventory(input.inventory).reduce((sum, item) => {
    return sum + getInventoryQuantity(item) * Number(item.cubicFeet || 0)
  }, 0)
  const inferredBoxes = roundToNearestFive(Math.max(10, Math.round(totalCubicFeet / 15)))
  return {
    plannedBoxes: inferredBoxes,
    source: 'volume_inference',
  }
}

export function buildPackingMaterialsEstimate(input: {
  inventory: InventoryItem[]
  estimatedBoxes?: number
}) {
  const includedInventory = getIncludedInventory(input.inventory)
  if (includedInventory.length === 0 && !input.estimatedBoxes) return null

  const { plannedBoxes, source } = estimateStandardBoxes({
    inventory: includedInventory,
    estimatedBoxes: input.estimatedBoxes,
  })

  const [smallBoxes, mediumBoxes, largeBoxes] = allocateByRatio(plannedBoxes, [0.25, 0.5, 0.25])
  const tvBoxCounts = new Map<string, number>()
  const mirrorBoxCount = countInventoryMatches(includedInventory, name =>
    (name.includes('mirror') || name.includes('picture') || name.includes('artwork') || name.includes('framed')) &&
    !name.includes('box')
  )
  const mattressBagCount = countInventoryMatches(includedInventory, name =>
    (name.includes('mattress') || name.includes('bed')) &&
    !name.includes('bedside')
  )

  includedInventory.forEach(item => {
    const name = normalizeInventoryName(item)
    if (!name.includes('tv') || name.includes('tv box')) return
    const preset = getTvBoxMaterialPresetForSize(item.size || item.name || item.notes)
    if (!preset) return
    const current = tvBoxCounts.get(preset.id) || 0
    tvBoxCounts.set(preset.id, current + getInventoryQuantity(item))
  })

  const paperBundles = Math.max(1, Math.ceil(plannedBoxes / 18))
  const tapeRolls = Math.max(1, Math.ceil(plannedBoxes / 15))
  const stretchWrapRolls = Math.max(1, Math.ceil((plannedBoxes + mattressBagCount + mirrorBoxCount + Array.from(tvBoxCounts.values()).reduce((sum, value) => sum + value, 0) * 2) / 25))
  const lines: PackingMaterialsEstimateLine[] = []

  addLine(lines, 'box-small', smallBoxes)
  addLine(lines, 'box-medium', mediumBoxes)
  addLine(lines, 'box-large', largeBoxes)
  addLine(lines, 'packing-paper', paperBundles)
  addLine(lines, 'tape-roll', tapeRolls)
  addLine(lines, 'stretch-wrap', stretchWrapRolls)
  addLine(lines, 'mattress-bag', mattressBagCount)
  addLine(lines, 'mirror-box', mirrorBoxCount)
  Array.from(tvBoxCounts.entries()).forEach(([presetId, quantity]) => addLine(lines, presetId, quantity))

  const subtotal = roundCurrency(lines.reduce((sum, item) => sum + item.amount, 0))
  const total = roundCurrency(subtotal * 1.13)
  const recommendedBufferBoxes = Math.max(2, Math.ceil(plannedBoxes * 0.1))
  const recommendedDeliveryBoxes = plannedBoxes + recommendedBufferBoxes

  return {
    plannedBoxes,
    recommendedDeliveryBoxes,
    recommendedBufferBoxes,
    source,
    lines,
    subtotal,
    total,
    note: 'Best practice: schedule packing the day before the move, bring about 10% extra standard boxes, and keep the quote based on expected usage.',
    billingNote: 'Quote packing labor separately from materials. Charge for the materials actually used, and credit back any unopened extra boxes or unused sealed supplies.',
  } satisfies PackingMaterialsEstimate
}
