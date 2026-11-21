import './realtor-runtime-20261019.mjs';
import fs from 'node:fs/promises';
const {db}=await import('./reply-runtime-20261015.mjs');
const result=[];
for(const id of ['31f358be-a4d3-4fcf-b607-fe5fd8ce2d24','021718a1-719b-418d-bd45-430ca9f83164','4cc8afed-8003-423b-a7b2-0251a53c1ea5']){
 const [c]=await db('market_contacts',{id:'eq.'+id});const t=await db('market_touches',{contact_id:'eq.'+id,order:'created_at.asc',limit:'1000'});result.push({contact:c,thread:t});console.log(JSON.stringify({contact:c,thread:t.map(x=>({id:x.id,at:x.created_at,channel:x.channel,direction:x.direction,notes:x.notes,metadata:x.metadata}))}));
}await fs.writeFile('artifacts/partnership-nudges-20261019/review.json',JSON.stringify(result,null,2));
