import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'

export const maxDuration = 30

const BUCKET = 'ops-media'
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

function sanitizeFilename(filename: string) {
  return (filename || 'media')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 120)
}

function extensionFromFile(file: File) {
  const fromName = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (fromName) return fromName
  const mime = (file.type || '').toLowerCase()
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/gif') return 'gif'
  if (mime === 'video/mp4') return 'mp4'
  if (mime === 'video/quicktime') return 'mov'
  if (mime === 'application/pdf') return 'pdf'
  return 'bin'
}

function isUnsupportedPhotoFormat(file: File) {
  const name = file.name.toLowerCase()
  const mime = file.type.toLowerCase()
  return mime.includes('heic') || mime.includes('heif') || /\.(heic|heif)$/i.test(name)
}

export async function POST(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    if (request.headers.get('content-type')?.includes('application/json')) {
      const input = await request.json() as { name?: string; type?: string; size?: number }
      const size = Number(input.size || 0)
      if (!input.name || !Number.isFinite(size) || size <= 0) {
        return NextResponse.json({ error: 'Invalid file details' }, { status: 400 })
      }
      if (size > MAX_UPLOAD_BYTES) {
        return NextResponse.json({ error: 'Videos and other attachments can be up to 50 MB.' }, { status: 413 })
      }

      const { url: supabaseUrl, headers } = requireSupabaseEnv()
      const supabaseKey = headers.apikey
      const safeName = sanitizeFilename(input.name)
      const path = `partnership-chat/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName}`
      const signRes = await fetch(`${supabaseUrl}/storage/v1/object/upload/sign/${BUCKET}/${path}`, {
        method: 'POST',
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })
      const signed = await signRes.json().catch(() => null) as { url?: string; token?: string; message?: string } | null
      if (!signRes.ok || !signed?.url) {
        return NextResponse.json({ error: signed?.message || 'Could not prepare upload' }, { status: 502 })
      }

      const uploadUrl = signed.url.startsWith('http')
        ? signed.url
        : `${supabaseUrl}/storage/v1${signed.url.startsWith('/') ? '' : '/'}${signed.url}`
      return NextResponse.json({
        ok: true,
        uploadUrl,
        url: `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${path}`,
      })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    if (isUnsupportedPhotoFormat(file)) {
      return NextResponse.json({ error: 'HEIC photos cannot be sent by SMS. Please choose JPG or PNG.' }, { status: 415 })
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: 'Videos and other attachments can be up to 50 MB.' }, { status: 413 })
    }

    const { url: supabaseUrl, headers } = requireSupabaseEnv()
    const supabaseKey = headers.apikey
    const safeName = sanitizeFilename(file.name || `media.${extensionFromFile(file)}`)
    const path = `partnership-chat/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName}`
    const bytes = await file.arrayBuffer()
    const uploadRes = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': file.type || 'application/octet-stream',
        'x-upsert': 'true',
      },
      body: bytes,
    })

    if (!uploadRes.ok) {
      const detail = await uploadRes.text().catch(() => '')
      return NextResponse.json({ error: detail || 'Upload failed' }, { status: uploadRes.status === 404 ? 500 : 400 })
    }

    const publicUrl = `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${path}`
    return NextResponse.json({ ok: true, url: publicUrl })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Upload failed' }, { status: 500 })
  }
}
