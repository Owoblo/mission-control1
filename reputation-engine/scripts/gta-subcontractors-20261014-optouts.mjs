import {fs} from './gta-email-recovery-runtime.mjs';
const {db}=await import('./reply-runtime-20261007.mjs');
const dir='artifacts/gta-subcontractor-recruiting-20261014/';
const review=JSON.parse(fs.readFileSync(dir+'verification.json'));
const receipts=[];
for(const row of review.rows){
 const stop=row.replies.find(r=>/^(stop|go away)$/i.test(r.body.trim()));
 if(!stop)continue;
 const [c]=await db('subcontractors',{id:'eq.'+row.contractor_id});
 const marker=`Recipient requested no further contact by SMS ("${stop.body.trim()}") on ${stop.at}; message ${stop.id}. No further recruiting contact.`;
 if(c.status!=='blocked'||!c.notes?.includes(stop.id))await db('subcontractors',{id:'eq.'+c.id},'PATCH',{status:'blocked',notes:(c.notes||'')+'\n'+marker,updated_at:new Date().toISOString()});
 const [verified]=await db('subcontractors',{id:'eq.'+c.id,select:'id,status'});
 if(verified.status!=='blocked')throw Error('Opt-out persistence failed');
 receipts.push({business:row.name,contractor_id:c.id,message_id:stop.id,status:verified.status});
}
fs.writeFileSync(dir+'optout-receipts.json',JSON.stringify({at:new Date().toISOString(),receipts},null,2));
console.log(JSON.stringify(receipts));
