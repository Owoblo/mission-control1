// Partner outreach taxonomy — categories, tiers, and service areas
// Tier 1: High-frequency referral sources (priority outreach)
// Tier 2: Commercial/institutional (slower burn, higher ticket)
// Tier 3: Community relationship partners (brand/trust plays)

export const SERVICE_AREAS = [
  { id: 'windsor',   label: 'Windsor',          province: 'ON', areaCode: '226' },
  { id: 'london',    label: 'London',            province: 'ON', areaCode: '519' },
  { id: 'kitchener', label: 'Kitchener/Waterloo', province: 'ON', areaCode: '519' },
  { id: 'ottawa',    label: 'Ottawa',             province: 'ON', areaCode: '613' },
] as const

export type ServiceArea = typeof SERVICE_AREAS[number]['id']

export interface PartnerCategory {
  id: string
  label: string
  tier: 1 | 2 | 3
  icon: string
  description: string
  color: string        // Tailwind badge classes
  suggestedScript: string  // Opening line for cold call
}

export const PARTNER_CATEGORIES: Record<string, PartnerCategory> = {

  // ─── Tier 1: High-Frequency Referral Sources ─────────────────────────────

  realtor: {
    id: 'realtor',
    label: 'Realtor',
    tier: 1,
    icon: '🏠',
    description: 'Individual real estate agents — closest to buying/selling decisions',
    color: 'border-amber-200 bg-amber-50 text-amber-800',
    suggestedScript: 'Hi, I\'m calling from Saturn Star Movers — we work with realtors in the area to make client moves seamless. Do you have clients who ever need reliable movers?',
  },

  brokerage: {
    id: 'brokerage',
    label: 'Brokerage',
    tier: 1,
    icon: '🏢',
    description: 'Real estate brokerages — one relationship reaches multiple agents',
    color: 'border-orange-200 bg-orange-50 text-orange-800',
    suggestedScript: 'Hi, I\'m calling from Saturn Star Movers — we\'d love to set up a preferred mover relationship with your brokerage so your agents always have someone to refer.',
  },

  property_manager: {
    id: 'property_manager',
    label: 'Property Manager',
    tier: 1,
    icon: '🏗',
    description: 'Property managers & apartment complexes — frequent tenant turnover',
    color: 'border-blue-200 bg-blue-50 text-blue-800',
    suggestedScript: 'Hi, I\'m with Saturn Star Movers — we know tenant turnover means a lot of moves. We\'d love to be your go-to referral for tenants who need help.',
  },

  mortgage_broker: {
    id: 'mortgage_broker',
    label: 'Mortgage Broker',
    tier: 1,
    icon: '💰',
    description: 'Mortgage brokers — see every home purchase before closing',
    color: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    suggestedScript: 'Hi, I\'m from Saturn Star Movers — every client you close needs to move. We\'d love to be the moving company you recommend.',
  },

  interior_designer: {
    id: 'interior_designer',
    label: 'Interior Designer',
    tier: 1,
    icon: '🎨',
    description: 'Interior designers — often involved during moves and renovations',
    color: 'border-purple-200 bg-purple-50 text-purple-800',
    suggestedScript: 'Hi, I\'m with Saturn Star Movers — we work with interior designers whose clients are staging or moving. Would you be open to referring us?',
  },

  professional_organizer: {
    id: 'professional_organizer',
    label: 'Professional Organizer',
    tier: 1,
    icon: '📦',
    description: 'Professional organizers — work alongside moving projects',
    color: 'border-teal-200 bg-teal-50 text-teal-800',
    suggestedScript: 'Hi, I\'m with Saturn Star Movers — we know organizers often get called in around moves. We\'d love to be the movers you recommend to your clients.',
  },

  storage_facility: {
    id: 'storage_facility',
    label: 'Storage Facility',
    tier: 1,
    icon: '🗄',
    description: 'Storage facilities — customers moving in/out of storage need movers',
    color: 'border-slate-200 bg-slate-50 text-slate-700',
    suggestedScript: 'Hi, I\'m from Saturn Star Movers — your customers moving items in or out of storage often need help. We\'d love to be your preferred referral.',
  },

  home_improvement: {
    id: 'home_improvement',
    label: 'Home Improvement',
    tier: 1,
    icon: '🔧',
    description: 'Home improvement & hardware stores — local moving traffic',
    color: 'border-yellow-200 bg-yellow-50 text-yellow-800',
    suggestedScript: 'Hi, I\'m with Saturn Star Movers — customers buying renovation supplies are often moving too. We\'d love to leave some cards or set up a referral.',
  },

  // ─── Tier 2: Commercial & Institutional ──────────────────────────────────

  contractor: {
    id: 'contractor',
    label: 'Renovation Contractor',
    tier: 2,
    icon: '🔨',
    description: 'Renovation contractors — clients often need to move during renos',
    color: 'border-sky-200 bg-sky-50 text-sky-700',
    suggestedScript: 'Hi, I\'m from Saturn Star Movers — homeowners doing major renos often need to move out temporarily. We\'d love to be who you recommend.',
  },

  home_stager: {
    id: 'home_stager',
    label: 'Home Stager',
    tier: 2,
    icon: '🛋',
    description: 'Home stagers — work on listings that are about to sell',
    color: 'border-rose-200 bg-rose-50 text-rose-700',
    suggestedScript: 'Hi, I\'m with Saturn Star Movers — homes you stage are about to sell. The sellers will need movers and so will the buyers. Can we set up a referral?',
  },

  cleaning_company: {
    id: 'cleaning_company',
    label: 'Cleaning Company',
    tier: 2,
    icon: '🧹',
    description: 'Cleaning companies — move-in/out cleans always follow moves',
    color: 'border-cyan-200 bg-cyan-50 text-cyan-700',
    suggestedScript: 'Hi, I\'m from Saturn Star Movers — we both work on move-in and move-out jobs. Would you be open to referring each other?',
  },

  corporate: {
    id: 'corporate',
    label: 'Corporate / HR Relocation',
    tier: 2,
    icon: '💼',
    description: 'HR departments & relocation companies — employee moves',
    color: 'border-indigo-200 bg-indigo-50 text-indigo-700',
    suggestedScript: 'Hi, I\'m with Saturn Star Movers — we specialize in corporate relocations and would love to be your preferred vendor for employee moves.',
  },

  school: {
    id: 'school',
    label: 'School / College',
    tier: 2,
    icon: '🎓',
    description: 'Schools and colleges — student move-in/out seasonally',
    color: 'border-violet-200 bg-violet-50 text-violet-700',
    suggestedScript: 'Hi, I\'m from Saturn Star Movers — we know you deal with a lot of student moves each semester. We\'d love to be the company you recommend.',
  },

  // ─── Tier 3: Community Relationship Partners ─────────────────────────────

  church: {
    id: 'church',
    label: 'Church / Faith Community',
    tier: 3,
    icon: '⛪',
    description: 'Churches and faith communities — congregation members move frequently',
    color: 'border-slate-200 bg-slate-50 text-slate-600',
    suggestedScript: 'Hi, I\'m with Saturn Star Movers — we\'d love to support your community by offering members a preferred rate and being someone you can recommend.',
  },

  nonprofit: {
    id: 'nonprofit',
    label: 'Community Nonprofit',
    tier: 3,
    icon: '🤝',
    description: 'Community nonprofits — local trust and referral network',
    color: 'border-slate-200 bg-slate-50 text-slate-600',
    suggestedScript: 'Hi, I\'m from Saturn Star Movers — we love supporting community organizations. Would you be open to a referral partnership?',
  },

  cultural_association: {
    id: 'cultural_association',
    label: 'Cultural Association',
    tier: 3,
    icon: '🌍',
    description: 'Cultural and immigrant associations — newcomers frequently need movers',
    color: 'border-slate-200 bg-slate-50 text-slate-600',
    suggestedScript: 'Hi, I\'m with Saturn Star Movers — newcomers to the community often need moving help. We\'d love to be someone your association can recommend.',
  },
}

// All categories sorted by tier then label
export const CATEGORY_LIST = Object.values(PARTNER_CATEGORIES)
  .sort((a, b) => a.tier - b.tier || a.label.localeCompare(b.label))

// Tier 1 categories only (for default outreach priority)
export const TIER1_CATEGORIES = CATEGORY_LIST.filter(c => c.tier === 1)

// Get tier from category id
export function getCategoryTier(categoryId: string): 1 | 2 | 3 {
  return PARTNER_CATEGORIES[categoryId]?.tier ?? 1
}

// Get category meta
export function getCategoryMeta(categoryId: string | null | undefined): PartnerCategory | null {
  if (!categoryId) return null
  return PARTNER_CATEGORIES[categoryId] ?? null
}

// Build a batch name suggestion
export function suggestBatchName(city: string, categoryId: string): string {
  const cat = PARTNER_CATEGORIES[categoryId]
  const area = SERVICE_AREAS.find(a => a.id === city)
  if (!cat || !area) return ''
  const now = new Date()
  const quarter = `Q${Math.ceil((now.getMonth() + 1) / 3)} ${now.getFullYear()}`
  return `${area.label} ${cat.label}s — ${quarter}`
}
