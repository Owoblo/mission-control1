import { verifyOwnedActiveCall } from '@/lib/server/dialer-access'
import { NextResponse } from 'next/server'
import { normalizeLead, uid } from '@/lib/sales'
import { normalizePhone } from '@/lib/sales-phones'
import type { CallLogEntry, CRMLead } from '@/lib/types'
import { getRequestSessionUser } from '@/lib/server/request-session'
import { canHandleLeadCommunications } from '@/lib/server/sales-permissions'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { recordLeadCreatedAudit, recordLeadUpdateAudit } from '@/lib/server/sales-audit'
import {
  getSalesLeadByContact,
  saveCrmCallSidMapping,
  saveSalesLead,
} from '@/lib/server/sales-repository'

const ALLOWED_ROLES = new Set(['owner', 'manager', 'sales_rep', 'partnership_manager'])
const SALES_ROLES = new Set(['owner', 'manager', 'sales_rep'])

type HandoffBody = {
  phone?: string
  callSid?: string
  targetUserId?: string
  targetIdentity?: string
  customerName?: string
  partnerName?: string
  notes?: string
}

async function getSalesTarget(userId: string) {
  const { url, headers } = requireSupabaseEnv()
  const query = new URLSearchParams({
    select: 'id,name,role,branch',
    id: `eq.${userId}`,
    role: 'in.(owner,manager,sales_rep)',
    limit: '1',
  })
  const response = await fetch(`${url}/rest/v1/app_users?${query}`, {
    headers,
    cache: 'no-store',
  })
  if (!response.ok) throw new Error('Could not verify the selected Sales teammate.')
  const users = await response.json() as Array<{ id: string; name?: string; role?: string; branch?: string }>
  return users[0] || null
}

