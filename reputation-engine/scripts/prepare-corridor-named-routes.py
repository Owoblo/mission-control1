"""Exact publicly reviewed nonstandard/local/named contact routes. No sends."""
import json,hashlib,re,sys
from pathlib import Path
P=Path('partnership-system/markets/ca/on/windsor-kitchener/runs/2026-09-15');W=Path('partnership-system/markets/ca/on/windsor-essex/runs/2026-09-15');S=W/'send-release';O=P/'named-01';O.mkdir(exist_ok=True)
specs=[
('liz@themyrtlemarket.ca','happy to answer your questions','I found The Myrtle’s Chatham business contact. I’d like to introduce a moving contact for ordinary furniture transfers around the shop.'),
('johnf@phoenixconsultgroup.com','Managing Partner','I saw that you are Phoenix Consulting’s managing partner. I’m reaching out about office furniture moves when your team changes space.','John F. Paquette','Managing Partner'),
('cs@jlincometaxandaccounting.ca','272 Park Ave','I found your Park Avenue West office contact in Chatham. I’d like to introduce a contact for the smaller office furniture jobs as well as a full move.'),
('store1063@applestorage.com','7 Industrial','I found the dedicated contact for your Industrial Street storage location in Chatham. If a customer needs help getting furniture into or out of storage, I’d like to be a moving contact your team can point them to.'),
('frank@3dgutter.com','Serving South Western Ontario','I saw your Southwestern Ontario service area. I’m reaching out about the office furniture side of changes at your own workspace.'),
('gdeliberato@thrivebusinesssolutions.ca','CONTACT US FOR A PERSONAL CONSULTATION','I came across Thrive’s business consulting work through the Chatham-Kent Chamber. I’d like to introduce a moving contact for your own office furniture transfers.'),
('tobie@reimstoneinteriors.ca','940 Richmond','I found Reimstone’s Richmond Street warehouse contact in Chatham. I’m reaching out about office furniture moves and the furniture-moving part of workspace changes.'),
('service@impactgraphicsandsigns.ca','7 Industrial','I saw Impact Graphics’ Industrial Street location in Chatham-Kent. I wanted to introduce a contact for office furniture transfers around your own workspace.'),
('jeff@canadianterminsurance.ca','Jeffrey Comiskey','I found your King Street West office contact in Chatham. I’d like to introduce a moving contact for the smaller office furniture jobs.','Jeffrey Comiskey','Published insurance business contact'),
('brian.plaskett@20-20hseconsulting.com','309 Southdale','I found your Southdale Road business contact in London. I’m reaching out about furniture transfers when your own office space changes.'),
('email@andersonselectronics.com','London, ON N6H','I found Anderson’s Electronics’ London contact details. I’d like to introduce a moving contact for ordinary office furniture transfers.'),
('brandon@corporatecleanerscanada.ca','Locally owned and operated','I saw Corporate Cleaners’ London operation. If a client also needs furniture moved before a workspace handover, I’d like to be a contact for that part.'),
('london@countrypaws.com','2206 Bradley','I found your Bradley Avenue location in London. I’m reaching out about office and ordinary furniture transfers when your workspace changes.'),
('london.admin@couriersplus.ca','300 EXETER ROAD','I found the dedicated London administration contact on Exeter Road. I’d like to understand whether furniture-moving work ever needs an outside crew alongside the jobs your team coordinates.'),
('andrea@dunnaudiology.ca','email Andrea directly','I found Dunn Audiology’s direct business contact. I’m reaching out about desks, chairs and waiting-area furniture when your clinic changes space.'),
('help@falconsightaccountinginc.ca','Contact Email','I found FalconSight’s London-area business contact. I wanted to introduce a moving contact for office furniture when the workspace changes.'),
('plobo@gplmachine.com','GET IN TOUCH','I found GPL’s Sovereign Road contact details in London. I’m reaching out specifically about office furniture moves at your site.'),
('rob@hickoryridge.ca','General Inquiries','I found Hickory Ridge’s general inquiries contact for the Woodhull Road club. I’d like to introduce a contact for ordinary furniture moves around your office or shared spaces.'),
('ask@infoplacecanada.ca','380 Wellington','I found your Wellington Street office contact in London. I’m reaching out about office furniture transfers when your own workspace changes.'),
('questions@jillsjunkremoval.com','Commercial Services','I saw that Jill’s handles both commercial and household junk removal. If a client needs furniture moved to another space or storage, I’d like to be a contact for that part.'),
('london@jlrichards.ca','380 Wellington Street','I found J.L. Richards’ dedicated London office contact on Wellington Street. I’d like to introduce a moving contact for the furniture side of workspace fit-outs.'),
('literacylink@llsc.on.ca','647 Wilton Grove','I found Literacy Link South Central’s Wilton Grove Road contact. I’m reaching out about office or training-room furniture transfers when your spaces change.'),
('newhomes@lhba.on.ca','680 Waterloo','I found the Association’s Waterloo Street contact. I’d like to understand the appropriate way to introduce our furniture-moving support to your builder network.'),
('ltc@londontransit.ca','450 Highbury','I found London Transit’s Highbury Avenue office contact. I’d like to understand the supplier route for ordinary office furniture transfers at your facilities.'),
('jonah@melvillemortgages.ca','Jonah Melville, Mortgage Broker','I found your mortgage practice’s business contact. When a client asks about movers around their closing, I’d like to be a contact you can point them to.','Jonah Melville','Mortgage Broker'),
('musiccentral@musiccentral.ca','1496 Dundas','I found Music Central’s Dundas Street contact. I’m reaching out about ordinary office furniture moves at your own workspace.'),
('secretary@nalaweb.ca','141 Dundas','I found the Association’s office contact at the Skill Centre on Dundas Street. I wanted to introduce a contact for ordinary office furniture transfers.'),
('sigma@sigmaassessmentsystems.com','Contact Us Canada','I came across SIGMA through the London Chamber. I’m reaching out about furniture transfers when your own office workspace changes.'),
('paul@starlightdjservices.ca','9 Starlight Lane','I found Starlight’s Dorchester contact details. I wanted to introduce a moving contact for ordinary office furniture transfers at your own workspace.'),
('sbm@sbmltd.ca','Kitchener Office','I saw SBM lists both London and Kitchener offices. I’d like to introduce a contact for office furniture transfers or the moving part of workspace fit-outs.'),
('courtney@teamdeblock.com','Courtney De Block Sales Representative','I saw that your role combines real estate and operations for Team DeBlock. If a client asks about movers around their closing, I’d like to be a contact you can point them to.','Courtney De Block','Sales Representative & Director of Operations'),
('getintouch@techdoz.ca','Email Address','I found Techdoz’s business contact through the London Chamber. I’m reaching out about the furniture-moving side of your own office changes.'),
('meghan@thechefshat.ca','4026 Meadowbrook','I found The Chef’s Hat’s Meadowbrook Drive contact. I’m reaching out about ordinary furniture transfers when your office or workspace changes.'),
('matt@vantageproperty.ca','Property Manager Matt Diesbourg','Your contact page lists you as Vantage’s property manager. I’d like to introduce a moving contact for furniture transfers between properties or into storage.','Matt Diesbourg','Property Manager'),
('andrew@verto360.com','Andrew Lutowicz','I found your sales and business development contact at Verto360. I’d like to understand whether outside moving support could fit the furniture side of your workspace projects.','Andrew Lutowicz','Sales & Business Development'),
('gm@westhavengolf.com','Jeff Pacheco General Manager','I saw that you manage West Haven. I wanted to introduce a moving contact for ordinary furniture transfers around the clubhouse or office.','Jeff Pacheco','General Manager'),
('biz@boomintertribal.com','Deshkan Ziibiing','I found BOOM InterTribal’s published business contact. I’m reaching out about ordinary furniture transfers when your office workspace changes.'),
('csr@thebetterbincompany.com','15910 Medway','I found your Medway Road contact in Arva. If a customer needs furniture moved alongside a bin rental, I’d like to be a contact for that part of the job.'),
('frankd@rbcplacelondon.com','Frank De Pierro Facilities Manager','Your staff page lists you as RBC Place London’s facilities manager. I’d like to introduce a moving contact for ordinary furniture transfers around the venue.','Frank De Pierro','Facilities Manager')]
reviews=list(map(json.loads,(P/'company-site-reviews.jsonl').read_text().splitlines()));release=json.loads((S/'published-company-expanded-release.json').read_text());ids={r['id'] for r in release['initial']};emails={r['to'] for r in release['initial']};candidates=[];held=[]
for email,phrase,opening,*person in specs:
 if email in emails:continue
 ev=next((r for r in reviews if r['id'] not in ids and any(email in pg['emails'] for pg in r['pages']) and any(phrase.lower() in pg['text'].lower() for pg in r['pages'])),None)
 if not ev:held.append({'email':email,'reason':'exact_phrase_or_new_account_missing'});continue
 if any(re.search(r'no solicit|unsolicited (commercial|sales|marketing)',pg['text'],re.I) for pg in ev['pages']):held.append({'email':email,'reason':'solicitation_notice_review'});continue
 pg=next(pg for pg in ev['pages'] if email in pg['emails']);candidates.append({**ev,'to':email,'publication_source':pg['resolved_url'],'publication_excerpt':phrase,'local_city_mentioned_on_site':True,'reviewed_opening':opening,'person':person,'manual_source_review':True})
(O/'candidates.json').write_text(json.dumps(candidates,indent=2));(O/'holds.json').write_text(json.dumps(held,indent=2));(S/'recovery-validation-candidates.json').write_text(json.dumps([r['to'] for r in candidates],indent=2));print(json.dumps({'candidates':len(candidates),'held':held}))
