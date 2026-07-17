import { NextResponse } from 'next/server'
import { getSalesLead, getSalesQuote } from '@/lib/server/sales-repository'
import { getReceiptBrand } from '@/lib/receipt-brand'

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const token = new URL(request.url).searchParams.get('token') || ''
  const quote = await getSalesQuote(params.id)
  const payment = quote?.paymentRecords?.find(item => item.publicToken === token)
  if (!quote || !payment) return NextResponse.json({ error: 'Receipt not found' }, { status: 404 })
  const lead = quote.leadId ? await getSalesLead(quote.leadId) : null
  return NextResponse.json({
    receipt: payment,
    quote: { id: quote.id, number: quote.number, total: quote.total, moveDate: quote.moveDate, originCity: quote.originCity, destCity: quote.destCity },
    customer: { name: lead?.name || 'Customer' },
    brand: getReceiptBrand(lead, quote),
  })
}
