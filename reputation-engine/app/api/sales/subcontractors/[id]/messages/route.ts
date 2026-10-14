import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { canAccessOperationsWorkspace } from '@/lib/server/sales-permissions'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { normalizePhone } from '@/lib/sales-phones'

// Internal contractor history: shared partnership numbers must not hide recruiting SMS.
// Kept separate from the customer inbox and the external partner portal.
export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser()
  if (!canAccessOperationsWorkspace(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await context.params
  const { url, headers } = requireSupabaseEnv()
  async function read(path: string) {
    const response = await fetch(`${url}/rest/v1/${path}`, { headers, cache: 'no-store' })
    if (!response.ok) throw new Error('Could not load contractor messages')
    return response.json()
  }
  try {
    const [contractor] = await read(`subcontractors?select=id,phone&id=eq.${encodeURIComponent(id)}&limit=1`)
    if (!contractor) return NextResponse.json({ error: 'Contractor not found' }, { status: 404 })
    const phone = normalizePhone(contractor.phone)
    if (!phone || !/^\+1\d{10}$/.test(phone)) return NextResponse.json({ messages: [], phone: null })
    const variants = [phone, phone.slice(2)]
    const filter = variants.flatMap(value => [`from_number.eq.${value}`, `to_number.eq.${value}`]).join(',')
    const query = new URLSearchParams({ select: 'id,from_number,to_number,body,direction,created_at', or: `(${filter})`, order: 'created_at.desc,id.desc', limit: '200' })
    const messages = await read(`sms_messages?${query}`)
    return NextResponse.json({ phone, messages: messages.reverse() })
  } catch {
    return NextResponse.json({ error: 'Could not load contractor messages' }, { status: 500 })
  }
}
