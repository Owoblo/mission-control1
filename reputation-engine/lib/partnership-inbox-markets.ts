import gtaCities from '@/lib/data/gta-service-cities.json'
export const WINDSOR_PARTNER_CITY_KEYS = [
  'windsor',
  'lasalle',
  'tecumseh',
  'amherstburg',
  'lakeshore',
  'belle_river',
  'comber',
  'stoney_point',
  'st_joachim',
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
  'chatham_kent',
  'tilbury',
  'wallaceburg',
  'dresden',
  'pain_court',
  'blenheim',
  'merlin',
  'charing_cross',
  'cedar_springs',
  'dealtown',
  'ridgetown',
  'thamesville',
  'bothwell',
  'highgate',
  'morpeth',
  'muirkirk',
  'mitchells_bay',
  'lighthouse_cove',
  'erieau',
  'shrewsbury',
  'erie_beach',
]

export const WATERLOO_PARTNER_CITY_KEYS = [
  'kitchener',
  'waterloo',
  'cambridge',
  'guelph',
  'kitchener_waterloo',
  'elmira',
  'st_jacobs',
  'conestogo',
  'breslau',
  'woolwich',
  'new_hamburg',
  'baden',
  'wellesley',
  'wilmot',
  'ayr',
  'north_dumfries',
  'puslinch',
  'guelph_eramosa',
  'rockwood',
  'fergus',
  'elora',
  'centre_wellington',
  'drayton',
  'mapleton',
  'arthur',
  'palmerston',
  'stratford',
  'listowel',
  'paris',
]

export const LONDON_PARTNER_CITY_KEYS = [
  'london',
  'lucan',
  'lucan_biddulph',
  'ailsa_craig',
  'parkhill',
  'ilderton',
  'north_middlesex',
  'strathroy',
  'strathroy_caradoc',
  'mount_brydges',
  'kerwood',
  'glencoe',
  'newbury',
  'wardsville',
  'adelaide_metcalfe',
  'southwest_middlesex',
  'komoka',
  'middlesex_centre',
  'dorchester',
  'thames_centre',
  'belmont',
  'st_thomas',
  'central_elgin',
  'southwold',
  'talbotville',
  'shedden',
  'fingal',
  'port_stanley',
  'dutton',
  'dutton_dunwich',
  'west_lorne',
  'rodney',
  'aylmer',
  'springfield',
  'malahide',
  'bayham',
  'vienna',
  'port_burwell',
  'st_marys',
  'sarnia',
  'point_edward',
  'brights_grove',
  'camlachie',
  'corunna',
  'mooretown',
  'courtright',
  'sombra',
  'port_lambton',
  'st_clair',
  'dawn_euphemia',
  'petrolia',
  'oil_springs',
  'brigden',
  'wyoming',
  'plympton_wyoming',
  'watford',
  'warwick',
  'alvinston',
  'brooke_alvinston',
  'arkona',
  'forest',
  'thedford',
  'grand_bend',
  'lambton_shores',
  'port_franks',
  'ipperwash',
  'woodstock',
  'ingersoll',
  'beachville',
  'sweaburg',
  'burgessville',
  'otterville',
  'norwich',
  'mount_elgin',
  'courtland',
  'tillsonburg',
  'tavistock',
  'thamesford',
  'innerkip',
  'east_zorra_tavistock',
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

export const OTTAWA_PARTNER_CITY_KEYS = [
  'ottawa',
  'kanata',
  'nepean',
  'orleans',
  'barrhaven',
  'gloucester',
  'stittsville',
  'manotick',
  'rockland',
  'carp',
]

export const TORONTO_PARTNER_CITY_KEYS = [...gtaCities.map(city => city.toLowerCase().replace(/[^a-z0-9]+/g, '_')), 'gta', 'greater_toronto_area']

export const PARTNERSHIP_AREA_GROUPS = [
  { id: 'toronto_area', label: 'Toronto / GTA + Hamilton', cityKeys: TORONTO_PARTNER_CITY_KEYS },
  {
    id: 'windsor_area',
    label: 'Windsor / Essex / Chatham',
    cityKeys: WINDSOR_PARTNER_CITY_KEYS,
  },
  {
    id: 'kwg_area',
    label: 'KWG area',
    cityKeys: WATERLOO_PARTNER_CITY_KEYS,
  },
  {
    id: 'london_area',
    label: 'London / Sarnia / Woodstock',
    cityKeys: LONDON_PARTNER_CITY_KEYS,
  },
  {
    id: 'ottawa_area',
    label: 'Ottawa area',
    cityKeys: OTTAWA_PARTNER_CITY_KEYS,
  },
]

const CITY_LABELS: Record<string, string> = {
  amherstburg: 'Amherstburg',
  belle_river: 'Belle River',
  cambridge: 'Cambridge',
  chatham: 'Chatham',
  chatham_kent: 'Chatham Kent',
  comber: 'Comber',
  cottam: 'Cottam',
  delhi: 'Delhi',
  essex: 'Essex',
  elmira: 'Elmira',
  elora: 'Elora',
  fergus: 'Fergus',
  gatineau: 'Gatineau',
  guelph: 'Guelph',
  harrow: 'Harrow',
  kanata: 'Kanata',
  kingsville: 'Kingsville',
  kitchener: 'Kitchener',
  kitchener_waterloo: 'Kitchener/Waterloo',
  kw: 'KW',
  kwg: 'KW/Guelph',
  lakeshore: 'Lakeshore',
  lasalle: 'LaSalle',
  leamington: 'Leamington',
  london: 'London',
  mcgregor: 'McGregor',
  new_hamburg: 'New Hamburg',
  nepean: 'Nepean',
  orleans: 'Orleans',
  ottawa: 'Ottawa',
  ayr: 'Ayr',
  baden: 'Baden',
  barrhaven: 'Barrhaven',
  gloucester: 'Gloucester',
  london_area: 'London area',
  manotick: 'Manotick',
  sarnia: 'Sarnia',
  st_thomas: 'St. Thomas',
  st_jacobs: 'St. Jacobs',
  st_joachim: 'St. Joachim',
  st_marys: 'St. Marys',
  stittsville: 'Stittsville',
  stoney_point: 'Stoney Point',
  strathroy: 'Strathroy',
  tecumseh: 'Tecumseh',
  waterloo: 'Waterloo',
  windsor: 'Windsor',
  woodstock: 'Woodstock',
}

export function normalizeInboxCity(value: string | null | undefined) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!normalized) return ''
  if (['la_salle', 'lasalle'].includes(normalized)) return 'lasalle'
  if (['chathamkent', 'chatham_kent', 'chatham'].includes(normalized)) return 'chatham_kent'
  if (['kitchener_waterloo', 'kitchener_and_waterloo', 'kw', 'kwg', 'wkg'].includes(normalized)) return 'kitchener_waterloo'
  if (['st_jacobs', 'saint_jacobs'].includes(normalized)) return 'st_jacobs'
  if (['newhamburg', 'new_hamburg'].includes(normalized)) return 'new_hamburg'
  if (['barr_haven', 'barrhaven'].includes(normalized)) return 'barrhaven'
  if (['stoney_pt', 'stoney_point'].includes(normalized)) return 'stoney_point'
  if (['st_thomas', 'saint_thomas'].includes(normalized)) return 'st_thomas'
  if (['st_joachim', 'saint_joachim'].includes(normalized)) return 'st_joachim'
  if (['st_marys', 'saint_marys'].includes(normalized)) return 'st_marys'
  if (['mitchell_s_bay', 'mitchells_bay'].includes(normalized)) return 'mitchells_bay'
  return normalized
}

