import { NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { getSalesOverview, listSalesLeadSearchSnapshots, listSalesQuotes } from '@/lib/server/sales-repository'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'
import { buildSalesSummary } from '@/lib/sales'
import { isBranchScopedManager, leadMatchesSessionBranch } from '@/lib/server/sales-permissions'
import { finishTimedResponse } from '@/lib/server/performance'
import type { CRMLead } from '@/lib/types'

// CRM read models are shared across users. A longer cache window prevents a
// browser refresh burst from rebuilding the same Supabase scans across many
// serverless instances while still keeping the dashboard reasonably current.
const OVERVIEW_CACHE_TTL_MS = 60_000
const QUOTES_CACHE_TTL_MS = 30_000
let overviewCache: {
  expiresAt: number
  payload: Awaited<ReturnType<typeof getSalesOverview>>
} | null = null
let overviewRefresh: Promise<Awaited<ReturnType<typeof getSalesOverview>>> | null = null
let quotesCache: {
  expiresAt: number
  payload: Awaited<ReturnType<typeof loadQuotesOverview>>
} | null = null
let quotesRefresh: Promise<Awaited<ReturnType<typeof loadQuotesOverview>>> | null = null

async function loadQuotesOverview() {
  const [leads, quotes] = await Promise.all([listSalesLeadSearchSnapshots(), listSalesQuotes()])
  return { leads, quotes }
}

async function loadCompactSalesOverview() {
  return compactOverview(await getSalesOverview())
}

// Vercel can spread one burst across several function instances. The shared
// data cache prevents each instance from independently rebuilding the same
// read model; the in-process promises below still coalesce requests per instance.
const loadSharedQuotesOverview = unstable_cache(loadQuotesOverview, ['sales-quotes-overview-v1'], {
  revalidate: QUOTES_CACHE_TTL_MS / 1000,
})
const loadSharedSalesOverview = unstable_cache(loadCompactSalesOverview, ['sales-overview-v3'], {
  revalidate: OVERVIEW_CACHE_TTL_MS / 1000,
})

async function getCachedQuotesOverview() {
  const now = Date.now()
  if (quotesCache && quotesCache.expiresAt > now) return quotesCache.payload
  if (!quotesRefresh) {
    quotesRefresh = loadSharedQuotesOverview()
      .then(payload => {
        quotesCache = { payload, expiresAt: Date.now() + QUOTES_CACHE_TTL_MS }
        return payload
      })
      .finally(() => { quotesRefresh = null })
  }
  return quotesRefresh
}

async function getCachedSalesOverview() {
  const now = Date.now()
  if (overviewCache && overviewCache.expiresAt > now) return overviewCache.payload
  if (!overviewRefresh) {
    overviewRefresh = loadSharedSalesOverview()
      .then(payload => {
        overviewCache = { payload, expiresAt: Date.now() + OVERVIEW_CACHE_TTL_MS }
        return payload
      })
      .finally(() => { overviewRefresh = null })
  }
  return overviewRefresh
}

function compactOverviewLead(lead: CRMLead): CRMLead {
  const {
    supabaseListing: _supabaseListing,
    listingScanSnapshot: _listingScanSnapshot,
    inventoryVerification: _inventoryVerification,
    inventory: _inventory,
    removedInventoryItemKeys: _removedInventoryItemKeys,
    mediaAssets: _mediaAssets,
    crewHours: _crewHours,
    crewPayouts: _crewPayouts,
    moveExecutionLog: _moveExecutionLog,
    opsChecklist: _opsChecklist,
    promises: _promises,
    ...overviewLead
  } = lead

  // List screens need call timing/outcome, but not transcripts, recordings, or
  // AI analyses. Full detail remains available from /api/sales/leads/:id.
  overviewLead.callLogs = lead.callLogs?.map(call => ({
    id: call.id,
    type: call.type,
    date: call.date,
    direction: call.direction,
    isVoicemail: call.isVoicemail,
    notes: call.notes,
  }))
  return overviewLead
}

function compactOverview<T extends Awaited<ReturnType<typeof getSalesOverview>>>(overview: T): T {
  return {
    ...overview,
    leads: overview.leads.map(compactOverviewLead),
    // AI call/message analysis belongs on lead detail. List screens use only
    // activity identity, type, timestamps and notes for guidance/feed labels.
    followUps: overview.followUps.map(({ aiSummary: _aiSummary, ...followUp }) => followUp),
  } as T
}

function pipelineLead(lead: CRMLead): CRMLead {
  return {
    id: lead.id,
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    stage: lead.stage,
    source: lead.source,
    branch: lead.branch,
    assignedRep: lead.assignedRep,
    assignedRepUserId: lead.assignedRepUserId,
    createdAt: lead.createdAt,
    lastTouchedAt: lead.lastTouchedAt,
    lastInboundAt: lead.lastInboundAt,
    lastOutboundAt: lead.lastOutboundAt,
    lastMissedCallAt: lead.lastMissedCallAt,
    followUpDate: lead.followUpDate,
    followUpNote: lead.followUpNote,
    moveDate: lead.moveDate,
    moveDateFlexible: lead.moveDateFlexible,
    moveDateFlexibleReason: lead.moveDateFlexibleReason,
    moveType: lead.moveType,
    originAddress: lead.originAddress,
    originCity: lead.originCity,
    destAddress: lead.destAddress,
    destCity: lead.destCity,
    originAccess: lead.originAccess,
    destAccess: lead.destAccess,
    propertyType: lead.propertyType,
    quoteId: lead.quoteId,
    leadScore: lead.leadScore,
    leadKind: lead.leadKind,
    contextFlag: lead.contextFlag,
    primaryContactRole: lead.primaryContactRole,
    opportunityCity: lead.opportunityCity,
    realtorBrokerage: lead.realtorBrokerage,
    opportunityContext: lead.opportunityContext,
    paymentStatus: lead.paymentStatus,
    depositAmount: lead.depositAmount,
    tentativeDecisionDate: lead.tentativeDecisionDate,
    tentativeReason: lead.tentativeReason,
    tentativeReservationStatus: lead.tentativeReservationStatus,
    totalItems: lead.totalItems,
    inventory: lead.inventory?.length ? [{} as NonNullable<CRMLead['inventory']>[number]] : [],
    intelligence: lead.intelligence ? {
      personaBadges: lead.intelligence.personaBadges,
      detectedConcerns: lead.intelligence.detectedConcerns,
      keyInsights: lead.intelligence.keyInsights,
      winFactors: lead.intelligence.winFactors,
      suggestedSalesLanguage: lead.intelligence.suggestedSalesLanguage,
      nextAction: lead.intelligence.nextAction,
      lastAnalyzedAt: lead.intelligence.lastAnalyzedAt,
    } : undefined,
    callLogs: [...(lead.callLogs || [])]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 3)
      .map(call => ({
      id: call.id,
      type: call.type,
      date: call.date,
      direction: call.direction,
      isVoicemail: call.isVoicemail,
      notes: call.notes?.slice(0, 240),
      aiSummary: call.aiSummary ? {
        summary: call.aiSummary.summary?.slice(0, 240),
        leadConcern: call.aiSummary.leadConcern?.slice(0, 160),
      } : undefined,
    })),
  } as CRMLead
}

