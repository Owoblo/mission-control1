import './gta-email-recovery-runtime.mjs';
import fs from 'node:fs/promises';
const {db,send,asset,reviewed}=await import('./reply-runtime-20261007.mjs');
const dir='artifacts/partnership-replies-20261011';
const {rows}=JSON.parse(await fs.readFile(dir+'/review.json','utf8'));
const cards=new Set(['Catherine Simmons','ARLENE MARQUES','JITHESH RAMDAS','Maham Naveed','JENNIFER SARGEANT','Caterina Maiolo','VINCE KRASNIQI','SUZY GOLDSTEIN','STEPHANIE NAUSE','HARSHARN KAUR BRAR']);
const plans=[];
for(const {contact:c,thread} of rows){
 if(!cards.has(c.name)&&c.name!=='ALEXEI ANTSYFEROV')continue;
 const last=thread.at(-1);const first=c.name.split(' ')[0].toLowerCase().replace(/^./,s=>s.toUpperCase());
 const p={id:c.id,name:c.name,phone:c.phone,city:c.city,latest:last.id,from:last.metadata.to,followup_key:'20261011-contextual'};
 if(cards.has(c.name)){
  p.media_urls=[await asset(c.city)];
  p.body=`Here you go, ${first}! Here's our ${c.city} digital card to save and share whenever a client needs a moving quote. You're welcome to call this number too. - John`;
  if(c.name==='Catherine Simmons')p.body="Here you go, Catherine! Here's our Burlington digital card for anyone who asks about movers. Wishing you all the best with your upcoming retirement. - John";
  if(c.name==='SUZY GOLDSTEIN')p.body="Hi Suzy, John from Saturn Star Movers here. Your last message about being on the way may have been intended for someone else. Here's the Toronto digital card you asked for earlier, to save and share. - John";
  if(c.name==='HARSHARN KAUR BRAR')p.body="Here you go, Harsharn! Here's our Brampton digital card. I'd be happy to help with the closing you mentioned at the end of October. Do your clients need a moving quote? If so, what date are they hoping to move, and from where to where? - John";
 }else{
  p.body="Thanks, Alexei, got the link. Which furniture in the photos is staging and won't be moving, and is there anything going with you that isn't pictured? Also, will you need packing, and are there any stairs or parking restrictions at either property? That will help me prepare the estimate for your November 26 move. - John";
 }
 plans.push(p);
}
await fs.writeFile(dir+'/send-plan.json',JSON.stringify(plans,null,2));
if(!process.argv.includes('--send')){console.log(JSON.stringify(plans.map(p=>({name:p.name,body:p.body,media:p.media_urls}))));process.exit(0);}
const results=[];
for(const p of plans){try{const receipt=await send(p);results.push({name:p.name,...receipt});if(receipt.state==='accepted')for(const t of rows.find(r=>r.contact.id===p.id).thread.filter(t=>t.direction==='inbound'&&t.created_at>'2026-10-10T22:00:00Z'))await reviewed(t.id,p.name==='ALEXEI ANTSYFEROV'?'Own-move enquiry: acknowledged supplied link and requested only missing scope. John retains estimate and appointment follow-up.':p.name==='HARSHARN KAUR BRAR'?'Requested card sent; closing enquiry needs date/route and client moving-need confirmation.':'Context reviewed; requested digital card sent.',{provider_receipt:receipt.result.sid});}catch(e){results.push({name:p.name,error:e.message});console.log(JSON.stringify({name:p.name,error:e.message}));}}
await fs.writeFile(dir+'/send-results.json',JSON.stringify(results,null,2));
