import test from 'node:test';import assert from 'node:assert/strict';
import {mailboxAdmissionQuality as assess,classifyBounce} from '../../lib/partnership-core/mailbox-admission-quality.mjs';
const sample=(mailbox,role='HIGH')=>({IsValid:{ConfidenceVerdict:'MEDIUM'},Evaluations:{HasValidSyntax:{ConfidenceVerdict:'HIGH'},HasValidDnsRecords:{ConfidenceVerdict:'HIGH'},MailboxExists:{ConfidenceVerdict:mailbox},IsRoleAddress:{ConfidenceVerdict:role}}});
test('a role inbox with high mailbox confidence remains eligible',()=>assert.equal(assess(sample('HIGH')).automatic,true));
test('published role inbox with uncertain existence requires another check',()=>assert.equal(assess(sample('MEDIUM')).automatic,false));
test('missing validation cannot pass',()=>assert.equal(assess(null).automatic,false));
test('transient label does not conceal spam or relay rejection',()=>{assert.equal(classifyBounce({bounceType:'Transient',diagnostics:[{diagnostic:'554 Relay access denied'}]}),'relay_access_denied');assert.equal(classifyBounce({bounceType:'Transient',diagnostics:[{diagnostic:'rejected due to spam classification'}]}),'spam_policy_rejection');});

test('AWS high overall validity can advance with medium mailbox confidence without claiming confirmed existence',()=>{const v=sample('MEDIUM','LOW');v.IsValid.ConfidenceVerdict='HIGH';assert.equal(assess(v).automatic,true);assert.match(assess(v).reason,/not_confirmed/);});
