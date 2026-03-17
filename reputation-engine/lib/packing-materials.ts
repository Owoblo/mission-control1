export type PackingMaterialPreset = {
  id: string
  label: string
  description: string
  unitPrice: number
}

// Seeded from current U-Haul supply pricing with a 10% markup for quoting.
export const PACKING_MATERIAL_PRESETS: PackingMaterialPreset[] = [
  { id: 'box-small', label: 'Small Box', description: 'U-Haul small moving box + 10%', unitPrice: 1.53 },
  { id: 'box-medium', label: 'Medium Box', description: 'U-Haul medium moving box + 10%', unitPrice: 2.24 },
  { id: 'box-large', label: 'Large Box', description: 'U-Haul large moving box + 10%', unitPrice: 2.73 },
  { id: 'box-wardrobe', label: 'Wardrobe Box', description: 'U-Haul wardrobe box + 10%', unitPrice: 23.65 },
  { id: 'packing-paper', label: 'Packing Paper Bundle', description: 'U-Haul packing paper bundle + 10%', unitPrice: 18.65 },
  { id: 'tape-roll', label: 'Tape Roll', description: 'U-Haul packing tape + 10%', unitPrice: 7.98 },
  { id: 'mattress-bag', label: 'Mattress Bag', description: 'U-Haul mattress bag + 10%', unitPrice: 10.95 },
  { id: 'stretch-wrap', label: 'Stretch Wrap', description: 'U-Haul stretch wrap + 10%', unitPrice: 12.08 },
  { id: 'recbox-bin', label: 'Reusable Moving Bin', description: 'U-Haul RecBox reusable bin + 10%', unitPrice: 16.45 },
]
