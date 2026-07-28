import { requireSupabaseEnv } from '@/lib/server/runtime'

export type RelationshipContactMatch = {
  id: string
  name?: string | null
  company?: string | null
  category?: string | null
  phone?: string | null
}

function phoneDigits(value?: string | null) {
  const digits = String(value || '').replace(/\D/g, '')
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
}

export async function findUniqueRelationshipContactByPhone(phone?: string | null) {
  const digits = phoneDigits(phone)
  if (digits.length !== 10) return null

  const { url, headers } = requireSupabaseEnv()
  const variants = [digits, `1${digits}`, `+1${digits}`]
  const endpoint = new URL(`${url}/rest/v1/market_contacts`)
  endpoint.searchParams.set('select', 'id,name,company,category,phone')
  endpoint.searchParams.set('or', `(${variants.map(value => `phone.eq.${value}`).join(',')})`)
  endpoint.searchParams.set('limit', '10')

  const response = await fetch(endpoint, { headers, cache: 'no-store' })
  if (!response.ok) return null
  const rows = (await response.json()) as RelationshipContactMatch[]
  const exact = rows.filter(row => phoneDigits(row.phone) === digits)

  // Shared brokerage/office numbers can belong to several people. Never guess
  // which relationship record owns a new customer in that situation.
  return exact.length === 1 ? exact[0] : null
}
