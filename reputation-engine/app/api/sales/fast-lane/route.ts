import { NextResponse } from 'next/server'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'
import { randomToken } from '@/lib/server/security'
import {
  getLatestSalesQuoteByLeadId,
  getSalesLead,
  listSalesClients,
  saveSalesClient,
  saveSalesLead,
  saveSalesQuote,
} from '@/lib/server/sales-repository'
import { sendSalesMessage } from '@/lib/server/sales-messaging'
import { getAppBaseUrl } from '@/lib/server/runtime'
import {
  formatMoney,
  genQuoteNumber,
  normalizeClient,
  normalizeQuote,
  uid,
} from '@/lib/sales'

const HST = 0.13
const DEPOSIT = 100
const FAST_LANE_DEDUPE_WINDOW_MS = 6 * 60 * 60 * 1000

const RATES: Record<string, Record<number, number>> = {
  truck:  { 2: 160, 3: 225, 4: 315 },
  labor:  { 2: 120, 3: 150, 4: 200 },
}

function formatFastLaneWindow(minHours: number, maxHours: number) {
  return minHours === maxHours ? `${minHours} hrs` : `${minHours}-${maxHours} hrs`
}

function buildFastLaneTerms(minHours: number, maxHours: number) {
  const windowLabel = formatFastLaneWindow(minHours, maxHours)
  return {
    rangeLabel: windowLabel,
    lineItemDetails:
      minHours === maxHours
        ? `${minHours}-hour minimum · billed in 15-minute increments after the minimum`
        : `${minHours}-hour minimum · most jobs in this lane take about ${windowLabel} · billed in 15-minute increments after the minimum`,
    smsSummary:
      minHours === maxHours
        ? `${minHours}-hour minimum`
        : `Most jobs in this lane take about ${windowLabel}`,
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json() as {
      leadId: string
      moveType: 'truck' | 'labor'
      crew: 2 | 3 | 4
      minHours: number
      maxHours: number
      specialtyItems?: string[]  // ['piano', 'safe', 'pool_table', 'hot_tub']
    }

    const { leadId, moveType = 'truck', crew = 2, minHours = 3, maxHours = 5, specialtyItems = [] } = body

    if (!leadId) return NextResponse.json({ error: 'leadId required' }, { status: 400 })

    const lead = await getSalesLead(leadId)
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    if (!lead.phone && !lead.email) {
      return NextResponse.json({ error: 'Add a phone number or email before sending a Fast Lane quote.' }, { status: 400 })
    }

    const rate = RATES[moveType]?.[crew] ?? 225
    const quotedHours = minHours
    const subtotal = Math.round(rate * quotedHours * 100) / 100
    const hst = Math.round(subtotal * HST * 100) / 100
    const total = Math.round((subtotal + hst) * 100) / 100
    const balance = Math.round((total - DEPOSIT) * 100) / 100

    const crewLabel = moveType === 'truck'
      ? `${crew} movers + 26ft truck`
      : `${crew} movers (labour only)`

    const fastLaneTerms = buildFastLaneTerms(minHours, maxHours)
    const rangeLabel = fastLaneTerms.rangeLabel
    const fastLaneSignature = `Fast Lane quote · ${crewLabel} · $${rate}/hr · ${rangeLabel}`

    // Specialty notes
    const specialtyMap: Record<string, string> = {
      piano: 'Piano & Safe — requires extra care (discussed at time of booking)',
      pool_table: 'Pool Table — requires disassembly, quoted separately',
      hot_tub: 'Hot Tub / Swim Spa — specialty item, quoted separately',
    }
    const specialtyNote = specialtyItems
      .map(k => specialtyMap[k])
      .filter(Boolean)
      .join(' · ')

    // Find or create client
    const clients = await listSalesClients()
    let client = clients.find(c =>
      c.name === lead.name ||
      (lead.phone && c.phone === lead.phone) ||
      (lead.email && c.email === lead.email)
    ) || null

    if (!client) {
      client = await saveSalesClient(normalizeClient({
        id: uid('cli'),
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        type: 'residential',
        company: '',
        createdAt: new Date().toISOString().slice(0, 10),
      }))
    }

    const now = new Date().toISOString()
    const existingFastLaneQuote = await getLatestSalesQuoteByLeadId(lead.id).catch(() => null)
    if (
      existingFastLaneQuote &&
      existingFastLaneQuote.internalNotes === fastLaneSignature &&
      existingFastLaneQuote.acceptToken &&
      existingFastLaneQuote.sentAt &&
      Date.now() - new Date(existingFastLaneQuote.sentAt).getTime() <= FAST_LANE_DEDUPE_WINDOW_MS
    ) {
      const appUrl = getAppBaseUrl('https://mission-control1-reputation-engine.vercel.app')
      const bookingLink = `${appUrl}/quote-accept?id=${encodeURIComponent(existingFastLaneQuote.id)}&token=${encodeURIComponent(existingFastLaneQuote.acceptToken!)}&fastlane=1`
      return NextResponse.json({
        ok: true,
        quoteId: existingFastLaneQuote.id,
        token: existingFastLaneQuote.acceptToken,
        bookingLink,
        rate,
        crewLabel,
        rangeLabel,
        minimumHours: minHours,
        maximumHours: maxHours,
        minTotal: Math.round(rate * minHours * (1 + HST)),
        maxTotal: Math.round(rate * maxHours * (1 + HST)),
        channel: lead.phone ? 'sms' : 'email',
        recipient: lead.phone || lead.email,
        deduped: true,
      })
    }

    // Create quote
    const acceptToken = randomToken('accept')
    const quoteId = uid('qt')

    const quote = await saveSalesQuote(normalizeQuote({
      id: quoteId,
      number: `FL-${genQuoteNumber(lead.name)}`,
      clientId: client.id,
      leadId: lead.id,
      moveDate: lead.moveDate,
      moveType: lead.moveType || 'residential',
      quoteType: moveType === 'labor' ? 'labor_only' : 'standard',
      originCity: lead.originCity,
      destCity: lead.destCity,
      crewSize: crew,
      estimatedHours: quotedHours,
      truckCount: moveType === 'truck' ? 1 : 0,
      billingModel: 'hourly_minimum',
      minimumBillableHours: minHours,
      maximumEstimatedHours: maxHours,
      hourlyRateOverride: rate,
      status: 'sent',
      validDays: 7,
      acceptToken,
      lineItems: [{
        description: `${crewLabel} — $${rate}/hr`,
        details: fastLaneTerms.lineItemDetails,
        amount: subtotal,
      }],
      discountAmount: 0,
      discountLabel: '',
      subtotal,
      hst,
      total,
      deposit: DEPOSIT,
      balance,
      moveDescription: specialtyNote || undefined,
      internalNotes: fastLaneSignature,
      createdAt: now.slice(0, 10),
      sentAt: now,
    }))

    // Update lead stage to quoted + link the quote
    await saveSalesLead({
      ...lead,
      stage: lead.stage === 'new' || lead.stage === 'contacted' ? 'quoted' : lead.stage,
      quoteId: quote.id,
      quoteIds: Array.from(new Set([...(lead.quoteIds || []), quote.id])),
      lastTouchedAt: now,
      lastTouchedByUserId: session?.userId,
      lastTouchedByName: session?.name?.trim(),
    })

    // Build the booking link
    const appUrl = getAppBaseUrl('https://mission-control1-reputation-engine.vercel.app')
    const bookingLink = `${appUrl}/quote-accept?id=${encodeURIComponent(quote.id)}&token=${encodeURIComponent(acceptToken)}&fastlane=1`

    // Build and send SMS
    const firstName = lead.name?.split(' ')[0] || 'there'
    const minTotal = Math.round(rate * minHours * (1 + HST))
    const maxTotal = Math.round(rate * maxHours * (1 + HST))

    const smsBody = [
      `Hi ${firstName}! Here's your moving quote from Saturn Star. ⭐`,
      ``,
      `${crewLabel}`,
      `$${rate}/hr · ${fastLaneTerms.smsSummary}`,
      `Minimum charge: ${minHours} hour${minHours === 1 ? '' : 's'} · ${formatMoney(minTotal)} incl. HST`,
      maxHours > minHours ? `If the move runs longer, the same hourly rate continues up to about ${maxHours} hours in this lane.` : '',
      specialtyNote ? `📋 Note: ${specialtyItems.includes('piano') ? 'Piano/Safe' : ''}${specialtyItems.includes('pool_table') ? ' Pool Table' : ''}${specialtyItems.includes('hot_tub') ? ' Hot Tub' : ''} — see booking page for details.` : '',
      ``,
      `Important: this lane has a ${minHours}-hour minimum. If the crew finishes sooner, the minimum still applies. After that, time bills in 15-minute increments at the same rate.`,
      ``,
      `Lock in your date with a $${DEPOSIT} deposit:`,
      bookingLink,
      ``,
      `Questions? Call/text 226-773-2993`,
    ].filter(line => line !== null && line !== undefined && !(line === '' && false)).join('\n').replace(/\n{3,}/g, '\n\n')

    const sentChannel: 'sms' | 'email' = lead.phone ? 'sms' : 'email'
    const sentRecipient = lead.phone || lead.email || ''

    if (lead.phone) {
      await sendSalesMessage({
        channel: 'sms',
        to: lead.phone,
        body: smsBody,
        leadId: lead.id,
        quoteId: quote.id,
        notes: `⚡ Fast Lane Quote sent — ${crewLabel} · $${rate}/hr · ${rangeLabel}`,
        actor: 'human',
        actorName: session?.name,
        actorUserId: session?.userId,
      })
    } else if (lead.email) {
      await sendSalesMessage({
        channel: 'email',
        to: lead.email,
        subject: 'Your Saturn Star moving quote',
        body: smsBody,
        leadId: lead.id,
        quoteId: quote.id,
        notes: `⚡ Fast Lane Quote emailed — ${crewLabel} · $${rate}/hr · ${rangeLabel}`,
        actor: 'human',
        actorName: session?.name,
        actorUserId: session?.userId,
      })
    }

    return NextResponse.json({
      ok: true,
      quoteId: quote.id,
      token: acceptToken,
      bookingLink,
      rate,
      crewLabel,
      rangeLabel,
      minimumHours: minHours,
      maximumHours: maxHours,
      minTotal,
      maxTotal,
      channel: sentChannel,
      recipient: sentRecipient,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create fast lane quote' },
      { status: 500 }
    )
  }
}
