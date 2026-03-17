import type { CRMLead } from '@/lib/types'

const MOVE_TYPES = new Set<NonNullable<CRMLead['moveType']>>([
  'residential',
  'long-distance',
  'commercial',
  'senior',
  'labor-only',
  'packing',
])

export function normalizePhone(value?: string) {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed
}

export function normalizeEmail(value?: string) {
  if (!value) return undefined
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return undefined
  return trimmed
}

export function validateMoveType(value?: string): CRMLead['moveType'] | undefined {
  if (!value) return undefined
  if (!MOVE_TYPES.has(value as NonNullable<CRMLead['moveType']>)) {
    throw new Error('Invalid move type')
  }
  return value as CRMLead['moveType']
}

export function validateLeadPayload(payload: Partial<CRMLead>) {
  if (!payload.name?.trim()) {
    throw new Error('Lead name is required')
  }

  const phone = normalizePhone(payload.phone)
  const email = normalizeEmail(payload.email)
  if (!phone && !email) {
    throw new Error('At least a phone or email is required')
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Invalid email address')
  }

  if (payload.moveDate && Number.isNaN(new Date(payload.moveDate).getTime())) {
    throw new Error('Invalid move date')
  }

  if (payload.followUpDate && Number.isNaN(new Date(payload.followUpDate).getTime())) {
    throw new Error('Invalid follow-up date')
  }

  return {
    name: payload.name.trim(),
    phone,
    email,
    moveType: validateMoveType(payload.moveType),
  }
}
