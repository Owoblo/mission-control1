import { NextResponse } from 'next/server'
import { uid } from '@/lib/sales'
import { sendSalesMessage } from '@/lib/server/sales-messaging'
import { getSalesLead, saveFollowUpLog, saveSalesLead } from '@/lib/server/sales-repository'
import { hasInternalSession } from '@/lib/server/session'
import { isMoveRelationshipLifecycleComplete } from '@/lib/move-relationship'
import { configuredReviewUrl, matchReviewLocationFromText, nearestReviewLocationByCoordinates } from '@/lib/review-locations'
import { geocodeAddress } from '@/lib/server/route-estimation'
import { listJobs, saveJobRecord } from '@/lib/server/repository'
import { buildReviewRequestCopy } from '@/lib/review-request-content'

const YELP_URL = process.env.NEXT_PUBLIC_YELP_REVIEW_URL || 'https://yelp.com/biz/saturn-star-moving'

export async function POST(request: Request) {
  const authed = await hasInternalSession()
  if (!authed) return new Response('Unauthorized', { status: 401 })

  const { leadId, leadName, leadEmail, leadPhone, quoteNumber, channel, action = 'send' } = await request.json() as {
    leadId?: string
    leadName: string
    leadEmail?: string
    leadPhone?: string
    quoteNumber?: string
    channel: 'both' | 'email' | 'sms'
    action?: 'preview' | 'send'
  }

  const firstName = leadName?.split(' ')[0] || 'there'

  const lead = leadId ? await getSalesLead(leadId).catch(() => null) : null
  const preferredAddress = lead?.originAddress || lead?.originCity || lead?.destAddress || lead?.destCity || ''
  let reviewLocation = matchReviewLocationFromText(preferredAddress)
  if (!reviewLocation && preferredAddress) {
    const geocoded = await geocodeAddress(preferredAddress).catch(() => null)
    if (geocoded) reviewLocation = nearestReviewLocationByCoordinates(geocoded.lat, geocoded.lng).location
  }
  reviewLocation ||= matchReviewLocationFromText(lead?.destAddress, lead?.destCity)
  const googleReviewUrl = reviewLocation
    ? configuredReviewUrl(reviewLocation)
    : process.env.NEXT_PUBLIC_GOOGLE_REVIEW_URL || 'https://www.google.com/search?q=Saturn+Star+Movers'

  const existingReviewJob = leadId
    ? (await listJobs().catch(() => [])).find(job => job.crmLeadId === leadId)
    : undefined
  const now = new Date().toISOString()
  const reviewJob = await saveJobRecord({
    id: existingReviewJob?.id || uid('review'),
    customerName: leadName,
    customerEmail: leadEmail || '',
    customerPhone: leadPhone || '',
    moveDate: lead?.moveDate || '',
    moveFrom: lead?.originAddress || lead?.originCity || '',
    moveTo: lead?.destAddress || lead?.destCity || '',
    crewLead: existingReviewJob?.crewLead || '',
    status: existingReviewJob?.status || 'sent',
    reviews: existingReviewJob?.reviews || { google: false, yelp: false, facebook: false, media: false },
    reviewConfirmedAt: existingReviewJob?.reviewConfirmedAt || {},
    incentiveEarned: existingReviewJob?.incentiveEarned || false,
    incentivePaid: existingReviewJob?.incentivePaid || false,
    proofSentToPartner: existingReviewJob?.proofSentToPartner || false,
    createdAt: existingReviewJob?.createdAt || now,
    reviewSentAt: action === 'send' ? now : existingReviewJob?.reviewSentAt,
    crmLeadId: leadId,
    googleReviewUrl,
    googleProfileLocation: reviewLocation?.label,
    reviewProofAssets: existingReviewJob?.reviewProofAssets || [],
  })
  const reviewFlowUrl = `${new URL(request.url).origin}/review/${reviewJob.id}`
  const brandName = reviewLocation?.businessName || 'Saturn Star Movers'
  const copy = buildReviewRequestCopy({ firstName, brandName, reviewFlowUrl })

  if (action === 'preview') {
    return NextResponse.json({
      ok: true,
      preview: {
        ...copy,
        reviewFlowUrl,
        googleReviewUrl,
        profileLabel: reviewLocation?.label || 'Default profile',
        brandName,
        originAddress: preferredAddress || 'Origin address unavailable',
      },
    })
  }

  const results: Array<{ channel: string; ok: boolean }> = []
  let savedLead = null

  // SMS
  if ((channel === 'both' || channel === 'sms') && leadPhone) {
    const smsOk = await sendSalesMessage({
      channel: 'sms',
      to: leadPhone,
      body: copy.smsBody,
      leadId,
      actor: 'automation',
    }).then(() => true).catch(() => false)
    results.push({ channel: 'sms', ok: smsOk })
  }

  // Email
  if ((channel === 'both' || channel === 'email') && leadEmail) {
    const html = buildReviewEmailHtml(firstName, quoteNumber, reviewFlowUrl, YELP_URL, brandName)
    const emailOk = await sendSalesMessage({
      channel: 'email',
      to: leadEmail,
      subject: copy.emailSubject,
      body: copy.emailBody,
      htmlBody: html,
      leadId,
      actor: 'automation',
    }).then(() => true).catch(() => false)
    results.push({ channel: 'email', ok: emailOk })
  }

  const sentSuccessfully = results.some(result => result.ok)
  if (leadId && sentSuccessfully) {
    if (lead) {
      savedLead = await saveSalesLead({
        ...lead,
        stage: isMoveRelationshipLifecycleComplete({
          context: lead.opportunityContext,
          signals: lead.attributionSignals,
        }) ? 'customer_success' : 'completed',
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
          notes: `Stage: ${lead.stage.replace(/_/g, ' ')} -> ${savedLead.stage === 'customer_success' ? 'Customer Success' : 'Completed (relationship context still open)'}. Review request sent.`,
        }).catch(() => null)
      }
    }
  }

  return NextResponse.json(
    { ok: sentSuccessfully, results, lead: savedLead, profileLabel: reviewLocation?.label, brandName, error: sentSuccessfully ? undefined : 'Review request could not be delivered.' },
    { status: sentSuccessfully ? 200 : 502 },
  )
}

