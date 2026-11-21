"""Prepare personalized source-backed messages from completed website review. No sends."""
import csv,json,re,html,sys,urllib.parse
from pathlib import Path
P=Path('partnership-system/markets/ca/on/windsor-essex/runs/2026-09-15')
S=P/'send-release'
plan=json.loads((S/'live-send-preflight.json').read_text())
by_id={r['id']:r for r in plan['rows']}
queue={r['draft_id']:r for r in csv.DictReader(open(P/'volume-experiment/account-review-queue.csv')) if r['draft_id']}
recovery='--recovery' in sys.argv
reviews=[json.loads(l) for l in (S/('company-publication-deep-review.jsonl' if recovery else 'company-publication-review.jsonl')).read_text().splitlines()]
validation={r['email']:r for r in map(json.loads,(P/'email-verification/aws-validation-results.jsonl').read_text().splitlines())}
existing=json.loads((S/'published-company-release.json').read_text())['initial'] if recovery else []
existing_ids={r['id'] for r in existing}
new_validation=[]
manual_holds={'we-ab-v1-we-2419a1ee7eb4c1c5':'current_US_address_conflicts_with_old_local_listing','we-ab-v1-we-48f80630ad0c2fa9':'website_redirects_to_Southwestern_duplicate_account','we-ab-v1-we-6bdef20e9c128dca':'coordinate_with_parent_ETR_first_contact','we-ab-v1-we-e0b05bb7024f3317':'template_contact_and_alternate_domain_need_manual_review'}
ready=[];held=[]
general={'info','contact','office','admin','hello','inquiries','reception','team','general','letstalk','enquiries'}
for evidence in reviews:
 row=dict(by_id[evidence['id']]);q=dict(queue[row['id']]);local=row['to'].split('@')[0].lower()
 if recovery:
  if row['id'] in existing_ids:continue
  if row['id'] in manual_holds:held.append({'id':row['id'],'account_name':row['account_name'],'to':row['to'],'reasons':[manual_holds[row['id']]]});continue
  if any(h in row['holds'] for h in ['suppression','existing_conversation_review','replaced_by_personalized_account_draft']):continue
  # Same-company published routing inbox only; never choose a vendor, developer or overseas distributor listed on the page.
  domains={urllib.parse.urlsplit(p['resolved_url']).hostname.removeprefix('www.') for p in evidence['pages']}|{row['to'].split('@')[1]}
  routes=[(e.strip().lower(),p['resolved_url']) for p in evidence['pages'] for e in p['emails'] if e.strip().split('@')[0].lower() in general and e.strip().split('@')[-1].lower() in domains]
  original=next((p['resolved_url'] for p in evidence['pages'] if row['to'].lower() in [e.strip().lower() for e in p['emails']]),None)
  if not original or local not in general:
   if routes:
    email,url=sorted(set(routes),key=lambda x:(x[0].split('@')[0]!='info',x[0]))[0]
    row['replaced_directory_email']=row['to'];row['to']=email;local=email.split('@')[0];q['contact_name']='';q['role']=''
    evidence={**evidence,'email_published':True,'publication_url':url}
  if not evidence['city_supported']:
   cities=['Windsor','Oldcastle','Tecumseh','LaSalle','Lakeshore','Maidstone','Essex','Kingsville','Leamington','Amherstburg','Belle River','Harrow','Cottam','Comber','Puce','Ruthven','McGregor','Stoney Point']
   for page in evidence['pages']:
    found=next((city for city in cities if re.search(r'\b'+re.escape(city)+r'[,\s]+(?:ON\b|Ontario\b)',page['text'],re.I)),None)
    if found:row['directory_city']=row['city'];row['city']=found;evidence={**evidence,'city_supported':True};break
  row['validation']=validation.get(row['to'])

 reason=[]
 if not evidence['email_published']:reason.append('email_not_found_on_reviewed_company_pages')
 if evidence['no_solicitation_signal']:reason.append('solicitation_notice_review')
 if not evidence['city_supported']:reason.append('local_context_not_confirmed')
 text=' '.join(p['text'] for p in evidence['pages'])
 named=bool(q['contact_name'] and q['contact_name'].lower() in text.lower() and re.search(r'owner|president|chief executive|general manager|facilities|procurement|purchasing|operations manager',q['role'],re.I))
 if local not in general and not named:reason.append('appropriate_role_not_confirmed')
 if recovery and not reason:
  v=row['validation']
  if not v:new_validation.append(row['to']);reason.append('new_published_email_validation_pending')
  elif v['overall']=='LOW' or v['mailbox']=='LOW' or v['status']=='hold_risk':reason.append('delivery_research')
 if reason:held.append({'id':row['id'],'account_name':row['account_name'],'to':row['to'],'reasons':reason});continue
 category=row['source_categories'].lower()
 if 'construction' in category:service='We can help with office and furniture moves around fit-outs or handovers, with the scope, access and timing reviewed before quoting.'
 elif any(x in category for x in ['logistics','transportation']):service='We provide local packing, loading and furniture-moving support. I’d like to understand whether outside moving crews ever fit the work your team coordinates.'
 elif any(x in category for x in ['manufactur','tool','industrial']):service='We help with office reshuffles and furniture transfers at industrial workplaces, including packing, loading, transport and placement. Access and timing are reviewed before quoting.'
 elif any(x in category for x in ['hospitality','food','beverage','tourism']):service='We help with office and furniture transfers, including smaller moves when a workspace changes. We review access and timing with the site before quoting.'
 else:service='We help local businesses with office moves and furniture transfers, including smaller moves when a team changes its workspace.'
 fact=f'I found {row["account_name"]}’s {row["city"]} contact details on your website and wanted to introduce a local moving contact for your team.'
 greeting=f'Hi {q["contact_name"].split()[0]},' if named else f'Hello {row["account_name"]} team,'
 question=('Is there a supplier process we should follow to be considered when this kind of moving work comes up?' if row['variant']=='A' else 'Who would be the best person to speak with about this kind of moving support for your team?')
 body='\n\n'.join([greeting,fact,'I’m John with Saturn Star Movers. '+service,question,'Thank you,\nJohn Owolabi\nSaturn Star Movers\nbusiness@starmovers.ca | (226) 773-2993\nhttps://starmovers.ca\n3608 Seminole Street, Unit 3\nWindsor, ON N8Y 1Y4, Canada','If you prefer no further emails from me, just reply and let me know.'])
 ready.append({**row,'body':body,'subject':'Moving support for your team','recipient_name':q['contact_name'] if named else row['account_name']+' — General inquiries','recipient_role':q['role'] if named else 'Published general business contact — routing introduction','publication_source':evidence['publication_url'],'publication_checked_at':evidence['checked_at'],'context_source':next(p['resolved_url'] for p in evidence['pages'] if re.search(r'\b'+re.escape(row['city'])+r'\b',p['text'],re.I)),'sending_basis':{'type':'company_published_email','source':evidence['publication_url'],'no_solicitation_notice_found':False,'role_relevance':'Business/site moving services introduction to a general company inquiry route or relevant management contact'},'status':'prepared_for_live_send_check','holds':[]})
