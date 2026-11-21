"""Prepare manually reviewed exact public routes without overwriting earlier copy. No sends."""
import json,re,hashlib,html,sys
from pathlib import Path
P=Path('partnership-system/markets/ca/on/windsor-essex/runs/2026-09-15');E=P/'expansion';S=P/'send-release';batch=sys.argv[sys.argv.index('--batch')+1] if '--batch' in sys.argv else 'recovery-v2';assert re.fullmatch(r'[a-z0-9-]+',batch);O=E/batch;O.mkdir(exist_ok=True)
# Exact email, source phrase, researched opening. Names only where the page establishes them.
specs=[
('aburgmission@yahoo.com','298 Victoria','I saw the Mission’s Victoria Street location in Amherstburg. I wanted to introduce a local contact for office and ordinary furniture transfers around your space.'),
('admin@bornaisfinancial.com','114 Murray','I saw your Murray Street office in Amherstburg. If the office needs furniture moved or rearranged, I’d like your team to have a local contact.'),
('info@thedigitaldragonfly.ca','Work With Digital Dragonfly','I came across your digital signage work through the local Chamber directory. I’m reaching out about the office and furniture side of workspace changes.'),
('sharron.carr@migroup.ca','Sharron Carr','I found your mortgage practice’s public contact page. When a client needs a local mover around their closing, I’d like to be a contact you can point them to.','Sharron Carr','Mortgage professional'),
('fortmalden@pc.gc.ca','100 Laird Avenue','I found Fort Malden’s Laird Avenue site contact. Who handles supplier inquiries for ordinary office and furniture moving support at the site?'),
('powerdistributionsupply@gmail.com','3725 DelDuca','I saw your DelDuca Drive location in Oldcastle. I wanted to introduce our team for office furniture transfers or changes around the workspace.'),
('mail@rivertowntimes.com','questions or comments','I came across the River Town Times through the Amherstburg Chamber. I’m reaching out about office furniture moves for your own team.'),
('mail@royalsushihouse.com','259 Dalhousie','I saw Royal Sushi House’s Dalhousie Street location. If ordinary furniture needs moving around a workspace change, I’d like your team to have a local contact.'),
('joe@thegaragegym.net','The Garage Gym','I came across The Garage Gym through the Amherstburg Chamber. I’m reaching out about office and ordinary furniture moves when your workspace changes.'),
('office@gibsongallery.org','140 Richmond','I saw the Gibson Gallery’s Richmond Street location. I wanted to introduce a local contact for office and ordinary furniture transfers at the gallery.'),
('thesaltydoginfo@gmail.com','237 Dalhousie','I saw The Salty Dog’s Dalhousie Street location in Amherstburg. I’m reaching out about ordinary furniture moves when a workspace or guest area changes.'),
('lemarketingandconsulting@gmail.com','Service Areas Kingsville','I saw that your marketing and consulting practice serves Kingsville and the surrounding area. I’d like to introduce a local contact for office furniture moves.'),
('contactus@sunsetgrown.com','2100 Road 4 East','I found your Kingsville headquarters contact. I’m reaching out about office furniture transfers and workspace changes at the site.'),
('anna@southwestdiesel.ca','Anna Unger - Office Manager','Your contact page lists you as Southwest Diesel’s office manager. I wanted to introduce a local moving contact for office furniture transfers at your Ruthven site.','Anna Unger','Office Manager'),
('bkmalott@edge-point.com','Leamington','I saw Edge Point’s business communications work and Leamington contact details. I’m reaching out about office furniture moves when your own workspace changes.'),
('generalinformation@aswecare.com','2135 Richmond','I found your Windsor office on Richmond Street. I’d like to introduce a local contact for office furniture transfers and workspace changes for your team.'),
('leamington@erieshoreseyecare.com','225 Erie Street South','I found the dedicated contact for your Erie Street South office in Leamington. I’m reaching out about office and waiting-area furniture moves at the clinic.'),
('dimennachiropractic@gmail.com','245 Talbot','I saw your Talbot Street West clinic contact details. If office or waiting-area furniture needs moving, I’d like your team to have a local contact.'),
('ngualtieri@countereffects.ca','2 Iroquois','I saw Counter Effects’ Iroquois Road location in Leamington. I wanted to introduce a moving contact for office furniture transfers around your own workspace.'),
('luca@policellaplumbing.com','founder, Luca Policella','I saw the story of how you started Policella Plumbing and your Oak Street West location. I’d like to introduce a local contact for office furniture moves around your own site.','Luca Policella','Founder'),
('sunparlor@cogeco.net','135 talbot','I found Sun Parlor Motel’s Talbot Street West contact details. I wanted to introduce our team for ordinary furniture transfers when a room or workspace changes.'),
('store438@theupsstore.ca','54 Erie Street South','I found the direct contact for your Erie Street South store in Leamington. If a customer’s move includes furniture beyond their parcels, I’d like to be a local contact your team can point them to.'),
('leamingtonvetclinic@windsoressexvets.ca','110 Talbot','I found the dedicated contact for your Leamington clinic on Talbot Street. I’m reaching out about office and waiting-area furniture transfers when the workspace changes.'),
('john@kingsvillebrewingco.ca','140 Park','I saw Kingsville Brewery’s Park Street location. I’m reaching out about ordinary furniture moves around your office or guest space.'),
('eddiessportsbar@hotmail.com','319 Erie','I found Eddie’s Erie Street South location in Leamington. I wanted to introduce a local moving contact for ordinary furniture transfers when your space changes.'),
('atease@cogeco.net','354 Manning','I saw At Ease’s Manning Road store. If office or ordinary furniture needs moving as the workspace changes, I’d like your team to know a local contact.'),
('ldasfair@gmail.com','Our mailing address','I found the Agricultural Society’s public contact details through the Leamington Chamber. I’d like to introduce our team for office and ordinary furniture transfers around your facilities.'),
('halfcenturycentre@cogeco.net','160 Talbot Street East','I saw the Centre’s Talbot Street East location. I wanted to introduce our team for office and ordinary furniture moves when the space needs rearranging.'),
('windsor@proax.ca','440 Advance Boulevard','I found Proax’s dedicated Windsor branch contact on Advance Boulevard. I’m reaching out about office furniture transfers at your local site.'),
('jfidalgo@bxfii.com','Justin Fidalgo President','Your team page lists you as BXF’s president. I’d like to introduce a moving contact for office furniture transfers and workspace changes.','Justin Fidalgo','President'),
('tharris@harrismc.com','Let’s see how we can work together','I found Harris Marketing Communications’ business contact page. I wanted to introduce our team for office furniture moves when your workspace changes.'),
('coreplugs@mercprod.com','439 Jutras Drive','I found the dedicated contact for Mercury’s Jutras Drive facility in Windsor. I’m reaching out specifically about office furniture moving support at that site.'),
('sales@sharpedgetool.com','5140 Halford','I saw Sharp Edge Tool’s Halford Drive location in Oldcastle. I’d like to introduce a local contact for office furniture transfers at the site.'),
('sales@baronrings.com','CHAMPIONSHIP','I came across Baron’s championship ring business in the Windsor–Essex directory. I’m reaching out about moving support for your own office furniture and workspace changes.'),
]
if '--spec-file' in sys.argv:specs=json.loads(Path(sys.argv[sys.argv.index('--spec-file')+1]).read_text())
reviews=[]
for f in ['company-publication-deep-review.jsonl','company-publication-retry-review.jsonl','company-contact-deeper-review.jsonl']:
 reviews+=list(map(json.loads,(S/f).read_text().splitlines()))
