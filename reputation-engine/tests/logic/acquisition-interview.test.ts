import assert from 'node:assert/strict'
import test from 'node:test'
import { validateAcquisitionInterview } from '../../lib/acquisition-interview'
const input = () => ({status:'answered',channel:'postcard',postcardRoute:'handed_by_connector',postcardLocation:'London office',postcardCode:'SS-123',connectorId:'contact_1',connectorRole:'passed_card',customerWords:'My agent gave it to me.'})
test('preserves the customer-reported card route and connector without inferring a campaign', () => {
  const result=validateAcquisitionInterview(input())
  assert.equal(result.postcardCode,'SS-123')
  assert.equal(result.connectorRole,'passed_card')
  assert.equal('campaignId' in result,false)
  assert.equal('recordedBy' in result,false)
})
test('does-not-recall and declined responses clear stale attributed details', () => {
  for(const status of ['does_not_recall','declined']) {
    const result=validateAcquisitionInterview({...input(),status})
    assert.equal(result.channel,'unknown');assert.equal(result.connectorId,'');assert.equal(result.postcardCode,'')
  }
})
test('rejects empty answered records, invalid enum, invalid connector IDs and oversized text', () => {
  for(const data of [null, {...input(),channel:'bogus'}, {...input(),connectorId:'bad),id.eq.other'}, {...input(),customerWords:'x'.repeat(2001)}, {...input(),channel:'unknown',postcardRoute:'unknown',connectorId:'',customerWords:''}]) assert.throws(()=>validateAcquisitionInterview(data))
})