if recovery:
 (S/'recovery-validation-candidates.json').write_text(json.dumps(sorted(set(new_validation)),indent=2))
 ready=existing+ready
unique=[];seen=set()
for r in ready:
 if r['to'].lower() in seen:held.append({'id':r['id'],'account_name':r['account_name'],'to':r['to'],'reasons':['same_email_duplicate_company_route']});continue
 seen.add(r['to'].lower());unique.append(r)
ready=unique
assert len({r['to'] for r in ready})==len(ready)
(S/('published-company-expanded-release.json' if recovery else 'published-company-release.json')).write_text(json.dumps({'initial':ready,'held':held,'send_status_source':'published-send-receipts.jsonl'},indent=2,ensure_ascii=False))
proof='<!doctype html><meta charset="utf-8"><title>Windsor published-contact email proofs</title><style>body{font:16px/1.6 Arial;color:#17212b;max-width:800px;margin:40px auto;padding:20px}article{border-top:3px solid #c99700;margin:35px 0;padding-top:20px}pre{font:inherit;white-space:pre-wrap}a{color:#715500}</style><h1>Windsor published-contact email proofs</h1><p>Exact prepared copy; send status is recorded separately in receipts.</p>'
for r in ready:proof+=f'<article><h2>{html.escape(r["account_name"])}</h2><p>To: {html.escape(r["to"])} · Variant {r["variant"]}</p><h3>{html.escape(r["subject"])}</h3><pre>{html.escape(r["body"])}</pre><a href="{html.escape(r["publication_source"],quote=True)}">Published recipient source</a></article>'
(S/('published-company-expanded-proofs.html' if recovery else 'published-company-email-proofs.html')).write_text(proof)
print(json.dumps({'prepared':len(ready),'held_after_website_review':len(held),'variants':{v:sum(r['variant']==v for r in ready) for v in ['A','B']}}))
for r in ready:print(r['account_name'],'|',r['to'],'|',r['recipient_role'])
