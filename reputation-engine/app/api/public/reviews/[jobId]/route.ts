import { NextResponse } from 'next/server'
import { getJob, saveJobRecord } from '@/lib/server/repository'
import { uploadLeadMediaAssets } from '@/lib/server/lead-media'
import type { ReviewProofAsset } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(_: Request, props: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await props.params
  const job = await getJob(jobId).catch(() => null)
  if (!job) return NextResponse.json({ error: 'Review request not found' }, { status: 404 })
  return NextResponse.json(job)
}

export async function PATCH(request: Request, props: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await props.params
  const current = await getJob(jobId).catch(() => null)
  if (!current) return NextResponse.json({ error: 'Review request not found' }, { status: 404 })
  const input = await request.json()
  const saved = await saveJobRecord({
    ...current,
    feedbackRating: typeof input.feedbackRating === 'number' ? input.feedbackRating : current.feedbackRating,
    feedbackComment: typeof input.feedbackComment === 'string' ? input.feedbackComment : current.feedbackComment,
    reviews: input.reviews || current.reviews,
    reviewConfirmedAt: input.reviewConfirmedAt || current.reviewConfirmedAt,
    status: input.status || current.status,
    incentiveEarned: Boolean(input.incentiveEarned),
  })
  return NextResponse.json(saved)
}

export async function POST(request: Request, props: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await props.params
  const current = await getJob(jobId).catch(() => null)
  if (!current) return NextResponse.json({ error: 'Review request not found' }, { status: 404 })
  const formData = await request.formData()
  const requestedPlatform = String(formData.get('platform') || 'other')
  const platform = ['google', 'yelp', 'video', 'customer_experience'].includes(requestedPlatform)
    ? requestedPlatform as ReviewProofAsset['platform']
    : 'other'
  const files = (formData.getAll('files') as File[]).filter(file =>
    file && (file.type.startsWith('image/') || file.type.startsWith('video/')) && file.size <= 75 * 1024 * 1024
  ).slice(0, 6)
  if (!files.length) return NextResponse.json({ error: 'Choose an image or video (75 MB maximum per file).' }, { status: 400 })

  const uploaded = await uploadLeadMediaAssets({
    leadId: current.crmLeadId || current.id,
    namespace: `review-proof-${Date.now()}`,
    files,
    room: 'Review proof',
    source: 'rep_upload',
    category: 'customer_media',
  })
  const proof: ReviewProofAsset[] = uploaded.map(asset => ({
    id: asset.id,
    url: asset.url,
    filename: asset.filename || 'review-proof',
    mimeType: asset.mimeType || 'application/octet-stream',
    kind: asset.kind === 'video' ? 'video' : 'image',
    platform,
    uploadedAt: asset.uploadedAt || new Date().toISOString(),
  }))
  const saved = await saveJobRecord({ ...current, reviewProofAssets: [...(current.reviewProofAssets || []), ...proof] })
  return NextResponse.json(saved)
}
