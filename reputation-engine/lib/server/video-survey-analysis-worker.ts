import crypto from 'crypto'
import { getStorageService, isObjectStorageConfigured } from '@/lib/server/storage-service'
import { readEnv, requireEnv } from '@/lib/server/runtime'
import {
  appendVideoSurveyEvent,
  claimNextVideoSurveyAnalysisJob,
  getVideoSurveySession,
  listVideoSurveyRecordings,
  replacePendingVideoSurveyEvidence,
  updateVideoSurveyAnalysisJob,
  updateVideoSurveySession,
} from '@/lib/server/video-survey-repository'
import {
  clusterVideoInventoryCandidates,
  type VideoInventoryCandidate,
} from '@/lib/video-survey-analysis'

type GeminiVideoResult = {
  summary?: string
  rooms?: Array<{
    room?: string
    observations?: string
    items?: Array<{
      name?: string
      quantity?: number
      disposition?: 'moving' | 'staying' | 'uncertain'
      confidence?: number
      offsetSeconds?: number
      transcriptEvidence?: string
      cubicFeet?: number
      weightLbs?: number
      notes?: string
    }>
  }>
}

const PROMPT = `You are reviewing a professional moving-estimate video walkthrough.

Build evidence for a DRAFT inventory. Never invent an item and never treat built-in fixtures as moving items.

Important:
- The same item may appear repeatedly while the camera pans or returns to a room. Report each physical object once per room when reasonably certain.
- Listen throughout the recording. Customer speech is inventory evidence, not background noise.
- Use explicit customer phrases such as "selling this", "stays", "not going", "leaving it", "donating it", or "belongs to the landlord" to mark an item as staying.
- Use phrases such as "this is going", "we are taking it", or "move this" to mark an item as moving.
- Distinguish the customer's statements from questions or suggestions made by the representative. Never turn the representative naming an item into customer confirmation.
- If speech and video conflict, or the speaker/disposition is ambiguous, use "uncertain".
- Record the approximate timestamp where the clearest evidence occurs.
- Count separate same-type objects carefully. If two sofas are physically distinct, report quantity 2; do not collapse them merely because they share a label.
- Keep numbered bedrooms and separate storage areas distinct so similar furniture in different rooms is not deduplicated together.
- Estimate cubic feet and weight per single item using professional moving-industry norms.
- Include garages, basements, storage areas, closets, wardrobes, outdoor areas, boxes and loose contents when visible or explicitly described.
- Do not include people, built-ins, wall art unless explicitly moving, counters, sinks, or permanent appliances.

Return JSON only:
{
  "summary": "short walkthrough summary",
  "rooms": [
    {
      "room": "room name",
      "observations": "short note",
      "items": [
        {
          "name": "specific item",
          "quantity": 1,
          "disposition": "moving|staying|uncertain",
          "confidence": 0.0,
          "offsetSeconds": 0,
          "transcriptEvidence": "short paraphrase, not a long quote",
          "cubicFeet": 0,
          "weightLbs": 0,
          "notes": "measurement, disassembly, fragile or access concern"
        }
      ]
    }
  ]
}`

