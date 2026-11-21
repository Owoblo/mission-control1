"""Apply explicit operator review to the bounded 50-site pass; no network or sends."""
import csv
import hashlib
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DIR = ROOT / 'partnership-system/state/windsor-activation-20261118'
# One primary disposition per site; secondary assertions retain their own evidence/holds.
# Order is pinned to the saved pass, with an address check to prevent silent reuse.
DECISIONS = [
 ('WALKER RD','address_resolution','retail','Resolve civic number and parcel before assigning Walker Commons/Walker Place tenants; coordinate with site 22.'),
 ('6870 HAWTHORNE DR','institutional_review','faith_nonprofit','Reconcile Kingdom Hall name variants and held quote with current organization evidence; research facilities route.'),
 ('9580 TECUMSEH RD E','address_resolution','unknown','Find exact current occupant; do not attach nearby pools, pizza or inn names.'),
 ('10715 EASTCOURT DR','institutional_review','education_childcare','Resolve school-board account and Delta Chi/YMCA childcare operator separately; held extraction is not accepted occupancy.'),
 ('6340 TECUMSEH RD E','municipal_context','government_infrastructure','Retain historical Jefferson Pump Station evidence under municipal account research; no private tenant introduction.'),
 ('2790 JEFFERSON BLVD','historical_conflict','unknown','Potentia directory is marked closed; establish current occupant before contact preparation.'),
 ('1902 JEFFERSON ST','address_resolution','unknown','Resolve Jefferson Street versus Boulevard and exact parcel before occupant lookup.'),
 ('6505 TECUMSEH RD E','contact_enrichment','beauty_personal_services','Find first-party E\'vie Nails contact and confirm current business/address; directory evidence alone is provisional.'),
 ('3040 JEFFERSON BLVD','prepared_draft','manufacturing_sports','Prahit draft prepared with source-published routes; Next Level Baseball remains historical unit-5 evidence and separate research debt.'),
 ('2606 JEFFERSON BLVD','account_identity_review','fuel_convenience_retail','Resolve Esso/Circle K brand, operator and branch; existing Esso CRM name candidate is not a branch match.'),
 ('2892 KEW DR','account_identity_review','staffing_professional_services','Verify Agilus against first-party branch information; dossier address assertion has no current temporal verification.'),
 ('3200 JEFFERSON BLVD','account_identity_review','trade_wholesale','Reconcile Baymar/Master Group acquisition or trade names and Aztec branch; review held claim before business creation.'),
 ('2740 JEFFERSON BLVD','prepared_draft','auto_services_manufacturing','Rad Shop draft prepared; Windsor Broach & Tool requires current source; other unit proposals remain unverified.'),
 ('7605 TECUMSEH RD E','address_resolution','mixed_commercial','Resolve 7605 exact parcel versus Pickwick Plaza address range; do not promote neighbouring tenant roster.'),
 ('6630 TECUMSEH RD E','account_identity_review','building_supply_retail','Resolve Home Depot East #7184 versus Division Road page content; verify branch-specific contact.'),
 ('8025 ANCHOR DR','account_identity_review','manufacturing_metal','Keep 8025 and 8165 distinct; reconcile Solis aliases, SyBridge history and Riverview current status; no machinery-handling promise.'),
 ('3158 VIOLA CRES','address_resolution','unknown','No exact-site business supported at 3158/3162; retain neighbouring candidates separately and do not profile residents.'),
 ('3585 FOREST GLADE DR','contact_enrichment','hospitality_food','Confirm Tim Hortons branch via first-party locator and identify operator; inspection aggregator is not franchise ownership evidence.'),
 ('7435 TECUMSEH RD E','contact_enrichment','hospitality_food','Michigan Diner official identity/phone found; reconcile precise branch/address and professional route before draft release.'),
 ('3100 JEFFERSON BLVD','contact_enrichment','hospitality_food','Recheck Hamburgers 4 All and Ahua proposals against exact current address; no accepted claim in this capture.'),
 ('2560 JEFFERSON BLVD','address_resolution','unknown','Resolve exact 2560 occupant and separate 2570-related Solcz/other proposals; held names are not exact-site matches.'),
 ('WALKER RD','address_resolution','retail','Resolve second building footprint civic number; prevent duplicate Walker corridor tenants with site 1.'),
 ('2675 LAUZON RD','contact_enrichment','mixed_retail_food','Confirm Circle K, Raqia and Sarducci business/unit contacts separately; translated/syndicated Circle K claims do not add businesses.'),
 ('11365 TECUMSEH RD E','contact_enrichment','building_supply_retail','Reconcile BMR/Windsor Building Centre aliases and extract Windsor-local contact, not default global-site store details.'),
 ('3160 WILDWOOD DR','prepared_draft','design_professional_services','Orqid draft prepared; Michigan office is a source assertion to reconcile, not proved common ownership; do not profile other residents.'),
 ('14194 TECUMSEH RD','historical_conflict','education_redevelopment','D.M. Eagle closed-school evidence conflicts with municipal directory; hold active-school outreach and separately research redevelopment ownership.'),
 ('14306 TECUMSEH RD','prepared_draft','health_beauty_mixed','SBLV draft prepared; Precision opening is historical and other unit proposals need current confirmation; no patient-form outreach.'),
 ('14301 TECUMSEH RD','account_identity_review','convenience_food_retail','Review held Circle K and Cutting Board associations; reconcile Family Style trade name and historical Mac\'s; link address correction from site 30.'),
 ('409 BEACH GROVE DR','address_resolution','unknown','Do not attach Authentik Hair Haus to this residential-context site; investigate its Manning Road business separately.'),
 ('438 CARITAS CRT','address_resolution','unknown','Reject Cutting Board association to this site pending evidence; carry its 14301 commercial-address lead to site 28.'),
 ('210 BRIGHTON RD','contact_enrichment','recreation_nonprofit','South Port club identity supported; verify current executive/facilities business route; no boat or specialist handling promise.'),
 ('383 BRIGHTON RD','contact_enrichment','specialty_retail','Al\'s Bait\'s is held/directory-led; resolve current exact-address business and professional route before introduction.'),
 ('401 BEACH GROVE DR','residential_context_hold','unknown','Only residential context; no supported professional business route. Do not create a private-resident prospect.'),
 ('14160 TECUMSEH RD','account_identity_review','recreation_hospitality','Resolve Beach Grove Oasis/grounds address versus main club; do not count an internal operation as separate owned company.'),
 ('14134 RIVERSIDE DR','account_identity_review','recreation_hospitality','Reconcile main Beach Grove club and held source address; Oasis/pool/legal labels remain possible internal operations.'),
 ('14077 RIVERSIDE DR','account_identity_review','apparel_retail','Under Armour is supported only by hours directory; verify official branch before treating it as an active business here.'),
 ('13710 ST GREGORYS RD','address_resolution','unknown','Latchkey/school sources point to 13765, not residential-context 13710; carry correction to site 38.'),
 ('13765 ST GREGORYS RD','institutional_review','education_childcare','Resolve St Andre/current school versus historical St Gregory name and board account; childcare operator remains unverified.'),
 ("117 ST MARK'S RD",'address_resolution','unknown','No exact-site professional occupant; Beatrice Print proposal is unresolved, not accepted occupancy.'),
 ('13797 RIVERSIDE DR','institutional_review','education','Reconcile held Lakeview Montessori/address evidence and teacher-training programme as related operation; verify institutional contact.'),
 ('200 CLOVELLY RD','address_resolution','unknown','Pulez Plumbing evidence points to 224, not 200; retain neighbouring-business research separately.'),
 ('13831 RIVERSIDE DR','account_identity_review','mixed_professional_personal_services','Reconcile Couture/Signatures names, law-firm aliases and other unit occupants individually; held tenant roster is not verified.'),
 ('14080 RIVERSIDE DR','municipal_context','government_infrastructure','Retain Peter Cecile pump-station/park context; resolve address variants and municipal account rather than new private prospect.'),
 ("150 ST MARK'S RD",'institutional_review','faith_nonprofit','Research church facilities route and reconcile held address; hosted support meeting is not a separate tenant or outreach target.'),
 ('13698 RIVERSIDE DR','municipal_context','government_infrastructure','Town project/certificate context; separate Scully site/park/pump labels and municipal account; no inferred moving requirement.'),
 ('374 TUSCANY CRES','address_resolution','unknown','Royal Islander evidence points to 362, not 374; no private-resident outreach or asserted target-site business.'),
 ('13470 TECUMSEH RD','institutional_review','finance','Reconcile Desjardins branch and related financial labels; exclude neighbouring Carlson travel at 13504; verify account/business route.'),
 ('13675 ST GREGORYS RD','institutional_review','library_public_institution','Reconcile Essex County Library/CADA/Tecumseh branch aliases and held extraction; use institutional facilities/procurement relationship.'),
 ('398 MANNING RD','contact_enrichment','specialty_retail','Reconcile Elite 4 aliases and obtain own contact, not BIA header contact; Vintner\'s Cellar remains historical/conflicting.'),
 ('394 MANNING RD','contact_enrichment','health_services','Resolve held Tecumseh Physiotherapy identity/address and Tenzer Primeau relationship; Beddazzle history is not current occupancy.'),
]

