import fs from 'node:fs'

const manifestPath = process.argv[2]
if (!manifestPath) throw new Error('Usage: node scripts/import-and-queue-google-property-assets.mjs <send-candidates.json>')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const rows = (manifest.rows || []).filter((row) => row.route_status === 'canadian_local_or_adjacent')
const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '')
const key = process.env.SUPABASE_KEY
const sender = String(process.env.PARTNERSHIP_PHONE || '').trim()
if (!url || !key || !sender) throw new Error('SUPABASE_URL, SUPABASE_KEY and PARTNERSHIP_PHONE are required')
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
const normalizePhone = (value) => { const d = String(value || '').replace(/\D/g, ''); return d.length === 10 ? `+1${d}` : d.length === 11 && d.startsWith('1') ? `+${d}` : '' }
const now = new Date()
const existing = []
for (let i = 0; i < rows.length; i += 100) {
  const phones = rows.slice(i, i + 100).map((r) => normalizePhone(r.phone)).filter(Boolean)
  if (!phones.length) continue
  const query = phones.map((p) => `"${p}"`).join(',')
  const response = await fetch(`${url}/rest/v1/market_contacts?select=id,phone,name,company,stage,decision,do_not_contact,sequence_paused&phone=in.(${query})`, { headers })
  if (!response.ok) throw new Error(`Existing contact read failed (${response.status})`)
  existing.push(...await response.json())
}
const byPhone = new Map(existing.map((row) => [normalizePhone(row.phone), row]))
const eligible = rows.map((row) => ({ ...row, phone: normalizePhone(row.phone) })).filter((row) => row.phone && !byPhone.has(row.phone))
const campaignKey = 'google_property_assets_windsor_essex_20260919'
const template = 'Hi there, John from Saturn Star Movers. We work with property managers and apartment/building teams across Windsor and Essex County.\n\nWe help with tenant and resident moves, building relocations, unit turnovers, furniture handling, storage moves, and time-sensitive relocations.\n\nIf you ever need an insured moving team for a resident or building project, would it be useful if I sent over a short digital card with our contact details?'
let campaignId = null
if (eligible.length) {
  const existingCampaignResponse = await fetch(`${url}/rest/v1/market_campaigns?select=id&tracking_code=eq.${encodeURIComponent(campaignKey)}&limit=1`, { headers })
  if (!existingCampaignResponse.ok) throw new Error(`Campaign lookup failed (${existingCampaignResponse.status})`)
  const existingCampaigns = await existingCampaignResponse.json()
  if (existingCampaigns[0]?.id) campaignId = existingCampaigns[0].id
  else {
    const campaignResponse = await fetch(`${url}/rest/v1/market_campaigns`, { method: 'POST', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify({
      name: 'Google Navigator property managers and apartment buildings Windsor Essex 2026-09-19', industry: 'property_management_apartments', city: 'Windsor / Essex', status: 'active', tracking_code: campaignKey, sent_date: now.toISOString().slice(0, 10), cost_cents: 0,
      notes: JSON.stringify({ type: 'partnership_sms_campaign', source: 'Google Navigator', sourceFiles: manifest.summary?.source_files, template, senderNumbers: [sender], repName: 'John', dailyCap: 500, timezone: 'America/Toronto', startHour: 9, endHour: 20, canadianOnly: true, requiresWorkerSendGate: true }),
    }) })
    if (!campaignResponse.ok) throw new Error(`Campaign creation failed (${campaignResponse.status})`)
    const campaigns = await campaignResponse.json()
    campaignId = campaigns[0]?.id
  }
  if (!campaignId) throw new Error('Campaign reservation returned no ID')
  const contactRows = eligible.map((row) => ({ name: row.listing_name, company: row.listing_name, title: row.category, phone: row.phone, city: row.search_location || 'Windsor', province: 'Ontario', website: row.website_candidates?.[0] || null, category: row.role_segment, industry: row.role_segment === 'property_manager' ? 'property manager' : 'apartment building', stage: 'target', pipeline_phase: 'outreach', sequence_step: 0, sequence_paused: false, batch_id: campaignId, created_at: now.toISOString(), notes: JSON.stringify({ source: 'Google Navigator', source_capture_id: row.source_capture_id, source_url: row.source_url, listed_context: row.listed_context, aliases: row.aliases, identity: 'business_listing', draft_template: row.draft_template }) }))
  for (let i = 0; i < contactRows.length; i += 50) {
    const response = await fetch(`${url}/rest/v1/market_contacts`, { method: 'POST', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify(contactRows.slice(i, i + 50)) })
    if (!response.ok) throw new Error(`Contact import failed (${response.status})`)
  }
  const importedResponse = await fetch(`${url}/rest/v1/market_contacts?select=id,phone,category,industry&batch_id=eq.${encodeURIComponent(campaignId)}&order=id.asc`, { headers })
  if (!importedResponse.ok) throw new Error(`Imported contact read failed (${importedResponse.status})`)
  const imported = await importedResponse.json()
  const jobs = imported.map((contact, index) => ({ contact_id: contact.id, batch_id: campaignId, channel: 'sms', scheduled_at: new Date(Date.now() + index * 15000).toISOString(), status: 'pending', template_key: `partnership_sms|${sender}` }))
  for (let i = 0; i < jobs.length; i += 50) {
    const response = await fetch(`${url}/rest/v1/sequence_jobs`, { method: 'POST', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify(jobs.slice(i, i + 50)) })
    if (!response.ok) throw new Error(`Sequence reservation failed (${response.status})`)
  }
}
console.log(JSON.stringify({ sourceRows: manifest.rows?.length || 0, canadianRows: rows.length, eligible: eligible.length, skippedExisting: rows.length - eligible.length, queued: eligible.length, campaignId, template, note: 'Queued only. Production worker must return provider message SIDs before counting as sent.' }, null, 2))
