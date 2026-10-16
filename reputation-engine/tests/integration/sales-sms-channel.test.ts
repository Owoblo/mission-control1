import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { smsNotificationEmail } from '../../lib/server/internal-notifications'

function harness(leadId: string | null) {
  const saved: any[] = [], alerts: any[] = []
  let partnershipCalls = 0
  const modules: Record<string, unknown> = {
    '@/lib/server/dialer-settings': { getDialerSettings: async () => ({}), findBlockedCaller: () => false },
    '@/lib/server/contractor-inbound': { findInboundContractor: async () => null },
    '@/lib/server/interactions': { captureTwilioInteraction: async () => {} },
    '@/lib/server/partnership-routing-review': { isAutomatedLeasingNotice: () => false, needsPartnershipRoutingReview: () => false },
    '@/lib/server/sales-automation': { processInboundAutomationEvent: async () => ({ lead: { id: 'automation-id', name: 'Fiona' } }) },
    '@/lib/sales-phones': { DEFAULT_SATURN_BRANCH_NUMBER: '+12267732993', getSaturnTrackingLabel: () => 'GTA Sales', getSaturnTrackingSource: (n: string) => n === '+14377823004' ? 'google_online_search' : 'partnership_outreach' },
    '@/lib/server/partnership-message-context': { getSalesSmsReplyLeadId: async () => leadId },
    '@/lib/server/partnership-inbound': { archiveOwnerIgnoredPartnershipInbound: async () => false, pausePartnershipSequenceForInbound: async () => { partnershipCalls++; return { matched: true } } },
    '@/lib/server/sales-repository': { getInboundLeadByPhone: async () => ({ id: 'intake-existing' }), appendSmsToInboundLead: async () => {} },
    '@/lib/server/runtime': { requireSupabaseEnv: () => ({ url: 'https://db.test', headers: {} }), getAppBaseUrl: () => '', getWorkerSharedSecret: () => '' },
    '@/lib/server/twilio-recordings': {},
    '@/lib/server/analytics': { logEvent: async () => {} },
    '@/lib/server/internal-notifications': { smsNotificationEmail, sendRepAlertEmail: async (...args: any[]) => { alerts.push(args) } },
    '@/lib/server/lead-media': {}, '@/lib/server/security': {},
  }
  const exports: any = {}
  runInNewContext(ts.transpileModule(readFileSync('lib/server/inbound-sms.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, {
    exports, require: (id: string) => { assert.ok(id in modules, id); return modules[id] },
    Response, URLSearchParams, crypto, console,
    fetch: async (_url: string, init: any) => { if (init?.method === 'POST') saved.push(JSON.parse(init.body)); return Response.json([]) },
  })
  return { saved, alerts, partnershipCalls: () => partnershipCalls, run: (to: string) => exports.handleInboundSms(new URLSearchParams({ From: '+16477126210', To: to, Body: 'Thanks, it includes 1 driver +1 men?', MessageSid: 'telnyx:reply' })) }
}

test('Sales-number reply is saved to the exact existing lead and sends one Sales alert', async () => {
  const h = harness('fiona-existing')
  assert.equal((await h.run('+14377823004')).status, 200)
  assert.equal(h.partnershipCalls(), 0)
  assert.equal(h.saved[0].lead_id, 'fiona-existing')
  assert.equal(h.saved[0].to_number, '+14377823004')
  assert.equal(h.alerts.length, 1)
  assert.equal(h.alerts[0][0], 'Sales inbound SMS — Fiona')
  assert.match(h.alerts[0][1], /sales\/leads\/fiona-existing\?tab=sms/)
  assert.match(h.alerts[0][1], /Open Sales Conversation/)
  assert.doesNotMatch(h.alerts[0][1], /Open Partner Thread/)
})

test('a partner texting a Sales number without previous linked messages still enters Sales', async () => {
  const h = harness(null)
  assert.equal((await h.run('+14377823004')).status, 200)
  assert.equal(h.partnershipCalls(), 0)
  assert.equal(h.saved.length, 1)
  assert.equal(h.alerts.length, 1)
})

test('partnership-number reply retains the partnership handler', async () => {
  const h = harness(null)
  assert.equal((await h.run('+14374650584')).status, 200)
  assert.equal(h.partnershipCalls(), 1)
  assert.equal(h.saved.length, 0)
  assert.equal(h.alerts.length, 0)
})
