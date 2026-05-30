import type { SalesBranch } from './types'

export const DEFAULT_SATURN_BRANCH_NUMBER = '+12267732993'

type SaturnPhoneMetadata = {
  branchLabel: string
  salesBranch: SalesBranch
  trackingLabel?: string
  trackingSource?: string
}

export const SATURN_BRANCH_PHONE_DIRECTORY = {
  '+12267732993': {
    branchLabel: 'Windsor',
    salesBranch: 'windsor',
    trackingLabel: 'Direct Mail',
    trackingSource: 'direct_mail',
  },
  '+12262423319': {
    branchLabel: 'Kitchener',
    salesBranch: 'waterloo',
  },
  '+12266055767': {
    branchLabel: 'Kitchener',
    salesBranch: 'waterloo',
  },
  '+16135193236': {
    branchLabel: 'Ottawa',
    salesBranch: 'ottawa',
  },
  '+15484883245': {
    branchLabel: 'London',
    salesBranch: 'london',
  },
} as const satisfies Record<string, SaturnPhoneMetadata>

export type SaturnBranchPhoneNumber = keyof typeof SATURN_BRANCH_PHONE_DIRECTORY

const SATURN_PRIMARY_BRANCH_NUMBERS: Record<SalesBranch, SaturnBranchPhoneNumber> = {
  windsor: '+12267732993',
  waterloo: '+12262423319',
  ottawa: '+16135193236',
  london: '+15484883245',
}

const SATURN_BRANCH_CITY_ALIASES: Array<{ branch: SalesBranch; patterns: RegExp[] }> = [
  {
    branch: 'windsor',
    patterns: [
      /\bwindsor\b/i,
      /\blasalle\b/i,
      /\btecumseh\b/i,
      /\bamherstburg\b/i,
      /\bkingsville\b/i,
      /\bleamington\b/i,
      /\bharrow\b/i,
      /\bessex\b/i,
      /\bchatham\b/i,
    ],
  },
  {
    branch: 'waterloo',
    patterns: [
      /\bkitchener\b/i,
      /\bwaterloo\b/i,
      /\bcambridge\b/i,
      /\bguelph\b/i,
      /\bkw\b/i,
    ],
  },
  {
    branch: 'london',
    patterns: [
      /\blondon\b/i,
      /\bst\.?\s*thomas\b/i,
      /\bwoodstock\b/i,
      /\bingersoll\b/i,
    ],
  },
  {
    branch: 'ottawa',
    patterns: [
      /\bottawa\b/i,
      /\bkanata\b/i,
      /\bnepean\b/i,
      /\borleans\b/i,
      /\bgloucester\b/i,
      /\bbarrhaven\b/i,
    ],
  },
]

const AREA_CODE_BRANCH_MAP: Partial<Record<string, SalesBranch>> = {
  '343': 'ottawa',
  '548': 'london',
  '613': 'ottawa',
}

export interface SmsMessageLike {
  direction: 'inbound' | 'outbound'
  from_number: string
  to_number: string
}

export function digitsOnly(value?: string | null) {
  return (value || '').replace(/\D/g, '')
}

export function normalizePhone(value?: string | null) {
  const raw = (value || '').trim()
  const digits = digitsOnly(raw)

  if (!digits) {
    return raw.startsWith('+') ? raw : ''
  }

  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return raw.startsWith('+') ? raw : `+${digits}`
}

export function getSaturnBranchPhoneNumbers() {
  return Object.keys(SATURN_BRANCH_PHONE_DIRECTORY) as SaturnBranchPhoneNumber[]
}

export function getDefaultSaturnBranchNumber() {
  return DEFAULT_SATURN_BRANCH_NUMBER
}

export function getSaturnBranchNumberForSalesBranch(branch?: SalesBranch | null) {
  return branch ? SATURN_PRIMARY_BRANCH_NUMBERS[branch] || null : null
}

export function coerceSaturnBranchPhoneNumber(value?: string | null): SaturnBranchPhoneNumber | null {
  const normalized = normalizePhone(value)
  return isSaturnBranchPhoneNumber(normalized) ? normalized : null
}

