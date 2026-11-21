import { fs, api, db as read } from './gta-email-recovery-runtime.mjs'
import { randomUUID } from 'node:crypto'
import { db as write } from './reply-runtime-20261007.mjs'

const dir = 'artifacts/contractor-bid-outreach-20261021/'
fs.mkdirSync(dir, { recursive: true })
const recipients = [
  { id: '961bdc74-9102-41ef-a395-63e43b76a29a', name: 'Paradise Movers', contact: 'John', email: 'John@paradisemovers.ca', from: 'email' },
  { id: 'db9e225d-a838-421f-88e7-3466275eaf01', name: 'Mississauga Brampton Caledon Movers', contact: 'Jesse', email: 'Msmovers2018@gmail.com', from: 'email' },
  { id: 'b1859baf-0ae3-4250-a149-453ae241ee21', name: '7Moving Ltd', contact: '7Moving Ltd', email: 'info@7moving.ca', from: 'email' },
  { id: 'ae8519a0-dfbf-4e64-90c8-f493216d9f57', name: 'Baker Home Solutions', contact: 'Justin', phone: '+12896882087', from: 'sms', hourlyOnly: true },
  { id: '772266aa-1c5b-4171-8b39-a68e7ce5f3be', name: 'Diligent Movers', contact: 'Diligent Movers', phone: '+16476166601', from: 'sms' },
]
const jobs = [
  { id: 'lead_ctn74wt50', key: 'moe-kitchener-london', templateId: '39df27fa-77d0-431f-b8a1-22cfaff75dd0' },
  { id: 'lead_5p16pkjjt', key: 'jesse-stoney-creek-amherstburg' },
]
const names = Object.fromEntries(recipients.map(x => [x.id, x]))

const [templateLead] = await read('crm_leads', { id: 'eq.' + jobs[0].id, select: 'id,data,updated_at' })
const templateReview = templateLead.data.contractorScopeReviews?.find(x => x.id === jobs[0].templateId)
if (!templateReview?.scope?.workSections?.length || !templateReview.scope?.referencePhotos?.length) throw Error('Moe’s detailed scope template is unavailable')

const formRows = await read('partner_onboarding_invites', { subcontractor_id: 'in.(' + recipients.map(x => x.id).join(',') + ')', select: 'id,token,subcontractor_id,stage,checklist,application,expires_at,created_at', order: 'created_at.desc', limit: '100' })
if (formRows.length >= 100) throw Error('Form pagination required')
const contacts = await read('subcontractors', { id: 'in.(' + recipients.map(x => x.id).join(',') + ')', select: 'id,company_name,contact_name,email,phone,status,notes' })
const dateNow = Date.now()
const plans = []

function jesseScope(base, recipient) {
  return {
    ...base,
    contactName: recipient.contact + (recipient.id === 'db9e225d-a838-421f-88e7-3466275eaf01' ? ' — Mississauga Brampton Caledon Movers' : recipient.contact === recipient.name ? '' : ' — ' + recipient.name),
    date: '2026-10-30', time: '09:00', origin: 'Stoney Creek', destination: 'Amherstburg',
    crew: 2, trucks: 1, truck: '26ft', packing: 'self',
    routeEstimate: { miles: 206, kilometers: 332 }, accessConfirmed: true,
    access: [
      { stop: 'Pickup', property: 'low-rise apartment', vertical: 'freight elevator to floor 2', floor: 2, parking: 'curb', exteriorSteps: 0, confirmed: true, narrowDoor: false, tightTurn: false },
      { stop: 'Delivery', property: 'low-rise apartment', vertical: 'freight elevator to floor 2', floor: 2, parking: 'curb', exteriorSteps: 0, confirmed: true, narrowDoor: false, tightTurn: false },
    ],
    workSections: [
      { title: 'Move overview', details: [
        'Friday, October 30, 2026; planned start 9:00 a.m. Residential move from Stoney Creek to Amherstburg.',
        'One 26-ft truck and a two-person crew are in the current plan. The one-way drive is approximately 206 miles (332 km). Include travel, loading, securing the load, delivery and unloading in your proposed price.',
        'Pickup and delivery are low-rise apartments on the second floor. Freight elevators are recorded as reserved at both buildings. Truck parking is recorded at the curb. Confirm the elevator window, protection rules and truck-to-elevator carrying path on arrival; tell John before pricing if anything differs.',
      ] },
      { title: 'Inventory and handling', details: [
        'The full included inventory is listed below: one 3-seat sofa, one loveseat, one queen bed set, one large coffee table, one small china cabinet, one 7-ft credenza, one sauna, twenty medium boxes and one recliner.',
        'The china cabinet has glass doors. Remove and secure shelves and wrap the cabinet carefully.',
        'The queen bed set is recorded as frame, headboard and mattress. A box spring is not included; confirm the actual pieces and dimensions against the inventory before loading.',
        'Lay the recliner flat for transport, as recorded in the scope.',
        'The sauna is estimated at about 420 lb. Confirm its actual dimensions, weight, disassembly requirements, safe handling method and any special equipment before agreeing to the job. State required crew, equipment or exclusions with your price; do not assume extra handling is approved.',
        'The customer is packing. Packing service is not included. The customer confirmed the basement, garage, outdoor/patio/shed and storage areas are empty; only the listed inventory is included.',
      ] },
      { title: 'Scope control and payment', details: [
        'Price the full recorded inventory, both second-floor elevator accesses and the one-way route. List any assumptions or exclusions with your bid.',
        'If the actual inventory, access, elevator availability or work differs, stop and contact John. Get written approval before additional work or any payout change. Customer questions and complaints come through Saturn.',
        'Payment is by direct deposit on or before seven days after job completion. Your team carries its own insurance and must add MARS RELOCATION SERVICES INC as additional insured. Crew, insurance and assignment checks must be completed before dispatch.',
      ] },
    ],
  }
}

