import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { defaultFollowUpDate, normalizePartnershipStage } from '@/lib/marketing'

interface QueueItem {
  id: string
  contact_id: string | null
  step_number: number
  channel: string
  due_date: string
  label: string
  message_draft: string | null
  status: string
  signal_id?: string | null
  assigned_to?: string | null
  priority?: string | null
}

interface Contact {
  id: string
  name: string
  company: string
  title: string
  email: string
  phone: string
  city: string
  industry: string
  tier: string
  tracking_code: string
  stage: string
  notes: string
  website: string
  next_follow_up?: string | null
}

interface SequenceStep {
  tier: string
  step_number: number
  days_after_last: number
  channel: string
  label: string
  message_hint: string
}

export async function GET(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const view = searchParams.get('view') ?? 'today' // today | upcoming | all

  const { url, headers } = requireSupabaseEnv()
  const today = new Date().toISOString().slice(0, 10)

  let dateFilter = `due_date=lte.${today}` // today + overdue
  if (view === 'upcoming') dateFilter = `due_date=gt.${today}&due_date=lte.${new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)}`
  if (view === 'all') dateFilter = ''

  const queueRes = await fetch(
    `${url}/rest/v1/market_queue?status=eq.pending${dateFilter ? '&' + dateFilter : ''}&order=due_date.asc&limit=50`,
    { headers, cache: 'no-store' }
  )
  if (!queueRes.ok) return NextResponse.json({ error: 'Failed to load queue' }, { status: 500 })
  const queueItems = (await queueRes.json()) as QueueItem[]

  if (queueItems.length === 0) return NextResponse.json({ items: [], total: 0 })

  // Fetch matching contacts (signal blasts have null contact_id)
  const contactIds = Array.from(new Set(queueItems.map(q => q.contact_id).filter(Boolean))) as string[]
  const contactsRes = await fetch(
    `${url}/rest/v1/market_contacts?id=in.(${contactIds.map(id => `"${id}"`).join(',')})&select=id,name,company,title,email,phone,city,industry,tier,tracking_code,stage,notes,website,next_follow_up`,
    { headers, cache: 'no-store' }
  )
  const contacts = (contactsRes.ok ? await contactsRes.json() : []) as Contact[]
  const contactMap = Object.fromEntries(contacts.map(c => [c.id, c]))

  const items = queueItems.map(q => ({
    ...q,
    contact: q.contact_id ? (contactMap[q.contact_id] ?? null) : null,
    overdue: q.due_date < today,
    daysOverdue: q.due_date < today
      ? Math.floor((new Date(today).getTime() - new Date(q.due_date).getTime()) / 86400000)
      : 0,
  }))

  return NextResponse.json({ items, total: items.length })
}

