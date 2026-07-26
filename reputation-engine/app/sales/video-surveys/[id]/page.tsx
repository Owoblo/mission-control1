'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import type { VideoSurveyMarkerKind, VideoSurveyPresence, VideoSurveySession } from '@/lib/video-survey'
import { canJoinVideoSurvey, isVideoSurveyParticipantPresent, videoSurveyProcessingStages, videoSurveyStatusLabel } from '@/lib/video-survey'
import { VideoSurveyReviewPanel } from '@/app/components/sales/video-survey-review-panel'

const VideoSurveyRoom = dynamic(() => import('@/app/components/video-survey-room'), { ssr: false })

const ROOMS = ['Living Room', 'Dining Room', 'Kitchen', 'Primary Bedroom', 'Bedroom', 'Office', 'Basement', 'Garage', 'Storage', 'Outdoor', 'Other']
const FLAGS: Array<{ kind: VideoSurveyMarkerKind; label: string }> = [
  { kind: 'measure', label: 'Measure' },
  { kind: 'staying_behind', label: 'Staying behind' },
  { kind: 'oversized', label: 'Oversized' },
  { kind: 'fragile', label: 'Fragile' },
  { kind: 'disassembly', label: 'Disassembly' },
  { kind: 'access', label: 'Access' },
]

export default function RepresentativeVideoSurveyPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const id = String(params?.id || '')
  const [session, setSession] = useState<VideoSurveySession | null>(null)
  const [authToken, setAuthToken] = useState('')
  const [roomName, setRoomName] = useState('Saturn video survey')
  const [markers, setMarkers] = useState<Array<Record<string, unknown>>>([])
  const [room, setRoom] = useState('Living Room')
  const [note, setNote] = useState('')
  const [recording, setRecording] = useState<Record<string, unknown> | null>(null)
  const [analysis, setAnalysis] = useState<Record<string, unknown> | null>(null)
  const [presence, setPresence] = useState<VideoSurveyPresence>({ customer: null, representative: null })
  const [error, setError] = useState<string | null>(null)
  const startedAt = useMemo(() => Date.now(), [])

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      fetch(`/api/sales/video-surveys/${encodeURIComponent(id)}/presence`, { cache: 'no-store' }).then(async response => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Could not load the survey.')
        return data
      }),
      fetch(`/api/sales/video-surveys/${encodeURIComponent(id)}/markers`).then(response => response.json()),
    ]).then(async ([presenceData, markerData]) => {
      if (cancelled) return
      setSession(presenceData.session)
      setPresence(presenceData.presence || { customer: null, representative: null })
      setRecording(presenceData.recording || null)
      setAnalysis(presenceData.analysis || null)
      setMarkers(markerData.markers || [])
      if (!canJoinVideoSurvey(presenceData.session.status)) return
      const response = await fetch(`/api/sales/video-surveys/${encodeURIComponent(id)}/join`, { method: 'POST' })
      const joinData = await response.json()
      if (!response.ok) throw new Error(joinData.error || 'Could not join the survey.')
      if (cancelled) return
      setAuthToken(joinData.authToken)
      setRoomName(joinData.roomName)
      setSession(joinData.session)
    }).catch(cause => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load the survey.')
    })
    return () => { cancelled = true }
  }, [id])

  useEffect(() => {
    if (!id) return
    const controller = new AbortController()
    const refresh = () => {
      void fetch(`/api/sales/video-surveys/${encodeURIComponent(id)}/presence`, {
        cache: 'no-store',
        signal: controller.signal,
      }).then(async response => {
        const data = await response.json()
        if (response.ok) {
          setRecording(data.recording || null)
          setAnalysis(data.analysis || null)
          setPresence(data.presence || { customer: null, representative: null })
          if (data.session) setSession(data.session)
        }
      }).catch(() => null)
    }
    refresh()
    const timer = window.setInterval(refresh, 5_000)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [id])

  const processingStages = videoSurveyProcessingStages({
    sessionStatus: session?.status || 'ready',
    recordingStatus: String(recording?.status || ''),
    analysisStage: String(analysis?.stage || ''),
    analysisProgress: Number(analysis?.progress || 0),
  })
  const playbackUrl = String(recording?.provider_download_url || '')
  const callEnded = Boolean(session?.endedAt) || ['completed', 'recording_processing', 'analysis_pending', 'analyzing', 'review_required', 'confirmed'].includes(session?.status || '')

  async function addMarker(kind: VideoSurveyMarkerKind, label?: string) {
    setError(null)
    try {
      const response = await fetch(`/api/sales/video-surveys/${encodeURIComponent(id)}/markers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          room,
          label: label || (kind === 'room' ? room : undefined),
          note: note.trim() || undefined,
          offsetMs: Date.now() - startedAt,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not save marker.')
      setMarkers(current => [...current, data.marker])
      if (kind === 'note') setNote('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save marker.')
    }
  }

  if (error && !authToken && !session) {
    return <div className="mx-auto max-w-xl p-8"><div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800">{error}</div></div>
  }

  return (
    <main className="min-h-screen bg-[#071421] text-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-6">
        <div>
          <Link href={session ? `/sales/leads/${session.leadId}` : '/sales'} className="text-xs text-white/60 hover:text-white">← Back to lead</Link>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="font-semibold">Video Survey Studio</h1>
            {session && <span className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-semibold">{videoSurveyStatusLabel(session.status)}</span>}
          </div>
        </div>
        <div className={`rounded-xl px-4 py-2.5 text-sm font-semibold ${
          String(recording?.status || '') === 'recording'
            ? 'bg-red-500 text-white'
            : ['uploading', 'uploaded', 'verified', 'transcribed'].includes(String(recording?.status || ''))
              ? 'bg-emerald-500 text-white'
              : 'bg-[#e1ad01] text-[#071421]'
        }`}>
          {String(recording?.status || '') === 'recording'
            ? '● Recording automatically'
            : String(recording?.status || '') === 'uploading'
              ? 'Processing recording…'
              : ['uploaded', 'verified', 'transcribed'].includes(String(recording?.status || ''))
                ? '✓ Recording saved'
                : 'Recording starts when customer joins'}
        </div>
      </header>

      <div className="grid min-h-[calc(100vh-70px)] lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="min-h-[62vh] p-3 sm:p-5">
          {authToken ? (
            <VideoSurveyRoom
              authToken={authToken}
              roomName={roomName}
              eventEndpoint={`/api/sales/video-surveys/${encodeURIComponent(id)}/presence`}
              participantRole="representative"
              peerPresent={isVideoSurveyParticipantPresent(presence.customer)}
              peerLabel="the customer"
              onLeave={() => router.push(session ? `/sales/leads/${session.leadId}` : '/sales')}
            />
          ) : callEnded ? (
            <div className="grid min-h-[70vh] place-items-center rounded-3xl bg-black/30 p-6 text-center">
              <div className="max-w-md">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-500/15 text-2xl text-emerald-300">✓</div>
                <h2 className="mt-4 text-xl font-semibold">Walkthrough complete</h2>
                <p className="mt-2 text-sm leading-6 text-white/60">The call has ended. Use the processing tracker, recording playback, timestamped notes, and AI inventory review beside this panel.</p>
              </div>
            </div>
          ) : (
            <div className="grid min-h-[70vh] place-items-center rounded-3xl bg-black/30"><div className="h-9 w-9 animate-spin rounded-full border-2 border-white/20 border-t-white" /></div>
          )}
        </section>

        <aside className="border-t border-white/10 bg-white p-5 text-[#071421] lg:border-l lg:border-t-0">
          <h2 className="text-lg font-semibold">Walkthrough guide</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">Mark evidence while the customer walks. These markers anchor the recording and AI review.</p>

          <div className={`mt-4 rounded-xl border p-3 ${
            isVideoSurveyParticipantPresent(presence.customer)
              ? 'border-emerald-200 bg-emerald-50'
              : 'border-amber-200 bg-amber-50'
          }`}>
            <div className="flex items-center gap-2 text-xs font-semibold">
              <span className={`h-2.5 w-2.5 rounded-full ${isVideoSurveyParticipantPresent(presence.customer) ? 'bg-emerald-500' : 'animate-pulse bg-amber-500'}`} />
              {isVideoSurveyParticipantPresent(presence.customer) ? 'Customer joined — walkthrough is live' : 'You are in the room — waiting for the customer'}
            </div>
            <p className="mt-1 text-[10px] leading-4 text-slate-600">
              {isVideoSurveyParticipantPresent(presence.customer)
                ? 'Guide them room by room and mark anything that needs attention.'
                : 'Keep this page open. The status will update automatically when they join.'}
            </p>
          </div>

          {callEnded && (
            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold">Walkthrough processing</h3>
                  <p className="mt-0.5 text-[10px] text-slate-500">Updates automatically after the call ends.</p>
                </div>
                {analysis && <span className="text-xs font-semibold text-[#0b7055]">{Math.round(Number(analysis.progress || 0))}%</span>}
              </div>
              <div className="mt-3 space-y-2">
                {processingStages.map(stage => (
                  <div key={stage.key} className="flex items-center gap-2 text-xs">
                    <span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold ${
                      stage.state === 'complete'
                        ? 'bg-emerald-100 text-emerald-700'
                        : stage.state === 'active'
                          ? 'animate-pulse bg-amber-100 text-amber-700'
                          : stage.state === 'failed'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-slate-200 text-slate-500'
                    }`}>{stage.state === 'complete' ? '✓' : stage.state === 'failed' ? '!' : '•'}</span>
                    <span className={stage.state === 'active' ? 'font-semibold text-[#071421]' : 'text-slate-600'}>{stage.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {playbackUrl && (
            <div className="mt-5">
              <h3 className="text-sm font-semibold">Watch the walkthrough</h3>
              <p className="mt-1 text-[10px] leading-4 text-slate-500">Review the recording alongside the AI draft and your timestamped notes.</p>
              <video controls preload="metadata" className="mt-3 aspect-video w-full rounded-xl bg-black" src={playbackUrl}>
                Your browser does not support video playback.
              </video>
            </div>
          )}

          <label className="mt-5 block text-xs font-bold uppercase tracking-wider text-slate-500">Current room</label>
          <select value={room} onChange={event => setRoom(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm">
            {ROOMS.map(item => <option key={item}>{item}</option>)}
          </select>
          <button onClick={() => void addMarker('room', room)} className="mt-2 w-full rounded-xl bg-[#0b7055] px-3 py-3 text-sm font-semibold text-white">Mark room start</button>

          <div className="mt-5 grid grid-cols-2 gap-2">
            {FLAGS.map(flag => (
              <button key={flag.kind} onClick={() => void addMarker(flag.kind, flag.label)} className="rounded-xl border border-slate-200 px-3 py-3 text-xs font-semibold hover:bg-slate-50">
                {flag.label}
              </button>
            ))}
          </div>

          <label className="mt-5 block text-xs font-bold uppercase tracking-wider text-slate-500">Survey note</label>
          <textarea value={note} onChange={event => setNote(event.target.value)} rows={3} placeholder="What did the customer say or show?" className="mt-2 w-full rounded-xl border border-slate-200 p-3 text-sm" />
          <button onClick={() => void addMarker('note', 'Rep note')} disabled={!note.trim()} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm font-semibold disabled:opacity-40">Save timestamped note</button>

          {error && <div className="mt-4 rounded-xl bg-red-50 p-3 text-xs text-red-700">{error}</div>}

          <div className="mt-6 border-t border-slate-200 pt-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Captured markers</h3>
              <span className="text-xs text-slate-500">{markers.length}</span>
            </div>
            <div className="mt-3 max-h-56 space-y-2 overflow-y-auto">
              {markers.slice().reverse().map(marker => (
                <div key={String(marker.id)} className="rounded-xl bg-slate-50 p-3 text-xs">
                  <div className="font-semibold">{String(marker.kind || 'marker').replaceAll('_', ' ')}</div>
                  <div className="mt-1 text-slate-500">{String(marker.room || '')}{marker.note ? ` · ${String(marker.note)}` : ''}</div>
                </div>
              ))}
              {markers.length === 0 && <div className="text-xs text-slate-400">No markers yet.</div>}
            </div>
          </div>
          <VideoSurveyReviewPanel sessionId={id} />
        </aside>
      </div>
    </main>
  )
}
