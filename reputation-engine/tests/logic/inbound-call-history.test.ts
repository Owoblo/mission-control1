import assert from 'node:assert/strict'
import test from 'node:test'
import { attachInboundCallHistory, type InboundCallEvent } from '../../lib/inbound-call-history'
import type { CRMLead } from '../../lib/types'

const lead: CRMLead = { id: 'fixture', name: 'Caller', phone: '+19055550123', createdAt: '2026-10-24', stage: 'new', callLogs: [] }
const event = (call: string, source: string, at: string, extra: Record<string, unknown> = {}): InboundCallEvent => ({ event: {
  source, channel: source === 'twilio_voicemail' ? 'voicemail' : 'call', sender: lead.phone, recipient: '+15484883245', occurredAt: at,
  provenance: { CallSid: call, ...extra },
} })

test('two missed calls remain separate while voicemail and callback events merge into their own call', () => {
  const events = [event('CAfirst', 'twilio_call', '2026-10-24T16:12:48Z'),
    event('CAfirst', 'twilio_missed_call', '2026-10-24T16:13:22Z', { DialCallStatus: 'no-answer' }),
    event('CAfirst', 'twilio_voicemail', '2026-10-24T16:14:20Z', { RecordingSid: 'REfirst', RecordingDuration: '37' }),
    event('CAsecond', 'twilio_call', '2026-10-24T16:16:19Z'),
    event('CAsecond', 'twilio_missed_call', '2026-10-24T16:16:54Z', { DialCallStatus: 'no-answer' })]
  const hydrated = attachInboundCallHistory(lead, events)
  assert.equal(hydrated.callLogs?.length, 2)
  const first = hydrated.callLogs![0]
  assert.equal(first.date, '2026-10-24T16:12:48Z')
  assert.equal(first.recordingSid, 'REfirst')
  assert.equal(first.recordingDuration, 37)
  assert.equal(first.isVoicemail, true)
  assert.match(first.recordingUrl!, /leadId=fixture/)
  assert.match(hydrated.callLogs![1].notes!, /missed/)
  assert.deepEqual(attachInboundCallHistory(hydrated, events).callLogs, hydrated.callLogs)
})

test('event recovery preserves archived audio and transcripts and ignores unrelated channels', () => {
  const existing = { ...lead, callLogs: [{ id: 'saved', callSid: 'CAfirst', type: 'call', date: '2026-10-24T16:12:48Z', recordingSid: 'REfirst', recordingUrl: '/api/sales/dialer/recording?key=archive', transcript: 'Saved transcript', recordingStatus: 'transcribed' as const }] }
  const hydrated = attachInboundCallHistory(existing, [event('CAfirst', 'twilio_voicemail', '2026-10-24T16:14:20Z', { RecordingSid: 'REfirst' }), event('CAignored', 'twilio_sms', '2026-10-24T16:15:00Z')])
  assert.equal(hydrated.callLogs?.length, 1)
  assert.equal(hydrated.callLogs![0].recordingUrl, existing.callLogs[0].recordingUrl)
  assert.equal(hydrated.callLogs![0].transcript, 'Saved transcript')
  assert.equal(hydrated.callLogs![0].recordingStatus, 'transcribed')
})
