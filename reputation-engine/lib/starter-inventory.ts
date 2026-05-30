import {
  PROPERTY_BEDROOM_OPTIONS,
  PROPERTY_TYPE_OPTIONS,
} from './sales'
import { INVENTORY_PRESETS, createInventoryItemFromPreset } from './item-presets'
import type { CRMLead, InventoryItem } from './types'

type StarterPresetSpec = {
  id: string
  qty?: number
}

export type StarterInventoryPlan = {
  title: string
  summary: string
  items: InventoryItem[]
  warnings: string[]
}

const PRESET_BY_ID = new Map(INVENTORY_PRESETS.map(preset => [preset.id, preset]))

function labelForBedroom(value?: CRMLead['propertyBedrooms']) {
  return PROPERTY_BEDROOM_OPTIONS.find(option => option.id === value)?.label || 'Home'
}

function labelForPropertyType(value?: CRMLead['propertyType']) {
  return PROPERTY_TYPE_OPTIONS.find(option => option.id === value)?.label || 'move'
}

function buildItems(specs: StarterPresetSpec[]) {
  return specs.flatMap(spec => {
    const preset = PRESET_BY_ID.get(spec.id)
    if (!preset) return []
    const item = createInventoryItemFromPreset(preset)
    item.qty = Math.max(1, Number(spec.qty || 1))
    return [item]
  })
}

function residentialPresetSpecs(bedrooms: NonNullable<CRMLead['propertyBedrooms']>, propertyType?: CRMLead['propertyType']) {
  const specs: StarterPresetSpec[] = []

  const add = (id: string, qty = 1) => specs.push({ id, qty })

  if (bedrooms === 'studio') {
    add('sofa-loveseat')
    add('coffee-table-sm')
    add('tv-stand-sm')
    add('full-bed')
    add('mattress-full')
    add('nightstand')
    add('dresser-sm')
    add('box-medium', 8)
    add('box-large', 4)
    add('wardrobe-box')
    add('dish-box')
  } else if (bedrooms === '1_bedroom') {
    add('sofa-standard')
    add('coffee-table-med')
    add('tv-stand-med')
    add('queen-bed')
    add('mattress-queen')
    add('nightstand', 2)
    add('dresser-med')
    add('dining-table-4')
    add('dining-chair', 4)
    add('box-medium', 12)
    add('box-large', 6)
    add('wardrobe-box', 2)
    add('dish-box', 2)
  } else if (bedrooms === '2_bedrooms') {
    add('sofa-standard')
    add('coffee-table-med')
    add('tv-stand-med')
    add('queen-bed')
    add('mattress-queen')
    add('full-bed')
    add('mattress-full')
    add('nightstand', 3)
    add('dresser-med')
    add('dresser-sm')
    add('dining-table-4')
    add('dining-chair', 4)
    add('box-medium', 18)
    add('box-large', 8)
    add('wardrobe-box', 3)
    add('dish-box', 2)
  } else if (bedrooms === '3_bedrooms') {
    add('sofa-large')
    add('coffee-table-med')
    add('tv-stand-lg')
    add('queen-bed')
    add('mattress-queen')
    add('full-bed')
    add('mattress-full')
    add('twin-bed')
    add('mattress-single')
    add('nightstand', 4)
    add('dresser-med', 2)
    add('dresser-sm')
    add('dining-table-6')
    add('dining-chair', 6)
    add('box-medium', 26)
    add('box-large', 12)
    add('wardrobe-box', 5)
    add('dish-box', 3)
  } else if (bedrooms === '4_bedrooms') {
    add('sectional-4seat')
    add('coffee-table-lg')
    add('tv-console-large')
    add('king-bed')
    add('mattress-king')
    add('queen-bed')
    add('mattress-queen', 2)
    add('full-bed')
    add('mattress-full')
    add('nightstand', 6)
    add('dresser-med', 2)
    add('dresser-lg', 2)
    add('dining-table-8')
    add('dining-chair', 8)
    add('box-medium', 34)
    add('box-large', 16)
    add('wardrobe-box', 6)
    add('dish-box', 4)
  } else {
    add('sectional-large')
    add('sofa-loveseat')
    add('coffee-table-lg')
    add('tv-console-large')
    add('king-bed')
    add('mattress-king', 2)
    add('queen-bed')
    add('mattress-queen', 2)
    add('full-bed')
    add('mattress-full')
    add('nightstand', 8)
    add('dresser-lg', 3)
    add('dresser-med', 2)
    add('dining-table-8')
    add('dining-chair', 8)
    add('box-medium', 42)
    add('box-large', 20)
    add('wardrobe-box', 8)
    add('dish-box', 5)
  }

  if (propertyType === 'townhouse' || propertyType === 'detached_house') {
    add('barbecue')
    add('patio-set')
  }

  if ((propertyType === 'detached_house' || propertyType === 'townhouse') && bedrooms !== 'studio' && bedrooms !== '1_bedroom') {
    add('tool-chest-sm')
    add('garage-shelving')
  }

  return specs
}

function commercialPresetSpecs() {
  return [
    { id: 'desk-standard', qty: 4 },
    { id: 'office-chair', qty: 6 },
    { id: 'file-cab-4v', qty: 2 },
    { id: 'bookshelf-med', qty: 2 },
    { id: 'printer-med' },
    { id: 'monitor-lg', qty: 4 },
    { id: 'box-medium', qty: 18 },
    { id: 'box-large', qty: 8 },
  ]
}

function storagePresetSpecs() {
  return [
    { id: 'box-medium', qty: 18 },
    { id: 'box-large', qty: 10 },
    { id: 'dresser-med' },
    { id: 'mattress-queen' },
    { id: 'bookshelf-med' },
    { id: 'tool-chest-sm' },
  ]
}

export function buildStarterInventoryPlan(input: {
  bedrooms?: CRMLead['propertyBedrooms']
  propertyType?: CRMLead['propertyType']
}) {
  const { bedrooms, propertyType } = input
  if (!propertyType) return null

  let specs: StarterPresetSpec[] = []

  if (propertyType === 'commercial') {
    specs = commercialPresetSpecs()
  } else if (propertyType === 'storage_unit') {
    specs = storagePresetSpecs()
  } else if (bedrooms) {
    specs = residentialPresetSpecs(bedrooms, propertyType)
  } else {
    return null
  }

  const items = buildItems(specs)
  const warnings = [
    'Confirm special handling separately: piano, pool table, safe, antique furniture, and wall-mounted TVs.',
  ]

  if (propertyType === 'apartment' || propertyType === 'condo') {
    warnings.push('Confirm elevator access and reservation at origin and destination.')
  }

  return {
    title: `${labelForBedroom(bedrooms)} ${labelForPropertyType(propertyType)} starter list`,
    summary: `${items.length} typical line items added as a starting point. Reps can adjust quantities before sending the quote.`,
    items,
    warnings,
  } satisfies StarterInventoryPlan
}

export function mergeStarterInventory(existing: InventoryItem[], starterItems: InventoryItem[]) {
  const seen = new Set(
    existing.map(item => `${(item.room || '').trim().toLowerCase()}::${(item.name || item.item || '').trim().toLowerCase()}`)
  )

  const additions = starterItems.filter(item => {
    const key = `${(item.room || '').trim().toLowerCase()}::${(item.name || item.item || '').trim().toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return [...existing, ...additions]
}
