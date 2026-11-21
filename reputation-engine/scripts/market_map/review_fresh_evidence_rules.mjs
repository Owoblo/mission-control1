/** Conservative, reproducible saved-source review for verified fresh cohorts.
 * No CRM write or send. The admission service still checks live history,
 * suppression, account identity, copy, and sender before queuing.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {loadVerifiedFreshCohortBundle,highMailboxEvidence} from '../../lib/partnership-core/fresh-cohort-bundle.mjs';
import {mailboxAdmissionQuality} from '../../lib/partnership-core/mailbox-admission-quality.mjs';

const root=process.argv[2];
if(!root)throw Error('Usage: node scripts/market_map/review_fresh_evidence_rules.mjs ROOT [--publish]');
const publish=process.argv.includes('--publish');
const regional=process.argv.includes('--regional');
const {candidates,sources,mailbox,technical}=loadVerifiedFreshCohortBundle(root);
const batchManifest=JSON.parse(fs.readFileSync(path.join(root,'batch-manifest.json')));
const preparationManifest=JSON.parse(fs.readFileSync(path.join(batchManifest.parent_preparation,'manifest.json')));
const knownCities=Object.keys(preparationManifest.cities||{}).filter(x=>x.length>=4).sort((a,b)=>b.length-a.length);
const sourceById=new Map(sources.map(r=>[r.organisation_id,r]));
const technicalById=new Map(technical.map(r=>[r.organisation_id,r]));
const validationById=new Map(mailbox.map(r=>[r.organisation_id,r]));
const excluded=new Set();
for(const name of fs.readdirSync(root)){
 if(/^claim-.*\.json$/.test(name))for(const r of JSON.parse(fs.readFileSync(path.join(root,name))).records||[])excluded.add(r.organisation_id);
 if(/^additional-reviewed-parallel-\d+-round\d+-source\.jsonl$/.test(name))for(const line of fs.readFileSync(path.join(root,name),'utf8').split('\n').filter(Boolean))excluded.add(JSON.parse(line).organisation_id);
}
const normalize=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\b(incorporated|limited|inc|ltd|corp|corporation)\b/g,'').replace(/[^a-z0-9]/g,'');
const word=(text,value)=>new RegExp('(^|[^a-z0-9])'+String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'([^a-z0-9]|$)','i').test(text);
const sha=value=>createHash('sha256').update(value).digest('hex');
const phones={windsor:'226-887-0667',waterloo:'226-241-9853',london:'548-639-1428',gta:'437-465-0584'};
const mapCity={brantford:'gta',stratford:'london','st. thomas':'london','st thomas':'london',woodstock:'london',chatham:'windsor','chatham-kent':'windsor',kitchener:'waterloo',waterloo:'waterloo',cambridge:'waterloo',guelph:'waterloo',windsor:'windsor',london:'london'};
function region(c){const city=String(c.city||'').toLowerCase();if(mapCity[city])return mapCity[city];const area=String(c.catchment||'').toLowerCase();if(area.includes('ottawa'))return null;if(area.includes('windsor')||area.includes('chatham-kent'))return 'windsor';if(area.includes('kitchener')||area.includes('waterloo'))return 'waterloo';if(area.includes('london')||area.includes('sarnia'))return 'london';if(area.includes('toronto')||area.includes('gta')||area.includes('hamilton'))return 'gta';return null;}
const regionalHub={gta:'Toronto',windsor:'Windsor',waterloo:'Kitchener',london:'London'};
const angles=[
 [/clean|janitorial|restoration|carpet/i,['cleaning','If one of your cleaning or restoration jobs needs furniture moved or unwanted items cleared out, we would like to be the team you can call for help.']],
 [/realt|property_management|real_estate|broker/i,['real_estate','If a client needs help moving or clearing unwanted items around a property handover, we would like to be the team you can call and trust.']],
 [/furniture_install|furniture.*install|install.*furniture/i,['furniture_installation','If an installation job needs furniture moved into place or old items cleared out, we would like to be the team you can call for help.']],
 [/furniture|interior|cabinet|countertop|kitchen|renovation|construction|fitout|home_improvement/i,['renovation','If a project needs furniture moved out of the way or unwanted items cleared, we would like to be the team you can call for help.']],
 [/hospitality|restaurant|cafe|retail|shop|florist|salon|barber/i,['local_business','If your business ever needs furniture or equipment moved or unwanted items cleared out, we would like to be the team you can call for help.']],
 [/education|school|nonprofit|community|church|sport|arts|event|music|dance/i,['community','If your team ever needs furniture, equipment or event supplies moved, we would like to be the team you can call for help.']],
 [/professional_offices|office|corporate|business_service|consult|staffing|finance|insurance|law/i,['business_premises','If your office or a client ever needs furniture moved or unwanted items cleared out, we would like to be the team you can call for help.']],
 [/spa|beauty|healthcare|dental|clinic/i,['local_premises','If your premises ever needs furniture or equipment moved or unwanted items cleared out, we would like to be the team you can call for help.']],
 [/industrial|manufactur|warehouse|distribution|supplier|automotive|repair|irrigation/i,['business_operations','If your team ever needs furniture or equipment moved or unwanted items cleared out, we would like to be the team you can call for help.']],
];
function angle(c){return angles.find(([re])=>re.test(String(c.sector||'')))?.[1]||null;}
if(process.argv.includes('--self-test')){
 const sectors=['cleaning','property_management','furniture_installation','retail','church','professional_offices','dental','manufacturing'];
 for(const sector of sectors){
  const result=angle({sector});
  if(!Array.isArray(result)||result.length!==2||typeof result[0]!=='string'||typeof result[1]!=='string'||result[1].includes('undefined'))throw Error('Contextual copy self-test failed: '+sector);
  const rendered=result[0]==='furniture_installation'?result[1]:result[1]+' I wanted to see how we could work together across Toronto and the surrounding areas.';
  if(rendered.includes('undefined'))throw Error('Rendered copy self-test failed: '+sector);
 }
 console.log(JSON.stringify({selfTest:'passed',sectorCount:sectors.length}));
}
function sourcePage(c,s){
 const n=normalize(c.organisation_name);if(n.length<7)return [null,'short_or_ambiguous_name'];
 const host=String(c.domain||'').toLowerCase().replace(/^www\./,'');
 for(const p of s.pages||[]){
  if(p.http_status!==200||!p.sha256||!p.target_email_observed||p.restriction_signals?.length)continue;
  let url;try{url=new URL(p.final_url||p.requested_url)}catch{continue}
  if(url.hostname.toLowerCase().replace(/^www\./,'')!==host||/privacy|terms|career|employment|job|admission|registration|support|policy/i.test(url.pathname))continue;
  const context=[p.target_context,...(p.target_contexts||[])].filter(Boolean).join(' ');
  const excerpt=p.page_identity_excerpt||'';const combined=excerpt+' '+context;
  if(!context.toLowerCase().includes(c.email.toLowerCase()))continue;
  if(!normalize(combined).includes(n))continue;
  const addressCities=knownCities.filter(city=>new RegExp('(^|[^a-z])'+city.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*,?\\s*(?:Ontario|ON)\\s*,?\\s*[KLMNP]\\d[A-Z][ -]?\\d[A-Z]\\d','i').test(combined));
  const exact=addressCities.find(city=>normalize(city)===normalize(c.city));
  const reviewedCity=exact||(addressCities.length===1?addressCities[0]:regional&&addressCities.length===0?(word(combined,c.city)?c.city:regionalHub[region(c)]):null);
  if(!reviewedCity)continue;
  const at=context.toLowerCase().indexOf(c.email.toLowerCase());
  const before=context.slice(Math.max(0,at-150),at);
  if(!/(?:email|e-mail|contact|reach us|our office|address|phone|call|visit us|hours)/i.test(before))continue;
  if(/(?:career|employment|job application|resum[eé]|privacy officer|web admin|technical support)/i.test(before.slice(-100)))continue;
  if(/(?:franchise|independently owned|owned by|managed by|division of|subsidiary)/i.test(combined.slice(0,1000)))continue;
  const locationBasis=exact||addressCities.length===1?'official_address':word(combined,c.city)?'official_city_mention':'regional_service_area_only';
  return [{page:p,city:reviewedCity,locationBasis},null];
 }
 return [null,'source_identity_locality_contact_context_not_proven'];
}
const rows=[],holds={};
for(const c of candidates){
 if(excluded.has(c.organisation_id)){holds.already_claimed_or_reviewed=(holds.already_claimed_or_reviewed||0)+1;continue}
 const s=sourceById.get(c.organisation_id),t=technicalById.get(c.organisation_id),v=validationById.get(c.organisation_id);
 let reason=null;
 if(!t||t.technical_screen_status!=='advance_to_identity_and_eligibility_review'||!v||!highMailboxEvidence(v.validation)||!mailboxAdmissionQuality(v.validation).automatic)reason='mailbox_review_required';
 else if(!s||s.restriction_signals?.length||!s.target_email_observed)reason='source_restriction_or_missing';
 else if(!region(c))reason='sender_region_unmapped';
 else if(!angle(c))reason='sector_angle_unmapped';
 const [review,pageReason]=reason?[null,null]:sourcePage(c,s);if(!reason&&!review)reason=pageReason;
 if(reason){holds[reason]=(holds[reason]||0)+1;continue}
 const [sector,lead]=angle(c),r=region({...c,city:review.city});
 if(typeof sector!=='string'||!sector||typeof lead!=='string'||!lead.includes('.')||lead.includes('undefined'))throw Error('Invalid contextual copy for '+c.organisation_id);
 if(!r){holds.sender_region_unmapped=(holds.sender_region_unmapped||0)+1;continue}
 const locationFinding=review.locationBasis==='official_address'?`The official page also publishes an Ontario address in ${review.city}.`:review.locationBasis==='official_city_mention'?`The official page mentions ${review.city}, but a physical address is not independently confirmed.`:`The regional service wording names ${review.city}, where the sender operates; the recipient's physical city remains unverified.`;
 const paragraph=sector==='furniture_installation'?lead:lead+` I wanted to see how we could work together across ${review.city} and the surrounding areas.`;
 if(paragraph.includes('undefined')||!paragraph.includes('.'))throw Error('Invalid rendered paragraph for '+c.organisation_id);
 rows.push({organisation_id:c.organisation_id,organisation_name:c.organisation_name,email:c.email,reviewed_at:new Date().toISOString(),reviewed_city:review.city,sender_region:r,regional_phone:phones[r],market:'saturn',reviewed_sector:sector,identity_email_binding:'pass',role_relevance:'pass_for_conditional_context',finding:`Automated saved-source rule review: the official ${c.organisation_name} page identifies the business and visibly publishes ${c.email} in a contact context. ${locationFinding} The sector supports a conditional ${sector} moving or clearing offer. No named owner, current need, franchise identity or prior relationship is asserted; live account, history and suppression checks remain required.`,proposed_contextual_paragraph:paragraph,sources:[{...review.page,url:review.page.final_url||review.page.requested_url}],review_method:'automated_evidence_rules_v2',source_record_sha256:sha(JSON.stringify(s)),requires_parent_account_review:false,location_basis:review.locationBasis});
}
const report={at:new Date().toISOString(),root,selected:candidates.length,reviewed:rows.length,holds,output:null,campaign_ready:0,admitted:0,sent:0};
if(process.argv.includes('--preview'))report.previews=rows.map(r=>({business:r.organisation_name,city:r.reviewed_city,basis:r.location_basis,sector:r.reviewed_sector,paragraph:r.proposed_contextual_paragraph,email:r.email,source:r.sources[0].url}));
if(publish&&rows.length){
 const name=`additional-reviewed-parallel-${regional?'902':'901'}-round1-source.jsonl`,file=path.join(root,name),marker=file+'.ready';
 if(fs.existsSync(file)||fs.existsSync(marker))throw Error('Immutable review output already exists');
 const body=rows.map(r=>JSON.stringify(r)).join('\n')+'\n';
 fs.writeFileSync(file,body,{flag:'wx'});
 fs.writeFileSync(marker,JSON.stringify({complete:true,count:rows.length,sha256:sha(body),reviewed_at:new Date().toISOString(),scope:'Conservative automated saved-source review; live admission required'},null,2),{flag:'wx'});
 report.output=file;
}
console.log(JSON.stringify(report));
