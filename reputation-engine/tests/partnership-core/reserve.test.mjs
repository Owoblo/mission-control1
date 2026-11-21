import test from 'node:test';import assert from 'node:assert/strict';
import {reserveAction} from '../../lib/partnership-core/reserve.mjs';
async function simulate(contact,decision,run){
 const original=globalThis.fetch;const calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(calls.length===1?[contact]:decision),{status:200})};
 try{await run(calls)}finally{globalThis.fetch=original}
}
const action={url:'https://fixture.invalid',headers:{},contactId:'c',channel:'direct_mail',key:'fixture-mail',content:'Reviewed letter',sender:'manual-mail'};
test('direct mail uses canonical account reservation and fresh market facts',async()=>simulate({city:'Sarnia',address:'Fixture address'},{allowed:true},async calls=>{await reserveAction(action);const body=JSON.parse(calls[1].options.body);assert.equal(body.p_evidence.marketActive,true);assert.equal(body.p_evidence.channelEligible,true);assert.equal(body.p_contact_id,'c')}));
test('Ottawa hold and missing address remain explicit',async()=>simulate({city:'Ottawa'},{allowed:false,reasons:['market_not_active']},async calls=>{await assert.rejects(reserveAction(action),/market_not_active/);const body=JSON.parse(calls[1].options.body);assert.equal(body.p_evidence.marketActive,false);assert.equal(body.p_evidence.channelEligible,false)}));
test('unknown geography cannot inherit service availability',async()=>simulate({city:'Unknown',address:'Fixture'},{allowed:false,reasons:['service_not_confirmed']},async calls=>{await assert.rejects(reserveAction(action));assert.equal(JSON.parse(calls[1].options.body).p_evidence.serviceAvailable,false)}));
