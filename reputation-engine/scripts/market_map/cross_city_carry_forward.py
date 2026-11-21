"""Retain source-supported out-of-area leads for later city research."""
import hashlib
import json
from collections import Counter
from datetime import datetime, timezone
from .windsor_physical_report import ROOT
from .windsor_batch_merge import validate_reference, validate_contacts


def build():
    source = ROOT/'artifacts/windsor-parallel-institutions-20261029-batch02/held.json'
    catalogue = json.loads((ROOT/'partnership-system/catalogs/service-areas.json').read_text())
    locations = catalogue['locations']
    rows = []
    inputs = [(source, item, True) for item in json.loads(source.read_text())
              if item.get('status') == 'outside_canonical_windsor_boundary']
    for receipt in sorted((ROOT/'artifacts').glob('windsor-parallel-*/integration-receipt.json')):
        for filename in ('cross-city-leads.json', 'cross-city-observations.json'):
            extra = receipt.parent/filename
            if extra.exists():
                inputs.extend((extra, item, False) for item in json.loads(extra.read_text()))
    seen = set()
    for source, item, municipal_open_data in inputs:
        evidence = validate_reference(item)
        validate_contacts(item)
        municipality = item.get('municipality_published') or item.get('municipality') or (item.get('destination_hint') or {}).get('municipality_name') or None
        matches = [r for r in locations if municipality and r['location'].casefold() == municipality.casefold()]
        identity = [item.get('source_id',item['source_url']), item.get('source_record_id'),
                    item.get('organization', item.get('name')), item.get('address'), item.get('unit_or_floor')]
        key = hashlib.sha256((item['source_id']+'|'+item['source_record_id']).encode()).hexdigest() if municipal_open_data else hashlib.sha256(json.dumps(identity).encode()).hexdigest()
        if key in seen:
            continue
        seen.add(key)
        rows.append({**item, **evidence, 'carry_forward_id': key,
                     'discovered_during_city': 'Windsor',
                     'destination_city_published': municipality,
                     'configured_area_candidates': matches,
                     'destination_boundary_verified': False,
                     'routing_status': 'published_city_exact_label_match' if matches else 'destination_review',
                     'relationship_type': item.get('relationship', 'facility_location'),
                     'current_occupancy_verified': False,
                     'outreach_eligible': False,
                     'next_research': 'Verify destination boundary, current facility and existing inventory identity before admission.',
                     'licence': ('Open Government Licence – The Corporation of the City of Windsor' if municipal_open_data
                                 else item.get('rights_status', 'Internal factual research; no open reuse licence established')),
                     'discovery_batch_reference': str(source.relative_to(ROOT))})
    out = ROOT/'artifacts/cross-city-carry-forward-20261029'
    out.mkdir(exist_ok=True)
    (out/'leads.json').write_text(json.dumps(rows, indent=2)+'\n')
    summary = {'generated_at': datetime.now(timezone.utc).isoformat(),
               'source_observations': len(rows),
               'by_published_city': dict(Counter(r['destination_city_published'] or 'unknown' for r in rows)),
               'routing_status': dict(Counter(r['routing_status'] for r in rows)),
               'new_verified_organizations': None,
               'limits': 'City labels are source-published routing hints, not validated boundary membership. Historical records retained. No Windsor coverage credit or automatic outreach.'}
    (out/'summary.json').write_text(json.dumps(summary, indent=2)+'\n')
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    build()
