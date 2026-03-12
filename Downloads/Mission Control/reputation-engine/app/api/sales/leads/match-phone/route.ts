import { NextResponse } from 'next/server'
import { listSalesLeads } from '@/lib/server/sales-repository'

function digitsOnly(value?: string) {
  return (value || '').replace(/\D/g, '')
}

export async function GET(request: Request) {
  try {
    const phone = new URL(request.url).searchParams.get('phone') || ''
    const digits = digitsOnly(phone)
    if (digits.length < 10) {
      return NextResponse.json({ lead: null })
    }

    const leads = await listSalesLeads()
    const matched = leads.find(lead => {
      const leadDigits = digitsOnly(lead.phone)
      return leadDigits && (leadDigits === digits || leadDigits.endsWith(digits) || digits.endsWith(leadDigits))
    }) || null

    return NextResponse.json({ lead: matched })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to match lead by phone' },
      { status: 500 }
    )
  }
}
