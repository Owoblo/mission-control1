"""Validate independent research batches before single-writer evidence integration."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from urllib.parse import urlparse
from .windsor_physical_report import ROOT


def observation_key(row):
    def norm(v): return ' '.join((v or '').casefold().split())
    fields = [row['source_url'], norm(row['organization']), norm(row['address']), norm(row.get('unit_or_floor')),
              str(row['source_record_id']) if row.get('source_record_id') is not None else None]
    return hashlib.sha256(json.dumps(fields, ensure_ascii=False).encode()).hexdigest()


def validate_reference(row, root=ROOT):
    if urlparse(row['source_url']).scheme not in ('https','http') or not urlparse(row['source_url']).netloc:
        raise ValueError('Invalid source URL')
    if row.get('outreach_eligible') or row.get('private_residential_occupant'):
        raise ValueError('Research intake cannot enable outreach or import private residential occupants')
    if 'scpl.com' == urlparse(row['source_url']).netloc.removeprefix('www.'):
        raise ValueError('Source is held for commercial-reuse restrictions')
    reference = row.get('raw_evidence_reference')
    reference_metadata = reference if isinstance(reference, dict) else None
    raw_path = reference.get('path') if reference_metadata else reference
    if not isinstance(raw_path, str) or not raw_path.strip():
        raise ValueError('Missing source evidence path')
    raw = (root/raw_path).resolve()
    if root.resolve() not in raw.parents:
        raise ValueError('Evidence source must be inside repository artifacts')
    if not raw.is_file():
        raise ValueError('Missing source evidence file')
    digest = hashlib.sha256(raw.read_bytes()).hexdigest()
    for supplied_hash in (row.get('source_sha256'), reference_metadata.get('sha256') if reference_metadata else None):
        if supplied_hash and digest != supplied_hash:
            raise ValueError('Source bytes do not match supplied checksum')
    return {**({'source_evidence': reference_metadata} if reference_metadata else {}),
            'source_sha256': digest, 'raw_evidence_reference': str(raw.relative_to(root.resolve()))}


def validate_contacts(row):
    for channel in row.get('published_contact_channels', []):
        if channel.get('type') not in ('phone','email','website','fax') or not isinstance(channel.get('value'), str) or not channel['value'].strip():
            raise ValueError('Invalid contact channel')
        for field in ('published_label','scope'):
            if not isinstance(channel.get(field), str):
                raise ValueError('Contact channel must retain label and scope')


def validate(row, root=ROOT):
    for field in ('organization', 'address', 'relationship', 'source_url', 'status', 'checked_on'):
        if not isinstance(row.get(field), str) or not row[field].strip():
            raise ValueError('Missing/non-text field: '+field)
    if 'unit_or_floor' not in row or not (row['unit_or_floor'] is None or isinstance(row['unit_or_floor'], str)):
        raise ValueError('unit_or_floor must be explicitly supplied or null')
    reference = validate_reference(row, root)
    validate_contacts(row)
    return {**row, **reference, 'observation_id': observation_key(row),
            'outreach_eligible': False, 'communication_eligibility': 'not_assessed'}


def merge_rows(existing, incoming, root=ROOT):
    results = list(existing)
    existing_keys = {observation_key(row) for row in existing}
    added, duplicate, held = [], [], []
    for i, row in enumerate(incoming):
        try:
            item = validate(row, root)
        except (KeyError, ValueError, TypeError) as error:
            held.append({'row_index': i, 'organization': row.get('organization'),
                         'source_url': row.get('source_url'), 'reason': str(error)})
            continue
        if item['observation_id'] in existing_keys:
            duplicate.append({'row_index': i, 'organization': item['organization'],
                              'observation_id': item['observation_id'], 'reason': 'Same source/record identity, name, address and unit; prior evidence preserved'})
            continue
        results.append(item); existing_keys.add(item['observation_id']); added.append(item['observation_id'])
    return results, {'incoming_rows': len(incoming), 'added_observations': len(added),
                     'same_observation_duplicates': len(duplicate), 'held_observations': len(held),
                     'added_ids': added, 'duplicate_details': duplicate, 'held_details': held}


def run(batch):
    batch = batch.resolve()
    if ROOT not in batch.parents or batch.name != 'observations.json':
        raise ValueError('Expected observations.json batch inside this repository')
    incoming = json.loads(batch.read_text())
    if isinstance(incoming, dict): incoming = incoming['observations']
    if not isinstance(incoming, list): raise ValueError('Expected observation list')
    target = Path(__file__).with_name('windsor_address_evidence.json')
    before = target.read_bytes(); evidence = json.loads(before)
    merged, receipt = merge_rows(evidence['observations'], incoming)
    receipt.update({'batch_file': str(batch.relative_to(ROOT)), 'checked_at': datetime.now(timezone.utc).isoformat(),
                    'batch_sha256': hashlib.sha256(batch.read_bytes()).hexdigest(),
                    'evidence_before_sha256': hashlib.sha256(before).hexdigest(),
                    'prior_observations': len(evidence['observations']), 'resulting_observations': len(merged),
                    'database_writes': 0, 'outreach_activated': False,
                    'scope': 'Research observation intake; schema/provenance validation is not verification of organization identity, currentness or ownership'})
    if target.read_bytes() != before: raise RuntimeError('Evidence changed concurrently; retry after other writer completes')
    evidence['observations'] = merged
    evidence['method'] = 'Source-supported research observations from official organization pages, publishers and labelled directories; separate observations retained without automatic entity merging.'
    if receipt['added_observations']:
        temporary = target.with_suffix('.json.pending')
        temporary.write_text(json.dumps(evidence, indent=2)+'\n'); temporary.replace(target)
    receipt['evidence_after_sha256'] = hashlib.sha256(target.read_bytes()).hexdigest()
    out = batch.parent/'integration-receipt.json'
    if out.exists():
        history = batch.parent/'integration-history.jsonl'
        with history.open('a') as f: f.write(out.read_text().replace('\n','')+'\n')
    out.write_text(json.dumps(receipt, indent=2))
    print(json.dumps(receipt, indent=2))


if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('batch', type=Path)
    run(p.parse_args().batch)
