import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeAuthenticatedSesReply, verifyReplySns } from '../../lib/server/email-sms-ses-ingress'
const destination='sms+'+'ab'.repeat(20)+'@reply.example.com'
const fixture=()=>({notificationType:'Received',mail:{messageId:'provider-id'},receipt:{recipients:[destination],action:{type:'SNS',encoding:'UTF-8'},dkimVerdict:{status:'PASS'},dmarcVerdict:{status:'PASS'},spamVerdict:{status:'PASS'},virusVerdict:{status:'PASS'}},content:'From: John <john@example.com>\r\nTo: '+destination+'\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nYes, that works.'})
test('receiving adapter uses SES authentication verdicts and decoded MIME, not forged headers',async()=>{
 const result=await decodeAuthenticatedSesReply(fixture(),'reply.example.com');assert.equal(result.from,'john@example.com');assert.equal(result.text.trim(),'Yes, that works.');assert.equal(result.messageId,'ses:provider-id')
 const forged=fixture();forged.receipt.dmarcVerdict.status='FAIL';forged.content='Authentication-Results: dmarc=pass\r\n'+forged.content;await assert.rejects(()=>decodeAuthenticatedSesReply(forged,'reply.example.com'))
 const duplicate=fixture();duplicate.content='From: attacker@example.com\r\n'+duplicate.content;await assert.rejects(()=>decodeAuthenticatedSesReply(duplicate,'reply.example.com'))
 const encoded=fixture();encoded.receipt.action.encoding='Base64';encoded.content=Buffer.from(encoded.content).toString('base64');assert.equal((await decodeAuthenticatedSesReply(encoded,'reply.example.com')).text.trim(),'Yes, that works.')
})
test('SNS verifier rejects wrong topics and certificate SSRF without fetching',async()=>{
 const old=global.fetch;global.fetch=async()=>{throw Error('must not fetch')}
 try{assert.equal(await verifyReplySns({TopicArn:'wrong'},'expected'),false);assert.equal(await verifyReplySns({TopicArn:'arn:aws:sns:us-east-1:123456789012:reply',Type:'Notification',SignatureVersion:'2',Timestamp:new Date().toISOString(),SigningCertURL:'https://attacker.test/cert.pem'},'arn:aws:sns:us-east-1:123456789012:reply'),false)}finally{global.fetch=old}
})

test('SES documented UTF-8 event omits encoding; unsupported encodings remain rejected',async()=>{
 const event=fixture();delete (event.receipt.action as {encoding?:string}).encoding
 assert.equal((await decodeAuthenticatedSesReply(event,'reply.example.com')).text.trim(),'Yes, that works.')
 event.receipt.action.encoding='UTF8';assert.equal((await decodeAuthenticatedSesReply(event,'reply.example.com')).text.trim(),'Yes, that works.')
 event.receipt.action.encoding='ROT13';await assert.rejects(()=>decodeAuthenticatedSesReply(event,'reply.example.com'),/encoding/)
 event.receipt.action.encoding='UTF-8';event.receipt.action.type='S3';await assert.rejects(()=>decodeAuthenticatedSesReply(event,'reply.example.com'),/SNS/)
})
