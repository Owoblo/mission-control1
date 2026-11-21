"""Operator-reviewed route selection from cloud evidence; offline, never sends."""
import hashlib,json,re
from collections import Counter
from pathlib import Path
from urllib.parse import urlsplit
ROOT=Path(__file__).resolve().parents[2]
DIR=ROOT/'partnership-system/state/windsor-activation-20261118/cloud-enrichment'
# name, source sites, independent business address, sector, source host/path,
# selected professional phone/email, account review condition.
SELECTIONS=[
 ('Dollar Tree — Walker Road',[1,22],'4140 Walker Road, Building 300 Unit 102, Windsor','retail','locations.dollartreecanada.com','4140-walker-road','2262161811','', ''),
 ("Osmow's — Walker Road",[1,22],'101-4140 Walker Road, Windsor','hospitality','locations.osmows.com','4140','5192500050','', ''),
 ("Kingdom Hall / Jehovah's Witnesses",[2],'6870 Hawthorne Drive, Windsor','institutional','windsor-2.canadianorglist.com','','5199443911','','secondary_source_current_identity_required'),
 ('L. A. Desmarais Catholic Elementary School',[4],'10715 Eastcourt Drive, Windsor','education','wecdsb.on.ca','ladesmarais','5197352892','','school_board_account_coordination_required'),
 ('Delta Chi — Desmarais Campus',[4],'10715 Eastcourt Drive, Windsor','childcare','deltachichildcare.com','locations','5199889016','',''),
 ('Windsor-Essex Catholic District School Board',[4,38],'1325 California Avenue, Windsor','education','wecdsb.on.ca','ladesmarais','5192532481','','parent_account_review_required'),
 ('Potentia Renewables',[6],'Current Windsor branch not established','industrial','potentiarenewables.com','contact-us','4167031911','','former_site_current_identity_required'),
 ("E'vie Nails & Beauty",[8],'6505 Tecumseh Road East, Windsor','beauty','dashbooking.com','evie-nails-beauty','5199441999','','booking_profile_identity_review_required'),
 ('Prahit Inc.',[9],'Unit 4, 3040 Jefferson Boulevard, Windsor','industrial','prahitengg.com','contact','5192829705','gnisarg@prahitengg.com',''),
 ('Next Level Baseball',[9],'Windsor facility; current street address unresolved','recreation','nextlevelbaseball.ca','','5199911692','','current_branch_address_required'),
 ('Agilus — Windsor',[11],'Unit 3, 301 Croft Drive; official Windsor branch listing','professional','agilus.ca','locations','8556221200','','shared_national_route_not_personal_mobile'),
 ('Master Group / Baymar — Windsor',[12],'3200 Jefferson Boulevard, Unit 100, Windsor','wholesale','ruskin.com','RepLocator','5199745800','','alias_and_current_branch_role_review_required'),
 ('The Rad Shop',[13],'2740 Jefferson Boulevard, Windsor','auto','radshop.ca','','5199451159','radshop2022@outlook.com',''),
 ('East Windsor Massage Therapy Clinic',[13],'Unit 12, 2740 Jefferson Boulevard, Windsor','health','windsormassageclinic.com','contact','5199460210','','branch_specific_phone_review_required'),
 ("Wendy's — Tecumseh Road",[14],'7605 Tecumseh Road, Windsor','hospitality','locations.wendys.com','7605-tecumseh-road','5192511125','',''),
 ('Westdale Properties',[14],'Corporate account; Pickwick Plaza property reference','property','westdaleproperties.com','7605-Tecumseh','4167031877','info@westdaleproperties.com','corporate_account_coordination_required'),
 ('Urban Greenhouse Hydroponics',[14],'7635 Tecumseh Road East, Windsor — corrected neighbouring address','retail','shopurbangreenhouse.myshopify.com','contact-information','5199448444','james@urbangreenhousehydroponics.com',''),
 ('Dr. Domenico Paonessa Dentistry',[14],'Suite 204, 7651 Tecumseh Road East, Windsor — neighbouring address','health','drpaonessa.com','','5199746120','',''),
 ('Home Depot — Windsor East #7184',[15],'6630 Tecumseh Road East, Windsor','retail','stores.homedepot.ca','7184','5199745423','','pro_desk_is_not_facilities_authority'),
 ('Solis Canada',[16],'Unit B, 8025 Anchor Drive, Windsor','industrial','','','','','legal_alias_and_professional_route_required'),
 ('Riverview Steel',[16],'8165 Anchor Drive, Windsor','industrial','riverviewsteel.com','','5199798255','info@riverviewsteel.com',''),
 ('SyBridge / Lakeshore Fixture & Gauge',[16],'8025 Anchor Drive historical association','industrial','sybridge.com','locations','','info@sybridge.com','historical_branch_and_parent_relationship_review_required'),
 ('Tim Hortons — Forest Glade',[18],'3585 Forest Glade Drive, Windsor','hospitality','locations.timhortons.ca','3585-forest-glade','5199748849','',''),
 ('Michigan Diner',[19],'7435 Tecumseh Road East, Windsor — address corroboration required','hospitality','michigandinerwindsor.com','','5199445111','','precise_branch_identity_review_required'),
 ('Hamburgers 4 All',[20],'3100 Jefferson Boulevard, Windsor — unverified proposal','hospitality','','','','','current_identity_and_professional_route_required'),
 ('Quality Cabinets',[21],'2596 Jefferson Boulevard, Windsor — corrected neighbouring address','trade','quality-cabinets.ca','','5199153355','quality-cabinets@outlook.com',''),
 ('Essex County Locksmiths',[21],'2580 Jefferson Boulevard, Windsor — corrected neighbouring address','trade','essexcountylocksmiths.ca','contact','5199718777','',''),
 ('Structube — Windsor Walker Road',[22],'Windsor Walker Road store; reconcile complete civic address','retail','structube.com','windsor-ontario','5192501778','walk@structube.com','complete_branch_address_review_required'),
 ('Lone Star Texas Grill — Windsor',[22],'Windsor branch; reconcile Walker Road premises','hospitality','lonestartexasgrill.com','locations/windsor','5198008311','windsor@lonestartexasgrill.com','complete_branch_address_review_required'),
 ("Sarducci's Pizza — East",[23],'Unit 130, 2675 Lauzon Road, Windsor','hospitality','sarduccispizza.ca','','5199747200','',''),
 ('Circle K — Jefferson',[10],'2606 Jefferson Boulevard, Windsor','retail','','','','','official_route_capture_and_operator_review_required'),
 ('Circle K — Lauzon',[23],'2675 Lauzon Road, Windsor','retail','','','','','official_route_capture_and_operator_review_required'),
 ('Raqia Supermarket & Bakery',[23],'Units 160–170, 2675 Lauzon Road, Windsor','retail','','','','','first_party_route_required'),
 ('BMR / Windsor Building Centre',[24],'11365 Tecumseh Road East, Windsor','retail','dealers.fiberondecking.com','','5199795250','','first_party_route_refresh_required'),
 ('Orqid Inc.',[25],'3160 Wildwood Drive, Windsor — published business office','professional','orqid.design','contact','5198180690','info@orqid.io',''),
 ('Fortis Group',[26],'Developer corporate contact; former-school project role unresolved','property','fortisgroup.ca','contact','','info@fortisgroup.ca','project_role_and_account_relationship_review_required'),
 ('SBLV Eye Care',[27],'14306 Tecumseh Road, Tecumseh','health','sblv.ca','','5199799888','',''),
 ('Precision Med Spa & Hair Design',[27],'Unit 5, 14306 Tecumseh Road — historical opening event','beauty','','','','','historical_after_hours_route_not_suitable_for_new_outreach'),
 ('Riverside Massage / Mifflin location',[27],'Unit 7, 14306 Tecumseh Road East, Tecumseh','health','riversidemassagetherapy.janeapp.com','mifflin','5197353000','riversidemassage@gmail.com','shared_clinic_and_location_identity_review_required'),
 ('The Cutting Board',[28,30],'14301 Tecumseh Road East — excludes 438 Caritas Court','hospitality','thecuttingboardonline.ca','','','info@thecuttingboardonline.ca',''),
 ('Authentik Hair Haus',[29],'400 Manning Road — excludes 409 Beach Grove Drive','beauty','','','','','own_business_route_required_not_bia_header'),
 ('South Port Sailing Club',[31],'210 Brighton Road, Tecumseh','recreation','southportsailingclub.com','getting-here','','spsc.commodore@gmail.com','club_role_and_relevance_review_required'),
 ("Al's Bait's",[32],'383 Brighton Road — current occupancy unresolved','retail','','','','','first_party_identity_and_route_required'),
 ('Beach Grove Golf & Country Club',[34,35],'14134 Riverside Drive East; grounds/Oasis address remains separate','recreation','beachgrove.net','Contact','5199798090','info@beachgrove.net',''),
 ('Under Armour — unverified seed',[36],'14077 Riverside Drive — unsupported branch','retail','','','','','unverified_brand_site_association'),
 ('Latchkey — St. André',[37,38],'13765 St. Gregory Road — excludes 13710','childcare','latchkey.ca','locations','','standre@latchkey.ca','school_childcare_account_coordination_required'),
 ('St. André Catholic Elementary School',[37,38],'13765 St. Gregory Road, Tecumseh','education','wecdsb.on.ca','schools/standre','','','school_board_route_coordination_required'),
 ('Lakeview Montessori School',[40],'13797 Riverside Drive East, Tecumseh','education','lakeviewmontessori.ca','leadership-governance','5197355005','reneeryerson@lakeviewmontessori.ca',''),
 ('Couture Salon & Spa',[42],'Unit 2, 13831 Riverside Drive East, Tecumseh','beauty','tecumsehbia.com','listing/couture','5199790076','','association_route_requires_first_party_confirmation'),
 ('Pearsall Marshall law firm — Tecumseh',[42],'Tecumseh office at 13831 Riverside Drive East; suite to reconcile','professional','pearsallmarshall.com','location/tecumseh','','info@pearsallmarshall.com','branch_and_named_decision_role_review_required'),
 ("St. Mark's-by-the-Lake",[44],'150 St. Marks Road, Tecumseh','institutional','diohuron.org','essex/st-marks','5197354921','stmarkstecumseh@diohuron.org',''),
 ('Desjardins — Tecumseh',[47],'13470 Tecumseh Road East, Tecumseh','finance','desjardins.com','tecumseh.html','5197356069','','branch_facilities_route_required'),
 ('Essex County Library — Tecumseh/CADA',[48],'13675 St. Gregory Road, Tecumseh','education','calendar.essexcountylibrary.ca','event/16549357','2269461529','tecbranch@essexcountylibrary.ca','library_account_and_supplier_route_review_required'),
 ('Elite 4',[49],'398 Manning Road, Tecumseh','retail','localcardshopsnearme.com','elite-4-tecumseh','2266760389','','first_party_route_required_not_bia_or_zeltrix'),
 ('Tecumseh Physiotherapy Clinic',[50],'394 Manning Road, Tecumseh','health','medimap.ca','tecumseh-physiotherapy','5199792266','','first_party_current_identity_and_parent_review_required'),
]

