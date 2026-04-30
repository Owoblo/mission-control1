import { NextResponse } from 'next/server'
import { hasInternalSession } from '@/lib/server/session'
import { getWorker, saveWorker, deleteWorker } from '@/lib/server/sales-repository'
import type { CRMWorker } from '@/lib/types'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authed = await hasInternalSession()
  if (!authed) return new Response('Unauthorized', { status: 401 })

  const { id } = await params
  const existing = await getWorker(id)
  if (!existing) return NextResponse.json({ error: 'Worker not found' }, { status: 404 })

  const updates = (await request.json()) as Partial<CRMWorker>
  const updated: CRMWorker = { ...existing, ...updates, id }
  const saved = await saveWorker(updated)
  return NextResponse.json(saved)
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authed = await hasInternalSession()
  if (!authed) return new Response('Unauthorized', { status: 401 })

  const { id } = await params
  await deleteWorker(id)
  return NextResponse.json({ ok: true })
}
