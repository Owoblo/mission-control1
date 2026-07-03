export type PartnershipMarket = 'windsor' | 'waterloo' | 'london' | 'ottawa'

export type PartnershipLine = {
  number: string
  label: string
  market: PartnershipMarket
  cityKeys: string[]
  primary?: boolean
}

export const PARTNERSHIP_LINES: PartnershipLine[] = [
  {
    number: '+12268870667',
    label: 'Windsor Partnership',
    market: 'windsor',
    cityKeys: ['windsor', 'essex', 'lasalle', 'tecumseh', 'amherstburg', 'kingsville', 'leamington', 'chatham'],
    primary: true,
  },
  {
    number: '+12266055008',
    label: 'Windsor Partnership 2',
    market: 'windsor',
    cityKeys: ['windsor', 'essex', 'lasalle', 'tecumseh', 'amherstburg', 'kingsville', 'leamington', 'chatham'],
  },
  {
    number: '+12262419853',
    label: 'Kitchener / Waterloo Partnership',
    market: 'waterloo',
    cityKeys: ['kitchener', 'waterloo', 'cambridge', 'guelph', 'kw', 'kitchener-waterloo'],
    primary: true,
  },
  {
    number: '+15486391428',
    label: 'London Partnership',
    market: 'london',
    cityKeys: ['london', 'st-thomas', 'st thomas', 'woodstock', 'stratford', 'sarnia'],
    primary: true,
  },
  {
    number: '+15482908695',
    label: 'Ottawa Partnership',
    market: 'ottawa',
    cityKeys: ['ottawa', 'kanata', 'nepean', 'orleans', 'gatineau'],
    primary: true,
  },
]

export const TEMP_PARTNERSHIP_SALES_RECOVERY_NUMBER = '+12267732993'

export const DEFAULT_PARTNERSHIP_SENDER_NUMBERS = PARTNERSHIP_LINES.map(line => line.number)

export const PARTNERSHIP_REPLY_SENDER_NUMBERS = [
  ...DEFAULT_PARTNERSHIP_SENDER_NUMBERS,
  TEMP_PARTNERSHIP_SALES_RECOVERY_NUMBER,
]

export const DEFAULT_PARTNERSHIP_FROM_NUMBER =
  PARTNERSHIP_LINES.find(line => line.market === 'windsor' && line.primary)?.number ||
  PARTNERSHIP_LINES[0]?.number ||
  '+12268870667'

export const DEFAULT_PARTNERSHIP_EMAIL = 'partnerships@starmovers.ca'

export function normalizePartnershipCityKey(value?: string | null) {
  return (value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function getPartnershipLinesForMarket(market?: string | null) {
  const key = normalizePartnershipCityKey(market)
  const exactMarket = PARTNERSHIP_LINES.filter(line => line.market === key)
  if (exactMarket.length > 0) return exactMarket

  const cityMatch = PARTNERSHIP_LINES.filter(line =>
    line.cityKeys.some(cityKey => {
      const city = normalizePartnershipCityKey(cityKey)
      return city === key || (!!key && key.includes(city)) || (!!city && city.includes(key))
    })
  )
  if (cityMatch.length > 0) return cityMatch

  return PARTNERSHIP_LINES.filter(line => line.market === 'windsor')
}

export function getPartnershipSenderNumbersForMarket(market?: string | null) {
  return getPartnershipLinesForMarket(market).map(line => line.number)
}

export function getPartnershipPrimaryNumberForMarket(market?: string | null) {
  const lines = getPartnershipLinesForMarket(market)
  return lines.find(line => line.primary)?.number || lines[0]?.number || DEFAULT_PARTNERSHIP_FROM_NUMBER
}

export function getPartnershipLineLabel(number?: string | null) {
  const line = PARTNERSHIP_LINES.find(item => item.number === number)
  return line?.label || 'Partnership line'
}

export function isPartnershipSenderNumber(number?: string | null, options?: { includeRecovery?: boolean }) {
  const allowed = options?.includeRecovery ? PARTNERSHIP_REPLY_SENDER_NUMBERS : DEFAULT_PARTNERSHIP_SENDER_NUMBERS
  return !!number && allowed.includes(number)
}