export function inboxCityLabel(cityKey: string) {
  return CITY_LABELS[cityKey] || cityKey.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase())
}

export function areaForCity(cityKey: string) {
  return PARTNERSHIP_AREA_GROUPS.find(area => area.cityKeys.includes(cityKey))
}


// Inverse aliases of normalizeInboxCity, shared by database filters and tests.
const CITY_ALIASES = [
  ['lasalle', 'la_salle'], ['chatham_kent', 'chathamkent', 'chatham'],
  ['kitchener_waterloo', 'kitchener_and_waterloo', 'kw', 'kwg', 'wkg'],
  ['st_jacobs', 'saint_jacobs'], ['new_hamburg', 'newhamburg'], ['barrhaven', 'barr_haven'],
  ['stoney_point', 'stoney_pt'], ['st_thomas', 'saint_thomas'], ['st_joachim', 'saint_joachim'],
  ['st_marys', 'saint_marys'], ['mitchells_bay', 'mitchell_s_bay'],
]
export function inboxCityPattern(keys: string[]) {
  const normalized = new Set(keys.map(normalizeInboxCity))
  const variants = new Set(normalized)
  for (const aliases of CITY_ALIASES) if (normalized.has(aliases[0])) aliases.forEach(alias => variants.add(alias))
  const patterns = [...variants].map(key => key.split('_and_').map(segment => segment.split('_').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^a-z0-9]+')).join('([^a-z0-9]+and[^a-z0-9]+|[^a-z0-9]*&[^a-z0-9]*)'))
  return `^[^a-z0-9]*(${patterns.join('|')})[^a-z0-9]*$`
}
