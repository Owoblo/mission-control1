import { listingAddressKey, decideListingMatch } from '@/lib/listing-match'
import { dateStamp } from '@/lib/sales'
import { realtorPartnerBlocked, type RealtorPartner } from '@/lib/realtor-research'
import { getSalesLead } from './sales-repository'
import { destinationDb } from './destination-db'
export async function assertDestinationRealtorSend(id:string, actor:string, to:string, channel:string) {
  const lead=await getSalesLead(id)
  if (lead?.leadKind!=='realtor_opportunity' || lead.primaryContactRole!=='realtor') return
  if (actor!=='human') throw new Error('Destination discovery does not authorize automated outreach. Review the partner conversation first.')
  const research=lead.realtorResearch
  if (research?.status!=='verified' || research.propertyKey!==listingAddressKey(lead.opportunityAddress,lead.opportunityCity)
    || !lead.supabaseListing || !decideListingMatch([lead.opportunityAddress?.split(',')[0],lead.opportunityCity,'ON'].filter(Boolean).join(', '),[lead.supabaseListing]).listing) throw new Error('Confirm the listing agent and property evidence before sending.')
  const source=lead.sourceLeadId ? await getSalesLead(lead.sourceLeadId) : null
  if (!source || source.moveDate!==lead.sourceLeadMoveDate || ['lost','completed'].includes(source.stage) || (source.moveDate && source.moveDate<dateStamp())
    || listingAddressKey(source.destAddress,source.destCity)!==research.propertyKey)
    throw new Error('The source move is no longer current. Refresh this opportunity before sending.')
  const phone=(v:string)=>(v || '').replace(/\D/g,'').replace(/^1(?=\d{10}$)/,'')
  const email=channel==='email'
  const identity=research.candidates[0]
  if (!identity || identity.name.toLowerCase().trim()!==lead.realtorName?.toLowerCase().trim()
    || (email ? to.toLowerCase()!==identity.email?.toLowerCase() : phone(to)!==phone(identity.phone || '')))
    throw new Error('Contact details changed after confirmation. Research and confirm the listing contact again.')
  if (email ? to.toLowerCase()!==lead.realtorEmail?.toLowerCase() : phone(to)!==phone(lead.realtorPhone || ''))
    throw new Error('Recipient differs from the confirmed listing contact.')
  const query=new URLSearchParams({select:'id,name,phone,email,do_not_contact,cross_channel_suppressed_at,stage,decision',limit:'100'})
  query.set(email?'email':'phone',email?`ilike.${to}`:`ilike.*${phone(to).slice(-7)}*`)
  const peers=await destinationDb<RealtorPartner[]>(`market_contacts?${query}`)
  if (peers.length>=100 || peers.filter(p=>email?p.email?.toLowerCase()===to.toLowerCase():phone(p.phone || '')===phone(to)).some(realtorPartnerBlocked))
    throw new Error('This contact is unavailable for outreach. Review the partnership record.')
}
