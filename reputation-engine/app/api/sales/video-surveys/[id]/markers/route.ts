import { NextResponse } from 'next/server'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'
import { addVideoSurveyMarker, appendVideoSurveyEvent, getVideoSurveySession, listVideoSurveyMarkers, updateVideoSurveySession } from '@/lib/server/video-survey-repository'
import type { VideoSurveyMarkerKind } from '@/lib/video-survey'

const ALLOWED_KINDS = new Set<VideoSurveyMarkerKind>([
  'room', 'snapshot', 'measure', 'staying_behind', 'oversized',
  'fragile', 'disassembly', 'access', 'note',
])

export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!canAccessSalesWorkspace(user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await props.params
  return NextResponse.json({ markers: await listVideoSurveyMarkers(id) })
}

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser()
    if (!canAccessSalesWorkspace(user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await props.params
    const session = await getVideoSurveySession(id)
    if (!session) return NextResponse.json({ error: 'Video survey not found' }, { status: 404 })
    const body = await request.json() as {
      kind?: VideoSurveyMarkerKind
      room?: string
      label?: string
      note?: string
      offsetMs?: number
    }
    if (!body.kind || !ALLOWED_KINDS.has(body.kind)) {
      return NextResponse.json({ error: 'Invalid marker type.' }, { status: 400 })
    }
    const marker = await addVideoSurveyMarker({
      sessionId: id,
      kind: body.kind,
      room: body.room?.slice(0, 100),
      label: body.label?.slice(0, 160),
      note: body.note?.slice(0, 1000),
      offsetMs: Number.isFinite(body.offsetMs) ? Math.max(0, Number(body.offsetMs)) : null,
      createdByType: 'rep',
      createdById: user?.userId,
    })
    if (body.kind === 'room' && body.room) {
      await updateVideoSurveySession(id, { current_room: body.room.slice(0, 100) })
    }
    await appendVideoSurveyEvent({
      sessionId: id,
      type: `marker.${body.kind}`,
      actorType: 'rep',
      actorId: user?.userId,
      payload: { room: body.room || null, offsetMs: body.offsetMs ?? null },
    })
    return NextResponse.json({ marker })
  } catch (error) {
    console.error('[video-survey/marker]', error)
    return NextResponse.json({ error: 'Could not save marker.' }, { status: 500 })
  }
}

