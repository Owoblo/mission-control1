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
}

export type PartnerDirectoryCreateInput = Omit<PartnerDirectoryEntry, 'id' | 'stage'>

export function normalizePartnerDirectoryQuery(value: string) {
  return value.trim().replace(/\s+/g, ' ').slice(0, 100)
}

export function partnerDirectoryEntryLabel(entry: PartnerDirectoryEntry) {
  return [entry.name, entry.company, entry.city].filter(Boolean).join(' · ')
}
