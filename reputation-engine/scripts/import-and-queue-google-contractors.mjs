import fs from 'node:fs'

const manifestPath = process.argv[2]
if (!manifestPath) throw new Error('Usage: node scripts/import-and-queue-google-contractors.mjs <clean-manifest> [--send]')
const send = process.argv.includes('--send')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const rows = manifest.rows || []
const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '')
const key = process.env.SUPABASE_KEY
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_KEY are required')
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
const now = new Date()
const normalizePhone = value => { const d = String(value || '').replace(/\D/g, ''); return d.length === 10 ? `+1${d}` : d.length === 11 && d.startsWith('1') ? `+${d}` : '' }
const existing = []
for (let i = 0; i < rows.length; i += 100) {
  const phones = rows.slice(i, i + 100).map(r => normalizePhone(r.phone)).filter(Boolean)
  if (!phones.length) continue
  const query = phones.map(p => `"${p}"`).join(',')
  const response = await fetch(`${url}/rest/v1/market_contacts?select=id,phone,name,company,stage,decision,do_not_contact&phone=in.(${query})`, { headers })
  if (!response.ok) throw new Error(`Existing contact read failed (${response.status})`)
  existing.push(...await response.json())
}
const byPhone = new Map(existing.map(row => [normalizePhone(row.phone), row]))
const eligible = rows.map(row => ({ ...row, phone: normalizePhone(row.phone) })).filter(row => row.phone && !byPhone.has(row.phone))
const skippedExisting = rows.length - eligible.length
const campaignKey = `google_general_contractors_windsor_essex_20260918`
const template = 'Hi there, John from Saturn Star Movers. We work with general contractors and renovation teams across Windsor and Essex County. If a project ever needs reliable moving, furniture handling, delivery coordination, storage moves, or a client relocation, we can provide insured crews and clear quotes. Would it be useful if I sent over a short digital card with our contact details so you have us as an option when a project comes up?'
let campaignId = null
if (send && eligible.length) {
  const existingCampaignResponse = await fetch(`${url}/rest/v1/market_campaigns?select=id&tracking_code=eq.${encodeURIComponent(campaignKey)}&limit=1`, { headers })
  if (!existingCampaignResponse.ok) throw new Error(`Campaign lookup failed (${existingCampaignResponse.status})`)
  const existingCampaigns = await existingCampaignResponse.json()
  const campaignResponse = existingCampaigns[0]?.id ? null : await fetch(`${url}/rest/v1/market_campaigns`, { method: 'POST', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify({
    name: 'Google Navigator general contractors Windsor Essex 2026-09-18', industry: 'general_contractors', city: 'Windsor / Essex', status: 'active', sequence_type: 'partnership_sms', tracking_code: campaignKey, sent_date: now.toISOString().slice(0, 10), cost_cents: 0,
    notes: JSON.stringify({ type: 'partnership_sms_campaign', source: 'Google Navigator', sourceFile: manifest.summary?.source_file, template, senderNumbers: process.env.PARTNERSHIP_PHONE ? [process.env.PARTNERSHIP_PHONE] : [], repName: 'John', dailyCap: 500, timezone: 'America/Toronto', startHour: 9, endHour: 20, dedupe: 'phone', canadianOnly: true, requiresWorkerSendGate: true }),
  }) })
  if (campaignResponse && !campaignResponse.ok) throw new Error(`Campaign creation failed (${campaignResponse.status})`)
  const campaigns = campaignResponse ? await campaignResponse.json() : []
  campaignId = existingCampaigns[0]?.id || campaigns[0]?.id
  if (!campaignId) throw new Error('Campaign reservation returned no ID')
  const contactRows = eligible.map(row => ({ name: row.listing_name, company: row.listing_name, title: row.category, phone: row.phone, city: row.search_location || 'Windsor', province: 'Ontario', website: row.website_candidates?.[0] || null, category: 'general_contractor', industry: 'general contractor', stage: 'target', pipeline_phase: 'outreach', sequence_step: 0, sequence_paused: false, batch_id: campaignId, created_at: now.toISOString(), notes: JSON.stringify({ source: 'Google Navigator', source_capture_id: row.source_capture_id, source_url: row.source_url, listed_context: row.listed_context, aliases: row.aliases, identity: 'business_listing' }) }))
  for (let i = 0; i < contactRows.length; i += 50) {
    const response = await fetch(`${url}/rest/v1/market_contacts`, { method: 'POST', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify(contactRows.slice(i, i + 50)) })
    if (!response.ok) throw new Error(`Contact import failed (${response.status})`)
  }
  const importedResponse = await fetch(`${url}/rest/v1/market_contacts?select=id,phone&batch_id=eq.${encodeURIComponent(campaignId)}&order=id.asc`, { headers })
  if (!importedResponse.ok) throw new Error(`Imported contact read failed (${importedResponse.status})`)
  const imported = await importedResponse.json()
  const jobs = imported.map((contact, index) => ({ contact_id: contact.id, batch_id: campaignId, channel: 'sms', scheduled_at: new Date(Date.now() + index * 15000).toISOString(), status: 'pending', template_key: 'partnership_sms' }))
  for (let i = 0; i < jobs.length; i += 50) {
    const response = await fetch(`${url}/rest/v1/sequence_jobs`, { method: 'POST', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify(jobs.slice(i, i + 50)) })
    if (!response.ok) throw new Error(`Sequence reservation failed (${response.status})`)
  }
}
console.log(JSON.stringify({ send, sourceRows: rows.length, eligible: eligible.length, skippedExisting, queued: send ? eligible.length : 0, campaignId, sample: eligible.slice(0, 5).map(row => ({ name: row.listing_name, phone: row.phone, city: row.search_location })) }, null, 2))