function buildPipelineOverview(overview: Awaited<ReturnType<typeof getSalesOverview>>) {
  const recentFollowUps = new Map<string, typeof overview.followUps>()
  for (const followUp of overview.followUps) {
    const key = followUp.leadId || (followUp.quoteId ? `quote:${followUp.quoteId}` : '')
    if (!key) continue
    const items = recentFollowUps.get(key) || []
    if (items.length < 8) {
      items.push(followUp)
      recentFollowUps.set(key, items)
    }
  }
  return {
    leads: overview.leads.map(pipelineLead),
    quotes: overview.quotes.map(quote => ({
      id: quote.id,
      leadId: quote.leadId,
      total: quote.total,
      status: quote.status,
      createdAt: quote.createdAt,
      sentAt: quote.sentAt,
      viewedAt: quote.viewedAt,
      acceptedAt: quote.acceptedAt,
      validDays: quote.validDays,
      depositPaidAt: quote.depositPaidAt,
      depositPaidAmount: quote.depositPaidAmount,
      depositStripePaymentIntentId: quote.depositStripePaymentIntentId,
      lineItems: quote.lineItems?.length ? [{}] : [],
    })),
    followUps: Array.from(recentFollowUps.values()).flat().map(followUp => ({
      id: followUp.id,
      leadId: followUp.leadId,
      quoteId: followUp.quoteId,
      type: followUp.type,
      date: followUp.date,
      createdAt: followUp.createdAt,
      notes: followUp.notes,
    })),
  }
}

function buildDashboardOverview(overview: Awaited<ReturnType<typeof getSalesOverview>>) {
  const leads = overview.leads.map(lead => ({
    id: lead.id,
    name: lead.name,
    phone: lead.phone,
    stage: lead.stage,
    assignedRep: lead.assignedRep,
    assignedRepName: lead.assignedRepName,
    assignedRepUserId: lead.assignedRepUserId,
    createdAt: lead.createdAt,
    followUpDate: lead.followUpDate,
    followUpNote: lead.followUpNote,
    moveDate: lead.moveDate,
    originAddress: lead.originAddress,
    originCity: lead.originCity,
    destAddress: lead.destAddress,
    destCity: lead.destCity,
    quoteId: lead.quoteId,
    callLogs: [...(lead.callLogs || [])]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 3)
      .map(call => ({ id: call.id, type: call.type, date: call.date, direction: call.direction, isVoicemail: call.isVoicemail })),
  })) as CRMLead[]
  const leadIds = new Set(leads.map(lead => lead.id))
  const quotes = overview.quotes
    .filter(quote => !quote.leadId || leadIds.has(quote.leadId))
    .map(quote => ({
      id: quote.id,
      leadId: quote.leadId,
      number: quote.number,
      total: quote.total,
      status: quote.status,
      createdAt: quote.createdAt,
      sentAt: quote.sentAt,
      viewedAt: quote.viewedAt,
      acceptedAt: quote.acceptedAt,
      respondedAt: quote.respondedAt,
      validDays: quote.validDays,
    })) as typeof overview.quotes
  const followUps = overview.followUps
    .filter(item => Boolean(item.leadId && leadIds.has(item.leadId)))
    .map(item => ({ id: item.id, leadId: item.leadId, quoteId: item.quoteId, type: item.type, date: item.date, createdAt: item.createdAt }))
  return { leads, quotes, followUps, summary: buildSalesSummary(leads, quotes) }
}