async function uploadVideoToGemini(sourceUrl: string, contentType: string, sizeBytes?: number) {
  const apiKey = requireEnv('GEMINI_API_KEY', 'Missing GEMINI_API_KEY')
  const source = await fetch(sourceUrl, { cache: 'no-store', signal: AbortSignal.timeout(60_000) })
  if (!source.ok || !source.body) throw new Error(`Could not open recording (${source.status})`)
  const length = Number(source.headers.get('content-length') || sizeBytes || 0)
  if (!length) throw new Error('Recording size is unknown')

  const start = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(length),
      'X-Goog-Upload-Header-Content-Type': contentType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: `saturn-video-survey-${Date.now()}` } }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!start.ok) throw new Error(`Gemini upload initialization failed (${start.status})`)
  const uploadUrl = start.headers.get('x-goog-upload-url')
  if (!uploadUrl) throw new Error('Gemini did not provide an upload URL')

  const uploaded = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(length),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: source.body,
    // Node's streaming request body requires duplex even though it is not part of RequestInit's DOM type.
    ...( { duplex: 'half' } as Record<string, unknown> ),
    signal: AbortSignal.timeout(10 * 60_000),
  } as RequestInit)
  const uploadResult = await uploaded.json().catch(() => null) as { file?: { name?: string; uri?: string; state?: string } } | null
  if (!uploaded.ok || !uploadResult?.file?.name || !uploadResult.file.uri) {
    throw new Error(`Gemini upload failed (${uploaded.status})`)
  }

  let file = uploadResult.file
  for (let attempt = 0; attempt < 30 && file.state !== 'ACTIVE'; attempt += 1) {
    if (file.state === 'FAILED') throw new Error('Gemini could not process the uploaded recording')
    await new Promise(resolve => setTimeout(resolve, 2_000))
    const status = await fetch(`https://generativelanguage.googleapis.com/v1beta/${file.name}?key=${encodeURIComponent(apiKey)}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    })
    const data = await status.json().catch(() => null) as { name?: string; uri?: string; state?: string } | null
    if (!status.ok || !data?.name || !data.uri) throw new Error('Could not check Gemini file status')
    file = data
  }
  if (file.state !== 'ACTIVE') throw new Error('Gemini recording processing timed out')
  return { apiKey, file }
}

async function analyzeGeminiVideo(sourceUrl: string, contentType: string, sizeBytes?: number) {
  const { apiKey, file } = await uploadVideoToGemini(sourceUrl, contentType, sizeBytes)
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { file_data: { mime_type: contentType, file_uri: file.uri } },
              { text: PROMPT },
            ],
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8192,
            responseMimeType: 'application/json',
          },
        }),
        signal: AbortSignal.timeout(5 * 60_000),
      }
    )
    const data = await response.json().catch(() => null) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    } | null
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!response.ok || !text) throw new Error(`Gemini video analysis failed (${response.status})`)
    return JSON.parse(text) as GeminiVideoResult
  } finally {
    void fetch(`https://generativelanguage.googleapis.com/v1beta/${file.name}?key=${encodeURIComponent(apiKey)}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null)
  }
}

function resultCandidates(result: GeminiVideoResult): VideoInventoryCandidate[] {
  const candidates: VideoInventoryCandidate[] = []
  for (const room of result.rooms || []) {
    for (const item of room.items || []) {
      if (!item.name?.trim()) continue
      candidates.push({
        id: `raw_${crypto.randomUUID()}`,
        room: room.room?.trim() || 'Unassigned',
        itemName: item.name.trim(),
        quantity: Math.max(1, Math.round(Number(item.quantity || 1))),
        disposition: ['moving', 'staying', 'uncertain'].includes(String(item.disposition))
          ? item.disposition!
          : 'uncertain',
        confidence: Math.max(0, Math.min(1, Number(item.confidence || 0.5))),
        sourceKind: item.transcriptEvidence ? 'transcript' : 'video',
        offsetMs: Math.max(0, Math.round(Number(item.offsetSeconds || 0) * 1000)),
        transcriptExcerpt: item.transcriptEvidence?.slice(0, 500),
        estimatedCubicFeet: Math.max(0, Number(item.cubicFeet || 0)),
        estimatedWeightLbs: Math.max(0, Number(item.weightLbs || 0)),
      })
    }
  }
  return candidates
}

async function recordingSource(recording: Record<string, unknown>) {
  const objectKey = String(recording.object_key || '')
  if (objectKey && isObjectStorageConfigured()) {
    return getStorageService().getSignedReadUrl(objectKey, 3600)
  }
  const providerUrl = String(recording.provider_download_url || '')
  if (providerUrl) return providerUrl
  throw new Error('The completed recording has no readable storage location')
}

