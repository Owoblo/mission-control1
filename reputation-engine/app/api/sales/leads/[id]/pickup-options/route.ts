import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { canAccessSalesWorkspace, leadMatchesSessionBranch } from '@/lib/server/sales-permissions'
import { getSalesLead, getSalesQuote } from '@/lib/server/sales-repository'
import { geocodeAddress, getDrivingRoute, isDrivingRoutePlausible } from '@/lib/server/route-estimation'
import { PLANNING_TRUCKS, type PlannedTruckSize } from '@/lib/truck-planning'
import { comparePickupRoutes, type RouteMatrix } from '@/lib/pickup-route-plan'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await context.params
    const body = await request.json() as { additionalLeadId: string; yard: string }
    const [parent, child] = await Promise.all([getSalesLead(id), getSalesLead(body.additionalLeadId)])
    if (!parent || !child || child.parentLeadId !== parent.id || !leadMatchesSessionBranch(parent, session) || !leadMatchesSessionBranch(child, session)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (child.additionalJobKind !== 'supplement') throw new Error('This is a separate booking, not a combined route.')
    const normalize = (s?: string) => s?.trim().toLowerCase().replace(/\s+/g, ' ')
    if (!parent.destAddress || normalize(parent.destAddress) !== normalize(child.destAddress)) throw new Error('Confirm the same delivery address on both jobs before comparing these pickup orders.')
    if (parent.moveDate && child.moveDate && parent.moveDate !== child.moveDate) throw new Error('These jobs have different dates. Confirm whether they belong on the same move.')
    if (!body.yard?.trim() || !parent.originAddress || !child.originAddress) throw new Error('Enter the truck departure/return address and confirm both pickup addresses.')
    const addresses = [body.yard.trim(), parent.originAddress, child.originAddress, parent.destAddress]
    const coordinates = await Promise.all(addresses.map(address => geocodeAddress(address)))
    if (coordinates.some(c => !c)) throw new Error('An address could not be located. Confirm full addresses, including city.')
    const matrix: RouteMatrix = {}
    const pairs = [[0,1],[0,2],[1,2],[2,1],[1,3],[2,3],[3,0],[3,1],[3,2]]
    // Bound provider concurrency; a failed leg cannot win the comparison as zero travel.
    for (let start = 0; start < pairs.length; start += 3) {
      await Promise.all(pairs.slice(start, start + 3).map(async ([a,b]) => {
        const leg = await getDrivingRoute(coordinates[a]!, coordinates[b]!)
        if (leg && isDrivingRoutePlausible(coordinates[a]!, coordinates[b]!, leg.distanceKm)) matrix[`${a}-${b}`] = leg
      }))
    }
    const metrics = (lead: typeof parent) => {
      const items = (lead.inventory || []).filter(i => i.included !== false)
      return { volume: items.reduce((n,i) => n + Number(i.cubicFeet || 0) * Number(i.qty ?? 1),0), weight: items.reduce((n,i) => n + Number(i.weightLbs || 0) * Number(i.qty ?? 1),0), known: !!lead.inventoryVerification?.completedAt && items.length > 0 && items.every(i => Number(i.cubicFeet) > 0 && Number(i.weightLbs) > 0 && Number(i.qty ?? 1) > 0) }
    }
    const a = metrics(parent), b = metrics(child)
    const quote = parent.quoteId ? await getSalesQuote(parent.quoteId) : null
    const spec = PLANNING_TRUCKS[(parent.truckSize || quote?.truckSize) as PlannedTruckSize]
    const count = parent.truckCountConfirmed || quote?.truckCount || 0
    const options = comparePickupRoutes(matrix, { original: a.volume, additional: b.volume, originalWeight: a.weight, additionalWeight: b.weight, capacity: (spec?.usableCubicFeet || 0) * count, payload: (spec?.payloadLbs || 0) * count, verified: a.known && b.known && !!spec && count === 1 })
    return NextResponse.json({ options, addresses, resolved: coordinates.map(c => c!.displayName), capacity: spec?.usableCubicFeet || null, truck: spec?.size || null,
      note: 'Planning comparison for these two pickups only. Driving estimates are rounded, without live traffic or stop time windows. Confirm geocoded addresses, access, loading sequence and actual truck specifications. Multi-truck allocation requires operations review. No price or dispatch is changed.' })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not compare pickup orders' }, { status: 400 }) }
}
