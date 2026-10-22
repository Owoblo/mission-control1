import type { PreparedSms } from './prepared-sms'
export type ManifestRow = { phone: string; names: string[]; cities: string[]; categories: string[]; segment: string; sender: string | null; draft: string | null; approved_body_preview?: string | null; holds: string[] }
/** Keep unresolved identity facts; do not turn obsolete preparation placeholders into policy. */
export function preparedManifestRows(rows: ManifestRow[]): PreparedSms[] {
  return rows.filter(r => r.draft).map(r => ({
    phone: r.phone, company: r.names.length === 1 ? r.names[0] : '', city: r.cities.length === 1 ? r.cities[0] : '',
    category: r.segment || '', sender: r.sender || '', body: r.approved_body_preview || r.draft || '',
    reviewReasons: [
      ...r.holds.filter(h => ['multiple_listing_names_for_phone','listing_reports_permanent_closure','missing_category','missing_identity','ocr_requires_verification','crm_identity_or_account_ambiguity'].includes(h)),
      ...(r.cities.length !== 1 ? ['location_ambiguous_or_missing'] : []),
    ],
  }))
}
