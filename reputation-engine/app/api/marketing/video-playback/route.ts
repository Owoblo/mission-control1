import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { normalizeSmsMediaUrls } from '@/lib/sms-media'
import { prepareVideoPlayback } from '@/lib/server/video-playback'

export const runtime = 'nodejs'
export const maxDuration = 240

export async function POST(request: Request) {
  if (!(await getSessionUser())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const input = await request.json().catch(() => null)
  if (typeof input?.touchId !== 'string' || typeof input?.url !== 'string') {
    return NextResponse.json({ error: 'Missing video attachment.' }, { status: 400 })
  }
  try {
    const { url, headers } = requireSupabaseEnv()
    const query = new URLSearchParams({ id: `eq.${input.touchId}`, select: 'notes,metadata', limit: '1' })
    const response = await fetch(`${url}/rest/v1/market_touches?${query}`, { headers, cache: 'no-store' })
    if (!response.ok) throw new Error('Could not load the video attachment.')
    const [touch] = await response.json()
    const attachments = touch?.metadata?.attachments
    const sources = normalizeSmsMediaUrls({ body: touch?.notes, metadata: touch?.metadata })
    if (Array.isArray(attachments)) for (const item of attachments) {
      if (typeof item?.url === 'string') sources.push(item.url)
    }
    if (!touch || !sources.includes(input.url)) {
      return NextResponse.json({ error: 'Video attachment not found in this conversation.' }, { status: 404 })
    }
    return NextResponse.json({ url: await prepareVideoPlayback(input.url) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not prepare video.' }, { status: 502 })
  }
}
