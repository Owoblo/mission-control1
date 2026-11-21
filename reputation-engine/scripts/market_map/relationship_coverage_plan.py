"""Offline coverage reporting and bounded rotation. No paid research, sends or DB writes."""
from __future__ import annotations
import argparse
import csv
import hashlib
import html
import json
import re
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCES = ('company_websites', 'local_directory', 'association_directory',
           'company_relationships', 'official_jurisdiction', 'google_maps')


def normalized(value):
    return re.sub(r'[^a-z0-9]+', ' ', (value or '').casefold()).strip()


def rotate(cities, categories, wave, limit):
    """One task per municipality per round; visit every category/source before repeating."""
    if wave < 0 or limit < 1:
        raise ValueError('wave must be nonnegative; limit must be positive')
    result = []
    for index in range(wave * limit, (wave + 1) * limit):
        turn, city_index = divmod(index, len(cities))
        city = cities[city_index]
        category = categories[(turn + city_index) % len(categories)]
        source = SOURCES[(turn // len(categories)) % len(SOURCES)]
        key = '|'.join((city['geography_id'], category['category_id'], source))
        result.append(dict(task_id='coverage_' + hashlib.sha256(key.encode()).hexdigest()[:24],
                           municipality_id=city['geography_id'], municipality=city['name'],
                           category_id=category['category_id'], category=category['category'],
                           source_id=source, state='planned_not_executed',
                           question=f"Reconcile saved {category['category']} evidence in {city['name']}; identify missing identities, routes and source coverage before collection",
                           research_route='reuse_saved_evidence_then_deterministic_extraction',
                           escalation_rule='Specific unresolved question plus remaining existing budget required',
                           automatic_send=False, paid_research_authorized_by_plan=False))
    return result


def write_csv(path, rows):
    with path.open('w', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]) if rows else ['id'])
        writer.writeheader()
        writer.writerows(rows)


