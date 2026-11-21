import fs from 'node:fs/promises'
import { SESv2Client, GetAccountCommand } from '@aws-sdk/client-sesv2'
const dir = 'deliverables/commercial-relationships-2026-09-15'
await fs.mkdir(dir, { recursive: true })
const headers = { apikey: process.env.SUPABASE_KEY, Authorization: `Bearer ${process.env.SUPABASE_KEY}` }
async function db(table, query) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}?${new URLSearchParams(query)}`, { headers })
  if (!r.ok) throw Error(`${table}: ${r.status}`)
  return r.json()
}
const schemaResponse = await fetch(`${process.env.SUPABASE_URL}/rest/v1/`, { headers })
const schema = await schemaResponse.json()
await fs.writeFile(`${dir}/schema.json`, JSON.stringify(schema.definitions || {}))
const contacts = await db('market_contacts', { select: '*', or: '(company.ilike.*huli*,company.ilike.*clair*college*,company.ilike.*steelcraft*,company.ilike.*arrow*manufact*,company.ilike.*border*service*,email.ilike.*cbsa*,email.ilike.*arrowmfggroup*,email.ilike.*huli.ca*,email.ilike.*stclaircollege.ca*)' })
await fs.writeFile(`${dir}/contacts-before.json`, JSON.stringify(contacts,null,2))
console.log('Contacts',contacts.map(c=>({id:c.id,name:c.name,email:c.email,companyId:c.partner_company_id})))
for (const t of ['partner_companies','sales_leads','market_touches']) {
  if (!schema.definitions?.[t]) continue
  console.log('Schema',t,Object.keys(schema.definitions[t].properties))
}
if(contacts.length){ const touches=await db('market_touches',{select:'*',contact_id:`in.(${contacts.map(c=>c.id).join(',')})`,order:'created_at.desc'}); await fs.writeFile(`${dir}/touches-before.json`,JSON.stringify(touches,null,2)); console.log('Existing touches',touches.map(t=>({id:t.id,contact:t.contact_id,channel:t.channel,date:t.created_at,notes:t.notes?.slice(0,400)}))) }
const tokenResponse = await fetch(process.env.ZOHO_PARTNERSHIP_ACCOUNTS_URL + '/oauth/v2/token', {method:'POST',body:new URLSearchParams({grant_type:'refresh_token',client_id:process.env.ZOHO_PARTNERSHIP_CLIENT_ID,client_secret:process.env.ZOHO_PARTNERSHIP_CLIENT_SECRET,refresh_token:process.env.ZOHO_PARTNERSHIP_REFRESH_TOKEN})})
const token=await tokenResponse.json(); if(!token.access_token)throw Error('Mailbox auth failed')
async function mail(path){ const r=await fetch(process.env.ZOHO_PARTNERSHIP_MAIL_URL+'/api/accounts/'+process.env.ZOHO_PARTNERSHIP_ACCOUNT_ID+path,{headers:{Authorization:'Zoho-oauthtoken '+token.access_token}});const d=await r.json();if(!r.ok||d.status?.code!==200)throw Error('Mail '+r.status+' '+JSON.stringify(d.status));return d.data }
const all = new Map()
for(const domain of ['huli.ca','stclaircollege.ca','arrowmfggroup.com','steelcraftinc.com','cbsa-asfc.gc.ca']){
  for(const field of ['sender','to','cc']){
    const rows=await mail('/messages/search?'+new URLSearchParams({searchKey:field+':'+domain,start:'1',limit:'200',includeto:'true',receivedTime:String(Date.now())}))
    if(rows.length===200)throw Error('Search pagination needed')
    for(const m of rows)all.set(m.messageId,m)
  }
}
const messages=[]
for(const m of all.values()){
 const d=await mail(`/folders/${m.folderId}/messages/${m.messageId}/content`)
 messages.push({...m,body:String(d.content||'').replace(/<style[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/\s+/g,' ')})
}
messages.sort((a,b)=>Number(b.receivedTime)-Number(a.receivedTime))
await fs.writeFile(`${dir}/mail-evidence.json`,JSON.stringify(messages,null,2))
console.log('Mail',messages.map(m=>({id:m.messageId,from:m.fromAddress,to:m.toAddress,date:new Date(Number(m.receivedTime)).toISOString(),subject:m.subject,body:m.body.slice(0,700)})))
const ses=new SESv2Client({region:'us-east-2'});const health=await ses.send(new GetAccountCommand({}));await fs.writeFile(`${dir}/ses-health.json`,JSON.stringify(health,null,2));console.log('SES',{production:health.ProductionAccessEnabled,sending:health.SendingEnabled,enforcement:health.EnforcementStatus})
