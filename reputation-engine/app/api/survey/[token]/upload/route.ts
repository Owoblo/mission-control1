import { NextResponse } from 'next/server'
import { applyLeadMediaAnalysis, uploadLeadMediaAssets } from '@/lib/server/lead-media'
import { getSalesLead, saveSalesLead } from '@/lib/server/sales-repository'
import { requireSupabaseEnv } from '@/lib/server/runtime'

async function getLeadByToken(token: string) {
  const { url, headers } = requireSupabaseEnv()
  // Query directly by surveyToken field — never fetch all leads
  const response = await fetch(
    `${url}/rest/v1/crm_leads?select=id,data&data->>surveyToken=eq.${encodeURIComponent(token)}&deleted=not.is.true&limit=1`,
    { headers, cache: 'no-store' }
  )
  if (!response.ok) return null
  const rows = await response.json() as Array<{ id: string; data: Record<string, unknown> }>
  return rows[0] || null
}

export async function POST(
  request: Request,
  { params }: { params: { token: string } }
) {
  try {
    const row = await getLeadByToken(params.token)
    if (!row) return NextResponse.json({ error: 'Invalid survey link' }, { status: 404 })

    const lead = await getSalesLead(row.id)
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    const expiresAt = row.data.surveyTokenExpiresAt as string | undefined
    if (expiresAt && new Date(expiresAt) < new Date()) {
      return NextResponse.json({ error: 'Survey link has expired' }, { status: 410 })
    }

    const formData = await request.formData()
    const room = (formData.get('room') as string) || 'other'
    const files = (formData.getAll('photos') as File[]).filter(Boolean)
    if (!files.length) return NextResponse.json({ error: 'No photos provided' }, { status: 400 })

    // Store photos immediately — NO AI scanning here (that happens on the rep's side)
    const assets = await uploadLeadMediaAssets({
      leadId: lead.id,
      namespace: params.token,
      files,
      room,
      source: 'survey',
    })

    // Save assets to lead (no inventory changes yet — scan happens later)
    const updatedLead = applyLeadMediaAnalysis(lead, {
      assets,
      detectedItems: [],   // empty — AI runs on the rep side, not here
      source: 'survey',
    })
    await saveSalesLead(updatedLead)

    return NextResponse.json({
      ok: true,
      uploadedCount: assets.length,
      room,
      totalPhotoCount: updatedLead.surveyPhotoCount || 0,
    })
  } catch (error) {
    console.error('[survey/upload] error', error)
    return NextResponse.json({ error: 'Upload failed', detail: String(error) }, { status: 500 })
  }
}