export async function POST(request: Request) {
  const session = await getRequestSessionUser(request)
  if (!session?.userId || !ALLOWED_ROLES.has(session.role || '')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json() as HandoffBody
    const phone = normalizePhone(body.phone)
    const callSid = body.callSid?.trim() || ''
    const targetUserId = body.targetUserId?.trim() || ''
    const targetIdentity = body.targetIdentity?.trim() || ''
    if (!phone || phone.replace(/\D/g, '').length < 10) {
      return NextResponse.json({ error: 'A valid caller phone number is required.' }, { status: 400 })
    }
    if (!/^CA[0-9a-f]{32}$/i.test(callSid)) {
      return NextResponse.json({ error: 'The active call is not ready to hand off.' }, { status: 400 })
    }
    if (!targetUserId || targetIdentity !== `saturn-rep-${targetUserId}`) {
      return NextResponse.json({ error: 'Choose a valid Sales teammate.' }, { status: 400 })
    }

    const verifiedCall = await verifyOwnedActiveCall(callSid, session, phone)
    if (!verifiedCall.branch) return NextResponse.json({ error: 'The servicing branch could not be verified from this call.' }, { status: 409 })
    const target = await getSalesTarget(targetUserId)
    if (!target || !SALES_ROLES.has(target.role || '')) {
      return NextResponse.json({ error: 'The selected teammate is not on the Sales team.' }, { status: 400 })
    }

    if (target.branch && target.branch !== verifiedCall.branch) return NextResponse.json({ error: 'Choose a teammate serving this call branch.' }, { status: 403 })
    const customerName = body.customerName?.trim().slice(0, 100) || ''
    const partnerName = body.partnerName?.trim().slice(0, 100) || ''
    const handoffNotes = body.notes?.trim().slice(0, 1500) || ''
    const now = new Date().toISOString()
    const lead = await getSalesLeadByContact(phone, null, null, { includeClosed: true })
    if (lead?.branch && lead.branch !== verifiedCall.branch) return NextResponse.json({ error: 'The existing customer belongs to a different branch.' }, { status: 403 })
    const existingOwnerName = lead?.assignedRepName || lead?.assignedRep
    const hasDifferentOwner = lead && (
      (lead.assignedRepUserId && lead.assignedRepUserId !== targetUserId) ||
      (!lead.assignedRepUserId && existingOwnerName && existingOwnerName.trim().toLowerCase() !== (target.name || '').trim().toLowerCase())
    )
    if (lead && hasDifferentOwner) {
      return NextResponse.json({
        error: `This lead is already assigned to ${existingOwnerName || 'another Sales teammate'}. Select their line to continue the handoff.`,
        leadId: lead.id,
      }, { status: 409 })
    }
    if (lead && session.role !== 'partnership_manager' && !canHandleLeadCommunications(session, lead)) {
      return NextResponse.json({ error: 'You do not have access to this customer record.' }, { status: 403 })
    }

    const referralDetail = partnerName
      ? `Partner name shared during call: ${partnerName}.`
      : 'Referring partner was not confirmed during the call.'
    const auditNote = [
      `Partnership-line warm handoff started by ${session.name || 'a Saturn Star teammate'} to ${target.name || 'Sales'}.`,
      referralDetail,
      handoffNotes ? `Call brief: ${handoffNotes}` : '',
    ].filter(Boolean).join('\n')
    const existingCall = lead?.callLogs?.find(item => item.callSid === callSid)
    const callLog: CallLogEntry = existingCall || {
      id: uid('cl'),
      type: 'call',
      date: now,
      phone,
      duration: 'in progress',
      direction: 'inbound',
      callSid,
      source: 'inbound',
      callOutcome: 'warm_handoff_in_progress',
      answeredBy: 'mobile',
      audioConnected: true,
      repId: session.userId,
      repName: session.name,
      notes: auditNote,
    }

    const nextLead = normalizeLead({
      ...(lead || {
        id: uid('lead'),
        name: customerName || 'Referred caller',
        branch: verifiedCall.branch,
        stage: 'contacted',
        leadKind: 'customer',
        primaryContactRole: 'customer',
        source: 'phone',
        sourceDetail: partnerName
          ? 'Partnership-line inbound call; partner name captured in the call notes.'
          : 'Partnership-line inbound call; referring partner not confirmed.',
        phone,
        createdAt: now,
        callLogs: [],
        notes: 'Caller reached Saturn Star through the partnership phone line and was handed to Sales while on the call.',
      } as CRMLead),
      ...(lead && !lead.name?.trim() && customerName ? { name: customerName } : {}),
      assignedRep: lead?.assignedRep || target.name || 'Sales',
      assignedRepName: lead?.assignedRepName || target.name || 'Sales',
      assignedRepUserId: lead?.assignedRepUserId || targetUserId,
      leadOwnerStatus: lead?.leadOwnerStatus || 'assigned',
      ownedAt: lead?.ownedAt || now,
      callLogs: existingCall
        ? (lead?.callLogs || [])
        : [callLog, ...(lead?.callLogs || [])],
      lastTouchedAt: now,
      lastTouchedByUserId: session.userId,
      lastTouchedByName: session.name,
      ...(lead ? {} : {
        sourceDetail: partnerName
          ? 'Partnership-line inbound call; partner name captured in the call notes.'
          : 'Partnership-line inbound call; referring partner not confirmed.',
      }),
    })

    const saved = await saveSalesLead(nextLead)
    if (callSid) await saveCrmCallSidMapping(callSid, saved.id, callLog.id).catch(() => undefined)
    if (lead) await recordLeadUpdateAudit(lead, saved).catch(() => undefined)
    else await recordLeadCreatedAudit(saved).catch(() => undefined)

    return NextResponse.json({
      ok: true,
      leadId: saved.id,
      created: !lead,
      customerName: customerName || saved.name,
      targetName: target.name || 'Sales',
      notes: [referralDetail, handoffNotes].filter(Boolean).join('\n'),
    })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Could not prepare the Sales handoff.',
    }, { status: 500 })
  }
}
