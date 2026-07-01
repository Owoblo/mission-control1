import { readEnv } from '@/lib/server/runtime'

export type DepositReceiptPayload = {
  toEmail: string
  toName: string
  quoteNumber: string
  moveDate?: string
  originCity?: string
  destCity?: string
  paymentKind?: 'deposit' | 'balance' | 'payment'
  depositAmount: number
  balanceAmount: number
  totalAmount: number
  paymentMethod: string
  cardLast4?: string
}

function formatMoney(n: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(n)
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-CA', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function buildDepositReceiptEmail(payload: DepositReceiptPayload) {
  const {
    toName,
    quoteNumber,
    moveDate,
    originCity,
    destCity,
    paymentKind = 'deposit',
    depositAmount,
    balanceAmount,
    totalAmount,
    paymentMethod,
    cardLast4,
  } = payload

  const firstName = (toName || 'there').split(' ')[0]
  const moveDateStr = moveDate ? formatDate(moveDate) : 'TBD'
  const routeStr = [originCity, destCity].filter(Boolean).join(' → ') || 'Your Move'
  const paymentStr = cardLast4
    ? `${paymentMethod} ending ····${cardLast4}`
    : paymentMethod
  const paidLabel =
    paymentKind === 'balance' ? 'Balance Paid' :
    paymentKind === 'payment' ? 'Payment Received' :
    'Deposit Paid'
  const badgeLabel =
    paymentKind === 'balance' ? 'BALANCE PAID' :
    paymentKind === 'payment' ? 'PAYMENT RECEIVED' :
    'DEPOSIT RECEIVED'
  const intro =
    paymentKind === 'balance'
      ? `We've received your balance payment — your move balance is <strong style="color:#1a2744;">paid</strong>. Here's your receipt for your records.`
      : paymentKind === 'payment'
        ? `We've received your payment. Here's your receipt for your records.`
        : `We've received your deposit — your move is <strong style="color:#1a2744;">confirmed</strong>. Here's your receipt for your records.`
  const balanceLabel = balanceAmount <= 0 ? 'Remaining Balance' : 'Balance Due After Move'
  const footerCopy =
    balanceAmount <= 0
      ? `Your balance is now <strong>paid in full</strong>. If you have any questions, reply to this email or call us at <strong>226-773-2993</strong>.`
      : `The remaining balance of <strong>${formatMoney(balanceAmount)}</strong> is due on move day. If you have any questions, reply to this email or call us at <strong>226-773-2993</strong>.`

  const subject = `Payment Received — Saturn Star Moving (${quoteNumber})`

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Payment Receipt</title>
</head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:32px 16px;">
<tr><td align="center">
<table width="100%" style="max-width:520px;" cellpadding="0" cellspacing="0">

  <tr>
    <td style="background:#1a2744;border-radius:12px 12px 0 0;padding:32px 36px 28px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <div style="font-size:20px;font-weight:800;color:#ffffff;letter-spacing:-0.3px;">Saturn Star Moving</div>
            <div style="font-size:12px;color:#94a3b8;margin-top:2px;">starmovers.ca · business@starmovers.ca</div>
          </td>
          <td align="right">
            <div style="background:#f5a623;color:#1a2744;font-size:11px;font-weight:700;padding:5px 12px;border-radius:20px;letter-spacing:0.5px;white-space:nowrap;">${badgeLabel}</div>
          </td>
        </tr>
      </table>
      <div style="height:1px;background:#f5a623;margin-top:20px;opacity:0.6;"></div>
    </td>
  </tr>

  <tr>
    <td style="background:#ffffff;padding:32px 36px;">
      <p style="margin:0 0 20px;font-size:15px;color:#1a2744;">Hi ${firstName},</p>
      <p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.6;">
        ${intro}
      </p>

      <div style="background:#f8fafc;border-radius:10px;padding:20px 22px;margin-bottom:24px;border:1px solid #e2e8f0;">
        <div style="font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:1px;margin-bottom:12px;text-transform:uppercase;">Move Details</div>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:13px;color:#64748b;padding-bottom:6px;">Quote</td>
            <td align="right" style="font-size:13px;font-weight:600;color:#1a2744;padding-bottom:6px;">${quoteNumber}</td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#64748b;padding-bottom:6px;">Move Date</td>
            <td align="right" style="font-size:13px;font-weight:600;color:#1a2744;padding-bottom:6px;">${moveDateStr}</td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#64748b;">Route</td>
            <td align="right" style="font-size:13px;font-weight:600;color:#1a2744;">${routeStr}</td>
          </tr>
        </table>
      </div>

      <div style="border-radius:10px;padding:20px 22px;margin-bottom:24px;border:2px solid #1a2744;">
        <div style="font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:1px;margin-bottom:12px;text-transform:uppercase;">Payment Summary</div>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:13px;color:#64748b;padding-bottom:6px;">Move Total</td>
            <td align="right" style="font-size:13px;color:#1a2744;padding-bottom:6px;">${formatMoney(totalAmount)}</td>
          </tr>
          <tr>
            <td style="padding-bottom:6px;">
              <span style="font-size:13px;color:#64748b;">${paidLabel}</span>
              <span style="font-size:11px;color:#94a3b8;margin-left:6px;">via ${paymentStr}</span>
            </td>
            <td align="right" style="padding-bottom:6px;">
              <span style="font-size:13px;font-weight:700;color:#16a34a;">−${formatMoney(depositAmount)}</span>
            </td>
          </tr>
          <tr>
            <td colspan="2" style="border-top:1px solid #e2e8f0;padding-top:10px;"></td>
          </tr>
          <tr>
            <td style="font-size:14px;font-weight:700;color:#1a2744;">${balanceLabel}</td>
            <td align="right" style="font-size:14px;font-weight:700;color:#1a2744;">${formatMoney(balanceAmount)}</td>
          </tr>
        </table>
      </div>

      <p style="margin:0 0 8px;font-size:13px;color:#64748b;line-height:1.6;">
        ${footerCopy}
      </p>
      <p style="margin:16px 0 0;font-size:13px;color:#64748b;">We can't wait to make your move seamless! 🚛</p>
    </td>
  </tr>

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

  const plainIntro =
    paymentKind === 'balance'
      ? 'Your balance payment has been received.'
      : paymentKind === 'payment'
        ? 'Your payment has been received.'
        : 'Your deposit has been received and your move is confirmed!'
  const plain = `Hi ${firstName},\n\n${plainIntro}\n\nQuote: ${quoteNumber}\nMove Date: ${moveDateStr}\nRoute: ${routeStr}\n\n${paidLabel}: ${formatMoney(depositAmount)} (${paymentStr})\n${balanceLabel}: ${formatMoney(balanceAmount)}\n\nQuestions? Call us at 226-773-2993 or reply to this email.\n\nThanks,\nSaturn Star Moving Team`

  return { subject, html, plain }
}

export async function sendDepositReceipt(payload: DepositReceiptPayload) {
  const resendKey = readEnv('RESEND_API_KEY')
  if (!resendKey) {
    throw new Error('RESEND_API_KEY not configured')
  }

  const { subject, html, plain } = buildDepositReceiptEmail(payload)
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${resendKey}`,
    },
    body: JSON.stringify({
      from: 'Saturn Star Movers <business@starmovers.ca>',
      to: [payload.toEmail],
      subject,
      text: plain,
      html,
      reply_to: 'business@inbound.starmovers.ca',
    }),
  })

  const result = await resp.json().catch(() => ({})) as { id?: string; message?: string; error?: string }
  if (!resp.ok) {
    throw new Error(result.error || result.message || 'Email failed')
  }

  return { ok: true, id: result.id || null }
}
