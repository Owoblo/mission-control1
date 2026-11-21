// One internal Dexa sender-identity probe, never campaign outreach.
import './gta-email-recovery-runtime.mjs';
import fs from 'node:fs';
import {openZohoMailbox} from '../lib/partnership-core/zoho.mjs';
const file='artifacts/partnership-pilot-3000-20261027/ottawa-internal-delivery-probe.json';
const subject='Dexa partnership infrastructure test 20261027';
let result;
if(fs.existsSync(file)){
 result=JSON.parse(fs.readFileSync(file,'utf8'));
 if(!result.messageId)throw Error('Prior attempt requires reconciliation. No resend.');
}else{
 const box=await openZohoMailbox('ottawa');
 result={at:new Date().toISOString(),type:'owned_mailbox_test',campaignRecipientsSent:0,recipient:'business@starmovers.ca',subject,state:'attempting'};
 fs.writeFileSync(file,JSON.stringify(result,null,2),{flag:'wx'});
 try{
  const receipt=await box.request(`/accounts/${box.accountId}/messages`,{
   fromAddress:'Courage Eke <hello@dexamovers.ca>',toAddress:'business@starmovers.ca',subject,
   content:'Hi John,\n\nThis is one internal Dexa sender-identity test. It checks whether Courage Eke appears as the sender. No campaign recipients are included.\n\nCourage\nDexa Movers',
   mailFormat:'plaintext',encoding:'UTF-8',askReceipt:'no',
  });
  result={...result,state:'provider_accepted',messageId:receipt.messageId||receipt.mailId||null};
  fs.writeFileSync(file,JSON.stringify(result,null,2));
 }catch(error){result={...result,state:'attempt_failed_requires_reconciliation',error:error.message};fs.writeFileSync(file,JSON.stringify(result,null,2));throw error;}
}
const inbox=await openZohoMailbox('saturn');
const messages=await inbox.request(`/accounts/${inbox.accountId}/messages/search?${new URLSearchParams({searchKey:'subject:'+subject,start:'1',limit:'20'})}`);
const match=Array.isArray(messages)?messages.find(m=>m.subject===subject):null;
if(match){result={...result,state:'observed_in_owned_mailbox',observedAt:new Date().toISOString(),zohoMessageId:match.messageId,fromAddress:match.fromAddress,sender:match.sender};fs.writeFileSync(file,JSON.stringify(result,null,2));}
console.log(JSON.stringify(result,null,2));