reviews+=list(map(json.loads,(E/'company-site-reviews.jsonl').read_text().splitlines()))
extra=E/'deeper-site-reviews.jsonl'
if extra.exists():reviews+=list(map(json.loads,extra.read_text().splitlines()))
plan={r['id']:r for r in json.loads((S/'live-send-preflight.json').read_text())['rows']};accounts={r['expansion_id']:r for r in json.loads((E/'normalized-chamber-accounts.json').read_text())};release=json.loads((S/'published-company-expanded-release.json').read_text());existing={r['to'].lower() for r in release['initial']};validation={r['email']:r for r in map(json.loads,(P/'email-verification/aws-validation-results.jsonl').read_text().splitlines())};candidates=[];held=[]
for spec in specs:
 email,phrase,opening,*person=spec
 if email in existing:continue
 evidence=next((r for r in reversed(reviews) if any(email in pg['emails'] for pg in r['pages']) and any(phrase.lower() in pg['text'].lower() for pg in r['pages'])),None)
 if not evidence:held.append({'email':email,'reason':'source_phrase_or_email_missing'});continue
 if any(re.search(r'no solicit|unsolicited (commercial|sales|marketing)',pg['text'],re.I) for pg in evidence['pages']):held.append({'email':email,'reason':'solicitation_notice_review'});continue
 page=next(pg for pg in evidence['pages'] if email in pg['emails']);context=next(pg for pg in evidence['pages'] if phrase.lower() in pg['text'].lower());ident=evidence.get('id',evidence.get('expansion_id'));a=accounts.get(ident)
 if ident in {x['id'] for x in release['initial']}:held.append({'email':email,'reason':'existing_account_release_id'});continue
 if a:
  r={'id':ident,'account_id':ident,'account_name':a['name'],'city':next((c for c in ['Amherstburg','Leamington','Kingsville','Windsor','Oldcastle','Essex','Tecumseh'] if c.lower() in a['address'].lower()),'Windsor–Essex'),'website':a['website'],'source_categories':a.get('category','Chamber member'),'source_url':a['source_url'],'physical_address':a['address'],'address_status':'directory_source; print_review_pending'}
 else:r=dict(plan[ident])
 r.update(to=email,publication_source=page['resolved_url'],context_source=context['resolved_url'],publication_checked_at=evidence['checked_at'],reviewed_phrase=phrase,reviewed_opening=opening,confirmed_person=person,validation=validation.get(email));candidates.append(r)
