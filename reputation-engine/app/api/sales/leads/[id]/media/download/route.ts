import { NextResponse } from 'next/server'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'
import { getSalesLead } from '@/lib/server/sales-repository'
import { createStoredZip } from '@/lib/server/zip'

export async function GET(_: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const session = await getSessionUser()
  if (!canAccessSalesWorkspace(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const lead = await getSalesLead(id)
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  const assets = (lead.mediaAssets || []).filter(asset =>
    !asset.removed && ['survey', 'rep_upload', 'mms'].includes(asset.source) && Boolean(asset.url)
  )
  if (!assets.length) return NextResponse.json({ error: 'No customer media to download' }, { status: 404 })

  const entries = []
  let totalBytes = 0
  for (const [index, asset] of assets.entries()) {
    const response = await fetch(asset.url, { signal: AbortSignal.timeout(30_000) })
    if (!response.ok) continue
    const data = Buffer.from(await response.arrayBuffer())
    totalBytes += data.length
    if (totalBytes > 250 * 1024 * 1024) return NextResponse.json({ error: 'Media bundle exceeds the 250 MB download limit.' }, { status: 413 })
    entries.push({ filename: asset.filename || `customer-media-${index + 1}`, data })
  }
  if (!entries.length) return NextResponse.json({ error: 'The media files could not be retrieved.' }, { status: 502 })
  const zip = createStoredZip(entries)
  const customer = lead.name.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'customer'
  return new Response(zip, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${customer}-media.zip"`,
      'Content-Length': String(zip.length),
    },
  })
}
