// Account/channel evidence only. Matching never merges people or grants send permission.
const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const phone=s=>String(s||'').replace(/\D/g,'').slice(-10);
const host=s=>{try{return new URL(s).hostname.toLowerCase().replace(/^www\./,'')}catch{return ''}};
export function routePurpose(email){
 const local=email.split('@')[0].toLowerCase().replace(/[._-]/g,'');
 return /^(accessibility|privacy|dpo|abuse|security|unsubscribe|noreply|donotreply|careers|jobs|recruitment|webmaster|postmaster|accountspayable|accountsreceivable)$/.test(local)||/pressoffice$/.test(local)?'special_purpose_route_review':'general_or_named_route_review';
}
export function relationshipReview(candidate,contacts,companies,sales){
 const names=new Set(candidate.organizations.map(norm));const phones=new Set(candidate.source_phones.map(phone).filter(Boolean));const domains=new Set(candidate.website_hosts);
 function reasons(row){const rs=[];const email=String(row.email||'').trim().toLowerCase();const domain=email.split('@')[1];const name=norm(row.company||row.company_name||row.name);
  if(email===candidate.email.toLowerCase())rs.push('exact_email');
  if(phones.has(phone(row.phone)))rs.push('possible_account_phone');
  if(names.has(name)&&name.length>=4)rs.push('organization_name');
  if(domains.has(host(row.website))||domain&&domains.has(domain))rs.push('account_domain');
  return rs;
 }
 const firms=companies.map(r=>({id:r.id,reasons:reasons(r)})).filter(r=>r.reasons.length);const companyIds=new Set(firms.map(r=>r.id));
 const peers=contacts.map(r=>({id:r.id,reasons:[...reasons(r),...(companyIds.has(r.partner_company_id)?['linked_company']:[])],suppressed:!!(r.do_not_contact||r.cross_channel_suppressed_at||r.stage==='dnc'||r.decision==='opted_out')})).filter(r=>r.reasons.length);
 const leads=sales.map(r=>({id:r.id,reasons:reasons(r.data||{})})).filter(r=>r.reasons.length);
 const holds=[...(candidate.holds||[]),'category_message_approval_required','person_or_business_route_identity_review'];
 if(!candidate.occurrence_evidence?.length||candidate.occurrence_evidence.some(e=>e.evidence_status==='attribution_evidence_incomplete'))holds.push('attribution_evidence_incomplete');
 if(routePurpose(candidate.email)==='special_purpose_route_review')holds.push('special_purpose_inbox_not_general_outreach');
 if(candidate.source_record_ids.length>1)holds.push('branch_association_review');
 // One local place row may point at an entire national staff directory.
 // A single source record therefore does not establish each person's branch.
 if((candidate.site_email_count||0)>=3)holds.push('multi_contact_site_requires_individual_role_and_branch_evidence');
 if(peers.length||firms.length||leads.length)holds.push('existing_relationship_review');
 if(peers.some(p=>p.suppressed))holds.push('possible_suppressed_relationship');
 if(!candidate.existing_policy_pass)holds.push('mailbox_confidence_review');
 return {email:candidate.email,organizations:candidate.organizations,municipalities:candidate.municipalities,source_pages:candidate.source_pages,mailbox_policy_pass:!!candidate.existing_policy_pass,contacts:peers,companies:firms,sales:leads,holds:[...new Set(holds)],occurrence_evidence:candidate.occurrence_evidence||[],phone_occurrence_evidence:candidate.phone_occurrence_evidence||[],relationship_status:'candidate_only_not_verified',send_ready:false,owner_send_hold:true};
}

// Index the snapshot once; keep the exact same matching and suppression rules.
export function indexedRelationshipReviewer(contacts,companies,sales){
 function index(rows,salesRows=false){
  const keys=new Map();
  const add=(key,i)=>{if(!keys.has(key))keys.set(key,new Set());keys.get(key).add(i)};
  rows.forEach((item,i)=>{const row=salesRows?item.data||{}:item;
   const email=String(row.email||'').trim().toLowerCase(),name=norm(row.company||row.company_name||row.name),p=phone(row.phone),domain=host(row.website);
   if(email)add('email:'+email,i);if(name.length>=4)add('name:'+name,i);if(p)add('phone:'+p,i);
   if(domain)add('domain:'+domain,i);if(email.includes('@'))add('domain:'+email.split('@')[1],i);
   if(row.partner_company_id)add('company:'+row.partner_company_id,i);
  });
  return query=>{const found=new Set();for(const key of query)for(const i of keys.get(key)||[])found.add(i);return [...found].sort((a,b)=>a-b).map(i=>rows[i]);};
 }
 const contactIndex=index(contacts),companyIndex=index(companies),salesIndex=index(sales,true);
 return candidate=>{
  const query=['email:'+candidate.email.toLowerCase(),...candidate.organizations.map(n=>'name:'+norm(n)),...candidate.source_phones.map(p=>'phone:'+phone(p)),...candidate.website_hosts.map(h=>'domain:'+h)];
  const firms=companyIndex(query);
  return relationshipReview(candidate,contactIndex([...query,...firms.map(r=>'company:'+r.id)]),firms,salesIndex(query));
 };
}