(O/'candidates.json').write_text(json.dumps(candidates,indent=2));(S/'recovery-validation-candidates.json').write_text(json.dumps([r['to'] for r in candidates],indent=2))
if '--prepare' in sys.argv:
 new=[]
 for r in candidates:
  v=r['validation']
  if not v or v['overall']=='LOW' or v['mailbox']=='LOW' or v['status']=='hold_risk':held.append({'email':r['to'],'reason':'validation_hold'});continue
  person=r.pop('confirmed_person');name=person[0] if person else None;role=person[1] if person else 'Company-published business contact — routing inquiry';variant='A' if int(hashlib.sha256(r['id'].encode()).hexdigest()[:8],16)%2==0 else 'B'
  question='Is there a supplier process we should follow to be considered when this kind of moving work comes up?' if variant=='A' else 'Who would be the best person to speak with about this kind of moving support?'
  opening=r.pop('reviewed_opening');service='We handle packing, loading, transport and placement for office moves and ordinary furniture transfers. We review the items, access and timing before quoting.'
  if r['to'] in ['sharron.carr@migroup.ca','store438@theupsstore.ca']:service='We handle local household and furniture moves, including packing, loading, transport and placement. We review the scope and access before quoting.';question='Would it be useful to have our details on hand for a client who asks about a local mover?'
  # Sector-specific need and an easy reply; retain the exact experiment angle.
  email=r['to']; sector='office'
  if email in ['aburgmission@yahoo.com','office@gibsongallery.org','generalinformation@aswecare.com','ldasfair@gmail.com','halfcenturycentre@cogeco.net']:sector='community'
  elif email in ['mail@royalsushihouse.com','thesaltydoginfo@gmail.com','sunparlor@cogeco.net','john@kingsvillebrewingco.ca','eddiessportsbar@hotmail.com']:sector='hospitality'
  elif email in ['leamington@erieshoreseyecare.com','dimennachiropractic@gmail.com','leamingtonvetclinic@windsoressexvets.ca']:sector='clinic'
  elif email in ['powerdistributionsupply@gmail.com','contactus@sunsetgrown.com','anna@southwestdiesel.ca','ngualtieri@countereffects.ca','luca@policellaplumbing.com','windsor@proax.ca','jfidalgo@bxfii.com','coreplugs@mercprod.com','sales@sharpedgetool.com']:sector='industrial'
  if sector=='community':
   service='If tables, chairs or office furniture need to move between rooms or sites, we can quote that smaller job too. The idea is to give your team a moving contact before something needs arranging.'
   question='Do you keep a list of outside movers for those jobs, or is there someone on your team I should introduce myself to?' if variant=='A' else 'Does your team usually handle those furniture moves internally, or bring in a mover?'
  elif sector=='hospitality':
   service='A few tables, chairs or room furnishings can still be a job to coordinate. We can quote those smaller transfers as well as a larger furniture move, with access and timing agreed first.'
   question='Is there a process for adding a local mover to your supplier contacts?' if variant=='A' else 'When furniture needs moving, does your site manager arrange it or does that go through someone else?'
  elif sector=='clinic':
   service='We can help with desks, chairs and waiting-room furniture when the office needs rearranging or moving. We would agree the items, access and timing with the practice first.'
   question='Would your office manager be the right person to ask about becoming a moving-service contact?' if variant=='A' else 'Are furniture moves handled by your office team, or do you use an outside mover?'
  elif sector=='industrial':
   service='I’m John with Saturn Star Movers. The work I have in mind is desks, chairs and office furniture when a team changes space. We can quote a small internal move or a transfer between sites.'
   service=service.removeprefix('I’m John with Saturn Star Movers. ')
   question='Is there a vendor registration step for that work, or can the local site arrange it directly?' if variant=='A' else 'Who normally arranges office furniture moves at your site—operations, facilities or the office manager?'
  elif email not in ['sharron.carr@migroup.ca','store438@theupsstore.ca','fortmalden@pc.gc.ca']:
   service='We can help with the smaller jobs too: desks and chairs moving between rooms, furniture going into storage, or a full office move. We agree the scope and access before quoting.'
   question='Would it be useful to keep a local mover on your supplier list for those jobs?' if variant=='A' else 'Do you already have a go-to mover for office furniture, or is that something your team arranges as needed?'
  if email=='fortmalden@pc.gc.ca':
   opening='I found Fort Malden’s site contact for 100 Laird Avenue in Amherstburg. I’d like to understand how a local mover can be considered for office furniture transfers at the site.'
   service='We handle packing, transport and placement of ordinary office furniture, with the scope and site access agreed before quoting.'
   question='Does that go through a Parks Canada vendor process, or a facilities contact at Fort Malden?'
  r['experiment_id']='windsor-recovery-v2-specific-need';r['experiment_sector']=sector;r['experiment_angle']='supplier-route' if variant=='A' else 'current-process'

  body='\n\n'.join(['Hi '+name.split()[0]+',' if name else 'Hello '+r['account_name']+' team,',opening,'I’m John with Saturn Star Movers. '+service,question,'Thank you,\nJohn Owolabi\nSaturn Star Movers\nbusiness@starmovers.ca | (226) 773-2993\nhttps://starmovers.ca\n3608 Seminole Street, Unit 3\nWindsor, ON N8Y 1Y4, Canada','If you prefer no further emails from me, just reply and let me know.'])
  r.update(body=body,subject='Moving support for your team',variant=variant,recipient_name=name or r['account_name']+' — Business contact',recipient_role=role,sending_basis={'type':'company_published_email','source':r['publication_source'],'role_relevance':role,'reviewed_evidence':r['reviewed_phrase']},holds=[],status='prepared_for_live_send_check');new.append(r)
 release['initial']+=new;assert len({r['to'].lower() for r in release['initial']})==len(release['initial']);(S/'published-company-expanded-release.json').write_text(json.dumps(release,indent=2,ensure_ascii=False));(O/'release.json').write_text(json.dumps({'initial':new,'held':held},indent=2,ensure_ascii=False));(O/'proofs.html').write_text('<!doctype html><meta charset="utf-8">'+''.join('<article><h2>'+html.escape(r['account_name'])+'</h2><p>'+html.escape(r['to'])+'</p><pre>'+html.escape(r['body'])+'</pre></article>' for r in new));print(json.dumps({'prepared':len(new),'held':held}))
else:print(json.dumps({'candidates':len(candidates),'held':held}))
