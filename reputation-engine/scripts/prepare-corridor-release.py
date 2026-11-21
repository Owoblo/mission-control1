"""Prepare bounded, source-reviewed corridor email copy; never sends."""
import json,re,hashlib,html,sys
from pathlib import Path
P=Path('partnership-system/markets/ca/on/windsor-kitchener/runs/2026-09-15');W=Path('partnership-system/markets/ca/on/windsor-essex/runs/2026-09-15');S=W/'send-release';batch=sys.argv[sys.argv.index('--batch')+1] if '--batch' in sys.argv else 'batch-01';assert re.fullmatch('[a-z0-9-]+',batch);out=P/batch;out.mkdir(exist_ok=True)
release=json.loads((S/'published-company-expanded-release.json').read_text());existing={r['to'].lower() for r in release['initial']};ids={r['id'] for r in release['initial']};validation={r['email']:r for r in map(json.loads,(W/'email-verification/aws-validation-results.jsonl').read_text().splitlines())}
hold_emails={'office@diamondaircraft.com':'Austria office; find Canadian route','info@eragroup.com':'US headquarters route; local relationship research','info@covenantconstruction.ca':'Clay DCC identity/rebrand review','team@loanconnect.ca':'Asset Direct product identity and recipient purpose review','info@neupath.com':'InMedic current brand/local site review','hello@gibsoncounselling.ca':'client-only route; seek administration','info@cfoe.ca':'template contact mixed with vendor address; review','sales@autoverify.com':'Mobials current brand/local role review','info@poi.ca':'local branch/central route review','info@prioritylogistics.ca':'Woodstock office evidence review','info@peoplecare.ca':'specific retirement site/central route review','info@stayrcc.com':'specific campus/central route review','contact@getcertain.ca':'Ai/GetCertain brand and local division review'}
def clean(x):return re.sub(r'\s+',' ',x).strip()
def sector(r):
 text=(r['name']+' '+r['categories']).lower()
 if re.search(r'movers|moving.*storage',text):return 'moving_partner'
 if re.search(r'property management|properties|developments',text):return 'property'
 if re.search(r'architect|engineering services|survey',text):return 'design'
 if re.search(r'furniture|atwork',text):return 'furniture'
 if re.search(r'clinic|dental|dentistry|orthodont|health centre|counselling|homecare|home care',text):return 'clinic'
 if re.search(r'not.for.profit|non.profit|charit|community|foundation|family services|youth|meals on wheels|nokee|atlohsa',text):return 'community'
 if re.search(r'hotel|motel|restaurant|catering|golf|brew|convention|hall|venue|arcade|cafe|bakery',text) and 'can-am' not in text:return 'hospitality'
 if re.search(r'college|education|school|training',text):return 'education'
 if re.search(r'manufactur|industrial|fabric|steel|equipment|construction|renovation|contract|plumbing|roof|electric|landscap|heating',text):return 'site'
 if re.search(r'logistics|courier|freight',text):return 'logistics'
 if re.search(r'cleaning|restoration|maintenance',text):return 'cleaning'
 if re.search(r'retail|apparel|gift|jewel|store|appliance',text):return 'retail'
 return 'office'
services={
'property':('We can quote furniture transfers between properties, moves into storage, or the office side of a turnover. You would have one contact to review the items, access and timing with.','Do you keep an approved mover list, or can individual property managers choose a mover?','Who on your team handles furniture moves between properties?'),
'design':('When a workspace fit-out reaches the furniture-moving stage, we can quote packing, transport and placement. I’d like to be a practical contact your team can bring into that part of a project.','Is there a vendor process for a mover to be considered on those projects?','Does your team coordinate that part of a fit-out, or does the client normally arrange the mover?'),
'furniture':('If a customer needs existing furniture moved before a new setup arrives, we can review and quote that part. I’d also like to understand whether outside moving support ever fits your installations.','Is there a process for becoming an overflow moving contact for your team?','Do you ever use outside movers for those jobs, or is everything handled by your own crew?'),
'clinic':('We can quote desks, chairs and waiting-area furniture when the practice rearranges or changes space. The items, access and timing would be agreed with the office first.','Would the office manager be the right person to ask about becoming a moving-service contact?','Does your office team handle furniture moves internally, or call in a mover?'),
'community':('We can quote the smaller jobs too: tables and chairs moving between spaces, or office furniture going to another site. I’d like your team to have a contact before something needs arranging.','Do you keep a supplier list for furniture-moving jobs?','Who normally arranges furniture transfers for your team?'),
'hospitality':('A few tables, chairs or room furnishings can still be a job to coordinate. We can quote those smaller transfers as well as a larger furniture move, with site access and timing agreed first.','Is there a process for adding a mover to your supplier contacts?','Can the site manager arrange furniture moves directly, or does that go through another team?'),
'education':('We can quote desks, chairs and classroom or office furniture moving between rooms or sites. Access and timing would be reviewed with the school before the job.','Is there a vendor registration step for classroom or office furniture moves?','Who handles furniture-moving arrangements for your site?'),
'site':('The work I have in mind is desks, chairs and office furniture when a team changes space. We can quote a small internal move or a transfer between sites.','Is there a vendor registration step for that work, or can the local site arrange it directly?','Does operations, facilities or the office manager normally arrange office furniture moves?'),
'logistics':('We handle packing and furniture moves. I’d like to understand whether a local moving crew could fit the jobs your team coordinates, with the scope agreed before taking anything on.','Is there a process for joining your outside-provider list for that work?','Do furniture-moving jobs ever come through your team, or is that outside your usual scope?'),
'cleaning':('If furniture has to move before a cleanup or workspace handover, we can review and quote the moving part. I’d like to understand whether having a moving contact would help your team coordinate those jobs.','Do you keep a list of outside movers for those situations?','Do those furniture moves come through your team, or does the client arrange them separately?'),
'retail':('We can quote the smaller furniture jobs too—desks and chairs going into storage, a workspace rearrangement, or a move to another space. We agree the items and access before quoting.','Would it be useful to keep our details with your supplier contacts?','Do you already have a mover for furniture transfers, or arrange those jobs as needed?'),
'office':('We can quote the smaller office jobs too: desks and chairs moving between rooms, furniture going into storage, or a full office move. I’d like your team to have a contact before that job comes up.','Would it be useful to keep our details on your supplier list?','Do you already have a go-to mover for office furniture, or is that arranged as needed?'),
'moving_partner':('I’d like to explore whether extra moving support in Windsor–Essex could fit your coverage. We can compare service areas and agree the scope before taking on overflow work.','Is there a process for joining your subcontractor or overflow-provider list?','Who coordinates outside crews when your team needs additional Windsor–Essex coverage?')}
if '--append' in sys.argv:
 candidates=json.loads((out/'candidates.json').read_text())
