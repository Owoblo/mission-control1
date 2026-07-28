import { requireSupabaseEnv } from '@/lib/server/runtime'
import type { CRMLead } from '@/lib/types'

type PartnerContact = {
  id: string
  partner_company_id?: string | null
  affiliate_partner_id?: string | null
  tracking_code?: string | null
}

async function loadContact(contactId: string) {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(
    `${url}/rest/v1/market_contacts?id=eq.${encodeURIComponent(contactId)}&select=id,partner_company_id,affiliate_partner_id,tracking_code&limit=1`,
    { headers, cache: 'no-store' }
  )
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Could not read selected partnership contact (${response.status}): ${detail}`)
  }
  const rows = await response.json() as PartnerContact[]
  return rows[0] || null
}

async function refreshReferralCount(contactId: string) {
  const { url, headers } = requireSupabaseEnv()
  const countResponse = await fetch(
    `${url}/rest/v1/partner_referrals?contact_id=eq.${encodeURIComponent(contactId)}&select=id`,
    { headers: { ...headers, Prefer: 'count=exact' }, cache: 'no-store' }
  ).catch(() => null)
  if (!countResponse?.ok) return
  const count = Number(countResponse.headers.get('content-range')?.split('/')[1] || 0)
  await fetch(`${url}/rest/v1/market_contacts?id=eq.${encodeURIComponent(contactId)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ referred_lead_count: count }),
  }).catch(() => {})
}

export async function syncLeadPartnerReferral(lead: CRMLead, previousContactId?: string) {
  const { url, headers } = requireSupabaseEnv()
  const currentContactId = lead.source === 'partner_referral' ? lead.partnerReferralContactId : undefined
  const existingResponse = await fetch(
    `${url}/rest/v1/partner_referrals?crm_lead_id=eq.${encodeURIComponent(lead.id)}&select=id,contact_id&limit=20`,
    { headers, cache: 'no-store' }
  )
  const existing = existingResponse.ok
    ? await existingResponse.json() as Array<{ id: string; contact_id?: string | null }>
    : []

  const affected = new Set(existing.map(item => item.contact_id).filter(Boolean) as string[])
  if (previousContactId) affected.add(previousContactId)

  if (!currentContactId) {
    if (existing.length > 0) {
      const deleteResponse = await fetch(`${url}/rest/v1/partner_referrals?crm_lead_id=eq.${encodeURIComponent(lead.id)}`, {
        method: 'DELETE',
        headers,
      })
      if (!deleteResponse.ok) throw new Error('Could not unlink partnership referral')
    }
    await Promise.all([...affected].map(refreshReferralCount))
    return
  }

  const contact = await loadContact(currentContactId)
  if (!contact) throw new Error('Selected partnership contact no longer exists')
  affected.add(currentContactId)

  const row = {
    contact_id: contact.id,
    company_id: contact.partner_company_id || null,
    affiliate_partner_id: contact.affiliate_partner_id || null,
    partner_code: contact.tracking_code || contact.affiliate_partner_id || null,
    customer_name: lead.name || null,
    customer_phone: lead.phone || null,
    customer_email: lead.email || null,
    job_city: lead.originCity || lead.destCity || null,
    move_date: lead.moveDate || null,
    crm_lead_id: lead.id,
    job_status: lead.stage || 'new',
    commission_status: 'rule_required',
    source: 'crm_lead_attribution',
    proof_notes: `Linked from sales lead source: ${lead.partnerReferralName || 'partnership referral'}`,
  }

  const keep = existing[0]
  if (keep) {
    const updateResponse = await fetch(`${url}/rest/v1/partner_referrals?id=eq.${encodeURIComponent(keep.id)}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(row),
    })
    if (!updateResponse.ok) throw new Error('Could not update partnership referral ledger')
    if (existing.length > 1) {
      const duplicateIds = existing.slice(1).map(item => item.id)
      await fetch(`${url}/rest/v1/partner_referrals?id=in.(${duplicateIds.map(encodeURIComponent).join(',')})`, {
        method: 'DELETE',
        headers,
      })
    }
  } else {
    const createResponse = await fetch(`${url}/rest/v1/partner_referrals`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify(row),
    })
    if (!createResponse.ok) throw new Error('Could not create partnership referral ledger entry')
  }

  await Promise.all([...affected].map(refreshReferralCount))
}
