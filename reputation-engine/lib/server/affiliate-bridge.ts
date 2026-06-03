/**
 * Affiliate bridge — fires when a partnership contact reaches partnership_active.
 * Creates or updates their review_partners (affiliate) record, generates their
 * portal token, and sends a welcome email with their unique portal link.
 */
import { requireSupabaseEnv, getAppBaseUrl, readEnv } from '@/lib/server/runtime'

function generateToken() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

function generatePartnerId() {
  return `partner_${Math.floor(Math.random() * 9000000 + 1000000)}`
}

interface MarketContact {
  id: string
  name: string
  company: string | null
  email: string | null
  phone: string | null
  city: string | null
  industry: string | null
  outreach_tier: number | null
  affiliate_partner_id: string | null
}

export async function activateAffiliatePartner(contactId: string): Promise<{
  partnerId: string
  token: string
  portalUrl: string
  isNew: boolean
} | null> {
  const { url, headers } = requireSupabaseEnv()
  const appUrl = getAppBaseUrl('https://mission-control1-reputation-engine.vercel.app')

  // 1. Fetch the contact
  const contactRes = await fetch(
    `${url}/rest/v1/market_contacts?id=eq.${contactId}&select=id,name,company,email,phone,city,industry,outreach_tier,affiliate_partner_id&limit=1`,
    { headers, cache: 'no-store' }
  )
  if (!contactRes.ok) return null
  const [contact] = await contactRes.json() as MarketContact[]
  if (!contact) return null

  // 2. Already linked? Just return the existing partner info
  if (contact.affiliate_partner_id) {
    const existingRes = await fetch(
      `${url}/rest/v1/review_partners?id=eq.${contact.affiliate_partner_id}&select=id,data&limit=1`,
      { headers, cache: 'no-store' }
    )
    if (existingRes.ok) {
      const [existing] = await existingRes.json() as Array<{ id: string; data: Record<string, unknown> }>
      if (existing) {
        const token = existing.data.affiliateToken as string
        return { partnerId: existing.id, token, portalUrl: `${appUrl}/affiliate?token=${token}`, isNew: false }
      }
    }
  }

  // 3. Check if a partner already exists with this email
  let partnerId = ''
  let token = ''
  let isNew = false

  if (contact.email) {
    const emailSearchRes = await fetch(
      `${url}/rest/v1/review_partners?data->>email=eq.${encodeURIComponent(contact.email)}&deleted=is.null&select=id,data&limit=1`,
      { headers, cache: 'no-store' }
    )
    if (emailSearchRes.ok) {
      const [found] = await emailSearchRes.json() as Array<{ id: string; data: Record<string, unknown> }>
      if (found) {
        // Update existing partner with latest info + ensure they have a token
        partnerId = found.id
        token = (found.data.affiliateToken as string) || generateToken()
        await fetch(`${url}/rest/v1/review_partners?id=eq.${partnerId}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            data: {
              ...found.data,
              name: found.data.name || contact.name,
              phone: found.data.phone || contact.phone,
              company: found.data.company || contact.company,
              city: found.data.city || contact.city,
              affiliateToken: token,
              partnershipContactId: contactId,
            },
          }),
        })
      }
    }
  }

  // 4. Create new partner if none found
  if (!partnerId) {
    isNew = true
    partnerId = generatePartnerId()
    token = generateToken()
    const inferredType = inferPartnerType(contact.industry)
    await fetch(`${url}/rest/v1/review_partners`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        id: partnerId,
        data: {
          id: partnerId,
          name: contact.name,
          email: contact.email || null,
          phone: contact.phone || null,
          company: contact.company || null,
          city: contact.city || null,
          type: inferredType,
          affiliateToken: token,
          commissionRate: 50,
          commissionType: 'per_job',
          totalJobsReferred: 0,
          totalIncentiveOwed: 0,
          partnershipContactId: contactId,
          createdAt: new Date().toISOString(),
        },
      }),
    })
  }

  // 5. Link the market_contact → review_partner
  await fetch(`${url}/rest/v1/market_contacts?id=eq.${contactId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ affiliate_partner_id: partnerId }),
  })

  const portalUrl = `${appUrl}/affiliate?token=${token}`

  // 6. Send welcome email if they have one
  if (contact.email) {
    void sendWelcomeEmail(contact, token, portalUrl, appUrl).catch(() => {})
  }

  return { partnerId, token, portalUrl, isNew }
}

function inferPartnerType(industry: string | null): string {
  const i = (industry || '').toLowerCase()
  if (/realtor|real estate|brokerage|realty|agent/.test(i)) return 'realtor'
  if (/property manager|landlord|rental|apartment/.test(i)) return 'property-manager'
  if (/builder|construct|developer/.test(i)) return 'builder'
  if (/interior|design|stager|staging/.test(i)) return 'other'
  if (/mortgage|lending|loan|bank/.test(i)) return 'other'
  return 'other'
}

async function sendWelcomeEmail(
  contact: MarketContact,
  token: string,
  portalUrl: string,
  appUrl: string
) {
  const resendKey = readEnv('RESEND_API_KEY')
  if (!resendKey || !contact.email) return

  const firstName = (contact.name || 'there').split(' ')[0]

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Eric at Saturn Star Movers <eric@saturnstarmovers.ca>',
      to: [contact.email],
      subject: `Your Saturn Star referral partner portal is ready`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a2744;">
          <div style="background:linear-gradient(135deg,#1a2744 0%,#0f6a53 100%);padding:32px 24px;border-radius:16px 16px 0 0;">
            <div style="color:rgba(255,255,255,0.6);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px;">Partner Portal</div>
            <div style="color:white;font-size:22px;font-weight:700;">Saturn Star Movers</div>
          </div>
          <div style="background:white;padding:32px 24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 16px 16px;">
            <p style="font-size:16px;font-weight:600;margin:0 0 12px;">Hi ${firstName} 👋</p>
            <p style="font-size:14px;color:#4b5563;margin:0 0 20px;line-height:1.6;">
              We've set up your referral partner portal. Whenever you have a client who needs moving services,
              you can submit their info through your personal link — we'll take care of the rest, and you get
              <strong style="color:#0f6a53;">$50 for every completed move</strong>.
            </p>

            <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px;margin:20px 0;">
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#166534;margin-bottom:8px;">Your personal portal link</div>
              <div style="font-size:13px;color:#374151;word-break:break-all;">${portalUrl}</div>
            </div>

            <a href="${portalUrl}" style="display:inline-block;background:linear-gradient(135deg,#0f6a53 0%,#1a9070 100%);color:white;padding:14px 24px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;margin:8px 0;">
              Open My Portal →
            </a>

            <p style="font-size:12px;color:#9ca3af;margin:20px 0 0;">Bookmark this link — it's yours permanently. No login needed.</p>

            <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />

            <p style="font-size:13px;color:#4b5563;margin:0;line-height:1.6;">
              Questions? Call or text us at <a href="tel:+12268870667" style="color:#0f6a53;">226-887-0667</a><br/>
              Eric — Partnerships, Saturn Star Movers
            </p>
          </div>
        </div>
      `,
      text: `Hi ${firstName},\n\nYour Saturn Star referral partner portal is ready.\n\nYour link: ${portalUrl}\n\nBookmark it — no login needed. Submit a referral anytime and you'll earn $50 when the move completes.\n\nQuestions? Call 226-887-0667\n\nEric\nSaturn Star Movers`,
    }),
  })
}
