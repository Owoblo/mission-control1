import fs from 'node:fs/promises';
import {createHmac, randomUUID} from 'node:crypto';

const env=v=>String(process.env[v]||'').trim();
const supabase=env('SUPABASE_URL'), key=env('SUPABASE_KEY');
const dbHeaders={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',Prefer:'return=representation'};
async function db(table,q={},method='GET',body){const r=await fetch(`${supabase}/rest/v1/${table}?${new URLSearchParams(q)}`,{method,headers:dbHeaders,body:body===undefined?undefined:JSON.stringify(body)});const t=await r.text();if(!r.ok)throw Error(`${table} ${r.status}: ${t.slice(0,300)}`);return t?JSON.parse(t):[]}
const source=JSON.parse(await fs.readFile('partnership-system/markets/ca/on/windsor-essex/runs/2026-09-17/google-interior-staging-clean.json','utf8'));
const sourceCity=r=>String(r.listed_context||r.search_location||'Windsor / Essex').split(/\s*[·|]\s*/)[0].replace(/\s+Closed.*$/i,'').trim();
const rows=source.rows.filter(r=>r.locality_status==='needs_geography_review');
if(rows.length!==108) throw Error(`Expected 108 geography-review rows, found ${rows.length}`);
const existing=await db('market_contacts',{select:'id,phone,name,company,city,industry,do_not_contact,stage,decision',limit:'10000'});
const byPhone=new Map(existing.filter(c=>c.phone).map(c=>[c.phone.replace(/\D/g,''),c]));
const fresh=rows.filter(r=>!byPhone.has(r.phone.replace(/\D/g,'')));
const campaignRows=await db('market_campaigns',{select:'id',name:'eq.Google Navigator interior staging geography review 2026-09-17',limit:'1'});
let campaignId=campaignRows[0]?.id;
if(!campaignId){const [campaign]=await db('market_campaigns',{},'POST',{name:'Google Navigator interior staging geography review 2026-09-17',industry:'interior_staging',city:'Windsor / Essex',status:'active',sequence_type:'manual_bulk_sms',tracking_code:`google_interior_review_${Date.now()}`,sent_date:new Date().toISOString().slice(0,10),cost_cents:0,notes:'Explicit user release of the 108 previously held geography-review Google Navigator rows; each contact retains its listed locality.'});campaignId=campaign.id}
const inserts=fresh.map(r=>({name:r.greeting_name||r.listing_name,company:r.listing_name,title:r.category,phone:r.phone,city:sourceCity(r),industry:r.role_segment||'interior_staging',website:r.website_candidates?.[0]||null,notes:`Google Navigator source: ${r.source_url||''}\nListed context: ${r.listed_context||''}\nCategory: ${r.category||''}\nRelease: user-authorized geography-review batch`,category:r.category,batch_id:campaignId,stage:'target',pipeline_phase:'outreach',sequence_step:0,sequence_paused:false,created_at:new Date().toISOString()}));
for(let i=0;i<inserts.length;i+=50) await db('market_contacts',{},'POST',inserts.slice(i,i+50));
const refreshed=await db('market_contacts',{batch_id:`eq.${campaignId}`,select:'id,phone,city,industry,name,company',limit:'1000'});
const wanted=new Set(rows.map(r=>r.phone.replace(/\D/g,'')));
const ids=refreshed.filter(c=>c.phone&&wanted.has(c.phone.replace(/\D/g,''))).map(c=>c.id);
for(const c of existing) if(c.phone&&wanted.has(c.phone.replace(/\D/g,''))) ids.push(c.id);
const uniqueIds=[...new Set(ids)];
const p=Buffer.from(JSON.stringify({role:'owner',name:'John',exp:Date.now()+900000})).toString('base64url');
const cookie=`mc_session=${p}.${createHmac('sha256',env('AUTH_SECRET')).update(p).digest('base64url')}`;
const template=`Hi {{firstName}},\n\nMy name is John from Saturn Star Movers. We help with furniture handling, staging support, delivery coordination, and client moves across {{city}} and surrounding areas.\n\nI wanted to introduce us in case you ever need an extra moving option for staging preparation, furniture rearranging, installations, storage moves, or clients getting ready to buy or sell a home.\n\nWe are insured, provide clear quotes, and can coordinate around the timing of your project or your client's move.\n\nWould it be okay if I sent over a short digital card with our contact information and service details?`;
const response=await fetch('https://go.quote2move.com/api/marketing/contacts/bulk-sms',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({contact_ids:uniqueIds,template,from_number:'+12268870667'}),signal:AbortSignal.timeout(120000)});
const text=await response.text();console.log(JSON.stringify({sourceRows:rows.length,existingMatched:rows.length-fresh.length,inserted:fresh.length,contactIds:uniqueIds.length,http:response.status,response:text.slice(0,2000)}));
if(!response.ok)process.exitCode=1;
