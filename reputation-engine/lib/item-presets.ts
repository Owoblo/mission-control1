import type { InventoryItem } from './types'

export type InventoryPreset = {
  id: string
  label: string
  room?: string
  item: InventoryItem
}

export const INVENTORY_PRESETS: InventoryPreset[] = [
  { id: 'sofa-standard', label: 'Sofa · Standard', room: 'Living Room', item: { name: 'Sofa', qty: 1, cubicFeet: 70, weightLbs: 140, included: true } },
  { id: 'sofa-large', label: 'Sofa · Large', room: 'Living Room', item: { name: 'Large Sofa', qty: 1, cubicFeet: 95, weightLbs: 185, included: true } },
  { id: 'sectional-small', label: 'Sectional · Small', room: 'Living Room', item: { name: 'Small Sectional', qty: 1, cubicFeet: 110, weightLbs: 240, included: true } },
  { id: 'sectional-large', label: 'Sectional · Large', room: 'Living Room', item: { name: 'Large Sectional', qty: 1, cubicFeet: 160, weightLbs: 320, included: true } },
  { id: 'armchair-standard', label: 'Armchair · Standard', room: 'Living Room', item: { name: 'Armchair', qty: 1, cubicFeet: 20, weightLbs: 45, included: true } },
  { id: 'coffee-table', label: 'Coffee Table', room: 'Living Room', item: { name: 'Coffee Table', qty: 1, cubicFeet: 15, weightLbs: 35, included: true } },
  { id: 'tv-console-large', label: 'TV Console · Large', room: 'Living Room', item: { name: 'Large TV Console', qty: 1, cubicFeet: 35, weightLbs: 95, included: true } },
  { id: 'dining-table-6', label: 'Dining Table · 6 Seat', room: 'Dining Room', item: { name: 'Dining Table', qty: 1, cubicFeet: 45, weightLbs: 110, included: true } },
  { id: 'dining-chair', label: 'Dining Chair', room: 'Dining Room', item: { name: 'Dining Chair', qty: 1, cubicFeet: 5, weightLbs: 15, included: true } },
  { id: 'queen-bed', label: 'Queen Bed Set', room: 'Primary Bedroom', item: { name: 'Queen Bed Set', qty: 1, cubicFeet: 65, weightLbs: 165, included: true } },
  { id: 'king-bed', label: 'King Bed Set', room: 'Primary Bedroom', item: { name: 'King Bed Set', qty: 1, cubicFeet: 80, weightLbs: 210, included: true } },
  { id: 'dresser-long', label: 'Dresser · Long', room: 'Primary Bedroom', item: { name: 'Long Dresser', qty: 1, cubicFeet: 40, weightLbs: 120, included: true } },
  { id: 'dresser-tall', label: 'Dresser · Tall', room: 'Primary Bedroom', item: { name: 'Tall Dresser', qty: 1, cubicFeet: 28, weightLbs: 95, included: true } },
  { id: 'nightstand', label: 'Nightstand', room: 'Primary Bedroom', item: { name: 'Nightstand', qty: 1, cubicFeet: 6, weightLbs: 18, included: true } },
  { id: 'desk-standard', label: 'Desk · Standard', room: 'Office', item: { name: 'Desk', qty: 1, cubicFeet: 25, weightLbs: 65, included: true } },
  { id: 'office-chair', label: 'Office Chair', room: 'Office', item: { name: 'Office Chair', qty: 1, cubicFeet: 10, weightLbs: 22, included: true } },
  { id: 'bookshelf-large', label: 'Bookshelf · Large', room: 'Office', item: { name: 'Large Bookshelf', qty: 1, cubicFeet: 22, weightLbs: 70, included: true } },
  { id: 'freezer-standalone', label: 'Freezer · Standalone', room: 'Basement', item: { name: 'Standalone Freezer', qty: 1, cubicFeet: 35, weightLbs: 180, included: true } },
  { id: 'treadmill', label: 'Treadmill', room: 'Basement', item: { name: 'Treadmill', qty: 1, cubicFeet: 45, weightLbs: 220, included: true } },
  { id: 'elliptical', label: 'Elliptical', room: 'Basement', item: { name: 'Elliptical', qty: 1, cubicFeet: 35, weightLbs: 180, included: true } },
  { id: 'washer-freestanding', label: 'Washer · Freestanding', room: 'Basement', item: { name: 'Washer', qty: 1, cubicFeet: 28, weightLbs: 180, included: true } },
  { id: 'dryer-freestanding', label: 'Dryer · Freestanding', room: 'Basement', item: { name: 'Dryer', qty: 1, cubicFeet: 28, weightLbs: 135, included: true } },
  { id: 'crib', label: 'Crib', room: 'Bedroom', item: { name: 'Crib', qty: 1, cubicFeet: 28, weightLbs: 65, included: true } },
  { id: 'bunk-bed', label: 'Bunk Bed', room: 'Bedroom', item: { name: 'Bunk Bed', qty: 1, cubicFeet: 75, weightLbs: 180, included: true } },
  { id: 'patio-set', label: 'Patio Set', room: 'Outdoor', item: { name: 'Patio Set', qty: 1, cubicFeet: 55, weightLbs: 95, included: true } },
  { id: 'barbecue', label: 'Barbecue', room: 'Outdoor', item: { name: 'Barbecue Grill', qty: 1, cubicFeet: 35, weightLbs: 90, included: true } },
  { id: 'upright-piano', label: 'Piano · Upright', room: 'Living Room', item: { name: 'Upright Piano', qty: 1, cubicFeet: 55, weightLbs: 450, included: true } },
  { id: 'gun-safe', label: 'Safe', room: 'Basement', item: { name: 'Safe', qty: 1, cubicFeet: 18, weightLbs: 350, included: true } },
  { id: 'glass-table', label: 'Glass Table', room: 'Dining Room', item: { name: 'Glass Table', qty: 1, cubicFeet: 30, weightLbs: 85, included: true } },
  { id: 'art-large', label: 'Artwork · Large', room: 'Other', item: { name: 'Large Artwork', qty: 1, cubicFeet: 12, weightLbs: 20, included: true } },
  { id: 'tool-chest', label: 'Tool Chest', room: 'Garage', item: { name: 'Tool Chest', qty: 1, cubicFeet: 30, weightLbs: 160, included: true } },
  { id: 'file-cabinet', label: 'File Cabinet', room: 'Office', item: { name: 'File Cabinet', qty: 1, cubicFeet: 15, weightLbs: 65, included: true } },
  { id: 'bin-stack', label: 'Storage Bins · 5', room: 'Storage', item: { name: 'Storage Bins', qty: 5, cubicFeet: 3, weightLbs: 12, included: true } },
  { id: 'wardrobe-boxes', label: 'Wardrobe Boxes · 4', room: 'Bedroom', item: { name: 'Wardrobe Boxes', qty: 4, cubicFeet: 13, weightLbs: 35, included: true, notes: 'Hanging clothes — avg 35 lbs packed per box' } },

  // ── Boxes (most common add-on — must ask every customer) ──────────────────
  // Weights are average packed weights (not max capacity) for realistic labor estimation
  { id: 'box-small', label: 'Box · Small', room: 'Boxes', item: { name: 'Small Box', qty: 1, cubicFeet: 1.5, weightLbs: 15, included: true, notes: 'Books, dishes, small heavy items — avg 15 lbs packed' } },
  { id: 'box-medium', label: 'Box · Medium', room: 'Boxes', item: { name: 'Medium Box', qty: 1, cubicFeet: 3, weightLbs: 25, included: true, notes: 'Clothes, toys, general household — avg 25 lbs packed' } },
  { id: 'box-large', label: 'Box · Large', room: 'Boxes', item: { name: 'Large Box', qty: 1, cubicFeet: 4.5, weightLbs: 30, included: true, notes: 'Pillows, linens, lightweight bulky items — avg 30 lbs packed' } },
  { id: 'box-xl', label: 'Box · XL', room: 'Boxes', item: { name: 'XL Box', qty: 1, cubicFeet: 6, weightLbs: 25, included: true, notes: 'Oversized lightweight items — avg 25 lbs packed' } },
  { id: 'tv-box-32', label: 'TV Box · 32–54"', room: 'Boxes', item: { name: 'TV Box (32–54 inch)', qty: 1, cubicFeet: 9, weightLbs: 12, included: true, notes: 'TV moving box for smaller flatscreens — wrap included' } },
  { id: 'tv-box-55', label: 'TV Box · 55–65"', room: 'Boxes', item: { name: 'TV Box (55–65 inch)', qty: 1, cubicFeet: 12, weightLbs: 15, included: true, notes: 'Custom TV moving box — wrap included' } },
  { id: 'tv-box-70', label: 'TV Box · 70–86"', room: 'Boxes', item: { name: 'TV Box (70–86 inch)', qty: 1, cubicFeet: 16, weightLbs: 20, included: true, notes: 'Large-screen TV moving box — wrap included' } },
  { id: 'mirror-box', label: 'Mirror / Picture Box', room: 'Boxes', item: { name: 'Mirror Box', qty: 1, cubicFeet: 5, weightLbs: 10, included: true, notes: 'Flat art, mirrors, framed items' } },

  // ── Appliances (customer opt-in — excluded from AI scan by default) ────────
  { id: 'fridge-standard', label: 'Fridge · Standard (add-on)', room: 'Kitchen', item: { name: 'Standard Refrigerator', qty: 1, cubicFeet: 45, weightLbs: 250, included: true, notes: 'Customer confirmed taking fridge — requires dolly and door removal' } },
  { id: 'fridge-large', label: 'Fridge · Large French Door', room: 'Kitchen', item: { name: 'Large French Door Refrigerator', qty: 1, cubicFeet: 60, weightLbs: 320, included: true, notes: 'Large fridge — door removal likely required' } },
  { id: 'stove-freestanding', label: 'Stove · Freestanding', room: 'Kitchen', item: { name: 'Freestanding Stove', qty: 1, cubicFeet: 30, weightLbs: 150, included: true, notes: 'Disconnect from gas/electric before move' } },
  { id: 'dishwasher', label: 'Dishwasher · Freestanding', room: 'Kitchen', item: { name: 'Freestanding Dishwasher', qty: 1, cubicFeet: 22, weightLbs: 80, included: true, notes: 'Freestanding only — not built-in' } },

  // ── Garage ────────────────────────────────────────────────────────────────
  { id: 'lawn-mower-push', label: 'Lawn Mower · Push', room: 'Garage', item: { name: 'Push Lawn Mower', qty: 1, cubicFeet: 15, weightLbs: 65, included: true, notes: 'Drain fuel before loading' } },
  { id: 'lawn-mower-riding', label: 'Lawn Mower · Riding', room: 'Garage', item: { name: 'Riding Lawn Mower', qty: 1, cubicFeet: 55, weightLbs: 400, included: true, notes: 'Specialty item — drain fuel, ramp required' } },
  { id: 'wheelbarrow', label: 'Wheelbarrow', room: 'Garage', item: { name: 'Wheelbarrow', qty: 1, cubicFeet: 10, weightLbs: 35, included: true } },
  { id: 'bicycle', label: 'Bicycle', room: 'Garage', item: { name: 'Bicycle', qty: 1, cubicFeet: 12, weightLbs: 25, included: true, notes: 'Remove pedals, lower seat for packing' } },
  { id: 'garage-shelving', label: 'Garage Shelving Unit', room: 'Garage', item: { name: 'Garage Shelving Unit', qty: 1, cubicFeet: 30, weightLbs: 55, included: true, notes: 'Disassembly required' } },
  { id: 'workbench', label: 'Workbench', room: 'Garage', item: { name: 'Workbench', qty: 1, cubicFeet: 40, weightLbs: 120, included: true } },
  { id: 'storage-cabinet-metal', label: 'Metal Storage Cabinet', room: 'Garage', item: { name: 'Metal Storage Cabinet', qty: 1, cubicFeet: 25, weightLbs: 90, included: true } },

  // ── Outdoor / Misc ────────────────────────────────────────────────────────
  { id: 'hot-tub', label: 'Hot Tub', room: 'Outdoor', item: { name: 'Hot Tub', qty: 1, cubicFeet: 120, weightLbs: 750, included: true, notes: 'Specialty move — drain first, 4 movers minimum, rigging likely required' } },
  { id: 'playground-set', label: 'Playground Set', room: 'Outdoor', item: { name: 'Playground Set', qty: 1, cubicFeet: 80, weightLbs: 200, included: true, notes: 'Full disassembly required' } },
  { id: 'garden-pots', label: 'Large Garden Pots · 5', room: 'Outdoor', item: { name: 'Large Garden Pots', qty: 5, cubicFeet: 4, weightLbs: 30, included: true } },

  // ── Junk / Donation (billable disposal items) ─────────────────────────────
  { id: 'junk-item-large', label: 'Junk Removal · Large Item', room: 'Other', item: { name: 'Junk Removal Item', qty: 1, cubicFeet: 20, weightLbs: 60, included: true, notes: 'Disposal fee applies — confirm with customer' } },
]

export function createInventoryItemFromPreset(preset: InventoryPreset): InventoryItem {
  return {
    id: `inv-${preset.id}-${Date.now()}`,
    room: preset.room || 'Unassigned',
    ...preset.item,
  }
}

export function matchInventoryPreset(name?: string) {
  if (!name) return null
  const normalized = name.toLowerCase().trim()
  return (
    INVENTORY_PRESETS.find(preset => normalized.includes(preset.item.name?.toLowerCase() || '')) ||
    INVENTORY_PRESETS.find(preset => preset.label.toLowerCase().includes(normalized)) ||
    null
  )
}
