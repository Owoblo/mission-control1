import { NextResponse } from 'next/server'
import { hasInternalSession } from '@/lib/server/session'
import { listWorkers, saveWorker } from '@/lib/server/sales-repository'
import { uid } from '@/lib/sales'
import type { CRMWorker, WorkerCity, WorkerRole } from '@/lib/types'

export async function GET() {
  const authed = await hasInternalSession()
  if (!authed) return new Response('Unauthorized', { status: 401 })

  const workers = await listWorkers()
  return NextResponse.json(workers)
}

export async function POST(request: Request) {
  const authed = await hasInternalSession()
  if (!authed) return new Response('Unauthorized', { status: 401 })

  const body = (await request.json()) as Partial<CRMWorker>

  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (!body.phone?.trim()) {
    return NextResponse.json({ error: 'phone is required' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const worker: CRMWorker = {
    id: body.id || uid('wrk'),
    name: body.name.trim(),
    phone: body.phone.trim(),
    city: (body.city || 'other') as WorkerCity,
    role: (body.role || 'mover') as WorkerRole,
    available: body.available !== false,
    notes: body.notes || undefined,
    createdAt: body.createdAt || now,
  }

  const saved = await saveWorker(worker)
  return NextResponse.json(saved)
}
