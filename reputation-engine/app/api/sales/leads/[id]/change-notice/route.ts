/**
 * POST /api/sales/leads/[id]/change-notice
 * Sends a "your booking was updated" email to the customer when
 * critical fields (move date, origin, destination) change on a booked job.
 */
import { NextResponse } from 'next/server'
import { hasInternalSession } from '@/lib/server/session'
import { requireWorkerBaseUrl } from '@/lib/server/runtime'

function formatDate(iso: string) {
  if (!iso) return iso
  try {
    return new Date(iso).toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  } catch {
    return iso
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authed = await hasInternalSession()
  if (!authed) return new Response('Unauthorized', { status: 401 })

  await params // consume params (id not needed here — all data comes from body)

  const workerBase = requireWorkerBaseUrl()
  const workerSecret = process.env.WORKER_SHARED_SECRET

  try {
    const {
      toEmail, toName,
      quoteNumber,
      changes,            // string[] — human-readable list of what changed
      newMoveDate,
      originCity, destCity,
    } = (await request.json()) as {
      toEmail: string
      toName: string
      quoteNumber?: string
      changes: string[]
      newMoveDate?: string
      originCity?: string
      destCity?: string
    }

    if (!toEmail || !changes?.length) {
      return NextResponse.json({ error: 'toEmail and changes[] required' }, { status: 400 })
    }

    const firstName = toName?.split(' ')[0] || 'there'
    const moveDateStr = newMoveDate ? formatDate(newMoveDate) : null
    const routeStr = [originCity, destCity].filter(Boolean).join(' → ') || null
    const changeList = changes.map(c => `<li style="margin-bottom:6px;">${c}</li>`).join('')
    const changePlain = changes.map(c => `• ${c}`).join('\n')

    const subject = `Update to Your Move${quoteNumber ? ` (${quoteNumber})` : ''} — Saturn Star Moving`

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Booking Update</title>
</head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:32px 16px;">
<tr><td align="center">
<table width="100%" style="max-width:520px;" cellpadding="0" cellspacing="0">

  <!-- Header -->
  <tr>
    <td style="background:#1a2744;border-radius:12px 12px 0 0;padding:32px 36px 28px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <div style="font-size:20px;font-weight:800;color:#ffffff;letter-spacing:-0.3px;">Saturn Star Moving</div>
            <div style="font-size:12px;color:#94a3b8;margin-top:2px;">starmovers.ca · business@starmovers.ca</div>
          </td>
          <td align="right">
            <div style="background:#f5a623;color:#1a2744;font-size:11px;font-weight:700;padding:5px 12px;border-radius:20px;letter-spacing:0.5px;white-space:nowrap;">BOOKING UPDATE</div>
          </td>
        </tr>
      </table>
      <div style="height:1px;background:#f5a623;margin-top:20px;opacity:0.6;"></div>
    </td>
  </tr>

  <!-- Body -->
  <tr>
    <td style="background:#ffffff;padding:32px 36px;">

      <p style="margin:0 0 20px;font-size:15px;color:#1a2744;">Hi ${firstName},</p>
      <p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.6;">
        We've made an update to your move booking. Here's a summary of what changed:
      </p>

      <!-- Changes list -->
      <div style="background:#fefce8;border:1px solid #fde68a;border-radius:10px;padding:20px 22px;margin-bottom:24px;">
        <div style="font-size:11px;font-weight:700;color:#92400e;letter-spacing:1px;margin-bottom:12px;text-transform:uppercase;">What Changed</div>
        <ul style="margin:0;padding-left:18px;font-size:13px;color:#1a2744;line-height:1.8;">
          ${changeList}
        </ul>
      </div>

      ${moveDateStr || routeStr ? `
      <!-- Current booking summary -->
      <div style="background:#f8fafc;border-radius:10px;padding:20px 22px;margin-bottom:24px;border:1px solid #e2e8f0;">
        <div style="font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:1px;margin-bottom:12px;text-transform:uppercase;">Current Booking</div>
        <table width="100%" cellpadding="0" cellspacing="0">
          ${quoteNumber ? `<tr><td style="font-size:13px;color:#64748b;padding-bottom:6px;">Reference</td><td align="right" style="font-size:13px;font-weight:600;color:#1a2744;padding-bottom:6px;">${quoteNumber}</td></tr>` : ''}
          ${moveDateStr ? `<tr><td style="font-size:13px;color:#64748b;padding-bottom:6px;">Move Date</td><td align="right" style="font-size:13px;font-weight:600;color:#1a2744;padding-bottom:6px;">${moveDateStr}</td></tr>` : ''}
          ${routeStr ? `<tr><td style="font-size:13px;color:#64748b;">Route</td><td align="right" style="font-size:13px;font-weight:600;color:#1a2744;">${routeStr}</td></tr>` : ''}
        </table>
      </div>
      ` : ''}

      <p style="margin:0 0 8px;font-size:13px;color:#64748b;line-height:1.6;">
        If you have any questions or concerns about these changes, please reply to this email or call us at <strong>226-773-2993</strong>.
      </p>
      <p style="margin:16px 0 0;font-size:13px;color:#64748b;">We look forward to making your move seamless! 🚛</p>

    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="background:#1a2744;border-radius:0 0 12px 12px;padding:20px 36px;text-align:center;">
      <div style="font-size:11px;color:#64748b;line-height:1.8;">
        Saturn Star Moving · Windsor, ON · 226-773-2993<br/>
        <a href="https://starmovers.ca" style="color:#f5a623;text-decoration:none;">starmovers.ca</a>
      </div>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`

    const plain = `Hi ${firstName},\n\nWe've updated your move booking:\n\n${changePlain}${moveDateStr ? `\n\nUpdated Move Date: ${moveDateStr}` : ''}${routeStr ? `\nRoute: ${routeStr}` : ''}\n\nQuestions? Call 226-773-2993 or reply to this email.\n\nThanks,\nSaturn Star Moving Team`

    const resp = await fetch(`${workerBase}/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': workerSecret || '',
      },
      body: JSON.stringify({ to: toEmail, subject, body: plain, htmlBody: html }),
    })

    const result = await resp.json().catch(() => ({})) as { ok?: boolean; error?: string }
    if (!resp.ok) return NextResponse.json({ error: result.error || 'Email failed' }, { status: 502 })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Change notice failed' }, { status: 500 })
  }
}
