import { NextResponse } from 'next/server'
import { uid } from '@/lib/sales'
import { sendSalesMessage } from '@/lib/server/sales-messaging'
import { getSalesLead, saveFollowUpLog, saveSalesLead } from '@/lib/server/sales-repository'
import { hasInternalSession } from '@/lib/server/session'

const GOOGLE_REVIEW_URL = process.env.NEXT_PUBLIC_GOOGLE_REVIEW_URL || 'https://g.page/r/YOUR_GOOGLE_REVIEW_LINK'
const YELP_URL = process.env.NEXT_PUBLIC_YELP_REVIEW_URL || 'https://yelp.com/biz/saturn-star-moving'

export async function POST(request: Request) {
  const authed = await hasInternalSession()
  if (!authed) return new Response('Unauthorized', { status: 401 })

  const { leadId, leadName, leadEmail, leadPhone, quoteNumber, channel } = await request.json() as {
    leadId?: string
    leadName: string
    leadEmail?: string
    leadPhone?: string
    quoteNumber?: string
    channel: 'both' | 'email' | 'sms'
  }

  const firstName = leadName?.split(' ')[0] || 'there'

  const results: Array<{ channel: string; ok: boolean }> = []
  let savedLead = null

  // SMS
  if ((channel === 'both' || channel === 'sms') && leadPhone) {
    const smsBody = `Hi ${firstName}! 🌟 It was a pleasure moving you today! If we earned it, would you mind leaving us a quick Google review? It means the world to a growing team like ours:\n\n${GOOGLE_REVIEW_URL}\n\nThank you! — Saturn Star Moving 🚛`
    const smsOk = await sendSalesMessage({
      channel: 'sms',
      to: leadPhone,
      body: smsBody,
      leadId,
      actor: 'automation',
    }).then(() => true).catch(() => false)
    results.push({ channel: 'sms', ok: smsOk })
  }

  // Email
  if ((channel === 'both' || channel === 'email') && leadEmail) {
    const html = buildReviewEmailHtml(firstName, quoteNumber, GOOGLE_REVIEW_URL, YELP_URL)
    const plain = `Hi ${firstName},\n\nThank you for choosing Saturn Star Moving! We hope your move was smooth and stress-free.\n\nIf you had a great experience, we'd be so grateful for a review:\n\nGoogle: ${GOOGLE_REVIEW_URL}\nYelp: ${YELP_URL}\n\nAs a thank you, mention this email for $25 off your next move or referral!\n\nWith gratitude,\nSaturn Star Moving Team\n226-773-2993 · starmovers.ca`
    const emailOk = await sendSalesMessage({
      channel: 'email',
      to: leadEmail,
      subject: 'Thank you for choosing Saturn Star Moving! ⭐',
      body: plain,
      htmlBody: html,
      leadId,
      actor: 'automation',
    }).then(() => true).catch(() => false)
    results.push({ channel: 'email', ok: emailOk })
  }

  if (leadId) {
    const lead = await getSalesLead(leadId).catch(() => null)
    if (lead) {
      savedLead = await saveSalesLead({
        ...lead,
        stage: 'customer_success',
        reviewSentAt: new Date().toISOString(),
      }).catch(() => null)
      if (savedLead) {
        const now = new Date().toISOString()
        await saveFollowUpLog({
          id: uid('fu'),
          leadId,
          type: 'status_change',
          date: now,
          createdAt: now,
          notes: `Stage: ${lead.stage.replace(/_/g, ' ')} -> Customer Success. Review request sent.`,
        }).catch(() => null)
      }
    }
  }

  return NextResponse.json({ ok: true, results, lead: savedLead })
}

function buildReviewEmailHtml(firstName: string, quoteNumber: string | undefined, googleUrl: string, yelpUrl: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:ui-sans-serif,system-ui,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:32px 16px;">
<tr><td align="center">
<table width="100%" style="max-width:520px;" cellpadding="0" cellspacing="0">
  <tr>
    <td style="background:#1a2744;border-radius:12px 12px 0 0;padding:32px 36px 28px;">
      <div style="font-size:20px;font-weight:800;color:#ffffff;">Saturn Star Moving</div>
      <div style="font-size:12px;color:#94a3b8;margin-top:2px;">starmovers.ca · 226-773-2993</div>
      <div style="height:2px;background:#f5a623;margin-top:20px;"></div>
    </td>
  </tr>
  <tr>
    <td style="background:#ffffff;padding:36px;">
      <p style="font-size:28px;margin:0 0 8px;">🌟</p>
      <p style="font-size:22px;font-weight:800;color:#1a2744;margin:0 0 16px;">Thank you, ${firstName}!</p>
      <p style="font-size:15px;color:#475569;line-height:1.7;margin:0 0 24px;">
        It was truly a pleasure working with you${quoteNumber ? ` (${quoteNumber})` : ''}. We hope your move went smoothly and you're loving your new space!
      </p>
      <p style="font-size:15px;color:#1a2744;font-weight:600;margin:0 0 20px;">
        If we earned a 5-star experience, would you take 60 seconds to share it?
      </p>
      <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr>
          <td style="padding-right:12px;">
            <a href="${googleUrl}" style="display:inline-block;background:#1a2744;color:#ffffff;font-size:14px;font-weight:700;padding:14px 24px;border-radius:10px;text-decoration:none;">⭐ Review on Google</a>
          </td>
          <td>
            <a href="${yelpUrl}" style="display:inline-block;background:#f5a623;color:#1a2744;font-size:14px;font-weight:700;padding:14px 24px;border-radius:10px;text-decoration:none;">⭐ Review on Yelp</a>
          </td>
        </tr>
      </table>
      <div style="background:#f8fafc;border-radius:10px;padding:20px;border-left:4px solid #f5a623;margin-bottom:24px;">
        <p style="margin:0;font-size:14px;color:#1a2744;font-weight:600;">🎁 Referral Bonus</p>
        <p style="margin:8px 0 0;font-size:13px;color:#64748b;line-height:1.6;">
          Know someone who needs to move? Send them our way and you'll both get <strong>$25 off</strong>. Just have them mention your name when they call!
        </p>
      </div>
      <p style="font-size:13px;color:#94a3b8;margin:0;">With gratitude,<br/><strong style="color:#1a2744;">The Saturn Star Moving Team</strong></p>
    </td>
  </tr>
  <tr>
    <td style="background:#1a2744;border-radius:0 0 12px 12px;padding:20px 36px;text-align:center;">
      <div style="font-size:11px;color:#64748b;">Saturn Star Moving · Windsor, ON · 226-773-2993 · <a href="https://starmovers.ca" style="color:#f5a623;text-decoration:none;">starmovers.ca</a></div>
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>`
}