function buildReviewEmailHtml(firstName: string, quoteNumber: string | undefined, googleUrl: string, yelpUrl: string, brandName: string) {
  const isDexa = brandName === 'Dexa Movers'
  const phone = isDexa ? '613-519-3236' : '226-773-2993'
  const website = isDexa ? 'dexamovers.ca' : 'starmovers.ca'
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:ui-sans-serif,system-ui,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:32px 16px;">
<tr><td align="center">
<table width="100%" style="max-width:520px;" cellpadding="0" cellspacing="0">
  <tr>
    <td style="background:#071421;border-radius:12px 12px 0 0;padding:32px 36px 28px;">
      <div style="font-size:20px;font-weight:800;color:#ffffff;">${brandName}</div>
      <div style="font-size:12px;color:#94a3b8;margin-top:2px;">${website} · ${phone}</div>
      <div style="height:2px;background:#C99700;margin-top:20px;"></div>
    </td>
  </tr>
  <tr>
    <td style="background:#ffffff;padding:36px;">
      <p style="font-size:28px;margin:0 0 8px;">🌟</p>
      <p style="font-size:22px;font-weight:800;color:#071421;margin:0 0 16px;">Thank you, ${firstName}!</p>
      <p style="font-size:15px;color:#475569;line-height:1.7;margin:0 0 24px;">
        It was truly a pleasure working with you${quoteNumber ? ` (${quoteNumber})` : ''}. We hope your move went smoothly and you're loving your new space!
      </p>
      <p style="font-size:15px;color:#071421;font-weight:600;margin:0 0 20px;">
        If you have a minute, would you share a few words about your experience? It means a lot to our crew and helps a local small business continue to grow.
      </p>
      <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr>
          <td style="padding-right:12px;">
            <a href="${googleUrl}" style="display:inline-block;background:#071421;color:#ffffff;font-size:14px;font-weight:700;padding:14px 24px;border-radius:10px;text-decoration:none;">⭐ Review on Google</a>
          </td>
          <td>
            <a href="${yelpUrl}" style="display:inline-block;background:#C99700;color:#071421;font-size:14px;font-weight:700;padding:14px 24px;border-radius:10px;text-decoration:none;">⭐ Review on Yelp</a>
          </td>
        </tr>
      </table>
      <div style="background:#f8fafc;border-radius:10px;padding:20px;border-left:4px solid #C99700;margin-bottom:24px;">
        <p style="margin:0;font-size:14px;color:#071421;font-weight:600;">🎁 Referral Bonus</p>
        <p style="margin:8px 0 0;font-size:13px;color:#64748b;line-height:1.6;">
          Know someone who needs to move? Send them our way and you'll both get <strong>$25 off</strong>. Just have them mention your name when they call!
        </p>
      </div>
      <p style="font-size:13px;color:#94a3b8;margin:0;">With gratitude,<br/><strong style="color:#071421;">The ${brandName} team</strong></p>
    </td>
  </tr>
  <tr>
    <td style="background:#071421;border-radius:0 0 12px 12px;padding:20px 36px;text-align:center;">
      <div style="font-size:11px;color:#64748b;">${brandName} · ${phone} · <a href="https://${website}" style="color:#C99700;text-decoration:none;">${website}</a></div>
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>`
}
