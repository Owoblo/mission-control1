import { NextResponse } from 'next/server'
import { getRequestSessionUser } from '@/lib/server/request-session'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { partnershipRecordMatchesSession } from '@/lib/server/partnership-access'
import { canonicalChannel, fulfilmentSummary, relationshipIdentity } from '@/lib/relationship-record'
export const dynamic = 'force-dynamic'
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getRequestSessionUser(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await context.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Invalid contact' }, { status: 400 })
  const { url, headers } = requireSupabaseEnv()
  async function read(table: string, query: string) {
    const response = await fetch(`${url}/rest/v1/${table}?${query}`, { headers, cache: 'no-store', signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error('Unable to load relationship records')
    return response.json()
  }
  try {
    const [contact] = await read('market_contacts', `id=eq.${id}&select=id,name,company,title,industry,city,address,email,phone,preferred_channel,owner_name,assigned_manager_user_id,do_not_contact`)
    if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    if (!partnershipRecordMatchesSession(session, contact)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const [tasks, touches] = await Promise.all([
      read('crm_tasks', `related_id=eq.${id}&category=in.(partnership_address_fulfilment,partner_email_fulfilment,partnership_print_delivery,partnership_visit_fulfilment)&select=id,title,status,category,description,due_at,updated_at&order=updated_at.desc&limit=51`),
      read('market_touches', `contact_id=eq.${id}&select=channel,direction&order=created_at.desc&limit=501`),
    ])
    const channels: Record<string, { inbound: number; outbound: number }> = {}
    for (const touch of touches.slice(0, 500)) {
      const channel = canonicalChannel(touch.channel)
      const count = channels[channel] ||= { inbound: 0, outbound: 0 }
      if (touch.direction === 'inbound') count.inbound++
      else if (touch.direction === 'outbound') count.outbound++
    }
    return NextResponse.json({ identity: relationshipIdentity(contact), address: contact.address, channels,
      historyLimited: touches.length > 500, tasksLimited: tasks.length > 50,
      tasks: tasks.slice(0, 50).map(fulfilmentSummary), checkedAt: new Date().toISOString() })
  } catch {
    return NextResponse.json({ error: 'Unable to load relationship records' }, { status: 502 })
  }
}
