"""Combine a Railway preparation checkpoint with the configured coverage ledger."""
import csv
from collections import Counter, defaultdict
from contextlib import closing
from datetime import datetime, timezone
import json
import sqlite3
from pathlib import Path

from .geo_recipient_cloud import FOLDER, remote
from .relationship_coverage_plan import ROOT, normalized, write_csv

BASELINE = ROOT/'partnership-system/state/coverage-plan-20261117'
OUT = ROOT/'partnership-system/state/geo-coverage-progress'
INVENTORY = ROOT/'artifacts/partnership-next-day-research-20261028/preparation-20261028-current/candidates.json'
PREPARED = 'prepared_contextual_draft'


def saved_map_footprint(cities):
    """Count saved map locations and source receipts using their own keys."""
    database = ROOT/'partnership-system/state/market-map.sqlite'
    with closing(sqlite3.connect(database.resolve().as_uri()+'?mode=ro',uri=True)) as db:
        db.execute('PRAGMA temp_store=MEMORY')
        locations = dict(db.execute('SELECT municipality_id,count(*) FROM locations GROUP BY municipality_id'))
        family_counts = list(db.execute("""
            SELECT l.municipality_id,c.category,count(DISTINCT l.id)
            FROM locations l CROSS JOIN classifications c ON c.entity_id=l.organisation_id
            WHERE c.entity_type='organisation' AND c.taxonomy='ssm_industry_family'
            GROUP BY l.municipality_id,c.category
        """))
        source_counts = list(db.execute("""
            SELECT s.id,s.name,s.geography_scope,s.sector_scope,s.last_success_at,
                   count(r.id),sum(CASE WHEN r.status='completed' THEN 1 ELSE 0 END),
                   sum(CASE WHEN r.status='partial' THEN 1 ELSE 0 END),
                   sum(CASE WHEN r.status='evidence_only' THEN 1 ELSE 0 END)
            FROM sources s LEFT JOIN source_runs r ON r.source_id=s.id
            GROUP BY s.id ORDER BY s.name
        """))
    families = sorted({family for _,family,_ in family_counts})
    family_lookup = {(geo,family):count for geo,family,count in family_counts}
    write_csv(OUT/'saved-map-industry-families.csv',
              [{'municipality_id':gid,'municipality':name,'industry_family':family,
                'saved_locations_with_family':family_lookup.get((gid,family),0),
                'all_saved_locations_in_municipality':locations.get(gid,0)}
               for gid,name in sorted(cities.items(),key=lambda item:item[1]) for family in families])
    source_fields = ('source_id','source','declared_geography_scope','declared_sector_scope','last_success_at',
                     'recorded_runs','completed_runs','partial_runs','evidence_only_runs')
    write_csv(OUT/'saved-source-run-receipts.csv',[dict(zip(source_fields,row)) for row in source_counts])
    return {'saved_database_locations':sum(locations.values()),
            'saved_database_locations_in_configured_municipalities':sum(locations.get(gid,0) for gid in cities),
            'saved_database_configured_municipalities_with_locations':sum(bool(locations.get(gid)) for gid in cities),
            'saved_database_industry_families':len(families),
            'saved_database_registered_sources':len(source_counts),
            'saved_database_sources_with_run_receipts':sum(bool(row[5]) for row in source_counts)}


def write_city_summary(records, footprint):
    map_locations = {r['municipality_id']:int(r['all_saved_locations_in_municipality']) for r in footprint}
    cities = {}
    for row in records:
        geo = row['municipality_id']
        city = cities.setdefault(geo, {'municipality_id':geo,'municipality':row['municipality'],
                                       'saved_map_locations':map_locations.get(geo,0),
                                       'saved_research_inventory':0,'worker_intake':0,'processed':0,
                                       'prepared_contextual_draft':0,'map_categories_with_intake':0,
                                       'map_categories_with_drafts':0})
        for field in ('saved_research_inventory','worker_intake','processed',PREPARED):
            city[field] += int(row[field])
        city['map_categories_with_intake'] += int(row['worker_intake'])>0
        city['map_categories_with_drafts'] += int(row[PREPARED])>0
    for city in cities.values():
        if city['worker_intake']:
            action = 'continue_enrichment_and_review_holds'
        elif city['saved_research_inventory']:
            action = 'review_saved_candidates_for_rotation'
        elif city['saved_map_locations']:
            action = 'seed_from_saved_map_locations'
        else:
            action = 'reconcile_source_receipts_and_discover_if_needed'
        city['next_action'] = action
    write_csv(OUT/'municipality-summary.csv',list(cities.values()))
    return Counter(c['next_action'] for c in cities.values())


def get_snapshot():
    return remote(f"""
import pathlib,json
p=pathlib.Path({FOLDER!r})
results=p/'results'
status=json.loads((results/'status.json').read_text())
intake=json.loads((p/'screened.json').read_text())['items']
items=[]
for index,row in enumerate(intake):
    state='awaiting_worker'
    if index<status['processed']:
        report=json.loads((results/'records'/(row['organisation_id']+'.json')).read_text())
        state=report['state']
    items.append([row['city'],row['sector'],state])
print('RESULT:'+json.dumps({{'status':status,'items':items}},separators=(',',':')))
""")


