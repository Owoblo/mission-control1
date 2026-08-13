export type PartnerDirectoryEntry = {
  id: string
  name: string
  company?: string
  title?: string
  email?: string
  phone?: string
  city?: string
  category?: string
  industry?: string
  stage?: string
  partnerCompanyId?: string
}

export type PartnerCompanyOption = { id: string; name: string; city?: string; industry?: string }

export type PartnerDirectoryCreateInput = Omit<PartnerDirectoryEntry, 'id' | 'stage'>

export const PARTNER_MUNICIPALITIES = [
  { city: 'Amherstburg', serviceArea: 'Windsor area' },
  { city: 'Belle River', serviceArea: 'Windsor area' },
  { city: 'Essex', serviceArea: 'Windsor area' },
  { city: 'Kingsville', serviceArea: 'Windsor area' },
  { city: 'LaSalle', serviceArea: 'Windsor area' },
  { city: 'Leamington', serviceArea: 'Windsor area' },
  { city: 'Lakeshore', serviceArea: 'Windsor area' },
  { city: 'Tecumseh', serviceArea: 'Windsor area' },
  { city: 'Windsor', serviceArea: 'Windsor area' },
  { city: 'Cambridge', serviceArea: 'Waterloo / KW area' },
  { city: 'Elora', serviceArea: 'Waterloo / KW area' },
  { city: 'Fergus', serviceArea: 'Waterloo / KW area' },
  { city: 'Guelph', serviceArea: 'Waterloo / KW area' },
  { city: 'Kitchener', serviceArea: 'Waterloo / KW area' },
  { city: 'Waterloo', serviceArea: 'Waterloo / KW area' },
  { city: 'Wilmot', serviceArea: 'Waterloo / KW area' },
  { city: 'London', serviceArea: 'London area' },
  { city: 'St. Thomas', serviceArea: 'London area' },
  { city: 'Strathroy', serviceArea: 'London area' },
  { city: 'Woodstock', serviceArea: 'London area' },
  { city: 'Ottawa', serviceArea: 'Ottawa area' },
  { city: 'Gatineau', serviceArea: 'Ottawa area' },
] as const

export function partnerServiceAreaForCity(city?: string) {
  if (!city?.trim()) return ''
  return PARTNER_MUNICIPALITIES.find(
    option => option.city.toLowerCase() === city.trim().toLowerCase()
  )?.serviceArea || 'Outside core service areas'
}

export function normalizePartnerDirectoryQuery(value: string) {
  return value.trim().replace(/\s+/g, ' ').slice(0, 100)
}

export function partnerDirectoryEntryLabel(entry: PartnerDirectoryEntry) {
  return [entry.name, entry.company, entry.city, partnerServiceAreaForCity(entry.city)].filter(Boolean).join(' · ')
}
