import { normalizeLead, uid } from '@/lib/sales'
import { applyMovePolicyToInventory } from '@/lib/move-policy'
import { dedupePhotosBeforeVision, detectFurnitureInRoom, getOpenAIConfig } from '@/lib/server/inventory-enrichment'
import { analyzeVideoForInventory, isVideoMimeType, isVideoScannable } from '@/lib/server/gemini-vision'
import { saveSalesLead } from '@/lib/server/sales-repository'
import { getTwilioCredentials, requireSupabaseEnv } from '@/lib/server/runtime'
import { twilioAuth } from '@/lib/server/twilio-recordings'
import type { CRMLead, InventoryItem, LeadMediaAsset } from '@/lib/types'
// @ts-expect-error heic-convert does not publish TypeScript declarations.
import convertHeic from 'heic-convert'

const BUCKET = 'survey-photos'
const MAX_MEDIA_UPLOAD_FILES = 30
const PHOTO_SCAN_BATCH_SIZE = 4

function sanitizeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function buildRoomBreakdown(items: InventoryItem[]) {
  return items.reduce<Record<string, number>>((rooms, item) => {
    if (item.included === false) return rooms
    const room = item.room?.trim() || 'Unassigned'
    rooms[room] = (rooms[room] || 0) + Math.max(1, Number(item.qty || 1))
    return rooms
  }, {})
}

function inferMediaKind(file: File) {
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('image/')) return 'image'
  return 'document'
}

function inferMediaKindFromMimeType(mimeType?: string) {
  if (mimeType?.startsWith('video/')) return 'video'
  if (mimeType?.startsWith('image/')) return 'image'
  return 'document'
}

function updateMediaAnalysisStatus(
  lead: CRMLead,
  assetId: string,
  status: LeadMediaAsset['analysisStatus'],
  analysisNotes?: string,
  detectedItemCount?: number
) {
  return normalizeLead({
    ...lead,
    mediaAssets: (lead.mediaAssets || []).map(asset =>
      asset.id === assetId
        ? { ...asset, analysisStatus: status, analysisNotes, detectedItemCount }
        : asset
    ),
  })
}

function extensionFromMimeType(mimeType?: string) {
  const normalized = (mimeType || '').toLowerCase().split(';')[0].trim()
  if (!normalized) return 'bin'
  if (normalized === 'image/jpeg') return 'jpg'
  if (normalized === 'image/png') return 'png'
  if (normalized === 'image/webp') return 'webp'
  if (normalized === 'image/gif') return 'gif'
  if (normalized === 'video/mp4') return 'mp4'
  if (normalized === 'video/quicktime') return 'mov'
  if (normalized === 'video/webm') return 'webm'
  const subtype = normalized.split('/')[1]
  return subtype ? subtype.replace(/[^a-z0-9]/g, '') || 'bin' : 'bin'
}

async function uploadToStorage(leadId: string, namespace: string, filename: string, buffer: ArrayBuffer, mime: string): Promise<string> {
  const { url: supabaseUrl, headers } = requireSupabaseEnv()
  const supabaseKey = headers.apikey
  const path = `${leadId}/${namespace}/${Date.now()}_${sanitizeFilename(filename)}`
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${supabaseKey}`,
      apikey: supabaseKey,
      'Content-Type': mime,
      'x-upsert': 'true',
    },
    body: buffer,
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Storage upload failed: ${response.status} ${body}`)
  }

  return `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${path}`
}