export async function processNextVideoSurveyAnalysis(workerId = `vercel_${crypto.randomUUID()}`) {
  const job = await claimNextVideoSurveyAnalysisJob(workerId)
  if (!job) return { processed: false, reason: 'empty' }
  const jobId = String(job.id)
  const sessionId = String(job.session_id)
  const attempts = Number(job.attempt_count || 1)
  const maxAttempts = Number(job.max_attempts || 5)
  try {
    const session = await getVideoSurveySession(sessionId)
    if (!session) throw new Error('Video survey session no longer exists')
    if (!session.aiConsent) {
      await updateVideoSurveyAnalysisJob(jobId, { status: 'cancelled', stage: 'consent_withdrawn', progress: 100 })
      return { processed: true, cancelled: true }
    }
    const recordings = await listVideoSurveyRecordings(sessionId)
    const recording = recordings.find(item =>
      item.kind === 'composite' && ['uploaded', 'verified', 'transcribed'].includes(String(item.status))
    )
    if (!recording) throw new Error('Completed composite recording is not ready')

    await updateVideoSurveyAnalysisJob(jobId, { stage: 'analyzing_video', progress: 20 })
    await updateVideoSurveySession(sessionId, { status: 'analyzing' })
    const sourceUrl = await recordingSource(recording)
    const result = await analyzeGeminiVideo(
      sourceUrl,
      String(recording.content_type || 'video/mp4'),
      Number(recording.size_bytes || 0) || undefined
    )
    const clustered = clusterVideoInventoryCandidates(resultCandidates(result))
    if (!clustered.length) throw new Error('Video analysis returned no reviewable inventory evidence')

    await updateVideoSurveyAnalysisJob(jobId, { stage: 'saving_evidence', progress: 85 })
    const now = new Date().toISOString()
    await replacePendingVideoSurveyEvidence(sessionId, clustered.map(candidate => ({
      id: `vsevi_${crypto.randomUUID()}`,
      session_id: sessionId,
      inventory_key: `${candidate.room}:${candidate.itemName}`.toLowerCase(),
      room: candidate.room,
      item_name: candidate.itemName,
      quantity: candidate.quantity,
      disposition: candidate.disposition,
      confidence: candidate.confidence,
      source_kind: candidate.sourceKind,
      recording_id: String(recording.id),
      offset_ms: candidate.offsetMs || null,
      transcript_excerpt: candidate.transcriptExcerpt || null,
      estimated_cubic_feet: candidate.estimatedCubicFeet || null,
      estimated_weight_lbs: candidate.estimatedWeightLbs || null,
      duplicate_group_id: candidate.duplicateGroupId || null,
      duplicate_confidence: candidate.duplicateConfidence || null,
      review_status: 'pending',
      metadata: { evidenceIds: candidate.evidenceIds },
      created_at: now,
      updated_at: now,
    })))
    await updateVideoSurveyAnalysisJob(jobId, {
      status: 'review_required',
      stage: 'review_required',
      progress: 100,
      result: { summary: result.summary || '', evidenceCount: clustered.length },
      locked_at: null,
      locked_by: null,
    })
    await updateVideoSurveySession(sessionId, { status: 'review_required' })
    await appendVideoSurveyEvent({
      sessionId,
      type: 'analysis.completed',
      actorType: 'ai',
      payload: { evidenceCount: clustered.length, summary: result.summary || '' },
    })
    return { processed: true, sessionId, evidenceCount: clustered.length }
  } catch (error) {
    const terminal = attempts >= maxAttempts
    const delayMinutes = Math.min(60, Math.pow(2, Math.max(0, attempts - 1)) * 2)
    await updateVideoSurveyAnalysisJob(jobId, {
      status: terminal ? 'failed' : 'retry',
      stage: terminal ? 'failed' : 'retry_wait',
      error_message: String(error).slice(0, 2000),
      next_attempt_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
      locked_at: null,
      locked_by: null,
    })
    await updateVideoSurveySession(sessionId, { status: terminal ? 'failed' : 'analysis_pending' }).catch(() => null)
    await appendVideoSurveyEvent({
      sessionId,
      type: terminal ? 'analysis.failed' : 'analysis.retry_scheduled',
      actorType: 'system',
      payload: { attempt: attempts, error: String(error).slice(0, 500) },
    }).catch(() => null)
    return { processed: true, sessionId, error: String(error), retrying: !terminal }
  }
}
