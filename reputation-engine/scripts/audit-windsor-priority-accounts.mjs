// Read-only CRM and Zoho history review for the existing 24-account shortlist.
import fs from 'node:fs/promises'
const dir='partnership-system/markets/ca/on/windsor-essex/runs/2026-09-15/priority-enrichment'
const accounts=JSON.parse(await fs.readFile(`${dir}/accounts-config.json`))
accounts.find(a=>a.name==='Flex-N-Gate').domains.push('flexngate.com')
const headers={apikey:process.env.SUPABASE_KEY,Authorization:`Bearer ${process.env.SUPABASE_KEY}`}
async function db(table,query='select=*&order=id'){
 const all=[]
 for(let offset=0;offset<20000;offset+=1000){const r=await fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}?${query}&limit=1000&offset=${offset}`,{headers});if(!r.ok)throw Error(`${table}: ${r.status}`);const rows=await r.json();all.push(...rows);if(rows.length<1000)return all}
 throw Error('Pagination cap reached')
}
const [contacts,companies]=await Promise.all([db('market_contacts'),db('partner_companies')])
function matches(a,row){
 const email=String(row.email||'').toLowerCase().split('@')[1]||''
 const name=String(row.company||row.company_name||'').toLowerCase().replace(/[^a-z0-9]/g,'')
 const target=a.name.toLowerCase().replace(/[^a-z0-9]/g,'')
 const aliases={'Integram – Windsor Seating':['integram'],'CenterLine (Windsor)':['centerline'],'Ford Motor Company':['fordmotor'],'NARMCO Group':['narmco'],'Plasman Group':['plasman'],'Green Shield Canada':['greenshield'],'St. Clair College':['stclaircollege'],'VistaPrint':['vistaprint','cimpresswindsor']}
 return a.domains.includes(email)||(name.length>3&&(name.includes(target)||(aliases[a.name]||[]).some(x=>name.includes(x))))
}
const audit=accounts.map(a=>({...a,contacts:contacts.filter(c=>matches(a,c)),companies:companies.filter(c=>matches(a,c))}))
const ids=[...new Set(audit.flatMap(a=>a.contacts.map(c=>c.id)))];const touches=ids.length?await db('market_touches','select=*&order=id&contact_id=in.('+ids.join(',')+')'):[]
await fs.writeFile(`${dir}/crm-before.json`,JSON.stringify({accounts:audit,touches},null,2))
console.log('CRM matches',audit.map(a=>({account:a.name,companies:a.companies.length,contacts:a.contacts.length})))
const tr=await fetch(process.env.ZOHO_PARTNERSHIP_ACCOUNTS_URL+'/oauth/v2/token',{method:'POST',body:new URLSearchParams({grant_type:'refresh_token',client_id:process.env.ZOHO_PARTNERSHIP_CLIENT_ID,client_secret:process.env.ZOHO_PARTNERSHIP_CLIENT_SECRET,refresh_token:process.env.ZOHO_PARTNERSHIP_REFRESH_TOKEN})});const token=await tr.json();if(!token.access_token)throw Error('Mailbox authorization failed')
async function mail(path){const r=await fetch(process.env.ZOHO_PARTNERSHIP_MAIL_URL+'/api/accounts/'+process.env.ZOHO_PARTNERSHIP_ACCOUNT_ID+path,{headers:{Authorization:'Zoho-oauthtoken '+token.access_token},signal:AbortSignal.timeout(30000)});const x=await r.json();if(!r.ok||x.status?.code!==200)throw Error('Mailbox search failed '+r.status+' '+JSON.stringify(x.status));return x.data}
const messages=new Map();const searches=[]
const prior=JSON.parse(await fs.readFile(`${dir}/mail-search-progress.json`).catch(()=>'{"accounts":[],"searches":[]}'))
for(const a of accounts){
 const old=prior.accounts.find(x=>x.key===a.key)
 if(old?.mailIds?.length===0 && prior.searches.filter(s=>s.account===a.key).length===a.domains.length*3 && prior.searches.filter(s=>s.account===a.key).every(s=>s.complete)) {a.mailIds=[];searches.push(...prior.searches.filter(s=>s.account===a.key));continue}
 const found=new Set()
 for(const domain of a.domains)for(const field of ['sender','to','cc']){
  let complete=false
  let error=''
  for(let start=1;start<=801;start+=200){let rows;for(let attempt=0;attempt<3;attempt++){try{rows=await mail('/messages/search?'+new URLSearchParams({searchKey:field+':'+domain,start:String(start),limit:'200',includeto:'true',receivedTime:String(Date.now())}));break}catch(e){error=e.message;await new Promise(r=>setTimeout(r,500))}}if(!rows)break;for(const m of rows){messages.set(m.messageId,m);found.add(m.messageId)}if(rows.length<200){complete=true;break}}
  searches.push({account:a.key,domain,field,complete,error:complete?'':error})
 }
 a.mailIds=[...found];console.log('Mail search',a.name,found.size)
 await fs.writeFile(`${dir}/mail-search-progress.json`,JSON.stringify({searches,accounts},null,2))
}
const content=[]
for(const m of messages.values()){
 const x=await mail(`/folders/${m.folderId}/messages/${m.messageId}/content`)
 content.push({...m,body:String(x.content||'').replace(/<style[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ')})
}
await fs.writeFile(`${dir}/mail-evidence.json`,JSON.stringify(content,null,2))
await fs.writeFile(`${dir}/history-summary.json`,JSON.stringify(accounts.map(a=>({key:a.key,name:a.name,crmContacts:audit.find(x=>x.key===a.key).contacts.map(c=>({id:c.id,name:c.name,email:c.email,company:c.company,stage:c.stage,last_touch_at:c.last_touch_at,do_not_contact:c.do_not_contact})),mailIds:a.mailIds,mailSearchComplete:searches.filter(s=>s.account===a.key).every(s=>s.complete)})),null,2))
console.log('Unique message bodies retrieved',content.length)
