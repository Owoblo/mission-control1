import {fs,api} from './gta-email-recovery-runtime.mjs';
const {db}=await import('./reply-runtime-20261007.mjs');
const dir='artifacts/ottawa-open-houses-20261013/';
const snapshot=JSON.parse(fs.readFileSync(dir+'history.json'));
const copy={
 'Eva Chen':"Hi Eva, Dr. Courage from Dexa Movers here. I saw the open house at 785 Cairn Crescent on October 14, 5–7 pm. Will you or Haiyan be hosting? Would you be open to arranging a quick introduction? We can also help if your sellers have items that need moving before or after closing.",
 'Trudy Van Dyke':"Hi Trudy, Dr. Courage from Dexa Movers here. You mentioned you're rarely at the office. I saw an open house advertised for 1133 St Emmanuel Terrace on October 18. Will you be hosting, and would that be a convenient place to arrange a quick introduction?",
 'Roxanne Emery':"Hi Roxanne, Dr. Courage from Dexa Movers here. I saw the October 18 open house at 1007 Grapefern Terrace. Will you be hosting? Would you be open to arranging a brief introduction? If your sellers have anything that needs moving as they prepare for closing, we can help with that too.",
 'Christopher Blenkiron':"Hi Christopher, Dr. Courage from Dexa Movers here. I saw the October 18 open house at 54 Carwood Circle. Will you or Genevieve be hosting, and is 2–4 pm still the right time? Would you be open to arranging a quick introduction?",
 'Asim Hameed':"Hi Asim, Dr. Courage from Dexa Movers here. I saw an open house advertised for 235 Station Boulevard on October 18. Is that still going ahead, and will you be hosting? Would you be open to arranging a quick introduction? We can also help if your sellers have items that need moving."
};
const plans=Object.entries(copy).map(([name,body])=>{const c=snapshot.contacts.find(x=>x.name===name);return {name,id:c.id,phone:c.phone,city:c.city,latest:snapshot.touches.filter(t=>t.contact_id===c.id).at(-1)?.id,body,from:'+15482908695'};});
fs.writeFileSync(dir+'send-plan.json',JSON.stringify({authorization:'John: please dial it in, based on the playbook; Ottawa-specific followups, October 13 2026',plans},null,2));
if(!process.argv.includes('--send')){console.log(JSON.stringify(plans,null,2));process.exit(0)}
for(const p of plans){
 const path=dir+'send-'+p.id+'.json';
 if(fs.existsSync(path)){console.log(JSON.stringify({name:p.name,state:'existing_receipt_no_retry'}));continue;}
 const [c]=await db('market_contacts',{id:'eq.'+p.id});
 const thread=await db('market_touches',{contact_id:'eq.'+p.id,order:'created_at.asc,id.asc',limit:'1000'});
 if(thread.length===1000||thread.at(-1)?.id!==p.latest||c.name!==p.name||c.phone!==p.phone||c.city!==p.city||c.do_not_contact||c.cross_channel_suppressed_at||['dnc','closed_lost'].includes(c.stage)||['rejected','opted_out'].includes(c.decision))throw Error('Context changed or suppressed: '+p.name);
 const peers=await db('market_contacts',{phone:'ilike.*'+p.phone.slice(-4)+'*',select:'id,phone'});
 if(peers.some(x=>x.id!==p.id&&x.phone?.replace(/\D/g,'').slice(-10)===p.phone.slice(-10)))throw Error('Shared phone: '+p.name);
 fs.writeFileSync(path,JSON.stringify({state:'reserved_no_blind_retry',plan:p,at:new Date().toISOString()},null,2),{flag:'wx'});
 const result=await api('/api/marketing/contacts/'+p.id+'/send-reply',{body:p.body,from_number:p.from,media_urls:[]});
 fs.writeFileSync(path,JSON.stringify({state:'provider_returned',plan:p,result,at:new Date().toISOString()},null,2));
 if(!result.sid)throw Error('Missing provider ID: '+p.name);
 const logged=await db('market_touches',{contact_id:'eq.'+p.id,direction:'eq.outbound',order:'created_at.desc',limit:'5'});
 const match=logged.filter(t=>t.metadata?.twilioSid===result.sid||t.metadata?.messageSid===result.sid||t.metadata?.provider_message_id===result.sid);
 if(match.length!==1)throw Error('CRM receipt mismatch: '+p.name);
 await db('market_contacts',{id:'eq.'+p.id},'PATCH',{sequence_paused:true,sequence_paused_reason:'Owner-reviewed Ottawa open-house follow-up; await reply, no automatic nudge',next_follow_up:null});
 fs.writeFileSync(path,JSON.stringify({state:'accepted_crm_verified',plan:p,result,touchId:match[0].id,at:new Date().toISOString()},null,2));
 console.log(JSON.stringify({name:p.name,state:'accepted_crm_verified',sid:result.sid}));
}
