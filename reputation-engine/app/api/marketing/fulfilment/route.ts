import { NextResponse } from 'next/server'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { getRequestSessionUser } from '@/lib/server/request-session'
import { requireSupabaseEnv, readEnv } from '@/lib/server/runtime'
import { partnershipRecordMatchesSession } from '@/lib/server/partnership-access'
import { isOptOutText } from '@/lib/server/partnership-sms'
import { cardFilename, validateEmailTask, type EmailTask } from '@/lib/partner-fulfilment'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
const KIND = 'partner_email_fulfilment'
async function db(table: string, query: string, method = 'GET', body?: unknown) {
  const { url, headers } = requireSupabaseEnv()
  const res = await fetch(`${url}/rest/v1/${table}?${query}`, { method, headers: { ...headers, Prefer: 'return=representation' }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error('Could not save or load CRM records')
  return await res.json()
}
function taskRow(row: { id: string; related_id: string; description: string; status: string }) {
  const metadata = JSON.parse(row.description) as EmailTask
  if (row.status === 'completed' && !['sent', 'completed_elsewhere'].includes(metadata.status)) {
    metadata.status = 'completed_elsewhere'; metadata.evidence = 'Marked complete in CRM tasks. Check the task outcome for details.'
  }
  if (row.status === 'cancelled') { metadata.status = 'completed_elsewhere'; metadata.evidence = 'Cancelled in CRM tasks; no email sent.' }
  return { id: row.id, contact_id: row.related_id, metadata }
}
function taskUpdate(task: EmailTask, updatedAt: string, actor: string) {
  const complete = ['sent', 'completed_elsewhere'].includes(task.status)
  return { description: JSON.stringify(task), updated_at: updatedAt, status: complete ? 'completed' : task.status === 'sending' ? 'in_progress' : 'open', due_at: task.nextReview ? `${task.nextReview}T16:00:00Z` : null, ...(complete ? { completed_at: updatedAt, completed_by_name: actor, outcome_note: task.evidence || `Email accepted by provider ${task.providerId}` } : {}) }
}
function sender(brand: string) {
  // Dexa must have its own explicitly configured, verified sender.
  return brand === 'ssm' ? 'Saturn Star Movers <business@starmovers.ca>' : readEnv('DEXA_PARTNERSHIP_EMAIL_FROM')
}
export async function GET(request: Request) {
  const session = await getRequestSessionUser(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const requestedId = new URL(request.url).searchParams.get('id')
    if (requestedId && !/^[0-9a-f-]{36}$/i.test(requestedId)) throw new Error('Invalid task')
    const records = await db('crm_tasks', `${requestedId ? `id=eq.${requestedId}&` : ''}category=eq.${KIND}&select=id,related_id,description,updated_at,status&order=created_at.asc&limit=200`)
    const touches = records.map(taskRow)
    if (!touches.length) return NextResponse.json({ tasks: [], dexaSender: sender('dexa') })
    const contacts = await db('market_contacts', `id=in.(${touches.map((t: {contact_id: string}) => t.contact_id).join(',')})&select=id,name,city,company,stage,do_not_contact,owner_name,assigned_manager_user_id,last_touch_at`)
    const tasks = touches.flatMap((t: {id: string; contact_id: string; metadata: EmailTask}) => {
      const contact = contacts.find((c: {id: string}) => c.id === t.contact_id)
      return contact && partnershipRecordMatchesSession(session, contact) ? [{ id: t.id, contact, ...t.metadata, attachments: requestedId ? t.metadata.attachments : (t.metadata.attachments || []).map(a => ({ filename: a.filename, content: '' })) }] : []
    })
    return NextResponse.json({ tasks, dexaSender: sender('dexa') })
  } catch { return NextResponse.json({ error: 'Unable to load fulfilment queue' }, { status: 500 }) }
}
export async function POST(request: Request) {
  const session = await getRequestSessionUser(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const input = await request.json()
    if (!/^[0-9a-f-]{36}$/i.test(input.id || '')) throw new Error('Invalid task')
    const [record] = await db('crm_tasks', `id=eq.${input.id}&category=eq.${KIND}&select=*`)
    const row = record ? taskRow(record) : null
    if (!row) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    const [contact] = await db('market_contacts', `id=eq.${row.contact_id}&select=*`)
    if (!contact || !partnershipRecordMatchesSession(session, contact)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const old = row.metadata as EmailTask
    if (old.revision !== input.revision) return NextResponse.json({ error: 'This task changed. Reload before continuing.' }, { status: 409 })
    if (record.status === 'cancelled' || record.status === 'completed' || old.status === 'sent' || old.status === 'completed_elsewhere') throw new Error('This promise is already closed')
    const action = input.action
    if (!['save', 'send', 'complete'].includes(action)) throw new Error('Unknown action')
    if (old.status === 'sending' && action !== 'complete') throw new Error('Sending outcome needs checking. Do not send again.')
    const task: EmailTask = { ...old, revision: old.revision + 1 }
    if (action === 'complete') {
      if (typeof input.evidence !== 'string' || input.evidence.trim().length < 8) throw new Error('Record when and how the promise was fulfilled')
      task.status = 'completed_elsewhere'; task.evidence = input.evidence.trim().slice(0, 2000)
    } else {
      const d = input.draft || {}
      for (const key of ['to', 'subject', 'body', 'region', 'note', 'nextReview'] as const) {
        if (typeof d[key] !== 'string') throw new Error('Invalid draft')
        task[key] = d[key].trim()
      }
      task.attachments = d.attachments || []
      task.status = d.status === 'waiting' ? 'waiting' : 'draft'
      validateEmailTask(task, action === 'send')
    }
    let attachments: { filename: string; content: string }[] = []
    if (action === 'send') {
      if (task.status === 'waiting') throw new Error('Resolve the missing information and select Ready to send first')
      if (!input.reviewed) throw new Error('Check recent conversation and sent-mail before sending')
      if (contact.do_not_contact || ['dnc', 'closed_lost'].includes(contact.stage) || ['opted_out', 'rejected'].includes(contact.decision) || isOptOutText(contact.notes)) throw new Error('This contact is opted out or closed')
      if (!readEnv('RESEND_API_KEY') || !sender(task.brand)) throw new Error('The company email sender is not configured')
      attachments = [...(task.attachments || [])]
      if (task.region) {
        const filename = cardFilename(task.region)
        attachments.unshift({ filename, content: (await readFile(path.join(process.cwd(), 'public/partner-cards', filename))).toString('base64') })
      }
      task.status = 'sending'
    }
    const claimTime = new Date(Math.max(Date.now(), Date.parse(record.updated_at) + 1)).toISOString()
    const claimed = await db('crm_tasks', `id=eq.${row.id}&updated_at=eq.${encodeURIComponent(record.updated_at)}&status=eq.${record.status}`, 'PATCH', taskUpdate(task, claimTime, session.name || 'CRM user'))
    if (!claimed.length) return NextResponse.json({ error: 'Another update won. Reload before continuing.' }, { status: 409 })
    if (action !== 'send') return NextResponse.json({ ok: true })
    // Persist the claim before contacting the provider. An uncertain result stays
    // locked for manual checking, rather than risking a duplicate email.
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${readEnv('RESEND_API_KEY')}`, 'Content-Type': 'application/json', 'Idempotency-Key': `partner-promise-${row.id}-${task.revision}` },
      body: JSON.stringify({ from: sender(task.brand), to: [task.to], subject: task.subject, text: task.body, ...(task.brand === 'ssm' ? { reply_to: 'business@inbound.starmovers.ca' } : {}), attachments }), signal: AbortSignal.timeout(20000),
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok || !result.id) {
      if ([400, 401, 403, 422, 429].includes(response.status)) {
        await db('crm_tasks', `id=eq.${row.id}&updated_at=eq.${encodeURIComponent(claimTime)}`, 'PATCH', taskUpdate({ ...task, status: 'draft' }, new Date().toISOString(), session.name || 'CRM user'))
        throw new Error('Email provider rejected the request. Check sender and recipient before retrying.')
      }
      throw new Error('Email outcome is uncertain. Check sent-mail before taking further action.')
    }
    task.status = 'sent'; task.providerId = result.id; task.sentAt = new Date().toISOString()
    const saved = await db('crm_tasks', `id=eq.${row.id}&updated_at=eq.${encodeURIComponent(claimTime)}`, 'PATCH', taskUpdate(task, new Date().toISOString(), session.name || 'CRM user'))
    if (!saved.length) throw new Error('Email accepted; CRM receipt needs checking. Do not resend.')
    // The completed task is the durable receipt. Only actual sends enter history.
    try {
      await db('market_touches', 'on_conflict=id', 'POST', { id: row.id, contact_id: row.contact_id, channel: 'email', direction: 'outbound', notes: `Subject: ${task.subject}\n\n${task.body}\n\nAttachments: ${attachments.map(a => a.filename).join(', ')}`, created_by: session.name || 'CRM user', created_at: task.sentAt, metadata: { source: KIND, provider_id: task.providerId, to: task.to } })
    } catch { return NextResponse.json({ ok: true, providerId: result.id, warning: 'Sent and saved on task; conversation-history copy needs checking.' }) }
    return NextResponse.json({ ok: true, providerId: result.id })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to update task' }, { status: 400 }) }
}
