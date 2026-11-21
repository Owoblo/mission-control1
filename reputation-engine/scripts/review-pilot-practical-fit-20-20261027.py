"""Materialize 20 analyst-reviewed source findings; no sending or eligibility approval."""
import collections
import csv
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path('artifacts/partnership-pilot-3000-20261027')
# name, corrected locality, corrected sector, role/identity evidence, concrete decision,
# conditional partnership paragraph (a proposal, not an assertion of present need).
REVIEWS = [
('Revival Cleaning Services','Brantford / Hamilton / Caledonia service area','carpet_upholstery_duct_cleaning',
 'Official homepage names Revival Cleaning Services, family-operated carpet/upholstery/duct cleaning across Hamilton, Brantford, Caledonia and Six Nations. The selected Hotmail address appears in its business footer. No individual owner identity inferred.',
 'pass', 'Use Brantford and surrounding areas instead of treating inventory Brant as a street-address finding.',
 'If one of your cleaning jobs needs furniture moved or unwanted items cleared out, we would like to be the team you can call for help. I wanted to see how we could work alongside you on those jobs across Brantford and the surrounding areas.'),
('Brantford Property Management','Brantford','property_management',
 'Official contact page gives 320 Cockshutt Rd., Brantford and publishes kyle@brantfordpropertymanagement.ca as its general contact. Homepage offers property-management services. A first name in an address alone does not establish the named person or owner role.',
 'pass','Use Brantford. Contact page calls for questions generally; do not describe this mailbox as a confirmed owner.',
 'When you are getting a property ready for its next tenant, moving furniture or clearing out what has been left behind can be another thing to arrange. We would like to be a team you can rely on for that across Brantford and the surrounding areas.'),
('BeeVee Cleaning Inc.','London','residential_commercial_cleaning',
 'Official contact-page saved visible text publishes Office Manager alyssan@beeveecleaninginc.com, while selected address is alyssab@beeveecleaninginc.com. The raw extraction reports a target mailto match, creating an unresolved visible-text/href conflict. Owner Operator chelseyv@beeveecleaninginc.com is a separate published address.',
 'hold','Resolve alyssab versus alyssan before release. Alternative addresses require separate technical validation and review; do not substitute silently.',
 'If a cleaning job comes with furniture or unwanted items that need clearing out, we would like to be the team you can call for help. I wanted to see how we could work alongside you on those jobs across London and the surrounding areas.'),
('Fields Furniture & Fabrics','Burlington','furniture_upholstery_repair_refinishing',
 'Homepage and contact page publish fieldsfurn@gmail.com with 735 Griffith Ct., Burlington. Business describes custom upholstery, wood refinishing and furniture repair, not merely automotive upholstery.',
 'pass','Correct inventory auto_upholstery classification to furniture upholstery/repair. General business mailbox; no person identity inferred.',
 'If a customer needs help moving furniture to or from your workshop, we would like to be a team you can call and trust to help. I wanted to see how we could work alongside you on those jobs across Burlington and the surrounding areas.'),
('LaserClean','Ajax headquarters; selected contact Moncton, New Brunswick','industrial_laser_cleaning_equipment_rental_sales',
 'Official contact page explicitly places Allan Saulnier and Allan@LaserClean.ca under New Brunswick and describes him as based in Moncton. Header publishes sales@laserclean.ca for Ajax headquarters. Official about page describes laser cleaning and equipment, not home cleaning.',
 'hold','Wrong selected regional contact and wrong inventory sector. Consider separately validating Ajax sales@laserclean.ca; do not offer specialized machinery transport without capacity confirmation.',
 None),
('Ideal Touch Janitorial Services','Kitchener / Waterloo','commercial_janitorial',
 'Saved source identifies Ideal Touch Janitorial commercial/institutional cleaning and 118 Cedar Crest Street, Kitchener. Official contact page web read additionally exposes Contact Us linked to judy@idealtouchjanitorial.ca. Named mailbox is presented as business contact; ownership not inferred.',
 'pass','General contact route confirmed; use Hi unless person name independently established.',
 'If a commercial cleaning job needs furniture moved or unwanted items cleared out, we would like to be the team you can call for help. I wanted to see how we could work alongside you on those jobs across Kitchener and Waterloo.'),
('Rustix Studio','St Thomas / London service area','custom_furniture_tables',
 'Official about-page saved text names owners Heather and Jay Aristone. Official contact web read binds heather@rustixstudio.ca to Showroom & Design / Heather and gives St Thomas. Page and footer disagree on street number (11096 versus 11054 Sunset Dr); city is consistent.',
 'pass','Use St Thomas and the London area. Heather is supported as showroom/design contact and co-owner. Do not assert a street number or a current delivery gap.',
 'If a customer needs a hand moving a finished table or another piece of furniture, we would like to be a team you can call and trust to help. I wanted to see how we could work alongside you across St Thomas and the London area.'),
('Jay cleaning company','Toronto / GTA','window_gutter_cleaning',
 'Official page brands Jay Window Cleaning / Jay Cleaning, publishes selected Gmail address, and explicitly lists Toronto/GTA window, gutter and power washing services.',
 'pass','Use business name Jay Window Cleaning. Do not imply interior house cleaning or assume Jay is the mailbox operator.',
 'If a customer asks about moving help or clearing out unwanted items while you are working on their property, we would like to be a team you feel comfortable recommending. I wanted to see how we could support you and your customers across Toronto and the GTA.'),
('Rapid Home Service','Markham / Richmond Hill / GTA','residential_commercial_move_in_out_cleaning',
 'Official contact page publishes info@rapidhomeservice.com with Markham/Richmond Hill contact lines. Website lists residential, commercial, property maintenance and move-in/move-out cleaning.',
 'pass','Direct general business route. Move-in/out cleaning supports conditional moving/clearance angle without inventing a current need.',
 'When a move-in or move-out cleaning job also needs furniture moved or unwanted items cleared out, we would like to be the team you can call for help. I wanted to see how we could work alongside you across Markham and the surrounding areas.'),
('Elements carpet cleaning and restoration','Windsor','carpet_upholstery_cleaning',
 'Official contact page publishes elements519@live.ca with 1011 Roselawn, Windsor. Service navigation includes carpet, rug, upholstery and tile/grout cleaning. No basis to claim specialist disaster restoration work from the name alone.',
 'pass','Use carpet/upholstery cleaning context; consumer-provider mailbox is explicitly published by the business.',
 'If a cleaning job needs furniture moved or unwanted items cleared out, we would like to be the team you can call for help. I wanted to see how we could work alongside you on those jobs across Windsor and the surrounding areas.'),
('Auto Classic Trim','Windsor','furniture_and_auto_upholstery',
 'Official site uses Classic Auto Trim & Upholstery, publishes classicautotrimupholstery@gmail.com and 580 Langlois Ave., Windsor. Homepage explicitly includes furniture repairs as well as convertible tops.',
 'pass','Use Classic Auto Trim & Upholstery as business name and furniture-only angle; no vehicle transport promise.',
 'If a customer needs help moving furniture to or from your workshop for upholstery work, we would like to be a team you can call and trust to help. I wanted to see how we could work alongside you on those jobs across Windsor and the surrounding areas.'),
('Spotless Abode','Harrow / Windsor-Essex service area','exterior_pressure_washing',
 'Official site publishes spotlessabode1@gmail.com with 2218 County Rd 20 W, Harrow; lists Kingsville and other Windsor-Essex service areas. Actual services are exterior pressure washing, roofs, fences/decks and gutters.',
 'pass','Correct home_cleaning to exterior cleaning. Kingsville is a service locality, not the observed address. Use Windsor-Essex rather than claiming Kingsville headquarters.',
 'If a customer asks about moving help or clearing out unwanted items while you are working on their property, we would like to be a team you feel comfortable recommending. I wanted to see how we could support you and your customers across Windsor-Essex.'),
('Tecumseh Window Cleaning','Tecumseh / Windsor-Essex','residential_commercial_window_cleaning',
 'Official quote page visibly writes twcincrick5 at gmail dot com, matching selected address when decoded, with 346 Lakewood Crescent, Tecumseh. Services include residential, commercial and high-rise cleaning.',
 'pass','Correct inventory window_supplier to window-cleaning service. Obfuscated business contact is supported; do not infer Rick identity from mailbox.',
 'If a customer asks about moving help or clearing out unwanted items while you are working on their property, we would like to be a team you feel comfortable recommending. I wanted to see how we could support you and your customers across Tecumseh and the surrounding areas.'),
('Clean-Up!','Kitchener / Waterloo / Cambridge','commercial_janitorial',
 'Official contact page invites contact with the owners and publishes info@clean-up.ca with 127-525 Highland Road West, Kitchener. Homepage describes commercial/public building janitorial services across Waterloo region.',
 'pass','Correct gutter_service classification to janitorial. Evidence supports owner-accessible general route, but not a particular named recipient.',
 'If a commercial cleaning job needs furniture moved or unwanted items cleared out, we would like to be the team you can call for help. I wanted to see how we could work alongside you on those jobs across Kitchener, Waterloo and Cambridge.'),
("Lester's Furniture Finishing",'Scarborough / Toronto','furniture_wood_refinishing',
 'Official page publishes lestersfurniturefinishing@gmail.com with 380 Finchdene Square, Unit 18, Scarborough. Business restores furniture, cabinetry and office woodwork.',
 'pass','Correct furniture_assembly to furniture/wood refinishing. Use Scarborough rather than only broad Toronto; no assumed individual Lester identity.',
 'If a customer needs help moving furniture to or from your workshop for refinishing, we would like to be a team you can call and trust to help. I wanted to see how we could work alongside you on those jobs across Scarborough and the surrounding areas.'),
('Contrast Window Cleaning','Toronto / GTA','residential_commercial_window_cleaning',
 'Official homepage and contact section publish info@contrastwc.com as business contact; page describes commercial/storefront/residential window cleaning in Toronto and GTA.',
 'pass','General business contact supported. Conditional referral angle only; do not presume window cleaning regularly involves interior furniture clearance.',
 'If a customer asks about moving help or clearing out unwanted items while you are working on their property, we would like to be a team you feel comfortable recommending. I wanted to see how we could support you and your customers across Toronto and the GTA.'),
('CR Cleaning Pros','Kitchener / Waterloo / Cambridge / Guelph','carpet_window_eavestrough_cleaning',
 'Official site and contact footer publish admin@crcleaningpros.ca with 812 King St W, Kitchener. Services include carpet, window, eavestrough and roof cleaning across listed regional cities.',
 'pass','Admin mailbox is publicly designated business contact; do not reject due to role prefix. Use carpet-cleaning conditional context.',
 'If a carpet cleaning job needs furniture moved or unwanted items cleared out, we would like to be the team you can call for help. I wanted to see how we could work alongside you across Kitchener and the surrounding areas.'),
('Walsh Property Service','Brampton / Ontario service area','property_maintenance_janitorial',
 'Official homepage publishes info@walshpropertyservice.ca with 12 Bram Ct #13, Brampton. Lists property maintenance, janitorial, mini bins, snow/landscaping plus Employment & Service Partners navigation.',
 'pass','Correct gardener-only classification. Already offers mini bins, so frame supplemental moving help and assess its explicit service-partner process; do not invent unmet clearance need.',
 'If a property maintenance job needs furniture moved, we would like to be a team you can call and trust to help. I wanted to see how we could work alongside your team on those jobs across Brampton and the surrounding areas.'),
('Parkers of Burlington','Burlington','garment_dry_cleaning_laundry',
 'Official homepage publishes info@parkersofburlington.com with 3040 New Street, Burlington and describes garment drycleaning/laundry. No furniture/property cleaning service established.',
 'hold_relevance','Identity passes, but exclude from cleaning-job furniture-clearance paragraph. A separate business relocation angle can be researched later; no specific plausible partnership context established in saved pages.',
 None),
('Terry Howald Pools','Kitchener / Waterloo','pool_installation_maintenance',
 'Official contact page publishes info@terryhowaldpools.ca with 274 Courtland Ave. E., Kitchener. Site describes pools, spas, chemicals, installations and maintenance; owner Sam Simons named on homepage.',
 'hold_relevance','Identity passes, but do not use generic cleaning paragraph or promise pool/spa transport, chemical handling or demolition. Moving-service fit requires further capability/context review.',
 None),
]

