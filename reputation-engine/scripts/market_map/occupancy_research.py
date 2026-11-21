"""Evidence-preserving shared-address research queues; never occupancy assertions."""
import hashlib
import json
import re
from collections import defaultdict


def address_key(value):
    # Preserve unit punctuation and numbers; do not collapse suites into buildings.
    return re.sub(r'\s+', ' ', (value or '').strip().casefold())


def build_queue(rows, municipality_code):
    groups = defaultdict(dict)
    conflicts = []
    seen = {}
    missing = []
    for row in rows:
        identity = row['gers']
        if identity in seen:
            if row != seen[identity]:
                conflicts.append({'source_record_id': identity, 'reason': 'conflicting_observations',
                                  'observations': [seen[identity], row]})
            continue
        seen[identity] = row
        key = address_key(row.get('address'))
        if not key:
            missing.append(identity)
            continue
        groups[key][identity] = row
    queue = []
    conflicted = {r['source_record_id'] for r in conflicts}
    for key, members in sorted(groups.items()):
        if len(members) < 2:
            continue
        queue.append({
            'research_id': hashlib.sha256((municipality_code + '\0' + key).encode()).hexdigest(),
            'municipality_code': municipality_code, 'reported_address': key,
            'source_place_count': len(members), 'source_record_ids': sorted(members),
            'observations': list(members.values()),
            'status': 'source_conflict' if conflicted.intersection(members) else 'shared_reported_address_requires_research',
            'known_suite_count': None, 'verified_occupant_count': None, 'building_id': None,
            'interpretation': 'Co-addressed source places may be duplicates, historical occupants, departments or separate organizations; no building or tenancy inferred.'})
    return {'queue': queue, 'conflicts': conflicts, 'missing_address_ids': sorted(missing),
            'unique_source_places': len(seen)}


def write_queue(rows, municipality_code, output):
    result = build_queue(rows, municipality_code)
    for name, key in [('occupancy-research.jsonl', 'queue'), ('place-conflicts.jsonl', 'conflicts')]:
        with (output / name).open('w') as handle:
            for row in result[key]:
                handle.write(json.dumps(row, ensure_ascii=False) + '\n')
    return {'shared_reported_address_groups': len(result['queue']),
            'conflicting_place_observations': len(result['conflicts']),
            'places_without_reported_address': len(result['missing_address_ids']),
            'unique_source_places': result['unique_source_places']}
