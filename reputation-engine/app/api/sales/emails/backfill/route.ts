import { NextResponse } from 'next/server'
import { getWorkerSharedSecret } from '@/lib/server/runtime'
import { listSalesEmails, listSalesLeads, saveSalesEmail } from '@/lib/server/sales-repository'

export async function POST(request: Request) {
  const secret = request.headers.get('x-internal-secret')
  if (secret !== getWorkerSharedSecret()) {
    return new Response('Unauthorized', { status: 401 })
  }
  try {
    const [emails, leads] = await Promise.all([listSalesEmails(), listSalesLeads()])

    // Build email -> leadId map from leads
    const leadByEmail = new Map<string, string>()
    for (const lead of leads) {
      if (lead.email) leadByEmail.set(lead.email.toLowerCase().trim(), lead.id)
    }

    let matched = 0
    let skipped = 0

    for (const email of emails) {
      if (email.leadId) { skipped++; continue }

      // For outbound: match on 'to'; for inbound: match on 'from'
      const addr = (email.direction === 'outbound' ? email.to : email.from).toLowerCase().trim()
      const leadId = leadByEmail.get(addr)

      if (leadId) {
        await saveSalesEmail({ ...email, leadId })
        matched++
      }
    }

    return NextResponse.json({ ok: true, matched, skipped, total: emails.length })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