def build(output, wave=0, limit=107):
    atlas = ROOT / 'artifacts/service-baseline-atlas-20261029-reviewed'
    municipalities = json.loads((atlas / 'municipality-manifest.json').read_text())
    cities = sorted(municipalities, key=lambda r: (r['name'], r['geography_id']))
    assert len({r['geography_id'] for r in cities}) == len(cities)
    communities = json.loads((atlas / 'configured-community-manifest.json').read_text())
    categories = list(csv.DictReader((ROOT / 'partnership-system/catalogs/outreach-overlay.csv').open()))
    aliases = defaultdict(set)
    for row in cities:
        for name in [row['name'], *row.get('configured_labels', [])]:
            aliases[normalized(name)].add(row['geography_id'])
    for row in communities:
        if row.get('canonical_geography_id') in {r['geography_id'] for r in cities}:
            aliases[normalized(row['label'])].add(row['canonical_geography_id'])
    state = ROOT / 'partnership-system/state/november-revival-20261117'
    contacts = {r['id']: r for r in json.loads((state / 'market_contacts.json').read_text())}
    snapshot = json.loads((state / 'snapshot.json').read_text())
    for row in snapshot['contacts']:
        contacts[row['id']] = {**contacts.get(row['id'], {}), **row}
    touches = defaultdict(set)
    for row in snapshot['touches']:
        touches[row['contact_id']].add(row.get('direction'))
    metrics = defaultdict(Counter)
    unresolved = []
    for row in contacts.values():
        matches = aliases.get(normalized(row.get('city')), set())
        if len(matches) != 1:
            unresolved.append(dict(contact_id=row['id'], city=row.get('city'), reason='unmapped_or_ambiguous_geography'))
            continue
        geo = next(iter(matches))
        text = normalized(' '.join(str(row.get(k) or '') for k in ('company', 'industry', 'title')))
        found = []
        for cat in categories:
            terms = [normalized(t) for t in cat['search_synonyms'].split(';')]
            if any(t and re.search(r'\b' + re.escape(t) + r'\b', text) for t in terms):
                found.append(cat['category_id'])
        if 'mortgage' in text and 'category-22' not in found:
            found.append('category-22')
        if not found:
            found = ['unclassified']
        for cid in found:
            m = metrics[(geo, cid)]
            m['crm_candidate_records'] += 1
            m['with_phone'] += bool(row.get('phone'))
            m['with_email'] += bool(row.get('email'))
            m['suppressed'] += bool(row.get('do_not_contact') or row.get('cross_channel_suppressed_at'))
            m['with_outbound_history'] += 'outbound' in touches[row['id']]
            m['with_inbound_history'] += 'inbound' in touches[row['id']]
    # Exact source taxonomy for the owner's mortgage example; organizations are NOT people.
    database = ROOT / 'partnership-system/state/market-map.sqlite'
    db = sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True)
    mortgage = db.execute("""SELECT l.municipality_id, COUNT(DISTINCT o.id), COUNT(DISTINCT l.id)
      FROM classifications c CROSS JOIN organisations o ON o.id=c.entity_id
      CROSS JOIN locations l ON l.organisation_id=o.id
      WHERE c.entity_type='organisation' AND c.category IN
      ('mortgage_broker','mortgage_lender','Mortgage Broker or Brokerage',
       'Mortgage and non-mortgage loan brokers') GROUP BY l.municipality_id""").fetchall()
    db.close()
    mortgage_by_city = {r[0]: r[1:] for r in mortgage}
    report = []
    for city in cities:
        for cat in [*categories, dict(category_id='unclassified', category='Unclassified CRM records')]:
            m = metrics[(city['geography_id'], cat['category_id'])]
            counts = mortgage_by_city.get(city['geography_id'], (0, 0)) if cat['category_id'] == 'category-22' else (None, None)
            report.append(dict(municipality_id=city['geography_id'], municipality=city['name'],
                category_id=cat['category_id'], category=cat['category'],
                **{k:m[k] for k in ('crm_candidate_records','with_phone','with_email','suppressed','with_outbound_history','with_inbound_history')},
                map_source_organisation_records=counts[0], map_source_location_records=counts[1],
                verified_unique_people=None, total_addressable_market=None,
                coverage_percent=None, revenue_market_share_percent=None,
                delivery_confirmed_people=None, qualified_opportunities=None,
                quoted_moves=None, booked_moves=None, completed_moves=None,
                attributed_revenue=None, full_research_cost_usd=None,
                classification='CRM lexical candidates; mortgage map counts use explicit source categories',
                freshness=snapshot['at']))
    plan = rotate(cities, categories, wave, limit)
    worklist = json.loads((state / 'logistics-intelligence-worklist.json').read_text())
    output.mkdir(parents=True, exist_ok=True)
    write_csv(output / 'city-category-metrics.csv', report)
    write_csv(output / 'next-research-batch.csv', plan)
    (output / 'relationship-review-work.json').write_text(json.dumps(worklist, indent=2))
    (output / 'unresolved-geographies.json').write_text(json.dumps(unresolved, indent=2))
    # Materialize the complete configured matrix; no cell is falsely declared searched.
    cells = [dict(municipality_id=c['geography_id'], municipality=c['name'],
        category_id=k['category_id'], category=k['category'], source_id=s,
        state='unknown_execution_receipts_not_reconciled')
        for c in cities for k in categories for s in SOURCES]
    write_csv(output / 'coverage-ledger.csv', cells)
    manifest = dict(generated_at=datetime.now(timezone.utc).isoformat(), snapshot_at=snapshot['at'],
        municipalities=len(cities), categories=len(categories), configured_labels=len(communities),
        full_coverage_cells=len(cells), planned_tasks=len(plan), wave=wave,
        distinct_cities_in_batch=len({r['municipality_id'] for r in plan}),
        distinct_categories_in_batch=len({r['category_id'] for r in plan}),
        crm_records_loaded=len(contacts), unresolved_crm_geographies=len(unresolved),
        preserved_relationship_actions=len(worklist['work']),
        automatic_send=False, paid_calls=0, deployed_scheduler_changed=False,
        limitations=['Saved snapshots, not live CRM reporting.',
          'CRM candidate records are not deduplicated verified people; category matches are provisional and may overlap.',
          'Map organizations and CRM records have NOT been identity-reconciled; never add these counts.',
          'Inbound/outbound history is available only for the saved conversation cohort, not all CRM contacts.',
          'No verified market denominator: coverage and revenue share remain unknown.',
          'Six configured source families are not an exhaustive source registry.',
          'Planned batches require evidence reconciliation and source-specific eligibility before execution.'],
        inputs=[dict(path=str(p.relative_to(ROOT)),sha256=hashlib.sha256(p.read_bytes()).hexdigest())
            for p in (atlas/'municipality-manifest.json',atlas/'configured-community-manifest.json',
                      ROOT/'partnership-system/catalogs/outreach-overlay.csv',state/'market_contacts.json',
                      state/'snapshot.json',state/'logistics-intelligence-worklist.json')])
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    usage = json.loads((state / 'research-resume-verification.json').read_text())
    batch = usage['city']['last_batch']
    cost = dict(evidence_at=usage['at'], reporting_run_paid_calls=0,
        last_saved_batch=batch,
        token_estimate_per_saved_investigation_usd=(batch['estimated_saved_result_token_usd']/batch['saved']) if batch['saved'] else None,
        full_provider_bill_usd=None, cost_per_verified_contact_usd=None,
        cost_per_qualified_opportunity_usd=None,
        exclusions='Saved-result token estimate excludes unreported search/tool charges, retries, infrastructure and other unallocated costs; it is not the provider bill.',
        routing=['reuse captured evidence and identity matches','deterministic extraction of structured fields',
                 'bounded model extraction only for unresolved structure','deep research for a named missing fact',
                 'human review for identity conflicts or commitments'],
        controls=['No paid request is authorized by this planner.',
                  'Preserve existing worker caps and unknown-request locks.',
                  'Reuse source URL/hash and extraction version; refresh on expiry or change.',
                  'Batch common organization/domain sources without merging separate people or tenants.',
                  'Record actual provider usage, tool fees and acceptance yield before claiming savings.'])
    (output/'research-cost-report.json').write_text(json.dumps(cost,indent=2))
    payload = json.dumps(report).replace('<','\\u003c')
    page = '''<!doctype html><meta charset="utf-8"><title>Relationship coverage</title>
<style>body{font:16px system-ui;margin:32px;color:#172b42}table{border-collapse:collapse;font-size:14px}th,td{padding:9px;border-bottom:1px solid #ddd;text-align:left}input,select{padding:9px;margin:8px}aside{padding:16px;background:#edf3f7}th{position:sticky;top:0;background:white}</style>
<h1>City and category coverage</h1><aside>Saved evidence: SNAPSHOT. Candidate counts are provisional. Market coverage %, verified unique people and revenue share are unknown until denominators and identity reconciliation exist. Map organizations and CRM records overlap; do not add them. History counts cover the captured conversation cohort only.</aside>
<p><label>City <select id="city"><option value="">All cities</option></select></label><label>Category <select id="category"><option value="">All categories</option></select></label></p><p id="summary"></p>
<details><summary>Research cost and efficiency</summary><p>This reporting run made zero paid research calls. Last saved batch: COSTSUMMARY. These are saved site investigations, not verified new prospects. Full provider bill and cost per qualified opportunity remain unknown. Reuse saved evidence → deterministic extraction → bounded model extraction → selective deep research. Existing worker spending limits remain in force.</p></details>
<table><thead><tr><th>City</th><th>Category</th><th>CRM candidates</th><th>Phone</th><th>Email</th><th>Suppressed</th><th>Outbound history</th><th>Inbound history</th><th>Map organizations</th><th>Map locations</th><th>Market coverage</th></tr></thead><tbody id="rows"></tbody></table>
<script>const data=PAYLOAD;const city=document.getElementById('city'),category=document.getElementById('category');
for(const [el,key] of [[city,'municipality'],[category,'category']]){for(const v of [...new Set(data.map(r=>r[key]))].sort()){const o=document.createElement('option');o.value=v;o.textContent=v;el.append(o)}el.onchange=render}
function render(){const selected=data.filter(r=>(!city.value||r.municipality===city.value)&&(!category.value||r.category===category.value));document.getElementById('summary').textContent=selected.length+' city/category rows. Blank source counts mean not yet integrated, not zero.';const body=document.getElementById('rows');body.replaceChildren();for(const r of selected){const tr=document.createElement('tr');for(const key of ['municipality','category','crm_candidate_records','with_phone','with_email','suppressed','with_outbound_history','with_inbound_history','map_source_organisation_records','map_source_location_records','coverage_percent']){const td=document.createElement('td');td.textContent=r[key]??'Unknown';tr.append(td)}body.append(tr)}}render();</script>'''
    cost_summary=f"{batch['saved']} saved; {batch['api_requests_started']} API requests; ${batch['estimated_saved_result_token_usd']:.4f} saved-result token estimate (${cost['token_estimate_per_saved_investigation_usd']:.4f} per saved investigation), excluding search/tool fees and other unallocated costs; evidence {usage['at']}"
    (output / 'index.html').write_text(page.replace('SNAPSHOT',html.escape(str(snapshot['at']))).replace('COSTSUMMARY',html.escape(cost_summary)).replace('PAYLOAD',payload))
    return manifest


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=ROOT/'partnership-system/state/coverage-plan-20261117')
    parser.add_argument('--wave',type=int,default=0)
    parser.add_argument('--limit',type=int,default=107)
    args=parser.parse_args()
    print(json.dumps(build(args.output,args.wave,args.limit),indent=2))


if __name__=='__main__':
    main()
