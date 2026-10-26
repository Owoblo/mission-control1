import assert from 'node:assert/strict'
import test from 'node:test'
import { decorateInboundLead, getInboundStatus, needsHumanInboundAttention } from '../../lib/inbound-inbox'
import type { InboundLead } from '../../lib/types'
const item=(raw:Record<string,unknown>):InboundLead=>({id:'inbound',source:'website_form',created_at:'2026-10-26T10:21:37Z',claimed:true,raw_data:raw})
test('automation linking and replying never fulfill the requirement for human attention',()=>{
 const lead=item({linkedLeadId:'lead',automationClaimedAt:'2026-10-26T10:21:46Z',requiresHumanAttention:true,inboxState:{webforms:{lastReadAt:'2026-10-26T10:21:46Z',lastActionAt:'2026-10-26T10:21:46Z'}}})
 assert.equal(getInboundStatus(lead),'needs_action');assert.equal(decorateInboundLead(lead).inboxStatus,'needs_action')
})
test('a read receipt does not claim ownership; an authenticated human action does',()=>{
 const raw={requiresHumanAttention:true,linkedLeadId:'lead',inboxState:{webforms:{lastReadAt:'2026-10-26T12:00Z',lastReadByUserId:'rep'}}}
 assert.equal(needsHumanInboundAttention(raw),true)
 assert.equal(getInboundStatus(item({...raw,humanClaimedAt:'2026-10-26T12:00Z',humanClaimedByUserId:'rep'}))==='needs_action',false)
 assert.equal(needsHumanInboundAttention({...raw,inboxState:{webforms:{lastActionAt:'2026-10-26T12:00Z',lastActionByUserId:'rep'}}}),false)
})
test('closed dispositions and legacy handoffs retain their existing treatment',()=>{
 assert.equal(getInboundStatus(item({requiresHumanAttention:true,inboxDisposition:'junk'})),'closed')
 assert.notEqual(getInboundStatus(item({linkedLeadId:'lead',automationClaimedAt:new Date().toISOString()})),'needs_action')
})
