export type PackingMaterialPreset = {
  id: string
  label: string
  description: string
  unitPrice: number
  tvMinInches?: number
  tvMaxInches?: number
}

// Seeded from current U-Haul supply pricing with a 10% markup for quoting.
export const PACKING_MATERIAL_PRESETS: PackingMaterialPreset[] = [
  { id: 'box-small', label: 'Small Box', description: 'U-Haul small moving box + 10%', unitPrice: 1.53 },
  { id: 'box-medium', label: 'Medium Box', description: 'U-Haul medium moving box + 10%', unitPrice: 2.24 },
  { id: 'box-large', label: 'Large Box', description: 'U-Haul large moving box + 10%', unitPrice: 2.73 },
  { id: 'tv-box-32', label: 'TV Box · 32–54"', description: 'TV moving box for screens up to 54 inches', unitPrice: 29.95, tvMinInches: 32, tvMaxInches: 54 },
  { id: 'tv-box-55', label: 'TV Box · 55–65"', description: 'TV moving box for 55 to 65 inch screens', unitPrice: 39.95, tvMinInches: 55, tvMaxInches: 65 },
  { id: 'tv-box-70', label: 'TV Box · 70–86"', description: 'Large-format TV moving box for 70 to 86 inch screens', unitPrice: 59.95, tvMinInches: 70, tvMaxInches: 86 },
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