def build(snapshot):
    status = snapshot['status']
    atlas = ROOT/'artifacts/service-baseline-atlas-20261029-reviewed'
    municipalities = json.loads((atlas/'municipality-manifest.json').read_text())
    labels = json.loads((atlas/'configured-community-manifest.json').read_text())
    cities = {c['geography_id']:c['name'] for c in municipalities}
    aliases = defaultdict(set)
    for city in municipalities:
        for label in [city['name'], *city.get('configured_labels', [])]:
            aliases[normalized(label)].add(city['geography_id'])
    for label in labels:
        if label.get('canonical_geography_id') in cities:
            aliases[normalized(label['label'])].add(label['canonical_geography_id'])

    def municipality(label):
        matches = aliases[normalized(label)]
        return next(iter(matches)) if len(matches)==1 else None

    inventory = json.loads(INVENTORY.read_text())
    sectors = set()
    counts, unresolved = defaultdict(Counter), defaultdict(Counter)
    seen = set()
    for r in inventory:
        if r['organisation_id'] in seen:
            continue
        seen.add(r['organisation_id'])
        geo, sector = municipality(r['city']), r['sector']
        if not sector:
            sector = 'unknown'
        sectors.add(sector)
        if geo:
            counts[(geo,sector)]['saved_research_inventory'] += 1
        else:
            unresolved[(r['city'],sector)]['saved_research_inventory'] += 1

    for label, sector, state in snapshot['items']:
        sector = sector or 'unknown'
        sectors.add(sector)
        geo = municipality(label)
        bucket = counts[(geo,sector)] if geo else unresolved[(label,sector)]
        bucket['worker_intake'] += 1
        if state!='awaiting_worker':
            bucket['processed'] += 1
        bucket[state] += 1

    records, next_city = [], {}
    fields = ('saved_research_inventory','worker_intake','processed',PREPARED,'awaiting_worker',
              'existing_identity_context_review','owner_or_sales_review','shared_phone_crm_review',
              'copy_or_identity_review','copy_review_needed','source_review','branch_identity_review',
              'suppression_hold','publication_restriction_review','duplicate_route_review')
    for geo, name in sorted(cities.items(),key=lambda t:t[1]):
        for sector in sorted(sectors):
            group = counts[(geo,sector)]
            if group[PREPARED]:
                state = 'drafts_available_review_remaining'
            elif group['processed']:
                state = 'processed_no_prepared_draft'
            elif group['worker_intake']:
                state = 'awaiting_enrichment'
            elif group['saved_research_inventory']:
                state = 'saved_candidates_not_in_worker'
            else:
                state = 'unobserved_in_saved_research_inventory'
            record = {'municipality_id':geo,'municipality':name,'map_category':sector,
                      'preparation_state':state,**{k:group[k] for k in fields}}
            records.append(record)
            if group['copy_or_identity_review'] or group['source_review']:
                action, rank = 'verify_location_identity_and_professional_route', 0
            elif state=='saved_candidates_not_in_worker':
                action, rank = 'review_saved_candidates_before_new_collection', 1
            elif state=='unobserved_in_saved_research_inventory':
                action, rank = 'reconcile_source_receipts_and_lookup_available_inventory', 2
            else:
                continue
            candidate = (rank, -group['saved_research_inventory'], sector,
                         {**record,'next_research_action':action})
            previous = next_city.get(geo)
            if previous is None or candidate[:3] < previous[:3]:
                next_city[geo] = candidate

    with (BASELINE/'coverage-ledger.csv').open() as handle:
        baseline = list(csv.DictReader(handle))
    states = Counter(r['preparation_state'] for r in records)
    summary = {'generated_at':datetime.now(timezone.utc).isoformat(),
               'worker_checkpoint':status['updated_at'],'worker_state':status['state'],
               'worker_intake':len(snapshot['items']),'worker_processed':status['processed'],
               'worker_prepared_drafts':status['contextual_drafts'],'target':status['target'],
               'inventory_records':len(seen),'municipalities':len(cities),'map_category_labels':len(sectors),
               'city_category_cells':len(records),'cell_states':dict(states),
               'municipalities_with_worker_intake':len({r['municipality_id'] for r in records if r['worker_intake']}),
               'municipalities_with_prepared_drafts':len({r['municipality_id'] for r in records if r[PREPARED]}),
               'unresolved_intake_records':sum(c['worker_intake'] for c in unresolved.values()),
               'unresolved_prepared_drafts':sum(c[PREPARED] for c in unresolved.values()),
               'baseline_source_cells':len(baseline),
               'baseline_states':dict(Counter(r['state'] for r in baseline)),
               'market_denominator':None,'research_actions_planned':len(next_city),'dispatch':False}
    assert sum(c['worker_intake'] for c in counts.values())+summary['unresolved_intake_records']==len(snapshot['items'])
    assert sum(c['processed'] for c in counts.values())+sum(c['processed'] for c in unresolved.values())==status['processed']
    assert sum(c[PREPARED] for c in counts.values())+summary['unresolved_prepared_drafts']==status['contextual_drafts']

    OUT.mkdir(parents=True,exist_ok=True)
    write_csv(OUT/'city-category-progress.csv',records)
    write_csv(OUT/'unresolved-locality-labels.csv',
              [{'mapped_label':label,'map_category':sector,**{k:c[k] for k in fields}}
               for (label,sector),c in sorted(unresolved.items())])
    # One proposed action per city on this pass. Keep the source-matrix receipts independent.
    write_csv(OUT/'next-city-research-actions.csv',
              [candidate[3] for candidate in sorted(next_city.values(),key=lambda c:(c[0],c[3]['municipality']))])
    summary.update(saved_map_footprint(cities))
    with (OUT/'saved-map-industry-families.csv').open() as handle:
        summary['municipal_next_actions'] = dict(write_city_summary(records,csv.DictReader(handle)))
    next_path = OUT/'summary.next'
    next_path.write_text(json.dumps(summary,indent=2)+'\n')
    next_path.replace(OUT/'summary.json')
    return summary


if __name__=='__main__':
    print(json.dumps(build(get_snapshot()),indent=2))
