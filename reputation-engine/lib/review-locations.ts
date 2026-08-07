export type ReviewLocation = {
  id: string
  label: string
  businessName: string
  address: string
  city: string
  lat: number
  lng: number
  profileUrl: string
  reviewUrl?: string
}

// Maintained from “_GBP Master (All Locations).xlsx”. Direct review URLs can be
// supplied separately; the workbook currently contains GBP listing URLs only.
export const REVIEW_LOCATIONS: ReviewLocation[] = [
  { id: 'windsor', label: 'Windsor (HQ)', businessName: 'Saturn Star Movers', address: '3608 Seminole Street, Windsor, ON N8Y 1Y4', city: 'Windsor', lat: 42.3170, lng: -82.9742, profileUrl: 'https://share.google/KB9kTQ4svDAl8bVhR', reviewUrl: 'https://g.page/r/CQN6C4RNFOJ0EAI/review' },
  { id: 'waterloo', label: 'Waterloo', businessName: 'Saturn Star Movers', address: '550 Parkside Drive, Waterloo, ON N2L 5V4', city: 'Waterloo', lat: 43.4977, lng: -80.5372, profileUrl: 'https://share.google/l3dV6i6f8GvMgFCQj', reviewUrl: 'https://g.page/r/CWwh2XMwyR82EAI/review' },
  { id: 'chatham', label: 'Chatham', businessName: 'Saturn Star Movers', address: '220 St Clair Street, Chatham, ON N7L 3J8', city: 'Chatham', lat: 42.4100, lng: -82.1950, profileUrl: 'https://share.google/3uVwD80oTcmhuhE5j', reviewUrl: 'https://g.page/r/Cb3uV9Q8h7BYEAI/review' },
  { id: 'guelph', label: 'Guelph', businessName: 'Saturn Star Movers', address: '55 Cedar Drive, Guelph, ON N1G 1C4', city: 'Guelph', lat: 43.5325, lng: -80.2482, profileUrl: 'https://share.google/OkyWGEFBNrtmmSnyj', reviewUrl: 'https://g.page/r/CRd6ZayokyjvEAI/review' },
  { id: 'london', label: 'London', businessName: 'Saturn Star Movers', address: '390 Saskatoon St, Unit 207D, London, ON N5W 4R3', city: 'London', lat: 43.0096, lng: -81.2054, profileUrl: 'https://share.google/ixHVopIrvtokUzIBD', reviewUrl: 'https://g.page/r/CWz51wzoadqNEAI/review' },
  { id: 'ottawa', label: 'Ottawa', businessName: 'Dexa Movers', address: 'Ottawa, ON', city: 'Ottawa', lat: 45.4215, lng: -75.6972, profileUrl: 'https://share.google/SMoRwagOcK268t7jy', reviewUrl: 'https://g.page/r/CZJtKOuOO3V5EAE/review' },
]

const CITY_ALIASES: Record<string, string[]> = {
  windsor: ['windsor', 'lasalle', 'la salle', 'tecumseh', 'amherstburg', 'essex'],
  waterloo: ['waterloo', 'kitchener', 'cambridge', 'breslau', 'elmira', 'st jacobs'],
  chatham: ['chatham', 'chatham kent', 'wallaceburg'],
  guelph: ['guelph', 'fergus', 'elora'],
  london: ['london', 'st thomas', 'woodstock', 'ingersoll'],
  ottawa: ['ottawa', 'kanata', 'nepean', 'orleans', 'barrhaven', 'stittsville'],
}

export function nearestReviewLocationByCoordinates(lat: number, lng: number) {
  return REVIEW_LOCATIONS.reduce((nearest, location) => {
    const latKm = (lat - location.lat) * 111.32
    const meanLat = ((lat + location.lat) / 2) * Math.PI / 180
    const lngKm = (lng - location.lng) * 111.32 * Math.cos(meanLat)
    const distance = Math.hypot(latKm, lngKm)
    return !nearest || distance < nearest.distanceKm ? { location, distanceKm: distance } : nearest
  }, null as { location: ReviewLocation; distanceKm: number } | null)!
}

export function matchReviewLocationFromText(...values: Array<string | undefined>) {
  const text = values.filter(Boolean).join(' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ')
  for (const location of REVIEW_LOCATIONS) {
    if ((CITY_ALIASES[location.id] || [location.city]).some(alias => text.includes(alias.toLowerCase()))) return location
  }
  return undefined
}

export type ReviewLocationLeadSignals = {
  originAddress?: string
  originCity?: string
  listingAddress?: string
  listingCity?: string
  branch?: string
  destAddress?: string
  destCity?: string
}

export function matchReviewLocationForLead(signals: ReviewLocationLeadSignals) {
  return matchReviewLocationFromText(signals.originAddress, signals.originCity)
    || matchReviewLocationFromText(signals.listingAddress, signals.listingCity)
    || matchReviewLocationFromText(signals.branch)
    || matchReviewLocationFromText(signals.destAddress, signals.destCity)
}

export function configuredReviewUrl(location: ReviewLocation) {
  const envKey = `GOOGLE_REVIEW_URL_${location.id.toUpperCase()}`
  return process.env[envKey] || location.reviewUrl || location.profileUrl
}
