import {fs,db} from './gta-email-recovery-runtime.mjs';
import {SESv2Client,ListSuppressedDestinationsCommand} from '@aws-sdk/client-sesv2';
const dir='artifacts/partnership-pilot-3000-20261027';const candidates=JSON.parse(fs.readFileSync(dir+'/candidates.json'));
const contacts=[];let complete=false;
for(let offset=0;offset<100000;offset+=1000){
 const rows=await db('market_contacts',{select:'id,email,company,website,phone,partner_company_id,city,do_not_contact,cross_channel_suppressed_at,email_unsubscribed_at,email_status,last_touch_at,last_inbound_at',order:'id',offset:String(offset),limit:'1000'});contacts.push(...rows);if(rows.length<1000){complete=true;break;}
}
const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const domain=s=>{try{return new URL(String(s).includes('://')?s:'https://'+s).hostname.toLowerCase().replace(/^www\./,'')}catch{return ''}};
const maps={email:new Map(),website:new Map(),phone:new Map(),company:new Map()};
function add(map,k,v){if(k){if(!map.has(k))map.set(k,[]);map.get(k).push(v)}}
for(const c of contacts){add(maps.email,String(c.email||'').toLowerCase(),c);add(maps.website,domain(c.website),c);add(maps.phone,String(c.phone||'').replace(/\D/g,'').slice(-10),c);if(norm(c.company).length>4)add(maps.company,norm(c.company),c)}
process.loadEnvFile('.env.ses.local');const ses=new SESv2Client({region:process.env.AWS_REGION||'us-east-2',maxAttempts:1});let token,suppressionComplete=false;const suppressed=new Map();
for(let page=0;page<100;page++){const r=await ses.send(new ListSuppressedDestinationsCommand({PageSize:1000,...(token?{NextToken:token}:{})}));for(const x of r.SuppressedDestinationSummaries||[])suppressed.set(x.EmailAddress.toLowerCase(),x.Reason);token=r.NextToken;if(!token){suppressionComplete=true;break;}}
const findings=candidates.map(r=>{const matched=new Map();const record=(reason,list)=>{for(const c of list||[]){const old=matched.get(c.id)||{contact:c,match_reasons:[]};old.match_reasons.push(reason);matched.set(c.id,old)}};
 record('email',maps.email.get(r.email.toLowerCase()));record('website',maps.website.get(domain(r.website)));record('company_name_candidate',maps.company.get(norm(r.organisation_name)));
 for(const p of JSON.parse(r.phone_candidates||'[]'))record('phone_candidate',maps.phone.get(String(p).replace(/\D/g,'').slice(-10)));
 return {organisation_id:r.organisation_id,email:r.email,matched_contacts:[...matched.values()],ses_suppression_reason:suppressed.get(r.email.toLowerCase())||null,review_status:matched.size?'existing_account_context_review':'no_matches_in_checked_fields',limitations:'Company and phone matches are candidates. Complete account touch/task/mailbox review still required.'};});
fs.writeFileSync(dir+'/account-context-review.json',JSON.stringify({at:new Date().toISOString(),crm_complete:complete,ses_suppression_complete:suppressionComplete,findings},null,2));
console.log(JSON.stringify({checked:findings.length,crmComplete:complete,suppressionComplete,existingContextCandidates:findings.filter(x=>x.matched_contacts.length).length,sesSuppressed:findings.filter(x=>x.ses_suppression_reason).length,sent:0}));
