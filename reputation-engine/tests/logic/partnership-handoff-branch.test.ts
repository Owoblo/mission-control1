import test from 'node:test'
import assert from 'node:assert/strict'
import cities from '../../lib/data/gta-service-cities.json'
import {partnershipHandoffBranch} from '../../lib/partnership-handoff-branch'
test('all 29 GTA and Hamilton partner cities hand off to Toronto',()=>{
 for(const city of cities)assert.equal(partnershipHandoffBranch(city),'toronto',city)
})
test('existing other-market assignments remain intact',()=>{
 assert.equal(partnershipHandoffBranch('Windsor'),'windsor')
 assert.equal(partnershipHandoffBranch('Ottawa'),'ottawa')
 assert.equal(partnershipHandoffBranch('Kitchener'),'kitchener')
 assert.notEqual(partnershipHandoffBranch('Kingston'),'toronto')
})
