import type { SalesBranch } from './types'

export const DEFAULT_SATURN_BRANCH_NUMBER = '+12267732993'

export const SATURN_BRANCH_PHONE_LABELS = {
  '+12267732993': 'Windsor',
  '+12262423319': 'Kitchener',
  '+12266055767': 'Kitchener',
  '+16135193236': 'Ottawa',
  '+15484883245': 'London',
} as const

export type SaturnBranchPhoneNumber = keyof typeof SATURN_BRANCH_PHONE_LABELS

const SATURN_BRANCH_PHONE_TO_SALES_BRANCH: Record<SaturnBranchPhoneNumber, SalesBranch> = {
  '+12267732993': 'windsor',
  '+12262423319': 'waterloo',
  '+12266055767': 'waterloo',
  '+16135193236': 'ottawa',
  '+15484883245': 'london',
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
  return Object.keys(SATURN_BRANCH_PHONE_LABELS) as SaturnBranchPhoneNumber[]
}

export function getDefaultSaturnBranchNumber() {
  return DEFAULT_SATURN_BRANCH_NUMBER
}

export function coerceSaturnBranchPhoneNumber(value?: string | null): SaturnBranchPhoneNumber | null {
  const normalized = normalizePhone(value)
  return isSaturnBranchPhoneNumber(normalized) ? normalized : null
}

export function isSaturnBranchPhoneNumber(value?: string | null): value is SaturnBranchPhoneNumber {
  const normalized = normalizePhone(value)
  return !!normalized && Object.prototype.hasOwnProperty.call(SATURN_BRANCH_PHONE_LABELS, normalized)
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
  const normalized = normalizePhone(value)
  return isSaturnBranchPhoneNumber(normalized)
    ? SATURN_BRANCH_PHONE_LABELS[normalized]
    : ''
}

export function getSalesBranchFromSaturnPhone(value?: string | null): SalesBranch | undefined {
  const normalized = coerceSaturnBranchPhoneNumber(value)
  return normalized ? SATURN_BRANCH_PHONE_TO_SALES_BRANCH[normalized] : undefined
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

  return pickSaturnBranchPhoneNumber(...candidates)
}
