"""Produce source-backed first-touch copy and coordinated follow-on drafts. No sends."""
import csv, json, html, base64
from pathlib import Path
P=Path('partnership-system/markets/ca/on/windsor-essex/runs/2026-09-15/priority-enrichment')
accounts=json.loads((P/'reviewed-account-plan.json').read_text())
register=json.loads((P/'crm-register.json').read_text())
routes=register['contacts']
bulk=list(csv.DictReader((P.parent/'volume-experiment/account-review-queue.csv').open()))
data=[
('caesars-windsor','procurement@caesarswindsor.com','Hello Procurement team,','Your Windsor supplier information page invites prospective vendors to introduce their services.','A'),
('integram-windsor-seating','naindirectsuppliers@magna.com','Hello Indirect Suppliers team,','Magna’s supplier page directs service introductions to your team. I’m getting in touch specifically about local moving support for Integram Windsor Seating.','B'),
('flex-n-gate','purchasing@flexngate.com','Hello Purchasing team,','Your North America contact page lists this inbox for purchasing. I’d like to understand the local route for office and furniture moving services at your Windsor-area operations.','A'),
('centerline-windsor','clpurchasing@cntrline.com','Hello Purchasing team,','CenterLine’s contact page directs supplier inquiries to your team. I’d like to introduce a nearby option for office and furniture transfers at your Windsor operation.','A'),
('university-of-windsor','dario.pavia@uwindsor.ca','Hi Dario,','The university directory lists you as a Buyer. I’d like to understand who covers outside office and furniture moving services for the Windsor campus.','B'),
('city-of-windsor','purchasing@citywindsor.ca','Hello Purchasing team,','I’m reviewing the City’s purchasing information so we can follow the right process for future office and furniture moving requests.','A'),
('county-of-essex','procurement@countyofessex.ca','Hello Procurement team,','The County’s procurement page lists your team as the contact for purchasing inquiries. I’d like to understand how office and furniture moving requests are coordinated.','B'),
('greater-essex-county-district-school-board','purchasingdept@publicboard.ca','Hello Purchasing team,','Your purchasing page asks prospective vendors to contact this inbox for a Vendor Application Form. I’m getting in touch about office and furniture moving services.','A'),
('windsor-essex-catholic-district-school-board','sarah_livingston@wecdsb.on.ca','Hi Sarah,','The board’s Business Department page lists you as the Supervisor of Purchasing Administration. I’d like to introduce our team for future office and furniture moving needs in Windsor–Essex.','B'),
('highline-mushrooms','info@highlinemushrooms.com','Hello Highline team,','Your contact page lists operations in Leamington and Kingsville. I’m trying to find the colleague who arranges office and furniture moving support for those local sites.','B')]
drafts=[]
signature='John Owolabi\nSaturn Star Movers\nbusiness@starmovers.ca | (226) 773-2993\nhttps://starmovers.ca\n\nIf you prefer no further emails from me, just reply and let me know.'
for key,email,greeting,fact,variant in data:
 a=next(a for a in accounts if a['key']==key)
 r=next(r for r in routes if r['account_key']==key and r['email']==email)
 matched=[x for x in bulk if x['company_group'] in a['domains']]
 if matched:
  assert len({x['variant'] for x in matched})==1
  variant=matched[0]['variant']
 question=('Could you point me to the process for being considered for this type of moving work?' if variant=='A' else 'Does your team coordinate these services, or is there a colleague you would recommend I introduce myself to?')
 if key=='greater-essex-county-district-school-board':question='Could you send me the Vendor Application Form and let me know which category covers these services?'
 if key=='university-of-windsor':question='Do you cover this service category, or would you point me to the colleague who does?'
 if key=='highline-mushrooms':question='Who would be the best person to introduce myself to about those services?'
 body='\n\n'.join([greeting,fact,'I’m John with Saturn Star Movers. We help businesses in Windsor–Essex with packing, loading, transport and placement for office and furniture moves, including smaller transfers.',question,'Thank you,\n'+signature])
 company_id=next(x['company_id'] for x in register['accounts'] if x['key']==key)
 drafts.append(dict(id='windsor-personalized-v1:'+key,account_key=key,account_name=a['name'],company_id=company_id,contact_id=r['crm_contact_id'],to=email,recipient_name=r['name'],role=r['title'],role_type='named' if ' — ' not in r['name'] else 'department',variant=variant,angle='vendor_process' if variant=='A' else 'relevant_colleague',subject='Moving support for your team',body=body,context_fact=fact,context_source=r['source_url'],context_checked_at='2026-09-15',mailbox_status='not_verified',status='prepared_not_sent',release_holds=['mailbox_verification','fresh_account_timeline_and_suppression','sending_basis_record','confirmed_sender_mailing_footer','delivery_bounce_and_reply_workflow_validation'],supersedes_bulk_ids=[x['draft_id'] for x in matched if x['draft_id']]))

