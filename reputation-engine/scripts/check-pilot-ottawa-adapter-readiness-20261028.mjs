import {fs} from './gta-email-recovery-runtime.mjs';
import {openZohoMailbox} from '../lib/partnership-core/zoho.mjs';
const report={at:new Date().toISOString(),market:'ottawa',expectedMailbox:'hello@dexamovers.ca',readOnly:true,emailsSent:0};
try{
 const box=await openZohoMailbox('ottawa');
 const folders=await box.request(`/accounts/${encodeURIComponent(box.accountId)}/folders`);
 report.mailbox=box.mailbox;report.mailboxReadReady=true;report.folderReadReady=Array.isArray(folders);report.folderCount=folders.length;
}catch(e){report.mailboxReadReady=false;report.error=e.message;}
fs.writeFileSync('artifacts/partnership-pilot-3000-20261027/ottawa-adapter-readiness.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
