/**
 * POST /api/sales/operations/upload-media
 * Accepts a file upload and stores it in Supabase ops-media bucket.
 * Uses service role credentials so anon users don't need storage write access.
 */
import { NextResponse } from 'next/server'

const SUPA_URL = 'https://idbyrtwdeeruiutoukct.supabase.co'
const BUCKET = 'ops-media'

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

    const ext = file.name.split('.').pop() || 'bin'
    const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

    // Get service role key at runtime
    const serviceKey = process.env.SUPABASE_KEY
    if (!serviceKey) return NextResponse.json({ error: 'Storage not configured' }, { status: 500 })

    const bytes = await file.arrayBuffer()
    const res = await fetch(`${SUPA_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': file.type || 'application/octet-stream',
        'x-upsert': 'true',
      },
      body: bytes,
    })

    if (!res.ok) {
      const err = await res.text()
      return NextResponse.json({ error: `Upload failed: ${err}` }, { status: 400 })
    }

    const publicUrl = `${SUPA_URL}/storage/v1/object/public/${BUCKET}/${path}`
    return NextResponse.json({ ok: true, url: publicUrl })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Upload failed' }, { status: 500 })
  }
}
