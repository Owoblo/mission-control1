import { NextResponse } from 'next/server'
import { listSalesLeads, saveSalesLead } from '@/lib/server/sales-repository'
import { uploadLeadMediaAssets } from '@/lib/server/lead-media'

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params
  const leads = await listSalesLeads()
  const lead = leads.find(item => (item.crewPayouts || []).some(entry => entry.dispatchToken === token && entry.subcontractorId))
  const entry = lead?.crewPayouts?.find(item => item.dispatchToken === token)
  if (!lead || !entry) return NextResponse.json({ error: 'Partner job access not found.' }, { status: 404 })
  const form = await request.formData()
  const files = (form.getAll('files') as File[]).filter(file => file && file.size > 0)
  const category = String(form.get('category') || 'incident').trim().slice(0, 50)
  if (!files.length) return NextResponse.json({ error: 'Select at least one photo or video.' }, { status: 400 })
  try {
    const assets = await uploadLeadMediaAssets({ leadId: lead.id, namespace: `partner-${category}-${Date.now()}`, files, room: `Partner evidence · ${category}`, source: 'rep_upload', category: 'customer_media', uploadedByName: entry.workerName, notes: `Partner field evidence · ${category}`, partyLabel: entry.workerName })
    await saveSalesLead({ ...lead, mediaAssets: [...(lead.mediaAssets || []), ...assets], lastTouchedAt: new Date().toISOString(), lastTouchedByName: entry.workerName })
    return NextResponse.json({ assets: assets.map(asset => ({ url: asset.url, contentType: asset.mimeType, category })) })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Upload failed.' }, { status: 500 }) }
}