else:
 candidates=[];holds=[]
 for r in json.loads((P/'email-candidates.json').read_text()):
  if r['to'] in existing or r['id'] in ids:continue
  reason=hold_emails.get(r['to'])
  if not r['local_city_mentioned_on_site']:reason=reason or 'local site/service-area evidence review'
  if r['publication_excerpt'].startswith('Published mailto'):reason=reason or 'mailto purpose review'
  if reason:holds.append({'id':r['id'],'name':r['name'],'email':r['to'],'reason':reason});continue
  if len(candidates)>=100:continue
  candidates.append(r)
 (out/'candidates.json').write_text(json.dumps(candidates,indent=2));(out/'holds.json').write_text(json.dumps(holds,indent=2));(S/'recovery-validation-candidates.json').write_text(json.dumps([r['to'] for r in candidates],indent=2));print(json.dumps({'candidates':len(candidates),'held':len(holds)}));sys.exit()
new=[];holds=[]
for c in candidates:
 if c['to'] in existing or c['id'] in ids:continue
 v=validation.get(c['to'])
 if not v or v['overall']=='LOW' or v['mailbox']=='LOW' or v['status']=='hold_risk':holds.append({'email':c['to'],'reason':'validation_hold'});continue
 name=clean(c['name']).rstrip('*');city=clean(c['city']).replace(', Ontario','').title();kind=sector(c);service,qa,qb=services[kind];variant='A' if int(hashlib.sha256(c['id'].encode()).hexdigest()[:8],16)%2==0 else 'B';street=c['address'].split(city)[0].strip();text=' '.join(pg['text'] for pg in c['pages']);address_match=bool(not re.search(r'P\.?O\.?\s*Box',street,re.I) and street and len(street)<90 and re.sub(r'\W','',street.lower()) in re.sub(r'\W','',text.lower()))
 opening=f'I found your {street} location in {city}.' if address_match else f'I found your {city} contact details while looking into {name}.'
 if kind=='moving_partner':opening=f'I came across {name} while researching moving partners along the Windsor–London corridor.'
 subject='A contact for the smaller furniture moves'
 if kind=='design':subject='The moving part of a workspace fit-out'
 if kind=='property':subject='Furniture transfers between your properties'
 if kind=='moving_partner':subject='Windsor–Essex overflow moving support'
 if kind=='clinic':subject='A contact for clinic furniture moves'
 if kind=='education':subject='Who arranges your furniture moves?'
 body='\n\n'.join(['Hello '+name+' team,',opening,'I’m John with Saturn Star Movers. '+service,qa if variant=='A' else qb,'Thank you,\nJohn Owolabi\nSaturn Star Movers\nbusiness@starmovers.ca | (226) 773-2993\nhttps://starmovers.ca\n3608 Seminole Street, Unit 3\nWindsor, ON N8Y 1Y4, Canada','If you prefer no further emails from me, just reply and let me know.'])
 r={'id':c['id'],'account_id':c['id'],'account_name':name,'to':c['to'],'city':city,'website':c['website'],'source_categories':c['categories'] or kind,'source_url':c['source_url'],'physical_address':c['address'],'address_status':'directory_source; print_review_pending','publication_source':c['publication_source'],'context_source':c['source_url'],'publication_checked_at':c['site_checked_at'],'body':body,'subject':subject,'variant':variant,'recipient_name':name+' — Business contact','recipient_role':'Company-published business contact — routing inquiry','validation':v,'sending_basis':{'type':'company_published_email','source':c['publication_source'],'role_relevance':'Company or site furniture-moving supplier/routing introduction','publication_excerpt':c['publication_excerpt']},'holds':[],'status':'prepared_for_live_send_check','experiment_id':'corridor-specific-need-v1','experiment_sector':kind,'experiment_angle':'supplier-route' if variant=='A' else 'current-process'};new.append(r);existing.add(r['to']);ids.add(r['id'])
# Prepare exact copy first. Separate --commit only after reviewing this saved artifact.
(out/'release.json').write_text(json.dumps({'initial':new,'held':holds},indent=2,ensure_ascii=False));(out/'proofs.html').write_text('<!doctype html><meta charset="utf-8"><title>Corridor exact email proofs</title>'+''.join('<article><h2>'+html.escape(r['account_name'])+'</h2><p>'+html.escape(r['to'])+'</p><h3>'+html.escape(r['subject'])+'</h3><pre>'+html.escape(r['body'])+'</pre></article>' for r in new));print(json.dumps({'prepared_for_review':len(new),'held':holds}))