export async function POST(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json()) as {
    action: 'complete' | 'skip' | 'schedule_next' | 'seed_contact' | 'blast_signal'
    queue_id?: string
    contact_id?: string
    signal_id?: string
    signal_company?: string
    signal_type?: string
    signal_description?: string
    due_date?: string
    note?: string
  }

  const { url, headers } = requireSupabaseEnv()

  if (body.action === 'blast_signal' && body.signal_id) {
    const today = new Date().toISOString().slice(0, 10)
    const co = body.signal_company ?? 'Unknown Company'
    const st = body.signal_type ?? 'SIGNAL'
    const desc = body.signal_description ?? ''
    const blastChannels = [
      { channel: 'linkedin',    label: `LinkedIn outreach — ${st}: ${co}`, draft: `Connect with decision maker at ${co}. ${desc} Mention Saturn Star helps companies like theirs with employee relocation.` },
      { channel: 'email',       label: `Email outreach — ${st}: ${co}`,    draft: `Send intro email to HR / office manager at ${co}. Lead with the signal: ${desc}. Offer a free consultation on employee relocation logistics.` },
      { channel: 'phone',       label: `Follow-up call — ${st}: ${co}`,    draft: `Call ${co} main line. Ask for HR Director or Office Manager. Reference the news: ${desc}. Pitch Saturn Star's corporate relocation partnership.` },
      { channel: 'direct_mail', label: `Rush mailer — ${st}: ${co}`,       draft: `Send a targeted letter to ${co} office address. Reference the expansion/move news. Include your direct line and a QR code.` },
    ]

    await Promise.all(blastChannels.map((ch, i) =>
      fetch(`${url}/rest/v1/market_queue`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({
          contact_id: null,
          step_number: 0,
          channel: ch.channel,
          due_date: today,
          label: ch.label,
          message_draft: ch.draft,
          status: 'pending',
          signal_id: body.signal_id,
        }),
      })
    ))

    // Mark signal as watching
    await fetch(`${url}/rest/v1/market_signals?id=eq.${body.signal_id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'watching' }),
    })

    return NextResponse.json({ ok: true, blasted: blastChannels.length })
  }

  if (body.action === 'seed_contact' && body.contact_id) {
    // Get contact's tier and schedule step 1
    const cRes = await fetch(`${url}/rest/v1/market_contacts?id=eq.${body.contact_id}&select=tier,stage`, { headers, cache: 'no-store' })
    const [contact] = (await cRes.json()) as { tier: string; stage: string }[]
    if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })

    const tier = contact.tier === 'HOT' ? 'HOT' : contact.tier
    const seqRes = await fetch(`${url}/rest/v1/market_sequences?tier=eq.${tier}&step_number=eq.1`, { headers, cache: 'no-store' })
    const [step] = (await seqRes.json()) as SequenceStep[]
    if (!step) return NextResponse.json({ error: 'No sequence for tier' + tier }, { status: 404 })

    const today = new Date().toISOString().slice(0, 10)
    await fetch(`${url}/rest/v1/market_queue`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        contact_id: body.contact_id,
        step_number: 1,
        channel: step.channel,
        due_date: today,
        label: step.label,
        message_draft: step.message_hint ?? null,
        status: 'pending',
      }),
    })
    return NextResponse.json({ ok: true })
  }

  if ((body.action === 'complete' || body.action === 'skip') && body.queue_id) {
    const completedAt = new Date().toISOString()
    // Mark current item done
    await fetch(`${url}/rest/v1/market_queue?id=eq.${body.queue_id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        status: body.action === 'complete' ? 'done' : 'skipped',
        completed_at: completedAt,
        completed_by: session.name ?? 'Rep',
      }),
    })

    if (body.action === 'complete') {
      // Get current item to find contact + step
      const itemRes = await fetch(`${url}/rest/v1/market_queue?id=eq.${body.queue_id}&select=contact_id,step_number,channel,label`, { headers, cache: 'no-store' })
      const [item] = (await itemRes.json()) as { contact_id: string; step_number: number; channel: string; label: string }[]
      if (!item) return NextResponse.json({ ok: true })

      // Get contact tier
      const cRes = await fetch(`${url}/rest/v1/market_contacts?id=eq.${item.contact_id}&select=tier,stage,next_follow_up`, { headers, cache: 'no-store' })
      const [contact] = (await cRes.json()) as { tier: string; stage: string; next_follow_up?: string | null }[]
      if (!contact) return NextResponse.json({ ok: true })

      const currentStage = normalizePartnershipStage(contact.stage)
      let stageUpdate: string | undefined
      let nextFollowUp = contact.next_follow_up ?? null

      if (item.channel === 'direct_mail') {
        stageUpdate = 'mail_sent'
        nextFollowUp = defaultFollowUpDate(completedAt, 21)
      } else if (['phone', 'email', 'linkedin', 'sms'].includes(item.channel) && ['target', 'mail_sent', 'follow_up_due'].includes(currentStage)) {
        stageUpdate = 'attempting_contact'
      }

      await fetch(`${url}/rest/v1/market_touches`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({
          contact_id: item.contact_id,
          channel: item.channel,
          direction: 'outbound',
          notes: `Queue complete: ${item.label}`,
          created_by: session.name ?? 'Rep',
          created_at: completedAt,
        }),
      })

      await fetch(`${url}/rest/v1/market_contacts?id=eq.${item.contact_id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          stage: stageUpdate ?? contact.stage,
          last_touch_at: completedAt,
          next_follow_up: nextFollowUp,
        }),
      })

      // Schedule next step
      const nextStep = item.step_number + 1
      const tier = contact.tier
      const seqRes = await fetch(`${url}/rest/v1/market_sequences?tier=eq.${tier}&step_number=eq.${nextStep}`, { headers, cache: 'no-store' })
      const [nextSeq] = (await seqRes.json()) as SequenceStep[]

      if (nextSeq) {
        const dueDate = new Date(Date.now() + nextSeq.days_after_last * 86400000).toISOString().slice(0, 10)
        await fetch(`${url}/rest/v1/market_queue`, {
          method: 'POST',
          headers: { ...headers, Prefer: 'return=minimal' },
          body: JSON.stringify({
            contact_id: item.contact_id,
            step_number: nextStep,
            channel: nextSeq.channel,
            due_date: dueDate,
            label: nextSeq.label,
            message_draft: nextSeq.message_hint ?? null,
            status: 'pending',
          }),
        })
      }
    }

    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
