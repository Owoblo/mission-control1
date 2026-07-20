import { NextResponse } from 'next/server'
import { applyLeadMediaAnalysis, uploadLeadMediaAssets } from '@/lib/server/lead-media'
import { getSalesLead, saveSalesLead } from '@/lib/server/sales-repository'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { sendRepAlertEmail, surveyPhotosUploadedEmail } from '@/lib/server/internal-notifications'

export const maxDuration = 60

async function getLeadByToken(token: string): Promise<{ id: string; data: Record<string, unknown>; partyLabel?: string } | null> {
  const { url, headers } = requireSupabaseEnv()
  // Check primary survey token
  const r1 = await fetch(
    `${url}/rest/v1/crm_leads?select=id,data&data->>surveyToken=eq.${encodeURIComponent(token)}&deleted=not.is.true&limit=1`,
    { headers, cache: 'no-store' }
  )
  if (r1.ok) {
    const rows = await r1.json() as Array<{ id: string; data: Record<string, unknown> }>
    if (rows[0]) return rows[0]
  }
  // Check Party B survey token
  const r2 = await fetch(
    `${url}/rest/v1/crm_leads?select=id,data&data->>surveyTokenPartyB=eq.${encodeURIComponent(token)}&deleted=not.is.true&limit=1`,
    { headers, cache: 'no-store' }
  )
  if (r2.ok) {
    const rows = await r2.json() as Array<{ id: string; data: Record<string, unknown> }>
    if (rows[0]) {
      const partyLabel = (rows[0].data.surveyTokenPartyBLabel as string | undefined) || 'Party B'
      return { ...rows[0], partyLabel }
    }
  }
  return null
}

export async function POST(request: Request, props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  try {
    const row = await getLeadByToken(params.token)
    if (!row) return NextResponse.json({ error: 'Invalid survey link' }, { status: 404 })

    const lead = await getSalesLead(row.id)
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    const isPartyB = !!row.partyLabel
    const expiresAt = (isPartyB ? row.data.surveyTokenPartyBExpiresAt : row.data.surveyTokenExpiresAt) as string | undefined
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
      partyLabel: row.partyLabel,
    })

    // Save assets to lead (no inventory changes yet — scan happens later)
    const updatedLead = applyLeadMediaAnalysis(lead, {
      assets,
      detectedItems: [],   // empty — AI runs on the rep side, not here
      source: 'survey',
    })
    await saveSalesLead(updatedLead)

    // Notify team — customer uploaded photos
    if (lead.name && assets.length > 0) {
      void sendRepAlertEmail(
        `📸 ${lead.name} uploaded ${assets.length} photo${assets.length !== 1 ? 's' : ''} — ${room}`,
        surveyPhotosUploadedEmail(lead.name, lead.id, assets.length, room)
      ).catch(() => {})
    }

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
