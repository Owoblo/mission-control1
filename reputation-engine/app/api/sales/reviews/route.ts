import { NextResponse } from 'next/server'
import { uid } from '@/lib/sales'
import { configuredReviewUrl, matchReviewLocationForLead, nearestReviewLocationByCoordinates } from '@/lib/review-locations'
import { isPastReviewCustomer, normalizedReviewContact } from '@/lib/review-customer-sync'
import { listBookedSalesLeads } from '@/lib/server/sales-repository'
import { listJobs, saveJobRecord } from '@/lib/server/repository'
import { hasInternalSession } from '@/lib/server/session'
import { geocodeAddress } from '@/lib/server/route-estimation'
import type { Job } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    if (!(await hasInternalSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const [allJobs, bookedLeads] = await Promise.all([listJobs(), listBookedSalesLeads()])
    const pastCustomers = bookedLeads.filter(lead => isPastReviewCustomer(lead))
    const jobs = [...allJobs]

    for (const lead of pastCustomers) {
      const phone = normalizedReviewContact(lead.phone)
      const email = normalizedReviewContact(lead.email)
      const existing = jobs.find(job =>
        job.crmLeadId === lead.id ||
        (!!phone && normalizedReviewContact(job.customerPhone) === phone) ||
        (!!email && normalizedReviewContact(job.customerEmail) === email)
      )
      let location = matchReviewLocationForLead({
        originAddress: lead.originAddress,
        originCity: lead.originCity,
        listingAddress: lead.supabaseListing?.address,
        listingCity: lead.supabaseListing?.city,
        branch: lead.branch,
        destAddress: lead.destAddress,
        destCity: lead.destCity,
      })
      if (!location && (lead.originAddress || lead.originCity)) {
        const geocoded = await geocodeAddress(lead.originAddress || lead.originCity || '').catch(() => null)
        if (geocoded) location = nearestReviewLocationByCoordinates(geocoded.lat, geocoded.lng).location
      }
      const base: Job = {
        ...existing,
        id: existing?.id || uid('review'),
        customerName: lead.name || existing?.customerName || 'Customer',
        customerEmail: lead.email || existing?.customerEmail || '',
        customerPhone: lead.phone || existing?.customerPhone || '',
        moveDate: lead.moveDate || existing?.moveDate || '',
        moveFrom: lead.originAddress || lead.originCity || existing?.moveFrom || '',
        moveTo: lead.destAddress || lead.destCity || existing?.moveTo || '',
        crewLead: existing?.crewLead || '',
        status: existing?.status || 'pending',
        reviews: existing?.reviews || { google: false, yelp: false, facebook: false, media: false },
        reviewConfirmedAt: existing?.reviewConfirmedAt || {},
        incentiveEarned: existing?.incentiveEarned || false,
        incentivePaid: existing?.incentivePaid || false,
        proofSentToPartner: existing?.proofSentToPartner || false,
        createdAt: existing?.createdAt || lead.createdAt || new Date().toISOString(),
        crmLeadId: lead.id,
        googleReviewUrl: location ? configuredReviewUrl(location) : existing?.googleReviewUrl,
        googleProfileLocation: location?.label || existing?.googleProfileLocation,
      }
      const saved = await saveJobRecord(base)
      const index = jobs.findIndex(job => job.id === saved.id)
      if (index >= 0) jobs[index] = saved
      else jobs.push(saved)
    }

    return NextResponse.json(jobs)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not load past customers' }, { status: 500 })
  }
}
