"""Select an evidence-backed first research turn for municipalities outside the active batch."""
from collections import Counter, defaultdict, deque
from contextlib import closing
import csv
from datetime import datetime, timezone
import json
import re
import sqlite3
from urllib.parse import urlsplit

from .geo_coverage_progress import INVENTORY, OUT, ROOT
from .geo_outreach_cohort import build
from .relationship_coverage_plan import normalized, write_csv


def host(value):
    try:
        parsed = urlsplit(value if '://' in value else 'https://'+value)
        domain = (parsed.hostname or '').removeprefix('www.').lower()
    except ValueError:
        return ''
    if not re.fullmatch(r'(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}',domain):
        return ''
    generic = ('facebook.com','instagram.com','linkedin.com','google.com','linktr.ee',
               'yellowpages.ca','realtor.ca','yelp.ca','canada.ca','ontario.ca')
    return '' if any(domain==d or domain.endswith('.'+d) for d in generic) else domain


def candidates(db, municipality_id, taxonomy='ssm_industry_family', location_window=None):
    scope = ('SELECT * FROM locations WHERE municipality_id=? AND country=\'CA\' LIMIT ?'
             if location_window else 'SELECT * FROM locations WHERE municipality_id=? AND country=\'CA\'')
    args = (municipality_id,location_window,taxonomy) if location_window else (municipality_id,taxonomy)
    return db.execute(f"""
        WITH local_locations AS MATERIALIZED ({scope})
        SELECT l.id,l.organisation_id,COALESCE(o.trading_name,o.legal_name),l.city_raw,
               COALESCE(l.street,l.address_raw),o.primary_domain,c.category,e.source_url,e.fetched_at
        FROM local_locations l JOIN organisations o ON o.id=l.organisation_id
        JOIN classifications c ON c.entity_id=o.id AND c.taxonomy=?
        JOIN source_identities s ON s.location_id=l.id AND s.organisation_id=o.id
        JOIN evidence e ON e.id=s.last_evidence_id
        WHERE o.primary_domain IS NOT NULL
          AND c.entity_type='organisation'
          AND COALESCE(o.status,'') NOT IN ('closed','permanently_closed','inactive')
          AND COALESCE(l.status,'') NOT IN ('closed','permanently_closed','inactive')
        ORDER BY (l.street IS NOT NULL) DESC, e.fetched_at DESC,l.id,c.category,s.source_id
    """,args)


def prepare(limit_per_city=3):
    with (OUT/'municipality-summary.csv').open() as handle:
        gaps = [r for r in csv.DictReader(handle) if not int(r['worker_intake'])]
    cohort = build(ROOT,4000)['items']
    active_domains = {host(r['website']) for r in cohort}
    active_names = {(normalized(r['name']),normalized(r['city'])) for r in cohort}
    inventory = defaultdict(list)
    for row in json.loads(INVENTORY.read_text()):
        inventory[normalized(row['city'])].append(row)
    db_path = ROOT/'partnership-system/state/market-map.sqlite'
    selected_domains, selected_orgs = set(), set()
    selected = defaultdict(list)
    with closing(sqlite3.connect(db_path.resolve().as_uri()+'?mode=ro',uri=True)) as db:
        for city in gaps:
            geo, name = city['municipality_id'], city['municipality']
            def available(org, label, site):
                return (org not in selected_orgs and bool(site) and site not in selected_domains
                        and site not in active_domains and (normalized(label),normalized(name)) not in active_names)

            def admit(row):
                selected[geo].append(row)
                selected_domains.add(row['domain'])
                selected_orgs.add(row['organisation_id'])

            for row in inventory[normalized(name)]:
                site = host(row.get('website') or '')
                if len(selected[geo]) == limit_per_city:
                    break
                if available(row['organisation_id'],row['organisation_name'],site) and row.get('inventory_source_url'):
                    admit({'municipality_id':geo,'municipality':name,'organisation_id':row['organisation_id'],
                           'location_id':'','organization':row['organisation_name'],'map_category':row['sector'],
                           'domain':site,'website_candidate':row['website'],
                           'source_url':row['inventory_source_url'],'source_observed_at':'',
                           'mapped_city_label':row['city'],'address_hint':'','origin':'saved_research_inventory'})

            buckets = defaultdict(deque)
            taxonomy = 'ssm_industry_family'
            map_rows = list(candidates(db,geo,taxonomy))
            if not map_rows:
                taxonomy = 'Overture Places'
                map_rows = list(candidates(db,geo,taxonomy))
            for loc, org, label, city_label, address, domain, family, source, observed in map_rows:
                site = host(domain or '')
                if not source or not label or not available(org,label,site):
                    continue
                buckets[family].append({'municipality_id':geo,'municipality':name,'organisation_id':org,
                       'location_id':loc,'organization':label,'map_category':family,'domain':site,
                       'website_candidate':'https://'+site+'/', 'source_url':source,
                       'source_observed_at':observed or '', 'mapped_city_label':city_label or '',
                       'address_hint':address or '', 'origin':'saved_map_location',
                       'map_taxonomy':taxonomy})
            while buckets and len(selected[geo])<limit_per_city:
                families_used = Counter(r['map_category'] for r in selected[geo])
                for family in sorted(buckets,key=lambda k:(families_used[k],-len(buckets[k]),k)):
                    bucket = buckets[family]
                    row = bucket.popleft()
                    if not bucket:
                        del buckets[family]
                    if available(row['organisation_id'],row['organization'],row['domain']):
                        admit(row)
                    if len(selected[geo])==limit_per_city:
                        break
    batch = []
    for turn in range(limit_per_city):
        for city in gaps:
            rows = selected[city['municipality_id']]
            if turn<len(rows):
                batch.append({**rows[turn],'review_state':'verify_location_and_professional_route','dispatch':False})
    summary = {'generated_at':datetime.now(timezone.utc).isoformat(),'seeded_candidates':len(batch),
               'gap_municipalities':len(gaps),'municipalities_with_seed':sum(bool(v) for v in selected.values()),
               'categories':len({r['map_category'] for r in batch}),
               'candidate_origins':dict(Counter(r['origin'] for r in batch)),
               'cities_without_seed':[c['municipality'] for c in gaps if not selected[c['municipality_id']]],
               'dispatch':False}
    write_csv(OUT/'gap-research-intake.csv',[{'map_taxonomy':r.get('map_taxonomy','saved_research_label'),**r} for r in batch])
    (OUT/'gap-research-intake.json').write_text(json.dumps({'summary':summary,'items':batch},indent=2)+'\n')
    return summary


if __name__=='__main__':
    print(json.dumps(prepare(),indent=2))