for (const recipient of recipients) {
  const c = contacts.find(x => x.id === recipient.id)
  if (!c || c.status === 'blocked' || c.company_name !== recipient.name || /OWNER OUTREACH HOLD|IDENTITY REVIEW HOLD|DECLINED CONTRACTOR OUTREACH|AD-CHANNEL PREFERENCE|wrong number/i.test(c.notes || '')) throw Error('Contractor changed, held, or mismatched: ' + recipient.name)
  const phone = c.phone
  const sms = await read('sms_messages', { or: '(from_number.eq.' + phone + ',to_number.eq.' + phone + ')', order: 'created_at.asc', limit: '1000' })
  if (sms.length >= 1000 || sms.some(x => x.direction === 'inbound' && /^(stop|unsubscribe|cancel|end|quit)\b|not interested|go away|do not (text|contact)|wrong number/i.test((x.body || '').trim()))) throw Error('SMS suppression for ' + recipient.name)
  const peers = await read('market_contacts', { phone: 'ilike.*' + phone.slice(-4) + '*', select: 'phone,do_not_contact,cross_channel_suppressed_at,decision' })
  if (peers.some(p => String(p.phone || '').replace(/\D/g, '').slice(-10) === phone.replace(/\D/g, '').slice(-10) && (p.do_not_contact || p.cross_channel_suppressed_at || ['opted_out', 'rejected'].includes(p.decision)))) throw Error('Cross-channel suppression for ' + recipient.name)
  const latestForm = formRows.filter(x => x.subcontractor_id === recipient.id).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0]
  if (!latestForm || latestForm.checklist?.application || ['agreement', 'approved', 'active'].includes(latestForm.stage) || Date.parse(latestForm.expires_at) <= dateNow) throw Error('Form not pending/unsubmitted for ' + recipient.name)
  const formState = await api('/api/onboarding/' + latestForm.token)
  if (!formState.invite?.editable || formState.invite.submitted) throw Error('Form closed or submitted for ' + recipient.name)
  const formUrl = 'https://go.quote2move.com/onboard/' + latestForm.token
  const jobLinks = {}
  for (const job of jobs) {
    const created = await api('/api/sales/subcontractors/scope-reviews', { action: 'create', leadId: job.id, contractorId: recipient.id })
    if (!created.url || !created.reviewId) throw Error('No review link for ' + recipient.name + ' / ' + job.key)
    const [row] = await read('crm_leads', { id: 'eq.' + job.id, select: 'id,data,updated_at' })
    const reviews = row.data.contractorScopeReviews || []
    const review = reviews.find(x => x.id === created.reviewId && x.contractorId === recipient.id)
    if (!review || review.revoked) throw Error('Saved review mismatch for ' + recipient.name + ' / ' + job.key)
    let scope = job.key === 'moe-kitchener-london'
      ? { ...templateReview.scope, contactName: recipient.contact + (recipient.contact === recipient.name ? '' : ' — ' + recipient.name) }
      : jesseScope(created.scope, recipient)
    scope = { ...scope, date: '2026-10-30' }
    if (job.key === 'moe-kitchener-london') scope.routeEstimate = { miles: 71, kilometers: 114 }
    const updatedReviews = reviews.map(x => x.id === review.id ? { ...x, scope } : x)
    const saved = await write('crm_leads', { id: 'eq.' + job.id, updated_at: 'eq.' + row.updated_at }, 'PATCH', { data: { ...row.data, contractorScopeReviews: updatedReviews }, updated_at: new Date().toISOString() })
    if (!saved.length) throw Error('Scope changed during preparation; refresh required')
    const page = await fetch(created.url, { cache: 'no-store' })
    const html = await page.text()
    const expected = job.key === 'moe-kitchener-london' ? 'Complete recorded inventory' : 'sauna'
    if (!page.ok || !html.includes(expected) || !html.includes('Your price and availability')) throw Error('Scope page failed content verification for ' + recipient.name + ' / ' + job.key)
    jobLinks[job.key] = { url: created.url, reviewId: created.reviewId, expiresAt: created.expiresAt }
  }
  plans.push({ ...recipient, formUrl, jobs: jobLinks, phone, email: c.email || recipient.email, formInviteId: latestForm.id })
  fs.writeFileSync(dir + 'links.json', JSON.stringify({ preparedAt: new Date().toISOString(), plans }, null, 2))
  console.log(JSON.stringify({ company: recipient.name, formPending: true, jobLinks: Object.keys(jobLinks) }))
}

console.log(JSON.stringify({ prepared: plans.length, reviews: plans.length * jobs.length, artifact: dir + 'links.json' }))
