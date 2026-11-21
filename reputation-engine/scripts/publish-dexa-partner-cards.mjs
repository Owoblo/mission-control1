import fs from 'node:fs/promises';import {createHash} from 'node:crypto';
const root='partnership-system/exports/dexa-cards-20260916';
const cards=JSON.parse(await fs.readFile('lib/data/partner-business-cards.json')).filter(c=>c.business==='Dexa Movers');
const results=[];
for(const c of cards)for(const format of ['jpg','pdf']){
 const bytes=await fs.readFile(`${root}/${c.slug}/card.${format}`);
 const key=`partnership-library/business-cards/2026-09-16-dexa/${c.slug}/card.${format}`;
 const base=process.env.SUPABASE_URL+'/storage/v1/object';
 const headers={apikey:process.env.SUPABASE_KEY,Authorization:'Bearer '+process.env.SUPABASE_KEY,'Content-Type':format==='jpg'?'image/jpeg':'application/pdf','x-upsert':'false'};
 const existing=await fetch(base+'/public/ops-media/'+key);
 if(!existing.ok){if(existing.status!==400&&existing.status!==404)throw Error('Asset preflight failed');const put=await fetch(base+'/ops-media/'+key,{method:'POST',headers,body:bytes});if(!put.ok)throw Error('Upload failed '+put.status)}
 const check=await fetch(base+'/public/ops-media/'+key);if(!check.ok)throw Error('Public asset unreadable');
 const sha=b=>createHash('sha256').update(b).digest('hex');if(sha(bytes)!==sha(Buffer.from(await check.arrayBuffer())))throw Error('Published asset differs; do not overwrite');
 results.push({slug:c.slug,format,url:base+'/public/ops-media/'+key,sha256:sha(bytes),bytes:bytes.length});
}
await fs.writeFile(root+'/publication-receipt.json',JSON.stringify(results,null,2));console.log(JSON.stringify({verifiedAssets:results.length,version:'2026-09-16-dexa'}));
