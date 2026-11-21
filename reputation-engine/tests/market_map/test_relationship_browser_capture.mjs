import test from 'node:test';
import assert from 'node:assert/strict';
import {allowedHosts,requestBlockReason} from '../../scripts/market_map/relationship_browser_capture.mjs';

test('host scope is exact unless apex/www equivalent explicitly supplied',()=>{
 assert.deepEqual(allowedHosts('https://example.ca/'),['example.ca']);
 assert.deepEqual(allowedHosts('https://www.example.ca/',['example.ca']),['www.example.ca','example.ca']);
 assert.throws(()=>allowedHosts('https://example.ca/',['cdn.example.ca']));
 assert.throws(()=>allowedHosts('http://example.ca/'));
 assert.throws(()=>allowedHosts('https://user:secret@example.ca/'));
});
test('browser rejects mutation, challenge and out-of-scope requests',()=>{
 const hosts=['example.ca'];
 assert.equal(requestBlockReason('https://example.ca/logo.png','GET',hosts),null);
 assert.equal(requestBlockReason('https://example.ca/send','POST',hosts),'non_read_method');
 assert.equal(requestBlockReason('https://example.ca/captcha','GET',hosts),'challenge_or_telemetry');
 assert.equal(requestBlockReason('https://other.ca/','GET',hosts),'outside_explicit_https_hosts');
 assert.equal(requestBlockReason('https://example.ca:444/','GET',hosts),'outside_explicit_https_hosts');
 assert.equal(requestBlockReason('http://example.ca/','GET',hosts),'outside_explicit_https_hosts');
});
