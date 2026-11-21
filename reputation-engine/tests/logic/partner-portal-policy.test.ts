import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isPortalRole, portalMutation, portalView } from '../../lib/partner-portal-policy'

test('Portal never grants an unknown prefixed role access', () => { assert.equal(isPortalRole('partner_superuser'), false) })
test('Portal rejects identity, verification and financial field injection', () => {
  for (const [resource, input] of [ ['member',{ auth_user_id: 'other' }], ['member',{ approved_for_jobs: true }],
    ['vehicle',{ insurance_verified: true }], ['document',{ verified_by: 'owner' }], ['claim',{ resolution:'closed' }],
    ['assignment',{ subcontractor_id:'other' }], ['assignment',{ member_ids:['other'] }] ] as const) {
    assert.throws(() => portalMutation(resource, input, 'partner_admin', 'PATCH', { status: 'assigned' }))
  }
  assert.throws(() => portalMutation('member', { name:'Joe' }, 'partner_crew', 'POST'))
  assert.throws(() => portalMutation('assignment', { status:'confirmed' }, 'partner_admin', 'POST'))
})
test('Assignment transitions cannot jump to completed or reopen cancelled work', () => {
  assert.throws(() => portalMutation('assignment', { status:'completed' }, 'partner_crew', 'PATCH', { status:'assigned' }))
  assert.throws(() => portalMutation('assignment', { status:'confirmed' }, 'partner_admin', 'PATCH', { status:'cancelled' }))
  assert.deepEqual(portalMutation('assignment', { status:'arrived' }, 'partner_crew', 'PATCH', { status:'en_route' }), { status:'arrived' })
})
test('Portal keeps review decisions internal and permits normal submissions', () => {
  assert.throws(() => portalMutation('member', { status:'active' }, 'partner_admin', 'PATCH', {status:'restricted'}))
  assert.throws(() => portalMutation('claim', { description:'changed' }, 'partner_admin', 'PATCH', {status:'closed'}))
  assert.deepEqual(portalMutation('claim', {lead_id:'job',title:'Report'}, 'partner_crew', 'POST'), {lead_id:'job',title:'Report',status:'reported'})
})
test('Crew DTO excludes unrelated assignments, claims, finance and internal data', () => {
  const data = { partner:{id:'p',company_name:'Partner',internal_notes:'secret'}, members:[{id:'m',name:'Me',permissions:{admin:true}},{id:'other'}],
    assignments:[{id:'a',lead_id:'job1',member_ids:['m'],internal_notes:'secret'},{id:'b',lead_id:'job2',member_ids:['other']}],
    vehicles:[],availability:[],documents:[],compliance:[],claims:[{id:'c',lead_id:'job1',resolution:'private'},{id:'d',lead_id:'job2'}],
    ledger:[{amount:99}],balances:{total:99},performance:{score:90,tier:'good',metrics:{}},rates:[{secret:true}],audits:[{secret:true}] }
  assert.throws(() => portalView(data,'partner_crew'))
  const view = portalView(data,'partner_crew','m')
  assert.equal(view.assignments.length,1); assert.equal(view.claims.length,1); assert.equal(view.members.length,1)
  assert.equal(view.balances,undefined); assert.deepEqual(view.ledger,[])
  assert.equal(JSON.stringify(view).includes('secret'),false)
  assert.equal(JSON.stringify(view).includes('resolution'),false)
})
