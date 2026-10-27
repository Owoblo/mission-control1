import test from 'node:test';import assert from 'node:assert/strict';
import {ottawaActionAllowed,isOttawa} from '../../lib/partnership-core/ottawa.mjs';
test('existing Ottawa SMS conversations require the Dexa line',()=>{
 const a={city:'Orléans',kind:'reply',channel:'sms',sender:'+15482908695'};
 assert.equal(ottawaActionAllowed(a),true);
 assert.equal(ottawaActionAllowed({...a,sender:'+12267732993'}),false);
 assert.equal(ottawaActionAllowed({...a,kind:'cold_introduction'}),false);
});
test('Ottawa email cannot use John or Saturn senders',()=>{
 const a={city:'Ottawa',kind:'reply',channel:'email',sender:'Dr. Courage | Dexa Movers <hello@dexamovers.ca>'};
 assert.equal(ottawaActionAllowed(a),true);
 assert.equal(ottawaActionAllowed({...a,sender:'Courage Eke <hello@dexamovers.ca>'}),true);
 assert.equal(ottawaActionAllowed({...a,sender:'John <hello@dexamovers.ca>'}),false);
 assert.equal(ottawaActionAllowed({...a,sender:'john@saturnstarmovers.ca'}),false);
 assert.equal(isOttawa('Windsor'),false);
});