def main():
 source=DIR/'completed-pass-results.json'
 raw=source.read_bytes(); data=json.loads(raw)
 assert len(data['sites']) == len(DECISIONS) == 50
 prepared=json.loads((DIR/'prepared-action-queue.json').read_text())
 prepared_names={x['organization'] for x in prepared['items']}
 sites=[]; assertions=[]; claim_groups=set()
 for number,(site,decision) in enumerate(zip(data['sites'],DECISIONS),1):
  address,disposition,sector,next_action=decision
  addresses=json.loads(site['addresses']) if isinstance(site['addresses'],str) else site['addresses']
  assert address in addresses, (number,address,addresses)
  r=site['result']; site_assertions=[]
  for lane in ('claims','held_claims','context_claims','discovery_proposals'):
   for index,c in enumerate(r.get(lane,[])):
    name=c.get('organization') or c.get('organization_name')
    if lane=='claims': claim_groups.add((site['site_id'],''.join(ch for ch in name.lower() if ch.isalnum())))
    status={'claims':'accepted_source_assertion_requires_review','held_claims':'preserve_source_hold','context_claims':'context_only','discovery_proposals':'unverified_discovery_lead'}[lane]
    if lane=='claims' and name in prepared_names: status='draft_prepared_release_checks_pending'
    elif lane=='claims' and (c.get('temporal_status')=='historical' or number==26): status='historical_or_current_status_conflict'
    elif lane=='claims' and number==45: status='municipal_account_context'
    # Source claims are not promoted to confirmed operating businesses.
    key=f"{site['site_id']}|{lane}|{index}"
    item={'key':key,'site_number':number,'site_id':site['site_id'],'city':site['municipality'],'organization':name,'source_lane':lane,'classification':status,'sector_hypothesis':sector,'size':'unknown','next_action':next_action,'send_ready':False,'evidence':c}
    assertions.append(item);site_assertions.append(key)
  sites.append({'site_number':number,'site_id':site['site_id'],'city':site['municipality'],'addresses':addresses,'primary_disposition':disposition,'sector_hypothesis':sector,'size':'unknown','next_action':next_action,'accepted_claim_names':list(dict.fromkeys(c.get('organization')or c.get('organization_name')for c in r.get('claims',[]))),'source_lane_counts':{k:len(r.get(k,[]))for k in ('claims','held_claims','context_claims','discovery_proposals')},'assertion_keys':site_assertions,'gaps':r.get('gaps',[]),'send_ready':False,'coverage_complete':False})
 lanes=Counter(a['source_lane'] for a in assertions)
 summary={'sites':len(sites),'cities':dict(Counter(s['city']for s in sites)),'primary_dispositions':dict(Counter(s['primary_disposition']for s in sites)),'source_lane_counts':dict(lanes),'accepted_claim_site_name_groups':len(claim_groups),'prepared_drafts':len(prepared['items']),'send_ready':0,'messages_sent':0,'new_paid_research':0,'unique_verified_businesses':'not_established'}
 assert lanes['claims']==43 and len(claim_groups)==29
 assert sum(summary['primary_dispositions'].values())==50
 assert len({a['key']for a in assertions})==len(assertions)
 report={'classified_at':'2026-11-18','method':'Explicit operator review of every saved site, all accepted/held/context claims and discovery proposals. No new source verification implied.','source_sha256':hashlib.sha256(raw).hexdigest(),'summary':summary,'sites':sites,'assertions':assertions}
 (DIR/'whole-batch-classification.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
 with (DIR/'whole-batch-classification.csv').open('w',newline='') as f:
  w=csv.writer(f);w.writerow(['site_number','city','addresses','disposition','sector_hypothesis','size','claim_names','next_action','send_ready'])
  for s in sites:w.writerow([s['site_number'],s['city'],'; '.join(s['addresses']),s['primary_disposition'],s['sector_hypothesis'],s['size'],'; '.join(s['accepted_claim_names']),s['next_action'],False])
 lines=['# Full bounded-batch classification — November 18','', 'All 50 saved investigations are classified. These are site review dispositions, not 50 verified businesses or approved sends. Every accepted, held, context and discovery assertion remains linked in the JSON evidence ledger. Size and ownership are not inferred.','', '## Reconciled counts','', *[f'- {k}: {v}'for k,v in summary.items()], '', '## Every site','', '| # | City | Address | Primary disposition | Next action |','| --- | --- | --- | --- | --- |']
 for s in sites:lines.append('| '+ ' | '.join([str(s['site_number']),s['city'],'; '.join(s['addresses']),s['primary_disposition'],s['next_action'].replace('|','/')])+' |')
 lines+=['','The contact-enrichment lane is a research queue, not confirmed contacts. Institutional and account-identity lanes can produce suitable relationships after reconciliation. Historical, residential and municipal context is retained without manufacturing active business prospects. The four prepared drafts retain all release holds; cold email remains paused.','', 'Evidence files: `partnership-system/state/windsor-activation-20261118/whole-batch-classification.{json,csv}`. No provider calls, CRM mutations, messages or paid research are performed by this classifier.']
 (ROOT/'docs/partnership-whole-batch-classification-20261118.md').write_text('\n'.join(lines)+'\n')
 print(json.dumps(summary,indent=2))

if __name__=='__main__':main()
