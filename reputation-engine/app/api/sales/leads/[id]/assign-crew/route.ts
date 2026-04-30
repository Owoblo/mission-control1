/**
 * POST /api/sales/leads/[id]/assign-crew
 * Assigns workers to a booked job and optionally sends each worker an SMS
 * with the job details (date, time, addresses, role).
 */
import { NextResponse } from 'next/server'
import { hasInternalSession } from '@/lib/server/session'
import { getSalesLead, saveSalesLead, saveFollowUpLog, listWorkers } from '@/lib/server/sales-repository'
import { requireWorkerBaseUrl } from '@/lib/server/runtime'
import { uid } from '@/lib/sales'

function formatDate(iso?: string) {
  if (!iso) return 'TBD'
  try {
    return new Date(iso).toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })
  } catch {
    return iso
  }
}

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return raw
}

async function sendSms(to: string, body: string): Promise<boolean> {
  try {
    const workerBase = requireWorkerBaseUrl()
    const workerSecret = process.env.WORKER_SHARED_SECRET || ''
    const resp = await fetch(`${workerBase}/send-sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': workerSecret },
      body: JSON.stringify({ to, body }),
    })
    return resp.ok
  } catch {
    return false
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authed = await hasInternalSession()
    if (!authed) return new Response('Unauthorized', { status: 401 })

    const { id } = await params
    const { workerIds, sendSms: doSendSms } = (await request.json()) as {
      workerIds: string[]
      sendSms?: boolean
    }

    if (!Array.isArray(workerIds)) {
      return NextResponse.json({ error: 'workerIds must be an array' }, { status: 400 })
    }

    const [lead, allWorkers] = await Promise.all([getSalesLead(id), listWorkers()])
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    // Save assignment to lead
    const saved = await saveSalesLead({ ...lead, assignedCrew: workerIds })

    // Log to timeline
    const assignedWorkers = allWorkers.filter(w => workerIds.includes(w.id))
    const now = new Date().toISOString()

    if (assignedWorkers.length > 0) {
      await saveFollowUpLog({
        id: uid('fu'),
        leadId: id,
        type: 'note',
        date: now,
        createdAt: now,
        notes: `👷 Crew assigned: ${assignedWorkers.map(w => `${w.name} (${w.role})`).join(', ')}`,
      })
    }

    // Send SMS to each assigned worker
    let notified = 0
    if (doSendSms && assignedWorkers.length > 0) {
      const moveDateStr = formatDate(lead.moveDate)
      const startTimeStr = lead.startTime ? ` at ${lead.startTime}` : ''
      const origin = [lead.originAddress, lead.originCity].filter(Boolean).join(', ') || 'TBD'
      const dest = [lead.destAddress, lead.destCity].filter(Boolean).join(', ') || 'TBD'

      for (const worker of assignedWorkers) {
        if (!worker.phone) continue
        const roleLabel = worker.role === 'lead' ? 'Crew Lead' : worker.role.charAt(0).toUpperCase() + worker.role.slice(1)
        const msg =
          `Hi ${worker.name.split(' ')[0]} 👋 — you're booked on a move!\n\n` +
          `📅 ${moveDateStr}${startTimeStr}\n` +
          `📦 From: ${origin}\n` +
          `🏠 To: ${dest}\n` +
          `Role: ${roleLabel}\n\n` +
          `Customer: ${lead.name}${lead.phone ? ` · ${lead.phone}` : ''}\n\n` +
          `Reply STOP to unsubscribe. Questions? Call the office: 226-773-2993`

        const ok = await sendSms(formatPhone(worker.phone), msg)
        if (ok) notified++

        // Log per-worker SMS to timeline
        await saveFollowUpLog({
          id: uid('fu'),
          leadId: id,
          type: 'sms',
          date: now,
          createdAt: now,
          notes: `SMS sent to ${worker.name} (${worker.phone}) — job assignment for ${moveDateStr}`,
        })
      }
    }

    return NextResponse.json({ ok: true, notified, lead: saved })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Crew assignment failed' },
      { status: 500 }
    )
  }
}
