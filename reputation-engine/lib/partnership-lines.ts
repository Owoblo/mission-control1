export type PartnershipMarket = 'windsor' | 'waterloo' | 'london' | 'ottawa'

export type PartnershipLine = {
  number: string
  label: string
  market: PartnershipMarket
  cityKeys: string[]
  primary?: boolean
}

const WINDSOR_ESSEX_AND_CHATHAM_CITIES = [
  'windsor',
  'lasalle',
  'la salle',
  'tecumseh',
  'amherstburg',
  'lakeshore',
  'belle river',
  'comber',
  'stoney point',
  'st. joachim',
  'st joachim',
  'puce',
  'emeryville',
  'anderdon',
  'leamington',
  'kingsville',
  'essex',
  'harrow',
  'mcgregor',
  'cottam',
  'ruthven',
  'colchester',
  'maidstone',
  'wheatley',
  'chatham',
  'chatham kent',
  'chatham-kent',
  'tilbury',
  'wallaceburg',
  'dresden',
  'pain court',
  'blenheim',
  'merlin',
  'charing cross',
  'cedar springs',
  'dealtown',
  'ridgetown',
  'thamesville',
  'bothwell',
  'highgate',
  'morpeth',
  'muirkirk',
  "mitchell's bay",
  'mitchells bay',
  'lighthouse cove',
  'erieau',
  'shrewsbury',
  'erie beach',
]

const WATERLOO_KWG_CITIES = [
  'kitchener',
  'waterloo',
  'cambridge',
  'guelph',
  'kw',
  'k w',
  'kwc',
  'kwg',
  'wkg',
  'kitchener waterloo',
  'kitchener-waterloo',
  'kitchener and waterloo',
  'elmira',
  'st jacobs',
  'st. jacobs',
  'conestogo',
  'breslau',
  'woolwich',
  'new hamburg',
  'baden',
  'wellesley',
  'wilmot',
  'ayr',
  'north dumfries',
  'puslinch',
  'guelph eramosa',
  'guelph-eramosa',
  'rockwood',
  'fergus',
  'elora',
  'centre wellington',
  'drayton',
  'mapleton',
  'arthur',
  'palmerston',
  'stratford',
  'listowel',
  'paris',
]

const LONDON_MIDDLESEX_SARNIA_WOODSTOCK_CITIES = [
  'london',
  'lucan',
  'lucan biddulph',
  'ailsa craig',
  'parkhill',
  'ilderton',
  'north middlesex',
  'strathroy',
  'strathroy-caradoc',
  'mount brydges',
  'kerwood',
  'glencoe',
  'newbury',
  'wardsville',
  'adelaide-metcalfe',
  'southwest middlesex',
  'komoka',
  'middlesex centre',
  'dorchester',
  'thames centre',
  'belmont',
  'st thomas',
  'st. thomas',
  'st-thomas',
  'central elgin',
  'southwold',
  'talbotville',
  'shedden',
  'fingal',
  'port stanley',
  'dutton',
  'dutton-dunwich',
  'west lorne',
  'rodney',
  'aylmer',
  'springfield',
  'malahide',
  'bayham',
  'vienna',
  'port burwell',
  'st marys',
  'st. marys',
  'sarnia',
  'point edward',
  'brights grove',
  'camlachie',
  'corunna',
  'mooretown',
  'courtright',
  'sombra',
  'port lambton',
  'st clair',
  'st. clair',
  'dawn-euphemia',
  'petrolia',
  'oil springs',
  'brigden',
  'wyoming',
  'plympton-wyoming',
  'watford',
  'warwick',
  'alvinston',
  'brooke-alvinston',
  'arkona',
  'forest',
  'thedford',
  'grand bend',
  'lambton shores',
  'port franks',
  'ipperwash',
  'woodstock',
  'ingersoll',
  'beachville',
  'sweaburg',
  'burgessville',
  'otterville',
  'norwich',
  'mount elgin',
  'courtland',
  'tillsonburg',
  'tavistock',
  'thamesford',
  'innerkip',
  'east zorra-tavistock',
  'embro',
  'hickson',
  'kintore',
  'zorra',
  'drumbo',
  'princeton',
  'plattsville',
  'bright',
  'delhi',
]

const OTTAWA_CITIES = [
  'ottawa',
  'kanata',
  'nepean',
  'orleans',
  'orléans',
  'barrhaven',
  'gloucester',
  'stittsville',
  'manotick',
  'rockland',
  'carp',
]

export const PARTNERSHIP_LINES: PartnershipLine[] = [
  {
    number: '+12268870667',
    label: 'Windsor Partnership',
    market: 'windsor',
    cityKeys: WINDSOR_ESSEX_AND_CHATHAM_CITIES,
    primary: true,
  },
  {
    number: '+12266055008',
    label: 'Windsor Partnership 2',
    market: 'windsor',
    cityKeys: WINDSOR_ESSEX_AND_CHATHAM_CITIES,
  },
  {
    number: '+12262419853',
    label: 'Kitchener / Waterloo Partnership',
    market: 'waterloo',
    cityKeys: WATERLOO_KWG_CITIES,
    primary: true,
  },
  {
    number: '+15486391428',
    label: 'London Partnership',
    market: 'london',
    cityKeys: LONDON_MIDDLESEX_SARNIA_WOODSTOCK_CITIES,
    primary: true,
  },
  {
    number: '+15482908695',
    label: 'Ottawa Partnership',
    market: 'ottawa',
    cityKeys: OTTAWA_CITIES,
    primary: true,
  },
]

export const TEMP_PARTNERSHIP_SALES_RECOVERY_NUMBER = '+12267732993'

export const ALL_PARTNERSHIP_SENDER_NUMBERS = PARTNERSHIP_LINES.map(line => line.number)

export const DEFAULT_PARTNERSHIP_SENDER_NUMBERS = PARTNERSHIP_LINES
  .filter(line => line.primary)
  .map(line => line.number)

export const PARTNERSHIP_REPLY_SENDER_NUMBERS = [
  ...ALL_PARTNERSHIP_SENDER_NUMBERS,
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

export function getPartnershipSenderNumbersForMarket(
  market?: string | null,
  options?: { includeSecondary?: boolean },
) {
  const lines = getPartnershipLinesForMarket(market)
  if (options?.includeSecondary) return lines.map(line => line.number)
  const primaryLines = lines.filter(line => line.primary)
  return (primaryLines.length > 0 ? primaryLines : lines).map(line => line.number)
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
  const allowed = options?.includeRecovery ? PARTNERSHIP_REPLY_SENDER_NUMBERS : ALL_PARTNERSHIP_SENDER_NUMBERS
  return !!number && allowed.includes(number)
}
