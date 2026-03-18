import { NextResponse } from 'next/server'
import { hasInternalSession } from '@/lib/server/session'
import { listSalesLeads, listSalesQuotes } from '@/lib/server/sales-repository'

export async function GET() {
  const authed = await hasInternalSession()
  if (!authed) return new Response('Unauthorized', { status: 401 })

  const [leads, quotes] = await Promise.all([listSalesLeads(), listSalesQuotes()])

  const bookedLeads = leads.filter(l =>
    l.stage === 'booked' || l.paymentStatus === 'deposit_received' || l.paymentStatus === 'paid_in_full'
  )

  const jobs = bookedLeads.map(lead => ({
    lead,
    quote: quotes.find(q => q.leadId === lead.id && (q.status === 'accepted' || q.status === 'sent' || q.status === 'invoiced')) || null,
  })).sort((a, b) => {
    const dateA = a.quote?.moveDate || a.lead.moveDate || '9999'
    const dateB = b.quote?.moveDate || b.lead.moveDate || '9999'
    return dateA.localeCompare(dateB)
  })

  return NextResponse.json({ jobs })
}
