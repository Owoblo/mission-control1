export const REFERRAL_INCENTIVE_PER_JOB_CENTS = 5000
export const DEFAULT_DIRECT_MAIL_COST_PER_LETTER_CENTS = 200

export function formatCadFromCents(cents: number, maximumFractionDigits = 0) {
  return (cents / 100).toLocaleString('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits,
  })
}
