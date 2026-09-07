import { NextResponse } from 'next/server'
import { detectSalesBranchFromLocation, getLeadAssignedRepName } from '@/lib/sales'
import { getSalesBranchFromSaturnLabel, normalizePhone } from '@/lib/sales-phones'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getRequestSessionUser } from '@/lib/server/request-session'
import { listSalesLeads } from '@/lib/server/sales-repository'

const MAX_CONTACTS = 100

function actionLabel(value?: string) {
  if (!value) return ''
  return value.replace(/^rep_/, '').replace(/^await_/, 'Wait for ').replaceAll('_', ' ').replace(/^\w/, letter => letter.toUpperCase())
}

export async function GET(request: Request) {
  const session = await getRequestSessionUser(request)
  if (!canAccessSalesWorkspace(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const query = new URL(request.url).searchParams.get('q')?.trim().toLowerCase() || ''
  const queryDigits = query.replace(/\D/g, '')
  const sessionBranch = getSalesBranchFromSaturnLabel(session?.branch) || session?.branch?.toLowerCase() || ''
  const branchScoped = Boolean(sessionBranch) && session?.role !== 'owner'
  const leads = await listSalesLeads()

  const contacts = leads
    .filter(lead => lead.leadKind !== 'realtor_opportunity' && Boolean(normalizePhone(lead.phone)))
    .filter(lead => {
      if (!branchScoped) return true
      const branch = lead.branch || detectSalesBranchFromLocation(
        lead.originCity,
        lead.originAddress,
        lead.destCity,
        lead.destAddress,
      )
      return String(branch || '').toLowerCase() === sessionBranch
    })
    .filter(lead => {
      if (!query) return true
      if (queryDigits.length >= 3 && normalizePhone(lead.phone).includes(queryDigits)) return true
      return [
        lead.name,
        lead.email,
        lead.phone,
        lead.originAddress,
        lead.originCity,
        lead.destAddress,
        lead.destCity,
      ].filter(Boolean).join(' ').toLowerCase().includes(query)
    })
    .sort((left, right) => String(
      right.lastTouchedAt || right.lastInboundAt || right.createdAt || '',
    ).localeCompare(String(
      left.lastTouchedAt || left.lastInboundAt || left.createdAt || '',
    )))
    .slice(0, MAX_CONTACTS)
    .map(lead => ({
      id: lead.id,
      name: lead.name || lead.phone || 'Customer',
      phone: normalizePhone(lead.phone),
      email: lead.email || '',
      stage: lead.stage,
      branch: lead.branch || '',
      route: [lead.originCity, lead.destCity].filter(Boolean).join(' → '),
      moveDate: lead.moveDate || '',
      assignedRep: getLeadAssignedRepName(lead) || '',
      quoteStatus: lead.automatedQuoteSentAt
        ? 'Quote sent'
        : lead.quoteId
          ? 'Quote in progress'
          : 'No quote yet',
      nextAction: actionLabel(lead.qualificationState?.nextBestAction),
    }))

  return NextResponse.json({ contacts })
}
