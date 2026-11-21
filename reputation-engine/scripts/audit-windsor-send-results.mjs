// Read-only reconciliation of the exact campaign receipts and provider diagnostics.
import fs from 'node:fs/promises';
const root='partnership-system/markets/ca/on/windsor-essex/runs/2026-09-15';const dir=`${root}/send-release`;
const receipts=[];for(const f of ['personalized-send-receipts','published-send-receipts']){const t=await fs.readFile(`${dir}/${f}.jsonl`,'utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e});receipts.push(...t.trim().split('\n').filter(Boolean).map(JSON.parse));}
async function db(t,q){const r=await fetch(`${process.env.SUPABASE_URL}/rest/v1/${t}?${new URLSearchParams(q)}`,{headers:{apikey:process.env.SUPABASE_KEY,Authorization:`Bearer ${process.env.SUPABASE_KEY}`}});if(!r.ok)throw Error(t+' '+r.status);return r.json()}
const events=[];for(let offset=0;offset<receipts.length;offset+=75)events.push(...await db('email_provider_events',{select:'*',provider_message_id:'in.('+receipts.slice(offset,offset+75).map(r=>r.messageId).join(',')+')',order:'occurred_at'}));
function message(e){let p=e.payload;if(p?.Message){try{return JSON.parse(p.Message)}catch{}}return p;}
const results=receipts.map(r=>{const ev=events.filter(e=>e.provider_message_id===r.messageId);const bounce=ev.find(e=>e.event_type==='email_bounced');const raw=bounce?message(bounce):null;return {...r,events:[...new Set(ev.map(e=>e.event_type))],delivered:ev.some(e=>e.event_type==='email_delivered'),bounced:!!bounce,complained:ev.some(e=>e.event_type==='email_complained'),bounce:raw?.bounce||null}});
const summary={at:new Date().toISOString(),accepted:receipts.length,delivered:results.filter(r=>r.delivered&&!r.bounced&&!r.complained).length,delivery_events:results.filter(r=>r.delivered).length,bounced:results.filter(r=>r.bounced).length,complained:results.filter(r=>r.complained).length,pending:results.filter(r=>!r.delivered&&!r.bounced&&!r.complained).length,results};
await fs.writeFile(`${dir}/delivery-results.json`,JSON.stringify(summary,null,2));await fs.writeFile(`${dir}/delivery-event-evidence.json`,JSON.stringify(events,null,2));
console.log(JSON.stringify({...summary,results:results.filter(r=>r.bounced||r.complained)},null,2));
