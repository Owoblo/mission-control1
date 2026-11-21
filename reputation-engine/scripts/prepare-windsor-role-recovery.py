"""Manually reviewed published routing contacts; preserves prior copy and receipts."""
import json,html
from pathlib import Path
P=Path('partnership-system/markets/ca/on/windsor-essex/runs/2026-09-15');S=P/'send-release'
release=json.loads((S/'published-company-expanded-release.json').read_text())
reviews={r['id']:r for r in map(json.loads,(S/'company-publication-deep-review.jsonl').read_text().splitlines())}
retry=S/'company-publication-retry-review.jsonl'
if retry.exists():reviews.update({r['id']:r for r in map(json.loads,retry.read_text().splitlines()) if r['pages']})
deeper=S/'company-contact-deeper-review.jsonl'
if deeper.exists():reviews.update({r['id']:r for r in map(json.loads,deeper.read_text().splitlines())})
plan={r['id']:r for r in json.loads((S/'live-send-preflight.json').read_text())['rows']}
validation={r['email']:r for r in map(json.loads,(P/'email-verification/aws-validation-results.jsonl').read_text().splitlines())}
# Exact evidence phrase, researched opening, and optional confirmed person's name/role.
selected={
'sales@greencityplastics.com':('1555 Kildare Road','I saw Green City Plastics’ Kildare Road location in Windsor. When the office or shared workspace needs furniture moved, I’d like your team to have a local contact.'),
'sales@windsortestsolutions.com':('1512 Westminster','I saw your Westminster Avenue location and your work in test engineering. I’m reaching out about office and furniture moves around your workspace.'),
'enzo@gennarocoffeeco.com':('Or contact us directly','Your website lists this address for reaching your team directly. I wanted to introduce a moving contact for furniture transfers or changes around the café.'),
'orders@silverstitch.ca':('1304 Lauzon','I saw Silver Stitch’s print and design operation on Lauzon Road. If a workspace rearrangement or furniture transfer comes up, I’d like your team to know a local mover.'),
'sales@timberwolfgroup.com':('7781 Howard','I saw TimberWolf’s Howard Avenue location in McGregor. I’m reaching out about the office and furniture side of site changes.'),
'sales@sherdil.com':('447 Silver Creek','I found Sherdil’s Silver Creek Industrial Drive location in Tecumseh. I’d like to introduce our team for office reshuffles and furniture transfers at the site.'),
'lowesprinting@cogeco.net':('32 ARTHUR','I saw Lowes Printing’s Arthur Avenue location in Essex. When a workspace changes, having a local contact for packing and furniture transfers can make the smaller moves easier to arrange.'),
'crsinc@mnsi.net':('3685 County Road','I saw Century Railing’s County Road 42 location and Southern Ontario service area. I’d like to introduce a local moving contact for office furniture transfers around your own site.'),
'alex@royalabrasives.com':('President: Alex Hadadean','Your website lists you as Royal Abrasives’ president and shows the Holden Avenue office in Windsor. I wanted to introduce our team for office moves and furniture transfers.','Alex Hadadean','President'),
'infowindsor@nsaero.com':('Windsor Facility','I found the dedicated Windsor facility contact on Northstar’s website. I’m reaching out specifically about office furniture moves at your East Pike Creek Road site.'),
'customerservice@wintex.ca':('635 Tecumseh','I saw Windsor Textiles’ Tecumseh Road West location. I’d like your team to have a local moving contact for office changes or furniture transfers.'),
'maya@dldtransportation.com':('13300 Tecumseh','I saw DLD’s Tecumseh Road East office contact details. I’m introducing our local moving team for office furniture transfers or a workspace move.'),
'dave@jakeswindsorbrew.com':('Store email','Your website lists this as the store contact for Jake’s on Howard Avenue. I wanted to introduce a local moving contact for furniture transfers when the workspace changes.'),
'service@ivesinsurance.com':('Essex - Head Office','I saw that Ives has an Essex head office and a Lakeshore location. If furniture ever needs to move between offices, I’d like your team to know a local contact.'),
'canada@mold-tech.com':('2221 Ambassador','I found the Canadian site contact for Standex Engraving Mold-Tech on Ambassador Drive. I’m reaching out about office furniture moves at the Windsor site.'),
'stmichaelmachine@gmail.com':('674 North Service','I saw St. Michael Machine’s North Service Road East location. I’d like to introduce our team for office furniture transfers when the workspace changes.'),
'results@ramstar.net':('Guelph Office','I saw Ramstar lists both an Oldcastle headquarters and a Guelph office. I’d like to introduce a moving contact for office furniture transfers or workspace changes.'),
'printing@prioritygroup.ca':('4530 Rhodes','I found Priority’s Windsor location on Rhodes Drive. I wanted to introduce a local mover for office and furniture transfers when your workspace needs change.'),
'sales@blackstonesport.com':('1919 Setterington','I saw Blackstone’s Setterington Drive location in Kingsville. I’m reaching out about office furniture moves and smaller workspace changes at your site.'),
'sales@stdwi.com':('5175 Hennin','I saw Saturn Tool & Die’s Hennin Drive location in Oldcastle. I’d like to introduce our moving team for office and furniture transfers at the site.'),
'sales@windsorindustrial.com':('5015 8th Concession','I found Windsor Industrial Services’ Maidstone site on 8th Concession Road. I’m introducing our team for office furniture transfers and workspace changes.'),
'sales@anderdontool.com':('5170 Ure','I saw Anderdon Tool’s Ure Street location in Oldcastle. I’d like to introduce a local moving contact for office reshuffles and furniture transfers.'),
'sales@crestmold.com':('2055 Blackacre','I saw Crest Mold’s Blackacre Drive location in Oldcastle. I’m reaching out about office and furniture moves when your team changes its workspace.'),
'hmc@hallergroup.ca':('1537 McDougall','I found Haller Mechanical’s McDougall Street office. I’d like to introduce a moving contact for your own office or furniture transfers around a workspace change.'),
'store362@theupsstore.ca':('1690 Huron Church','I found the direct contact for your Huron Church Road store. If a customer’s move involves furniture beyond their parcels, I’d like your team to have a local moving contact.'),
'lmcustommachining@gmail.com':('4 Sutton Drive','I saw L&M Custom Machining’s Sutton Drive location in Leamington. I’m introducing our team for office furniture transfers or workspace changes.'),
'windsor@renaperson.com':('3200 Deziel','I saw Renaissance Personnel’s Windsor office on Deziel Drive, alongside your other Ontario locations. If your office team needs furniture moved, I’d like to be a local contact.'),
'mpdinfo@mpdweldingltd.com':('Canada Office','Your contact page distinguishes MPD’s Michigan office from the Canadian office on Twin Oaks Drive. I’m reaching out specifically about office furniture moving support for the Windsor site.'),
'fmindustries1990@live.com':('2080 Ferriss','I saw FM Industries’ Ferriss Road location in Harrow. I’d like to introduce our team for office furniture moves and smaller workspace changes.'),
}
extra=S/'additional-reviewed-contacts.json'
if extra.exists():selected.update(json.loads(extra.read_text()))
existing={r['to'] for r in release['initial']};added=[];held=[]
for h in release['held']:
 email=h['to']
 if email not in selected or email in existing:held.append(h);continue
 ev=reviews[h['id']];spec=selected[email];page=next((p for p in ev['pages'] if email in p['emails']),None)
 if not any(spec[0].lower() in p['text'].lower() for p in ev['pages']):raise ValueError('Missing context evidence '+email)
 if not page:raise ValueError('Missing reviewed evidence '+email)
 v=validation.get(email)
 if not v or v['overall']=='LOW' or v['mailbox']=='LOW' or v['status']=='hold_risk':held.append({**h,'reasons':['delivery_research']});continue
 r=dict(plan[h['id']]);name=spec[2] if len(spec)>2 else r['account_name']+' team';role=spec[3] if len(spec)>3 else 'Company-published business contact — routing inquiry'
 service='We handle packing, loading, transport and placement for office moves and furniture transfers. We review the scope, access and timing before quoting.'
 if email=='store362@theupsstore.ca':service='We handle local furniture and household moves, including packing, loading, transport and placement. We review the scope and access before quoting.'
 question='Is there a supplier process we should follow to be considered when this kind of work comes up?' if r['variant']=='A' else 'Who would be the best person to speak with about this kind of moving support?'
 body='\n\n'.join(['Hi '+spec[2].split()[0]+',' if len(spec)>2 else 'Hello '+r['account_name']+' team,',spec[1],'I’m John with Saturn Star Movers. '+service,question,'Thank you,\nJohn Owolabi\nSaturn Star Movers\nbusiness@starmovers.ca | (226) 773-2993\nhttps://starmovers.ca\n3608 Seminole Street, Unit 3\nWindsor, ON N8Y 1Y4, Canada','If you prefer no further emails from me, just reply and let me know.'])
 r.update(to=email,body=body,subject='Moving support for your team',recipient_name=name,recipient_role=role,validation=v,publication_source=page['resolved_url'],publication_checked_at=ev['checked_at'],context_source=page['resolved_url'],sending_basis={'type':'company_published_email','source':page['resolved_url'],'no_solicitation_notice_found':False,'role_relevance':role,'reviewed_evidence':spec[0]},status='prepared_for_live_send_check',holds=[])
 added.append(r);existing.add(email)
release['initial']+=added;release['held']=held
(S/'published-company-expanded-release.json').write_text(json.dumps(release,indent=2,ensure_ascii=False))
(S/'role-recovery-proofs.html').write_text('<!doctype html><meta charset="utf-8"><title>Reviewed role recovery</title>'+''.join('<article><h2>'+html.escape(r['account_name'])+'</h2><p>'+html.escape(r['to'])+'</p><pre>'+html.escape(r['body'])+'</pre><p>'+html.escape(r['publication_source'])+'</p></article>' for r in added))
print(json.dumps({'added':len(added),'remaining_holds':len(held),'total_release':len(release['initial']),'recipients':[r['to'] for r in added]}))
