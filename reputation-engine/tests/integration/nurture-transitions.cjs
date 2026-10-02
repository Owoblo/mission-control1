const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path'), ts = require('typescript')
const assert = require('node:assert/strict')
const root = process.cwd(), cache = new Map()
let lead = { id: 'fixture', name: 'Fixture', stage: 'contacted', createdAt: '2026-10-02T12:00:00Z', followUpDate: '2026-10-02', moveDateFlexible: true }, writes = 0
const noop = async () => {}, identity = x => x
const stubs = {
 '@/lib/server/task-repository': { listTasks: async () => [] },
 'next/server': { NextResponse: { json: (x, init) => new Response(JSON.stringify(x), init) } },
 '@/lib/server/session': { getSessionUser: async () => ({ role: 'owner', name: 'Fixture Owner', userId: 'owner1' }) },
 '@/lib/server/sales-repository': {
   getSalesLeadForUpdate: async () => ({ lead: structuredClone(lead), updatedAt: String(writes) }),
   getSalesLead: async () => structuredClone(lead),
   saveSalesLead: async (next, version) => { assert.equal(version, String(writes)); writes++; lead = JSON.parse(JSON.stringify(next)); return structuredClone(lead) },
   getSalesQuote: async () => null,
 },
 '@/lib/server/sales-permissions': { canAccessSalesWorkspace: () => true, canAccessOperationsWorkspace: () => false, canDeleteLead: () => true, canReassignLead: () => true, leadMatchesSessionBranch: () => true },
 '@/lib/server/analytics': { logEvent: noop, daysBetween: () => 1 },
 '@/lib/server/lead-intelligence-refresh': { queueLeadIntelligenceRefresh: noop },
 '@/lib/server/sales-automation': { scheduleMoveReminder: noop, scheduleConsultationReminder: noop, scheduleLostFeedback: noop },
 '@/lib/server/sales-audit': { recordLeadUpdateAudit: noop, getBookedJobFieldDiffs: () => [] },
 '@/lib/server/sales-opportunities': { applyDetectedBranch: identity, maybeCreateDestinationOpportunityLead: async (_, next) => next },
 '@/lib/server/partner-referral-link': { syncLeadPartnerReferral: noop },
 '@/lib/server/sales-messaging': { sendSalesMessage: () => { throw Error('Customer messaging prohibited in test') } },
}
function load(file) {
 if (cache.has(file)) return cache.get(file)
 const exports = {}; cache.set(file, exports)
 const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
 vm.runInNewContext(code, { exports, require: n => {
  if (stubs[n]) return stubs[n]
  if (n.startsWith('@/') || n.startsWith('.')) {
   let p = n.startsWith('@/') ? path.join(root, n.slice(2)) : path.resolve(path.dirname(file), n)
   if (p.endsWith('.json')) return require(p)
   return load(p.endsWith('.ts') ? p : p + '.ts')
  }
  return require(n)
 }, structuredClone, Error, TypeError, Request, Response, URL, crypto: require('node:crypto').webcrypto, console, process, Buffer, setTimeout, clearTimeout })
 return exports
}
(async () => {
 const route = load(path.join(root, 'app/api/sales/leads/[id]/route.ts'))
 async function patch(body) { return route.PATCH(new Request('https://fixture.invalid/api', { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ id: 'fixture' }) }) }
 async function saved(body, stage) { const response = await patch(body); const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); assert.equal(data.stage, stage); const reload = await route.GET(new Request('https://fixture.invalid/api'), { params: Promise.resolve({ id: 'fixture' }) }); assert.equal((await reload.json()).stage, stage); return data }
 const lost = { stage: 'lost', lostReason: 'competitor', lostNotes: 'Customer confirmed by SMS that they booked another mover.' }
 await saved(lost, 'lost'); assert.equal(lead.followUpDate, undefined)
 await saved({ stage: 'contacted' }, 'contacted')
 assert.equal((await patch({ stage: 'nurture' })).status, 400)
 await saved({ stage: 'nurture', moveDate: '2027-08-01', nurtureIntervalDays: 30, nurtureReturnWindowDays: 45 }, 'nurture')
 assert.equal(lead.nurtureIntervalDays, 30); assert.equal(lead.moveDateFlexible, false)
 await saved({ nurtureCheckInNote: 'Still planning the move after the house sale.' }, 'nurture')
 assert.equal(lead.nurtureCheckIns.length, 1); assert.equal(lead.nurtureCheckIns[0].actorUserId, 'owner1')
 await saved({ stage: 'contacted', followUpDate: '2026-10-02' }, 'contacted'); assert.equal(lead.nurtureNextCheckInAt, undefined)
 await saved({ stage: 'nurture', moveDate: '2027-08-01' }, 'nurture')
 await saved(lost, 'lost'); assert.equal(lead.followUpDate, undefined)
 console.log(JSON.stringify({ transitions: 4, reloadVerified: true, database: 'serialized in-memory fixture', checkInPersisted: true, customerMessages: 0 }))
})().catch(e => { console.error(e); process.exitCode = 1 })