def phone(value):
    digits=re.sub(r'\D','',str(value).split(' ext')[0].split(' x')[0]);return '+1'+digits[-10:]if len(digits)in (10,11)else None

def draft(name,sector):
    greeting='Hi Renée,'if name=='Lakeview Montessori School'else 'Hi,'
    angles={
     'industrial':('office furniture or general business relocations','your team'),
     'wholesale':('office furniture or general business relocations','your branch'),
     'hospitality':('furniture moves or a change of premises','your location'),
     'property':('tenant moves or office furniture relocations','your properties'),
     'education':('classroom furniture moves or office relocations','your school or branch'),
     'childcare':('furniture moves or a change of premises','your centre'),
     'health':('office furniture moves or general relocation support','the practice'),
     'beauty':('salon furniture moves or a change of premises','the salon'),
     'trade':('furniture moves or general relocations','your team or customers'),
     'auto':('furniture moves or general relocations','the shop or anyone you refer'),
     'recreation':('furniture moves or general relocation support','the club'),
     'institutional':('furniture moves or general relocation support','your organization'),
     'professional':('office relocations or client moving referrals','your team'),
     'retail':('store furniture moves or a change of premises','the store'),
     'finance':('office relocations or client moving referrals','your branch'),
    }
    service,recipient=angles[sector]
    # Draft is internal copy only. Approved sender/footer and release policy are
    # added by the existing transport; no capacity or specialist work is promised.
    return f'{greeting} would it be useful to have a moving contact handy for {service}? Happy to be an option for {recipient} whenever something comes up. John'

