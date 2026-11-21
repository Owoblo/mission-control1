import test from 'node:test';import assert from 'node:assert/strict';
import {archivedThreadEvidence} from '../../lib/partnership-core/archive-thread-evidence.mjs';
const headers='From: John <john@example.com>\r\nTo: info@shop.example\r\nSubject: Working together\r\nMessage-ID: <recorded-api-id@observed-provider.example>';
const expected={providerMessageId:'recorded-api-id',recipient:'info@shop.example',sender:'john@example.com',subject:'Working together',archiveMessageId:'archive-message',configurationSet:'pilot',expectedConfigurationSet:'pilot'};
test('persists exact archived header domain rather than deriving a suffix',()=>{assert.equal(archivedThreadEvidence(headers,expected).internetMessageId,'<recorded-api-id@observed-provider.example>');});
test('rejects different receipt, recipient, configuration, or ambiguous IDs',()=>{
 assert.throws(()=>archivedThreadEvidence(headers,{...expected,providerMessageId:'other'}));
 assert.throws(()=>archivedThreadEvidence(headers,{...expected,recipient:'someone@else.example'}));
 assert.throws(()=>archivedThreadEvidence(headers,{...expected,configurationSet:'other'}));
 assert.throws(()=>archivedThreadEvidence(headers+'\r\nMessage-ID: <duplicate@provider.example>',expected));
});
