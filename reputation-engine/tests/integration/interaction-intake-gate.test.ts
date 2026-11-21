import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { countsAsCommercialLead } from '../../lib/interaction-classification'

function load(lead: unknown, failStorage = false) {
  const calls: string[] = []
  const modules: Record<string, unknown> = {
    '../interaction-classification': { countsAsCommercialLead },
    './interactions': { storeInteraction: async () => { calls.push('receipt'); if (failStorage) throw Error('Storage unavailable'); return 'interaction' } },
    '@/lib/server/runtime': { readEnv: () => undefined },
    '@/lib/server/sales-repository': {
      getSalesLeadByContact: async () => { calls.push('identity'); return lead },
      saveSalesLead: async () => { throw Error('Unexpected CRM creation') },
    },
  }
  const exports: any = {}
  runInNewContext(ts.transpileModule(readFileSync('lib/server/sales-automation.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, require: (name: string) => modules[name] || {}, console })
  return { calls, ingest: exports.processInboundAutomationEvent }
}

test('unknown sender and noncommercial identities remain interactions, with no CRM creation or automation', async () => {
  for (const lead of [null, { id: 'legacy' }, { id: 'employee', commercialDisposition: 'not_a_lead' }, { id: 'candidate', commercialDisposition: 'lead_candidate' }]) {
    const { calls, ingest } = load(lead)
    const result = await ingest({ source: 'twilio_sms', phone: '+15195550123', message: 'Need a moving quote' })
    assert.equal(result.lead, null)
    assert.equal(result.job, null)
    assert.equal(result.interactionId, 'interaction')
    assert.deepEqual(calls, ['receipt', 'identity'])
  }
})

test('failed raw persistence stops processing before identity resolution or promotion', async () => {
  const { calls, ingest } = load(null, true)
  await assert.rejects(ingest({ source: 'email_reply', email: 'person@example.test', message: 'Hello' }), /Storage unavailable/)
  assert.deepEqual(calls, ['receipt'])
})