def main():
    raw=(DIR/'results.json').read_bytes();result=json.loads(raw);sites={s['site_number']:s for s in result['sites']};records=[]
    for name,nums,address,sector,host,path,ph,em,condition in SELECTIONS:
        evidence=[];channels=[];selected_pages=[]
        for n in nums:
            for pg in sites[n]['pages']:
                hostname=(urlsplit(pg['url']).hostname or '').removeprefix('www.')
                if host and hostname==host.removeprefix('www.')and path.lower()in pg['url'].lower():selected_pages.append(pg)
        for channel,value in [('phone',phone(ph)if ph else None),('email',em or None)]:
            if not value:continue
            supports=[]
            for pg in selected_pages:
                entries=pg.get('phones'if channel=='phone'else 'emails',[])
                for entry in entries:
                    candidate=phone(entry.get('phone'))if channel=='phone'else entry.get('email','').lower()
                    if candidate==value and entry.get('kind')!='fax'and not entry.get('kind_review_required'):
                        supports.append({'source_url':pg['url'],'source_sha256':pg['sha256'],'captured_at':pg.get('captured_at'),'extraction_method':entry.get('extraction_method'),'locator':entry.get('source_dom_locator'),'context':entry.get('short_supporting_context')or entry.get('context'),'extension':entry.get('extension')or ''})
            if supports:channels.append({'type':channel,'value':value,'evidence':supports,'verification_state':'source_published_requires_technical_and_release_checks','personally_preferred':False})
        key='research-account:'+hashlib.sha256((name+'|'+address).encode()).hexdigest()[:24]
        holds=[condition]if condition else []
        if not channels:holds.append('no_selected_source_supported_route')
        holds+=['fresh_crm_history_and_suppression_check','outreach_eligibility_not_established','transport_identification_and_unsubscribe_format_required']
        records.append({'key':key,'organization':name,'source_sites':nums,'business_address':address,'sector_hypothesis':sector,'employee_size':'unknown','routes':channels,'identity_review_condition':condition or None,'draft':draft(name,sector)if channels else None,'draft_kind':'new_relationship_or_business_routing_copy_requires_crm_reconciliation','account_structure':'not_inferred','preferred_channel':'unknown','holds':holds,'send_ready':False,'approved':False,'scheduled':False,'source_pages_reviewed':list(dict.fromkeys(p['url']for p in selected_pages))})
    exclusions=[]
    for s in result['sites']:
        for index,f in enumerate(s['facts']):
            if f.get('fact_type')not in ('email','phone'):continue
            value=f['value'];org=f['organization'];reason=None
            if '[email' in value.lower():reason='protected_display_placeholder_not_an_email'
            elif org in ('Royal Islander Club','Beddazzle'):reason='outside_target_geography_or_unconfirmed_historical_occupant'
            elif 'Skyline' in org and 'media' in value:reason='media_inquiries_not_relationship_route'
            elif 'Planning' in org or org in ('Town of Tecumseh','Tecumseh BIA'):reason='source_or_enquiry_contact_not_target_tenant'
            elif 'Precision Med Spa' in org:reason='historical_after_hours_route_not_for_new_outreach'
            if reason:exclusions.append({'site_number':s['site_number'],'fact_index':index,'organization':org,'value':value,'disposition':reason,'evidence':f})
    coverage=[]
    for s in result['sites']:
        linked=[r['key']for r in records if s['site_number']in r['source_sites']]
        coverage.append({'site_number':s['site_number'],'site_id':s['site_id'],'addresses':s['addresses'],'linked_account_keys':linked,'state':'account_reconciliation'if linked else 'research_debt_or_context_only','remaining_research':s.get('unresolved',[]),'model_fact_holds_retained':sum(f['evidence_gate']=='held'for f in s['facts']),'send_ready':False})
    summary={'source_sites':len(coverage),'review_account_records':len(records),'accounts_with_selected_routes':sum(bool(r['routes'])for r in records),'drafts_prepared':sum(bool(r['draft'])for r in records),'selected_route_associations':sum(len(r['routes'])for r in records),'route_types':dict(Counter(c['type']for r in records for c in r['routes'])),'excluded_model_route_assertions':len(exclusions),'approved':0,'scheduled':0,'send_ready':0,'messages_sent':0}
    out={'at':__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(),'source_results_sha256':hashlib.sha256(raw).hexdigest(),'scope':'Bounded account review ledger; source-site corrections and role hypotheses retained, no legal-entity auto-merges','summary':summary,'accounts':records,'sites':coverage,'excluded_route_assertions':exclusions}
    (DIR/'account-route-review.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
    assert len(coverage)==50 and len({r['key']for r in records})==len(records)
    assert all(c['evidence']for r in records for c in r['routes'])
    print(json.dumps(summary,indent=2))

if __name__=='__main__':main()
