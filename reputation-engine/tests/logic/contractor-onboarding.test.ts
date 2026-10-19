import test from 'node:test'
import assert from 'node:assert/strict'
import { applicationErrors, detectDocumentType, EMPTY_APPLICATION, inviteIsOpen, parseApplication } from '../../lib/contractor-onboarding'

const complete = { ...EMPTY_APPLICATION, legalBusinessName: 'Example Movers', contactName: 'Alex', contactRole: 'Owner', phone: '4165550100', email: 'alex@example.com', homeMarket: 'Toronto', serviceAreas: 'GTA', phoneAnsweredBy: 'Sales representative', dispatchName: 'Sam', dispatchRole: 'Dispatcher / operations', dispatchPhone: '4165550101', preferredContact: 'Phone call', serviceModel: 'Truck and moving crew', crewSize: '2–4', pricingModel: 'Hourly', additionalInsured: 'Need Saturn’s legal details first', branding: 'Yes, happy to discuss the details', truckAccess: ['Own', 'Rent'], truckSizes: '26 ft', specialties: ['Residential moves'], confirmed: true }

test('supports distinct sales and dispatch contacts and mixed truck access', () => {
  const parsed = parseApplication(complete)
  assert.deepEqual(applicationErrors(parsed), [])
  assert.notEqual(parsed.phone, parsed.dispatchPhone)
  assert.deepEqual(parsed.truckAccess, ['Own', 'Rent'])
})
test('untrusted application cannot inject approval fields or arbitrary capabilities', () => {
  const parsed = parseApplication({ ...complete, status: 'active', insured: true, specialties: ['Residential moves', 'invented'], truckAccess: ['Own', 'Own', 'invented'] })
  assert.equal('insured' in parsed, false)
  assert.equal('status' in parsed, false)
  assert.deepEqual(parsed.specialties, ['Residential moves'])
  assert.deepEqual(parsed.truckAccess, ['Own'])
})
test('specialty work requires evidence of experience and limits', () => {
  assert.ok(applicationErrors(parseApplication({ ...complete, specialties: ['Hot tubs'] })).some(e => e.includes('specialty')))
  assert.deepEqual(applicationErrors(parseApplication({ ...complete, specialties: ['Hot tubs'], specialtyDetails: 'Ground-level moves only; spa dollies, 4-person crew; no craning.' })), [])
})
test('incomplete drafts can be stored but cannot be submitted', () => {
  const parsed = parseApplication({ legalBusinessName: 'Test', confirmed: 'true' })
  assert.equal(parsed.confirmed, false)
  assert.ok(applicationErrors(parsed).length > 5)
})
test('expired, invalid expiry and later-stage invites cannot mutate applications', () => {
  const now = Date.parse('2026-10-19T12:00:00Z')
  for (const stage of ['active', 'agreement', 'declined', 'trial']) assert.equal(inviteIsOpen({ stage }, now), false)
  assert.equal(inviteIsOpen({ stage: 'application', expires_at: '2026-10-19T12:00:00Z' }, now), false)
  assert.equal(inviteIsOpen({ stage: 'application', expires_at: 'invalid' }, now), false)
  assert.equal(inviteIsOpen({ stage: 'verification', expires_at: '2026-10-20T12:00:00Z' }, now), true)
})
test('document content is checked rather than trusting an extension or MIME label', () => {
  assert.equal(detectDocumentType(new TextEncoder().encode('<html>not a PDF</html>')), null)
  assert.equal(detectDocumentType(new TextEncoder().encode('%PDF-1.7'))?.type, 'application/pdf')
  assert.equal(detectDocumentType(new Uint8Array([137,80,78,71,13,10,26,10]))?.type, 'image/png')
  assert.equal(detectDocumentType(new Uint8Array([255,216,255,224]))?.type, 'image/jpeg')
})
