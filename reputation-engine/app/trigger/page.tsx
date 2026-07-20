import { redirect } from 'next/navigation'

/**
 * Legacy completion entry point.
 *
 * Job completion now belongs to the canonical Operations job spine so a
 * second review-only record cannot disagree with the booked job, payment,
 * crew closeout, or customer-care state.
 */
export default function LegacyTriggerRedirect() {
  redirect('/sales/operations?focus=completion')
}
