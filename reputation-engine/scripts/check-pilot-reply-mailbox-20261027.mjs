import './gta-email-recovery-runtime.mjs';
import fs from 'node:fs';
import {openZohoMailbox} from '../lib/partnership-core/zoho.mjs';
const result={at:new Date().toISOString(),mailboxes:[]};
for(const market of ['saturn','ottawa']){
 try{const m=await openZohoMailbox(market);result.mailboxes.push({market,mailbox:m.mailbox,accountAndReadAccess:true,roundTripVerified:false});}
 catch(e){result.mailboxes.push({market,accountAndReadAccess:false,error:e.message});}
}
fs.writeFileSync('artifacts/partnership-pilot-3000-20261027/reply-mailbox-check.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
