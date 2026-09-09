import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { partnershipRecordMatchesSession, partnershipScopeFilter, canSeeAllPartnershipMarkets, isPartnershipManager } from '@/lib/server/partnership-access'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const session = await getSessionUser()
  if (!session || (!canSeeAllPartnershipMarkets(session) && !isPartnershipManager(session))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { url, headers } = requireSupabaseEnv()
  const rows: Record<string, any>[] = []
  for (let offset = 0; ; offset += 1000) {
    const response = await fetch(`${url}/rest/v1/partner_listing_activity?select=*&order=observed_at.desc,activity_key&limit=1000&offset=${offset}${partnershipScopeFilter(session)}`, { headers, cache: 'no-store' })
    if (!response.ok) return NextResponse.json({ error: 'Listing activity could not be loaded' }, { status: 502 })
    const page = await response.json(); rows.push(...page)
    if (page.length < 1000) break
  }
  const contactIds = [...new Set(rows.map(r => r.contact_id).filter(Boolean))]
  const contacts: Record<string, any>[] = []
  for (let i = 0; i < contactIds.length; i += 100) {
    const response = await fetch(`${url}/rest/v1/market_contacts?select=id,name,company,phone,email,city,owner_name,assigned_manager_user_id,stage,last_touch_at,last_inbound_at,do_not_contact,sequence_paused,listing_discovery_key&id=in.(${contactIds.slice(i,i+100).join(',')})`, { headers, cache: 'no-store' })
    if (!response.ok) return NextResponse.json({ error: 'Contact history could not be loaded' }, { status: 502 })
    contacts.push(...await response.json())
  }
  const batches: Record<string, any>[] = []
  const ids = [...new Set(rows.map(r => r.postcard_batch_id).filter(Boolean))]
  for(let i=0;i<ids.length;i+=100) {
    const response=await fetch(`${url}/rest/v1/mail_batches?select=batch_id,status,submitted_at&batch_id=in.(${ids.slice(i,i+100).map(encodeURIComponent).join(',')})`,{headers,cache:'no-store'})
    if(!response.ok) return NextResponse.json({error:'Print history could not be loaded'},{status:502})
    batches.push(...await response.json())
  }
  const contactMap = new Map(contacts.filter(c=>partnershipRecordMatchesSession(session,c)).map(c => [c.id,c])), batchMap=new Map(batches.map(b=>[b.batch_id,b]))
  const groups = new Map<string, Record<string, any>>()
  for (const row of rows) {
    const key = row.contact_id || row.representative_key
    const group = groups.get(key) || { key, representative: row.representative, contact: contactMap.get(row.contact_id) || null, listings: [] }
    group.listings.push({ ...row, postcard_status: batchMap.get(row.postcard_batch_id)?.status || row.postcard_status })
    groups.set(key,group)
  }
  const research: Record<string, Record<string, number>> = {}
  if (canSeeAllPartnershipMarkets(session)) {
    for(let offset=0;;offset+=1000) {
      const response=await fetch(`${url}/rest/v1/partner_listing_research?select=status,lane:listing->>_lane&order=property_key&limit=1000&offset=${offset}`,{headers,cache:'no-store'})
      if(!response.ok) return NextResponse.json({error:'Research queue could not be loaded'},{status:502})
      const page=await response.json()
      for(const job of page) { const lane=job.lane||'unknown';research[lane] ||= {};research[lane][job.status]=(research[lane][job.status]||0)+1 }
      if(page.length<1000) break
    }
  }
  const params = new URL(request.url).searchParams
  const lane = params.get('lane')
  return NextResponse.json({ groups: [...groups.values()].filter(g => !lane || g.listings.some((l: any) => l.lane === lane)), observed_connections: rows.length, research })
}

export async function PATCH(request: Request) {
  const session = await getSessionUser()
  if (!session || (!canSeeAllPartnershipMarkets(session) && !isPartnershipManager(session))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json()
  if (typeof body.activity_key !== 'string') return NextResponse.json({ error: 'Activity required' }, { status: 400 })
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/partner_listing_activity?activity_key=eq.${encodeURIComponent(body.activity_key)}&select=*&limit=1`, { headers, cache:'no-store' })
  if(!response.ok) return NextResponse.json({error:'Could not load activity'},{status:502})
  const [row] = await response.json()
  if (!row || !partnershipRecordMatchesSession(session,row)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  let contactId = body.contact_id
  if (body.create_contact === true) {
    const rep=row.representative
    const existing=await fetch(`${url}/rest/v1/market_contacts?listing_discovery_key=eq.${row.representative_key}&select=id&limit=1`,{headers,cache:'no-store'})
    if(!existing.ok) return NextResponse.json({error:'Contact lookup failed'},{status:502})
    const [known]=await existing.json()
    if(known) contactId=known.id
    else {
      const duplicateResponse=await fetch(`${url}/rest/v1/market_contacts?name=ilike.${encodeURIComponent(String(rep.name||'').trim())}&select=id&limit=1`,{headers,cache:'no-store'})
      if(!duplicateResponse.ok) return NextResponse.json({error:'Could not check for duplicate contacts'},{status:502})
      if((await duplicateResponse.json()).length) return NextResponse.json({error:'A contact with this name already exists. Search and review that record before creating another.'},{status:409})
      const created=await fetch(`${url}/rest/v1/market_contacts`,{method:'POST',headers:{...headers,Prefer:'return=representation'},body:JSON.stringify({
        name:rep.name,company:rep.brokerage||'',title:rep.role||'',phone:rep.phone||null,email:rep.email||null,city:row.city,
        stage:'target',industry:'Real Estate',listing_discovery_key:row.representative_key,tags:['listing-discovery',row.lane],
        sequence_paused:true,sequence_paused_reason:'Manual outreach only — listing discovery',source_csv:'listing_research_review',
        notes:`Listing association reviewed by ${session.name || 'operator'}. Source: ${row.source_url || ''}`,
      })})
      if(!created.ok) return NextResponse.json({error:'Could not create contact; check for an existing record'},{status:409})
      contactId=(await created.json())[0].id
    }
  }
  if(typeof contactId!=='string'||!/^[0-9a-f-]{36}$/i.test(contactId)) return NextResponse.json({error:'Valid contact required'},{status:400})
  const contactResponse=await fetch(`${url}/rest/v1/market_contacts?id=eq.${contactId}&select=*&limit=1`,{headers,cache:'no-store'})
  if(!contactResponse.ok) return NextResponse.json({error:'Contact lookup failed'},{status:502})
  const [contact]=await contactResponse.json()
  if(!contact||!partnershipRecordMatchesSession(session,contact)) return NextResponse.json({error:'Contact unavailable'},{status:404})
  const updated=await fetch(`${url}/rest/v1/partner_listing_activity?representative_key=eq.${row.representative_key}${partnershipScopeFilter(session)}`,{method:'PATCH',headers,body:JSON.stringify({contact_id:contactId,match_status:'reviewed'})})
  return updated.ok ? NextResponse.json({ok:true,contact_id:contactId}) : NextResponse.json({error:'Could not link contact'},{status:502})
}
