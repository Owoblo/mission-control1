import test from 'node:test'
import assert from 'node:assert/strict'
import { findInboundContractor, contractorInboundEmail, notifyContractorInbound } from '../../lib/server/contractor-inbound'

process.env.SUPABASE_URL = 'https://db.test'
process.env.SUPABASE_KEY = 'test'
const contractor = { id: 'contractor-1', company_name: 'Mover <script>', phone: '+16475550123' }

test('contractor requires a unique record and latest outbound ownership on the same line', async () => {
  const original = globalThis.fetch
  try {
    for (const scenario of ['recruiting', 'duplicate', 'unknown', 'sales', 'realtor', 'no-outbound']) {
      let calls = 0
      globalThis.fetch = async input => {
        calls++
        const u = new URL(String(input))
        if (u.pathname.endsWith('/subcontractors')) return Response.json(scenario === 'duplicate' ? [contractor, contractor] : scenario === 'unknown' ? [] : [contractor])
        if (u.pathname.endsWith('/sms_messages')) {
          assert.equal(u.searchParams.get('from_number'), 'eq.+14374650584')
          assert.equal(u.searchParams.get('direction'), 'eq.outbound')
          assert.equal(u.searchParams.get('order'), 'created_at.desc')
          return Response.json(scenario === 'no-outbound' ? [] : [{ twilio_sid: 'telnyx:abc', lead_id: scenario === 'sales' ? 'lead1' : null }])
        }
        assert.ok(u.pathname.endsWith('/market_touches'))
        assert.match(u.searchParams.get('or')!, /metadata->>messageSid.eq.telnyx:abc/)
        return Response.json(scenario === 'realtor' ? [{ id: 'touch' }] : [])
      }
      assert.deepEqual(await findInboundContractor('+16475550123', '+14374650584'), scenario === 'recruiting' ? contractor : null, scenario)
      if (['duplicate', 'unknown'].includes(scenario)) assert.equal(calls, 1)
    }
    globalThis.fetch = async () => new Response('', { status: 503 })
    await assert.rejects(findInboundContractor('+16475550123', '+14374650584'), /ownership/)
  } finally { globalThis.fetch = original }
})

test('contractor notification shows full escaped text, phone, Eastern time and direct conversation link', () => {
  const email = contractorInboundEmail(contractor, { from: contractor.phone, to: '+14374650584', body: 'Available tomorrow\n<script>alert(1)</script>', at: '2026-10-14T20:00:00Z', sid: 'abc' })
  assert.equal(email.subject, 'Contractor inbound SMS — Mover <script>')
  assert.ok(email.html.includes('Available tomorrow\n&lt;script&gt;'))
  assert.ok(!email.html.includes('<script>'))
  assert.ok(email.html.includes('/sales/contractors/contractor-1?tab=messages'))
  assert.ok(email.html.includes('+16475550123'))
  assert.ok(email.html.includes('Received (Eastern)'))
  assert.ok(email.html.includes('business@starmovers.ca'))
})

test('replayed webhook creates one contractor task and one email, never a customer or realtor record', async () => {
  const original = globalThis.fetch
  let persisted = false, emails = 0
  globalThis.fetch = async (input, init) => {
    assert.match(String(input), /crm_tasks\?on_conflict=source_key/)
    const body = JSON.parse(String(init?.body))
    assert.equal(body.related_type, 'subcontractor')
    assert.equal(body.related_id, contractor.id)
    assert.equal(body.category, 'operations')
    assert.match(String((init?.headers as Record<string, string>).Prefer), /ignore-duplicates/)
    if (persisted) return Response.json([])
    persisted = true
    return Response.json([body])
  }
  const send = async (payload: any) => {
    emails++
    assert.equal(payload.to, 'business@starmovers.ca')
    assert.equal(payload.replyTo, 'business@starmovers.ca')
    assert.match(payload.subject, /^Contractor inbound SMS/)
    return { provider: 'ses' as const, messageId: 'email-1', accepted: true }
  }
  const input = { from: contractor.phone, to: '+14374650584', body: 'Yes', at: '2026-10-14T20:00:00Z', sid: 'telnyx:abc' }
  try {
    assert.equal(await notifyContractorInbound(contractor, input, send), true)
    assert.equal(await notifyContractorInbound(contractor, input, send), false)
    assert.equal(emails, 1)
  } finally { globalThis.fetch = original }
})
