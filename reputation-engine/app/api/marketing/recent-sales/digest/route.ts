import { NextResponse } from 'next/server'
import { isAuthorizedCronRequest } from '@/lib/server/cron-auth'
import { sendRepAlertEmail } from '@/lib/server/internal-notifications'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { getSessionUser } from '@/lib/server/session'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function authorized(request: Request) {
  if (isAuthorizedCronRequest(request)) return true
  return Boolean(await getSessionUser())
}

function escapeHtml(value: unknown) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function GET(request: Request) {
  if (!(await authorized(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(
    `${url}/rest/v1/partner_sale_signals?verification_status=eq.verified&status=in.(needs_match,needs_review,ready)&select=id,address,city,realtor_name,realtor_brokerage,relationship_tier,status,sold_verified_at&order=sold_verified_at.desc&limit=200`,
    { headers, cache: 'no-store' }
  )
  if (!response.ok) return NextResponse.json({ error: 'Could not load recent sales' }, { status: 500 })
  const sales = await response.json() as Array<Record<string, unknown>>
  const matched = sales.filter(sale => sale.status !== 'needs_match')
  const needsMatch = sales.filter(sale => sale.status === 'needs_match')
  const priority = matched.filter(sale => ['active_partner', 'warm'].includes(String(sale.relationship_tier)))

  const rows = sales.slice(0, 30).map(sale => `
    <tr>
      <td style="padding:9px;border-bottom:1px solid #e5e7eb">${escapeHtml(sale.realtor_name)}<br><span style="color:#64748b;font-size:12px">${escapeHtml(sale.realtor_brokerage)}</span></td>
      <td style="padding:9px;border-bottom:1px solid #e5e7eb">${escapeHtml(sale.address)}<br><span style="color:#64748b;font-size:12px">${escapeHtml(sale.city)}</span></td>
      <td style="padding:9px;border-bottom:1px solid #e5e7eb">${escapeHtml(String(sale.relationship_tier).replace('_', ' '))}</td>
      <td style="padding:9px;border-bottom:1px solid #e5e7eb">${escapeHtml(String(sale.status).replace('_', ' '))}</td>
    </tr>
  `).join('')

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:760px;margin:auto;color:#14213d">
      <h1 style="font-size:24px;margin-bottom:6px">Recent Realtor sales</h1>
      <p style="color:#64748b;margin-top:0">Verified relationship opportunities waiting in Saturn Star OS.</p>
      <div style="display:flex;gap:12px;margin:22px 0">
        <div style="padding:14px 18px;background:#ecfdf5;border-radius:10px"><strong style="font-size:22px">${priority.length}</strong><br><span style="font-size:12px">warm priorities</span></div>
        <div style="padding:14px 18px;background:#f8fafc;border-radius:10px"><strong style="font-size:22px">${matched.length}</strong><br><span style="font-size:12px">matched</span></div>
        <div style="padding:14px 18px;background:#fffbeb;border-radius:10px"><strong style="font-size:22px">${needsMatch.length}</strong><br><span style="font-size:12px">need matching</span></div>
      </div>
      ${sales.length ? `<table style="width:100%;border-collapse:collapse;font-size:14px"><thead><tr><th align="left" style="padding:9px">Realtor</th><th align="left" style="padding:9px">Sale</th><th align="left" style="padding:9px">Relationship</th><th align="left" style="padding:9px">Status</th></tr></thead><tbody>${rows}</tbody></table>` : '<p>No open verified-sale opportunities today.</p>'}
      <p style="margin-top:22px"><a href="https://go.quote2move.com/marketing/recent-sales" style="display:inline-block;background:#071421;color:white;text-decoration:none;padding:11px 18px;border-radius:8px;font-weight:600">Review recent sales</a></p>
      <p style="font-size:12px;color:#94a3b8">No congratulatory message is sent automatically.</p>
    </div>
  `
  await sendRepAlertEmail(
    `${priority.length} warm Realtor sale opportunities · ${sales.length} open`,
    html,
    ['business@starmovers.ca']
  )
  return NextResponse.json({ ok: true, open: sales.length, matched: matched.length, priority: priority.length, needsMatch: needsMatch.length })
}