def main():
    selected = {r['organisation_name']: r for r in json.loads((ROOT/'candidates.json').read_text())}
    sources = {r['organisation_name']: r for r in map(json.loads,(ROOT/'source-refresh.jsonl').read_text().splitlines())}
    now = datetime.now(timezone.utc).isoformat()
    results=[]
    for name, locality, sector, finding, decision, action, paragraph in REVIEWS:
        candidate, source = selected[name], sources[name]
        pages=[p for p in source['pages'] if p.get('status')=='observed']
        item={
          'organisation_id':candidate['organisation_id'],'organisation_name':name,'email':candidate['email'],
          'reviewed_at':now,'reviewer':'Codex practical-fit source review',
          'inventory_city':candidate['city'],'reviewed_location':locality,
          'inventory_sector':candidate['sector'],'reviewed_sector':sector,
          'identity_email_binding': 'hold' if decision=='hold' else 'pass',
          'role_relevance':'pass_for_conditional_context' if decision=='pass' else 'hold',
          'finding':finding,'required_correction_or_action':action,
          'proposed_contextual_paragraph':paragraph,
          'paragraph_status':'proposed_preserves_user_approved_direction_not_final_send_approval' if paragraph else 'withheld_pending_relevance',
          'source_no_solicitation_assessment':'no_signal_in_saved_sample' if not source.get('restriction_signals') else 'hold_signal_interpretation',
          'source_no_solicitation_limits':'Saved scanner checked bounded public pages; excerpts reviewed here are not a complete terms/policy review. Absence of a detected signal is not permission.',
          'source_checked_at':source['checked_at'],
          'source_record_sha256':hashlib.sha256(json.dumps(source,sort_keys=True).encode()).hexdigest(),
          'sources':[{'url':p['final_url'],'sha256':p['sha256'],'target_email_observed':p['target_email_observed'],'target_context':p.get('target_context')} for p in pages],
          'supplemental_official_page_review':[],
          'outreach_eligibility':'not_determined','campaign_ready':False,
        }
        if name=='Ideal Touch Janitorial Services':
            item['supplemental_official_page_review']=[{'url':'https://www.idealtouchjanitorial.ca/contact','method':'web tool official page read','finding':'Contact Us link explicitly resolves judy@idealtouchjanitorial.ca; Kitchener address.','reviewed_at':now}]
        if name=='Rustix Studio':
            item['supplemental_official_page_review']=[{'url':'https://www.rustixstudio.ca/contact','method':'web tool official page read','finding':'Showroom & Design / Heather binds heather@rustixstudio.ca; St Thomas location; street number differs between contact block and footer.','reviewed_at':now}]
        results.append(item)
    assert len(results)==20
    (ROOT/'practical-fit-source-review-20.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in results))
    with (ROOT/'practical-fit-source-review-20.csv').open('w',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=list(results[0]));writer.writeheader()
        writer.writerows({k:json.dumps(v) if isinstance(v,(list,dict)) else v for k,v in r.items()} for r in results)
    summary={'at':now,'reviewed':len(results),'identity_pass':sum(r['identity_email_binding']=='pass' for r in results),
      'identity_hold':sum(r['identity_email_binding']=='hold' for r in results),
      'identity_and_conditional_relevance_pass':sum(r['identity_email_binding']=='pass' and r['role_relevance']=='pass_for_conditional_context' for r in results),
      'hold_names':[r['organisation_name'] for r in results if r['role_relevance']=='hold'],
      'campaign_ready':0,'sent':0,'scope':'Analyst review of saved source extracts plus two official-page supplemental reads; not comprehensive policy/legal eligibility or live reservation.'}
    (ROOT/'practical-fit-source-review-20-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps(summary,indent=2))

if __name__=='__main__':main()
