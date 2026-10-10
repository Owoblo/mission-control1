import test from 'node:test'
import assert from 'node:assert/strict'
import { listingAddressKey } from '../../lib/listing-match'
import { matchRealtorPartners, parseRealtorCandidates } from '../../lib/realtor-research'
const candidate={name:'Nicole Miller',phone:'+12269276886',role:'listing_agent' as const,evidence:'owner',sources:[]}
test('address identity does not duplicate mirrored origin fields and handles aliases',()=>{
  assert.equal(listingAddressKey('22 Ridge Street','Strathroy'),listingAddressKey('22 Ridge St','Strathroy-Caradoc'))
})
test('known individual matches phone and name without requiring corporate email',()=>{
  assert.equal(matchRealtorPartners(candidate,[{id:'nicole',name:'Nicole Miller',phone:'2269276886'}])?.id,'nicole')
  assert.equal(matchRealtorPartners({...candidate,phone:undefined,email:'nicole@gmail.com'},[{id:'nicole',name:'Nicole Miller',email:'nicole@gmail.com'}])?.id,'nicole')
})
test('shared office and name-only matches do not select a relationship',()=>{
  assert.equal(matchRealtorPartners(candidate,[{id:'a',name:'Nicole Miller',phone:candidate.phone},{id:'b',name:'Other Agent',phone:candidate.phone}]),null)
  assert.equal(matchRealtorPartners({...candidate,phone:undefined},[{id:'a',name:'Nicole Miller'}]),null)
})
test('invented sources and invalid contact kinds cannot be promoted to listing evidence',()=>{
  const [c]=parseRealtorCandidates([{name:'Office',role:'listing_agent|sales_representative',sourceUrls:['https://fake.example']}],[{url:'https://real.example',title:'real'}])
  assert.equal(c.role,'unknown');assert.deepEqual(c.sources,[])
})