export async function uploadLeadMediaAssets(input: {
  leadId: string
  namespace: string
  files: File[]
  room?: string
  source: LeadMediaAsset['source']
  category?: LeadMediaAsset['category']
  uploadedByUserId?: string
  uploadedByName?: string
  notes?: string
  partyLabel?: string
}) {
  const assets: LeadMediaAsset[] = []

  for (const file of input.files.slice(0, MAX_MEDIA_UPLOAD_FILES)) {
    const originalBuffer = Buffer.from(await file.arrayBuffer())
    const isHeic = /image\/hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name || '')
    const convertedBytes = isHeic
      ? Buffer.from(await convertHeic({ buffer: originalBuffer, format: 'JPEG', quality: 0.88 }))
      : originalBuffer
    const preparedBuffer = convertedBytes.buffer.slice(
      convertedBytes.byteOffset,
      convertedBytes.byteOffset + convertedBytes.byteLength,
    ) as ArrayBuffer
    const preparedName = isHeic
      ? `${(file.name || 'photo').replace(/\.(?:heic|heif)$/i, '')}.jpg`
      : (file.name || 'media')
    const preparedMime = isHeic ? 'image/jpeg' : (file.type || 'application/octet-stream')
    const url = await uploadToStorage(input.leadId, input.namespace, preparedName, preparedBuffer, preparedMime)
    assets.push({
      id: uid('media'),
      url,
      kind: inferMediaKind(file),
      source: input.source,
      category: input.category,
      room: input.room || undefined,
      filename: preparedName || undefined,
      mimeType: preparedMime || undefined,
      uploadedAt: new Date().toISOString(),
      uploadedByUserId: input.uploadedByUserId,
      uploadedByName: input.uploadedByName,
      notes: input.notes,
      partyLabel: input.partyLabel || undefined,
      ...(inferMediaKind(file) === 'image' ? { analysisStatus: 'pending' as const } : {}),
    })
  }

  return assets
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function inventoryDedupeKey(item: InventoryItem) {
  const name = (item.name || item.item || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const room = (item.room || 'other').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const size = (item.size || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return `${room}:${name}:${size}`
}

function mergeDetectedInventory(items: InventoryItem[]) {
  const byKey = new Map<string, InventoryItem>()
  for (const item of items) {
    const key = inventoryDedupeKey(item)
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, item)
      continue
    }

    byKey.set(key, {
      ...existing,
      qty: Math.max(Number(existing.qty || 1), Number(item.qty || 1)),
      cubicFeet: Math.max(Number(existing.cubicFeet || 0), Number(item.cubicFeet || 0)),
      weightLbs: Math.max(Number(existing.weightLbs || 0), Number(item.weightLbs || 0)),
      confidence: Math.max(Number(existing.confidence || 0), Number(item.confidence || 0)),
      notes: [existing.notes, item.notes].filter(Boolean).join(' · ') || undefined,
    })
  }
  return Array.from(byKey.values())
}

export async function persistInboundMmsToLead(input: {
  lead: CRMLead
  media: Array<{ url: string; contentType?: string }>
  messageSid: string
}) {
  if (!input.media.length) return input.lead

  const { accountSid, authToken } = getTwilioCredentials()
  const existingAssets = Array.isArray(input.lead.mediaAssets) ? input.lead.mediaAssets : []
  const nextAssets: LeadMediaAsset[] = []

  for (let index = 0; index < input.media.length; index += 1) {
    const media = input.media[index]
    const dedupeKey = `twilio:${input.messageSid}:${index}`
    if (existingAssets.some(asset => asset.source === 'mms' && asset.notes === dedupeKey)) {
      continue
    }

    const response = await fetch(media.url, {
      headers: {
        Authorization: twilioAuth(accountSid, authToken),
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    })

    if (!response.ok) {
      throw new Error(`Failed to download MMS media ${index + 1}: ${response.status}`)
    }

    const mimeType = media.contentType || response.headers.get('content-type') || 'application/octet-stream'
    const extension = extensionFromMimeType(mimeType)
    const filename = `mms_${input.messageSid}_${index + 1}.${extension}`
    const buffer = await response.arrayBuffer()
    const storedUrl = await uploadToStorage(input.lead.id, 'mms', filename, buffer, mimeType)

    nextAssets.push({
      id: uid('media'),
      url: storedUrl,
      kind: inferMediaKindFromMimeType(mimeType),
      source: 'mms',
      filename,
      mimeType,
      uploadedAt: new Date().toISOString(),
      uploadedByName: 'Twilio MMS',
      notes: dedupeKey,
      ...(inferMediaKindFromMimeType(mimeType) === 'video'
        ? { analysisStatus: 'pending' as const, analysisNotes: 'Video saved. Inventory scan pending.' }
        : {}),
    })
  }

  if (nextAssets.length === 0) {
    return input.lead
  }

  let leadWithAssets = normalizeLead({
    ...input.lead,
    mediaAssets: [...existingAssets, ...nextAssets],
  })

  // ── Video scanning: if any asset is a video and Gemini is configured, extract inventory ──
  const videoAssets = nextAssets.filter(a => isVideoMimeType(a.mimeType) && a.url)
  if (videoAssets.length > 0) {
    const { accountSid, authToken } = getTwilioCredentials()

    for (const asset of videoAssets) {
      if (!isVideoScannable(asset.mimeType)) {
        leadWithAssets = updateMediaAnalysisStatus(
          leadWithAssets,
          asset.id,
          'skipped',
          'Video scanning skipped because Gemini is not configured or the file type is unsupported.'
        )
        continue
      }

      try {
        // Find the original MMS URL to download with auth (stored URL won't have Twilio auth)
        const originalMedia = input.media.find(m => {
          const ext = (asset.filename || '').split('.').pop()
          return m.contentType?.startsWith('video/') || ext === 'mp4' || ext === 'mov'
        })
        if (!originalMedia) {
          leadWithAssets = updateMediaAnalysisStatus(leadWithAssets, asset.id, 'failed', 'Could not locate original Twilio video for scanning.')
          continue
        }

        const videoRes = await fetch(originalMedia.url, {
          headers: { Authorization: twilioAuth(accountSid, authToken) },
          signal: AbortSignal.timeout(30000),
        })
        if (!videoRes.ok) {
          leadWithAssets = updateMediaAnalysisStatus(leadWithAssets, asset.id, 'failed', `Could not download video for scanning (${videoRes.status}).`)
          continue
        }

        const buffer = await videoRes.arrayBuffer()
        const mimeType = originalMedia.contentType || asset.mimeType || 'video/mp4'
        const scanResult = await analyzeVideoForInventory(buffer, mimeType)
        if (!scanResult || scanResult.items.length === 0) {
          leadWithAssets = updateMediaAnalysisStatus(leadWithAssets, asset.id, 'failed', 'Gemini did not return inventory items from this video.')
          continue
        }

        const existingInventory = Array.isArray(leadWithAssets.inventory) ? leadWithAssets.inventory : []
        const newInventory = applyMovePolicyToInventory(
          [...existingInventory, ...scanResult.items.map(item => ({
            ...item,
            id: item.id || uid('inv_vid'),
          }))],
          { enforceExclusion: true }
        )

        leadWithAssets = normalizeLead({
          ...leadWithAssets,
          inventory: newInventory,
          lastAutoEnrichmentAt: new Date().toISOString(),
        })
        leadWithAssets = updateMediaAnalysisStatus(
          leadWithAssets,
          asset.id,
          'scanned',
          `${scanResult.items.length} item${scanResult.items.length === 1 ? '' : 's'} extracted. ${scanResult.summary || ''}`.trim()
        )
      } catch {
        leadWithAssets = updateMediaAnalysisStatus(leadWithAssets, asset.id, 'failed', 'Video scan failed before inventory could be extracted.')
      }
    }
  }

  return saveSalesLead(leadWithAssets)
}

export async function analyzeLeadPhotosWithVision(room: string, photoUrls: string[]): Promise<InventoryItem[]> {
  const config = getOpenAIConfig()
  if (!config) throw new Error('No OpenAI API key')
  const dedupedPhotoUrls = await dedupePhotosBeforeVision(photoUrls)
  const batches = chunkArray(dedupedPhotoUrls, PHOTO_SCAN_BATCH_SIZE)
  const detected: InventoryItem[] = []

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index]
    if (!batch.length) continue
    const batchItems = await detectFurnitureInRoom(
      batches.length === 1 ? room : `${room} photo set ${index + 1}`,
      batch,
      config
    )
    detected.push(...batchItems.map(item => ({ ...item, room: item.room || room })))
  }

  return applyMovePolicyToInventory(mergeDetectedInventory(detected).map(item => ({
    ...item,
    id: item.id || uid('inv_media'),
    room: item.room || room,
  })), { enforceExclusion: true })
}

