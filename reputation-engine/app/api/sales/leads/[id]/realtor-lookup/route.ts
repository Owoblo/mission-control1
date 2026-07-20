/**
 * POST /api/sales/leads/[id]/realtor-lookup
 *
 * Uses OpenAI Responses API with web_search_preview tool to find the listing agent.
 * Same approach as Claude.ai — live web search, no additional API keys needed.
 * Works for active AND sold listings.
 */
import { NextResponse } from 'next/server'
import { canAutoApplyRealtorContact } from '@/lib/realtor-opportunity'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSalesLead } from '@/lib/server/sales-repository'
import { getSessionUser } from '@/lib/server/session'
import { readEnv } from '@/lib/server/runtime'

export const maxDuration = 60

export async function POST(_: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const lead = await getSalesLead(params.id)
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    const address = [
      lead.opportunityAddress || lead.originAddress,
      lead.opportunityCity || lead.originCity,
    ].filter(Boolean).join(', ')

    const brokerage = lead.realtorBrokerage ||
      (lead.supabaseListing as Record<string, unknown> | null)?.brokername as string || ''

    if (!address) {
      return NextResponse.json({ error: 'No address on this lead to search' }, { status: 400 })
    }

    const apiKey = readEnv('OPENAI_API_KEY')
    if (!apiKey) return NextResponse.json({ error: 'Missing OPENAI_API_KEY' }, { status: 500 })

    // Use OpenAI Responses API with web_search_preview — same as Claude.ai web search
    // Search for both the listing agent AND the brokerage contact if no individual found
    const query = brokerage
      ? `Who is the specific listing agent or sales rep at "${brokerage}" for the property at ${address}? Find their full name, direct phone number, and email. If not found, find the main contact phone and email for ${brokerage}.`
      : `Who is the listing agent/realtor for the property at ${address}? Find their full name, direct phone number, and email address.`

    const searchRes = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        tools: [{ type: 'web_search_preview' }],
        input: query,
      }),
      signal: AbortSignal.timeout(45000),
    })

    if (!searchRes.ok) {
      const err = await searchRes.text().catch(() => '')
      throw new Error(`OpenAI search error: ${searchRes.status} ${err.slice(0, 200)}`)
    }

    const searchData = (await searchRes.json()) as {
      output?: Array<{
        type: string
        content?: Array<{ type: string; text?: string }>
        text?: string
      }>
      output_text?: string
    }

    // Extract the text response
    const rawText =
      searchData.output_text ||
      searchData.output?.flatMap(item => item.content || []).find(c => c.type === 'output_text')?.text ||
      searchData.output?.find(item => item.type === 'message')?.content?.find(c => c.type === 'output_text')?.text ||
      ''

    if (!rawText) {
      return NextResponse.json({ error: 'No search results returned' }, { status: 500 })
    }

    // Now extract structured data from the web search response
    const extractRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        max_tokens: 250,
        temperature: 0.0,
        messages: [{
          role: 'user',
          content: `Extract listing-side contact info from this text about ${address}:\n\n${rawText}\n\nReturn JSON only: {"realtorName": null, "realtorPhone": null, "realtorEmail": null, "realtorBrokerage": null, "contactKind": "listing_agent|sales_representative|brokerage_office|unknown", "confidence": "high|medium|low", "source": "brief note"}. Use null if not found. Do NOT invent phone or email numbers.`,
        }],
      }),
    })

    const extractData = (await extractRes.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = extractData.choices?.[0]?.message?.content || '{}'

    let extracted: {
      realtorName?: string | null
      realtorPhone?: string | null
      realtorEmail?: string | null
      realtorBrokerage?: string | null
      contactKind?: string
      confidence?: string
      source?: string
    } = {}

    try { extracted = JSON.parse(content) } catch { /* empty */ }

    const autoApplySafe = canAutoApplyRealtorContact({
      rawText,
      expectedBrokerage: brokerage,
      realtorName: extracted.realtorName,
      realtorPhone: extracted.realtorPhone,
      realtorEmail: extracted.realtorEmail,
      realtorBrokerage: extracted.realtorBrokerage,
      contactKind: extracted.contactKind,
      confidence: extracted.confidence,
    })

    return NextResponse.json({
      ok: true,
      address,
      searchSummary: rawText.slice(0, 500),
      realtorName: extracted.realtorName || null,
      realtorPhone: extracted.realtorPhone || null,
      realtorEmail: extracted.realtorEmail || null,
      realtorBrokerage: extracted.realtorBrokerage || brokerage || null,
      contactKind: extracted.contactKind || 'unknown',
      confidence: extracted.confidence || 'low',
      source: extracted.source || 'web search',
      autoApplySafe,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Realtor lookup failed' },
      { status: 500 }
    )
  }
}