secondary=[]
for key,email,context,question in [
 ('university-of-windsor','melissav@uwindsor.ca','The university residence team page lists you as Facilities and Operations Manager.','When residence furniture needs moving, does your team arrange outside movers directly, or does that go through central facilities?'),
 ('windsor-essex-catholic-district-school-board','meagan_adams@wecdsb.on.ca','The board’s facilities page lists you as Senior Manager of Facilities Services.','When a few offices or furniture items need moving, does your team arrange outside movers directly, or does purchasing coordinate that?'),
 ('integram-windsor-seating','nalogistics@magna.com','Magna lists this inbox for North America logistics supplier inquiries.','Does local office and furniture moving support for Integram Windsor Seating fall within your team’s scope, or should it stay with indirect purchasing?')]:
 r=next(r for r in routes if r['account_key']==key and r['email']==email)
 primary=next(d for d in drafts if d['account_key']==key)
 greeting='Hello Logistics team,' if key=='integram-windsor-seating' else 'Hi '+r['name'].split()[0]+','
 secondary.append(dict(account_key=key,company_id=primary['company_id'],contact_id=r['crm_contact_id'],to=email,role=r['title'],variant=primary['variant'],subject='Local office and furniture moving support',body='\n\n'.join([greeting,context,'I’m John with Saturn Star Movers. We help with office and furniture moves in Windsor–Essex, including smaller transfers.',question,'Thank you,\n'+signature]),context_source=r['source_url'],status='held_follow_on_not_scheduled',activation='Use only after a relevant introduction or coordinated account review. Do not add to the V1 one-recipient experiment without recording the changed exposure.'))

manifest=dict(version='windsor-personalized-v1',status='prepared_not_sent',initial=drafts,secondary=secondary,notes='Operational pilot with role-specific questions; counts do not establish a statistically controlled winner. Existing bulk assignments preserved where matched. All initial copy needs sender mailing footer and release holds resolved.')
(P/'personalized-release.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False))
logo=base64.b64encode(Path('public/brand/saturn-star-horizontal-full-color.png').read_bytes()).decode()
esc=html.escape
cards=[]
for d in drafts+secondary:
 title=d.get('account_name',d['account_key'])
 cards.append(f'<article><h2>{esc(title)}</h2><p><b>To:</b> {esc(d["to"])}<br><b>Role:</b> {esc(d["role"])}<br><b>Status:</b> {esc(d["status"])}</p><h3>{esc(d["subject"])}</h3><div class="email">{esc(d["body"])}</div><p class="source"><a href="{esc(d["context_source"],quote=True)}">Context source</a> · Internal proof: sender mailing footer and release checks remain outstanding.</p></article>')
page='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Windsor relationship email proofs</title><style>body{font:16px/1.6 Arial,sans-serif;background:#f3f4f6;color:#17212b;margin:0}main{max-width:900px;margin:auto;padding:32px}header{border-bottom:3px solid #c99700;padding:20px 0}img{width:240px;max-width:100%}article{background:white;padding:28px;margin:24px 0;border-radius:8px;border:1px solid #ddd;break-inside:avoid}h1,h2{color:#071421}h2{font-size:22px}.email{white-space:pre-wrap;max-width:650px}.source{font-size:13px;color:#555}a{color:#715500}@media print{body{background:white}article{break-before:page;border:0}main{padding:0}}</style></head><body><main><header><img alt="Saturn Star Movers" src="data:image/png;base64,'+logo+'"><h1>Windsor relationship outreach</h1><p>10 personalized initial drafts · 3 held follow-on drafts · No prospect sends</p></header>'+''.join(cards)+'</main></body></html>'
(P/'personalized-email-proofs.html').write_text(page)
assert len(drafts)==10 and len({d['company_id'] for d in drafts})==10
assert all(d['context_source'].startswith('https://') for d in drafts+secondary)
print(json.dumps({'initial_drafts':len(drafts),'held_follow_on':len(secondary),'A':sum(d['variant']=='A' for d in drafts),'B':sum(d['variant']=='B' for d in drafts),'superseded_bulk_drafts':sum(len(d['supersedes_bulk_ids']) for d in drafts),'sent':0}))
