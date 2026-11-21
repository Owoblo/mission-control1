import {createHash} from 'node:crypto';
export function archivedThreadEvidence(headers,{providerMessageId,recipient,sender,subject,archiveMessageId,configurationSet,expectedConfigurationSet}){
 if(configurationSet!==expectedConfigurationSet)throw Error('Archive configuration set mismatch');
 const lines=headers.replace(/\r?\n[ \t]+/g,' ').split(/\r?\n/);
 const values=name=>lines.filter(l=>l.slice(0,l.indexOf(':')).toLowerCase()===name).map(l=>l.slice(l.indexOf(':')+1).trim());
 const ids=values('message-id');
 if(ids.length!==1||!/^<[^<>\s@]+@[^<>\s@]+>$/.test(ids[0]))throw Error('Missing or ambiguous archived MIME Message-ID');
 // Compare the observed header local-part to the recorded API receipt. Never manufacture a suffix.
 if(ids[0].slice(1,ids[0].indexOf('@'))!==providerMessageId)throw Error('Archive provider receipt binding mismatch');
 const addresses=name=>values(name).flatMap(v=>v.match(/[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)||[]).map(v=>v.toLowerCase());
 if(!addresses('to').includes(recipient.toLowerCase())||!addresses('from').includes(sender.toLowerCase()))throw Error('Archive address binding mismatch');
 if(values('subject').length!==1||values('subject')[0]!==subject)throw Error('Archive subject requires MIME decoding or review');
 return {source:'ses_outbound_archive',archiveMessageId,providerMessageId,internetMessageId:ids[0],recipient,sender,configurationSet,headerSha256:createHash('sha256').update(headers).digest('hex'),observedAt:new Date().toISOString(),scope:'exact_received_format_header_no_guessed_suffix'};
}
