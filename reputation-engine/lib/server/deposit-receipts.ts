import { readEnv } from '@/lib/server/runtime'
import type { ReceiptBrand } from '@/lib/receipt-brand'

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
  receiptNumber?: string
  receiptUrl?: string
  paidAt?: string
  note?: string
  reference?: string
  brand?: ReceiptBrand
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
    receiptNumber,
    receiptUrl,
    paidAt,
    note,
    reference,
    brand = {
      name: 'Saturn Star', fullName: 'Saturn Star Movers', tagline: 'Moving with care, from city to city.',
      phone: '226-773-2993', phoneHref: 'tel:+12267732993', email: 'info@starmovers.ca', website: 'starmovers.ca',
      logoPath: '/brand/saturn-star-horizontal-full-color.png',
    },
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

  const subject = `Payment receipt ${receiptNumber ? `${receiptNumber} — ` : '— '}${brand.name}`

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Payment Receipt</title>
</head>
<body style="margin:0;padding:0;background:#F7F4ED;font-family:Inter,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F4ED;padding:32px 16px;">
<tr><td align="center">
<table width="100%" style="max-width:520px;" cellpadding="0" cellspacing="0">

  <tr>
    <td style="background:#071421;border-radius:20px 20px 0 0;padding:30px 36px 26px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            ${brand.logoPath ? `<img src="${brand.logoPath.startsWith('http') ? brand.logoPath : `https://go.quote2move.com${brand.logoPath}`}" width="220" alt="${brand.fullName}" style="display:block;max-width:220px;height:auto;"/>` : `<div style="font-family:Manrope,Arial,sans-serif;font-size:22px;font-weight:800;color:#ffffff;">${brand.fullName}</div>`}
            <div style="font-size:12px;color:#CBD5E1;margin-top:8px;">${brand.tagline}</div>
          </td>
          <td align="right">
            <div style="background:#C99700;color:#071421;font-size:11px;font-weight:800;padding:7px 12px;border-radius:999px;letter-spacing:0.5px;white-space:nowrap;">${badgeLabel}</div>
          </td>
        </tr>
      </table>
      <div style="height:1px;background:#C99700;margin-top:22px;"></div>
    </td>
  </tr>

  <tr>
    <td style="background:#ffffff;padding:32px 36px;">
      <p style="margin:0 0 20px;font-size:15px;color:#1a2744;">Hi ${firstName},</p>
      <p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.6;">
        ${intro}
      </p>

      <div style="background:#F7F4ED;border-radius:18px;padding:20px 22px;margin-bottom:24px;border:1px solid #E5E7EB;">
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

      <div style="border-radius:18px;padding:20px 22px;margin-bottom:24px;border:1px solid #071421;">
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

      ${(receiptNumber || paidAt || reference || note) ? `<div style="background:#F7F4ED;border:1px solid #E5E7EB;border-radius:18px;padding:16px 20px;margin-bottom:22px;font-size:12px;line-height:1.8;color:#667085;">${receiptNumber ? `<strong style="color:#111827;">Receipt:</strong> ${receiptNumber}<br/>` : ''}${paidAt ? `<strong style="color:#111827;">Paid:</strong> ${formatDate(paidAt)}<br/>` : ''}${reference ? `<strong style="color:#111827;">Reference:</strong> ${reference}<br/>` : ''}${note ? `<strong style="color:#111827;">Note:</strong> ${note}` : ''}</div>` : ''}

      ${receiptUrl ? `<p style="margin:0 0 24px;"><a href="${receiptUrl}" style="display:inline-block;background:#C99700;color:#071421;text-decoration:none;padding:14px 20px;border-radius:12px;font-weight:800;">View official receipt</a></p>` : ''}

      <p style="margin:0 0 8px;font-size:13px;color:#64748b;line-height:1.6;">
        ${footerCopy}
      </p>
      <p style="margin:16px 0 0;font-size:13px;color:#64748b;">We can't wait to make your move seamless! 🚛</p>
    </td>
  </tr>

  <tr>
    <td style="background:#071421;border-radius:0 0 20px 20px;padding:22px 36px;text-align:center;">
      <div style="font-size:11px;color:#64748b;line-height:1.8;">
        ${brand.fullName} · ${brand.phone}${brand.website ? `<br/><a href="https://${brand.website}" style="color:#C99700;text-decoration:none;">${brand.website}</a>` : ''}
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
  const plain = `Hi ${firstName},\n\n${plainIntro}\n\n${receiptNumber ? `Receipt: ${receiptNumber}\n` : ''}Quote: ${quoteNumber}\nMove Date: ${moveDateStr}\nRoute: ${routeStr}\n\n${paidLabel}: ${formatMoney(depositAmount)} (${paymentStr})\n${balanceLabel}: ${formatMoney(balanceAmount)}${reference ? `\nReference: ${reference}` : ''}${note ? `\nNote: ${note}` : ''}${receiptUrl ? `\n\nView official receipt: ${receiptUrl}` : ''}\n\nQuestions? Call us at ${brand.phone} or reply to this email.\n\nThanks,\n${brand.fullName}`

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
      from: `${payload.brand?.fullName || 'Saturn Star Movers'} <info@starmovers.ca>`,
      to: [payload.toEmail],
      subject,
      text: plain,
      html,
      reply_to: payload.brand?.email || 'info@starmovers.ca',
    }),
  })

  const result = await resp.json().catch(() => ({})) as { id?: string; message?: string; error?: string }
  if (!resp.ok) {
    throw new Error(result.error || result.message || 'Email failed')
  }

  return { ok: true, id: result.id || null }
}
