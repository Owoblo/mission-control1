import fs from 'node:fs/promises';
const ids=['18204ac7-41b6-50ff-9d8e-ec428947a8f4','102df5b9-6a60-4e04-9110-2745c614dbde','3488e63a-f15c-484a-8b11-058b7fae4416','8bbc9687-ace5-49c6-bdb7-726d1ab2760e'];
const query=new URLSearchParams({select:'id,contact_id,direction,notes,created_at,metadata',contact_id:'in.('+ids.join(',')+')',created_at:'gte.2026-09-11T00:00:00Z',order:'created_at.asc',limit:1000});
const r=await fetch(process.env.SUPABASE_URL+'/rest/v1/market_touches?'+query,{headers:{apikey:process.env.SUPABASE_KEY,Authorization:'Bearer '+process.env.SUPABASE_KEY}});if(!r.ok)throw Error('Review '+r.status);
const rows=await r.json();if(rows.length===1000)throw Error('Paginate before review');
await fs.writeFile('partnership-system/state/conversation-review-20260916.json',JSON.stringify(rows,null,2));
console.log(JSON.stringify(rows.map(({metadata,...r})=>r),null,2));