export function isSaturnBranchPhoneNumber(value?: string | null): value is SaturnBranchPhoneNumber {
  const normalized = normalizePhone(value)
  return !!normalized && Object.prototype.hasOwnProperty.call(SATURN_BRANCH_PHONE_DIRECTORY, normalized)
}

export function pickSaturnBranchPhoneNumber(...candidates: Array<string | null | undefined>) {
  for (const candidate of candidates) {
    const normalized = normalizePhone(candidate)
    if (isSaturnBranchPhoneNumber(normalized)) {
      return normalized
    }
  }

  return DEFAULT_SATURN_BRANCH_NUMBER
}

export function getSaturnBranchLabel(value?: string | null) {
  return getSaturnPhoneMetadata(value)?.branchLabel || ''
}

export function getSalesBranchFromSaturnPhone(value?: string | null): SalesBranch | undefined {
  const normalized = coerceSaturnBranchPhoneNumber(value)
  return normalized ? SATURN_BRANCH_PHONE_DIRECTORY[normalized].salesBranch : undefined
}

export function getSaturnTrackingLabel(value?: string | null) {
  return getSaturnPhoneMetadata(value)?.trackingLabel || ''
}

export function getSaturnTrackingSource(value?: string | null) {
  return getSaturnPhoneMetadata(value)?.trackingSource || ''
}

export function getSaturnDisplayLabel(value?: string | null) {
  const meta = getSaturnPhoneMetadata(value)
  if (!meta) return ''
  return [meta.branchLabel, meta.trackingLabel].filter(Boolean).join(' · ')
}

export function getSaturnPhoneMetadata(value?: string | null) {
  const normalized = coerceSaturnBranchPhoneNumber(value)
  return normalized ? (SATURN_BRANCH_PHONE_DIRECTORY[normalized] as SaturnPhoneMetadata) : undefined
}

export function getSalesBranchFromSaturnLabel(value?: string | null): SalesBranch | undefined {
  const normalized = (value || '').trim().toLowerCase()
  if (!normalized) return undefined
  if (normalized.includes('windsor')) return 'windsor'
  if (normalized.includes('kitchener') || normalized.includes('waterloo') || normalized.includes('kw')) return 'waterloo'
  if (normalized.includes('london')) return 'london'
  if (normalized.includes('ottawa')) return 'ottawa'
  return undefined
}

export function inferSalesBranchFromPhoneAreaCode(value?: string | null): SalesBranch | undefined {
  const digits = digitsOnly(value)
  if (digits.length < 10) return undefined
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits.slice(-10)
  if (national.length !== 10) return undefined
  return AREA_CODE_BRANCH_MAP[national.slice(0, 3)]
}

export function inferSaturnBranchPhoneNumberFromPhone(value?: string | null) {
  return getSaturnBranchNumberForSalesBranch(inferSalesBranchFromPhoneAreaCode(value)) || null
}

export function inferSalesBranchFromCity(value?: string | null): SalesBranch | undefined {
  const text = (value || '').trim()
  if (!text) return undefined

  for (const alias of SATURN_BRANCH_CITY_ALIASES) {
    if (alias.patterns.some(pattern => pattern.test(text))) {
      return alias.branch
    }
  }

  return undefined
}

export function inferSaturnBranchPhoneNumberFromCity(value?: string | null) {
  return getSaturnBranchNumberForSalesBranch(inferSalesBranchFromCity(value)) || null
}

export function getSmsContactPhone(message: SmsMessageLike) {
  return normalizePhone(message.direction === 'inbound' ? message.from_number : message.to_number)
}

export function getSaturnBusinessNumberFromSmsMessage(message: SmsMessageLike) {
  return pickSaturnBranchPhoneNumber(
    message.direction === 'inbound' ? message.to_number : message.from_number
  )
}

export function getSaturnBranchNumberFromRawData(raw?: Record<string, unknown> | string | null) {
  if (!raw || typeof raw === 'string') return null

  const candidates = [
    typeof raw.branchNumber === 'string' ? raw.branchNumber : null,
    typeof raw.to === 'string' ? raw.to : null,
  ]

  if (!candidates.some(Boolean)) return null

  return pickSaturnBranchPhoneNumber(...candidates)
}
