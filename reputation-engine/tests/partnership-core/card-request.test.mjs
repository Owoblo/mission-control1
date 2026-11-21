import test from 'node:test';import assert from 'node:assert/strict';
import {requestsDigitalCard} from '../../lib/partnership-core/card-request.mjs';
const offer='Would a digital card be useful for your clients?';
test('explicit request or clear acceptance of a card offer qualifies',()=>{
 for(const text of ['Send me your business card','Inbound SMS: Yes','Hey yes please','Sure','✅'])assert.equal(requestsDigitalCard(text,offer),true,text);
});
test('generic assent, declined offer and mixed requests require review',()=>{
 for(const [text,prior] of [['Yes','Can we meet Friday?'],['No thanks',offer],['Email me the card',offer],['Send your card and prices',offer],['I will call you',offer],['👍','Here is the digital card. [MMS: url]']])assert.equal(requestsDigitalCard(text,prior),false,text);
});