export function applyLeadMediaAnalysis(
  lead: CRMLead,
  input: {
    assets: LeadMediaAsset[]
    detectedItems: InventoryItem[]
    source: LeadMediaAsset['source']
    surveyCompletedAt?: string
  }
) {
  const existingInventory = Array.isArray(lead.inventory) ? lead.inventory : []
  const nextInventory = [...existingInventory, ...input.detectedItems]
  const includedItems = nextInventory.filter(item => item.included !== false)

  return normalizeLead({
    ...lead,
    inventory: nextInventory,
    mediaAssets: [...(lead.mediaAssets || []), ...input.assets],
    totalCubicFeet: includedItems.reduce((sum, item) => sum + (item.cubicFeet || 0) * (item.qty || 1), 0),
    totalWeightLbs: includedItems.reduce((sum, item) => sum + (item.weightLbs || 0) * (item.qty || 1), 0),
    totalItems: includedItems.reduce((sum, item) => sum + (item.qty || 1), 0),
    roomBreakdown: buildRoomBreakdown(nextInventory),
    surveyPhotoCount: input.source === 'survey'
      ? Number(lead.surveyPhotoCount || 0) + input.assets.filter(asset => asset.kind === 'image').length
      : lead.surveyPhotoCount,
    surveyCompletedAt: input.surveyCompletedAt || lead.surveyCompletedAt,
  })
}

export async function appendLeadMediaAssetsAtomic(
  leadId: string,
  assets: LeadMediaAsset[],
  surveyPhotoIncrement = 0
) {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/rpc/append_crm_lead_media`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      p_lead_id: leadId,
      p_assets: assets,
      p_survey_increment: Math.max(0, surveyPhotoIncrement),
    }),
  })
  if (!response.ok) {
    throw new Error(`Atomic media append failed: ${response.status}`)
  }
  const data = await response.json() as CRMLead | null
  return data ? normalizeLead(data) : null
}
