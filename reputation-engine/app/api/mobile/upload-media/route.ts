import { NextResponse } from 'next/server'
import { getRequestSessionUser } from '@/lib/server/request-session'
import { requireSupabaseEnv } from '@/lib/server/runtime'

export const maxDuration = 30

const BUCKET = 'ops-media'
const MAX_UPLOAD_BYTES = 4_000_000
const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
])

function safeFilename(value: string) {
  return (value || 'attachment')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 120)
}

export async function POST(request: Request) {
  const session = await getRequestSessionUser(request)
  if (!session?.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const form = await request.formData()
    const file = form.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'Choose a file first' }, { status: 400 })
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: 'Attachments must be smaller than 4 MB' }, { status: 413 })
    }
    if (!ALLOWED_TYPES.has(file.type.toLowerCase())) {
      return NextResponse.json(
        { error: 'Use JPG, PNG, WEBP, GIF, PDF, or TXT files' },
        { status: 415 },
      )
    }

    const { url, headers } = requireSupabaseEnv()
    const key = headers.apikey
    const path = [
      'mobile-mms',
      new Date().toISOString().slice(0, 10),
      `${Date.now()}-${Math.random().toString(36).slice(2)}-${safeFilename(file.name)}`,
    ].join('/')
    const upload = await fetch(`${url}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': file.type,
        'x-upsert': 'false',
      },
      body: await file.arrayBuffer(),
    })
    if (!upload.ok) {
      return NextResponse.json({ error: 'Attachment upload failed' }, { status: 502 })
    }

    return NextResponse.json({
      ok: true,
      url: `${url}/storage/v1/object/public/${BUCKET}/${path}`,
      name: file.name,
      type: file.type,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Attachment upload failed' },
      { status: 500 },
    )
  }
}
