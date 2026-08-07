import type { CRMLead } from './types'

export function isPastReviewCustomer(lead: Pick<CRMLead, 'stage' | 'moveDate'>, today = new Date()) {
  if (lead.stage === 'completed' || lead.stage === 'customer_success') return true
  if (lead.stage !== 'booked' || !lead.moveDate) return false
  const moveDate = new Date(`${lead.moveDate.slice(0, 10)}T23:59:59`)
  return !Number.isNaN(moveDate.getTime()) && moveDate.getTime() <= today.getTime()
}

export function normalizedReviewContact(value?: string) {
  return (value || '').trim().toLowerCase().replace(/[^a-z0-9@.]+/g, '')
}