export async function GET(request: Request) {
  const startedAt = performance.now()
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return finishTimedResponse(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), startedAt, 'sales_overview')
    }

    const mode = new URL(request.url).searchParams.get('mode')
    if (mode === 'search') {
      const leads = await listSalesLeadSearchSnapshots()
      return finishTimedResponse(NextResponse.json({ leads: leads.filter(lead => leadMatchesSessionBranch(lead, session)) }), startedAt, 'sales_overview_search')
    }
    if (mode === 'quotes') {
      const { leads: allLeads, quotes: allQuotes } = await getCachedQuotesOverview()
      const leads = allLeads.filter(lead => leadMatchesSessionBranch(lead, session))
      const leadIds = new Set(leads.map(lead => lead.id))
      const quotes = isBranchScopedManager(session)
        ? allQuotes.filter(quote => Boolean(quote.leadId && leadIds.has(quote.leadId)))
        : allQuotes
      return finishTimedResponse(NextResponse.json({ leads, quotes }), startedAt, 'sales_overview_quotes')
    }

    if (mode === 'pipeline') {
      const fullOverview = await getCachedSalesOverview()
      const pipeline = buildPipelineOverview(fullOverview)
      if (!isBranchScopedManager(session)) {
        return finishTimedResponse(NextResponse.json(pipeline), startedAt, 'sales_overview_pipeline')
      }
      const leads = pipeline.leads.filter(lead => leadMatchesSessionBranch(lead, session))
      const leadIds = new Set(leads.map(lead => lead.id))
      const quotes = pipeline.quotes.filter(quote => Boolean(quote.leadId && leadIds.has(quote.leadId)))
      const quoteIds = new Set(quotes.map(quote => quote.id))
      const followUps = pipeline.followUps.filter(item =>
        Boolean((item.leadId && leadIds.has(item.leadId)) || (item.quoteId && quoteIds.has(item.quoteId)))
      )
      return finishTimedResponse(NextResponse.json({ leads, quotes, followUps }), startedAt, 'sales_overview_pipeline')
    }

    if (mode === 'dashboard') {
      const fullOverview = await getCachedSalesOverview()
      const scopedOverview = isBranchScopedManager(session)
        ? { ...fullOverview, leads: fullOverview.leads.filter(lead => leadMatchesSessionBranch(lead, session)) }
        : fullOverview
      return finishTimedResponse(NextResponse.json(buildDashboardOverview(scopedOverview)), startedAt, 'sales_overview_dashboard')
    }

    const fullOverview = await getCachedSalesOverview()
    const overview = compactOverview(fullOverview)

    if (isBranchScopedManager(session)) {
      const leads = overview.leads.filter(lead => leadMatchesSessionBranch(lead, session))
      const leadIds = new Set(leads.map(lead => lead.id))
      const quotes = overview.quotes.filter(quote => Boolean(quote.leadId && leadIds.has(quote.leadId)))
      const quoteIds = new Set(quotes.map(quote => quote.id))
      const clientIds = new Set(quotes.map(quote => quote.clientId).filter(Boolean))
      const clients = overview.clients.filter(client => clientIds.has(client.id))
      const followUps = overview.followUps.filter(log =>
        Boolean((log.leadId && leadIds.has(log.leadId)) || (log.quoteId && quoteIds.has(log.quoteId)))
      )
      return finishTimedResponse(NextResponse.json({ leads, quotes, clients, followUps, summary: buildSalesSummary(leads, quotes) }), startedAt, 'sales_overview')
    }

    return finishTimedResponse(NextResponse.json(overview), startedAt, 'sales_overview')
  } catch (error) {
    console.error('[sales-overview] Live CRM read failed', error)
    if (overviewCache) {
      return finishTimedResponse(NextResponse.json(
        { ...compactOverview(overviewCache.payload), stale: true, warning: 'Live data is temporarily unavailable.' },
        { headers: { 'X-Saturn-Data': 'stale', 'Retry-After': '5' } }
      ), startedAt, 'sales_overview')
    }
    return finishTimedResponse(NextResponse.json(
      { error: 'CRM data is temporarily unavailable. Please retry.', retryable: true },
      { status: 503, headers: { 'Retry-After': '5' } }
    ), startedAt, 'sales_overview')
  }
}
