#!/usr/bin/env python3
"""Validate Muse pilot deliveries; optionally stage immutable snapshots in LOCAL SQLite.

No network, production writes, archive extraction, or outreach. This validates the
four pilot JSONL datasets, not the legacy archive or truth of source evidence.
"""
import argparse
import hashlib
import json
import posixpath
import sqlite3
import zipfile
from pathlib import Path, PurePosixPath

PREFIX = '03_sold2move_pilot/'
FILES = ('pilot_listings', 'listing_photos', 'property_classifications', 'listing_observations')
CATEGORIES = {'ordinary_resale', 'investor_flip', 'student_housing', 'rental', 'new_construction', 'land_lot'}
OCCUPANCY = {'furnished', 'partially_furnished', 'empty', 'construction', 'not_applicable', 'unknown'}
SEGMENTS = {'owner_occupied', 'investor_flip', 'student_housing', 'rental', 'new_construction', 'land_lot', 'unknown'}
MAX_UNCOMPRESSED = 250 * 1024 * 1024


def inspect_delivery(path):
    errors, warnings, rows = [], [], {}
    report = {'zip_sha256': hashlib.sha256(Path(path).read_bytes()).hexdigest(),
              'scope': 'four pilot datasets only; source truth and whole-market coverage not certified',
              'errors': errors, 'warnings': warnings}
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        if len(names) != len(set(names)):
            errors.append('Duplicate ZIP member names')
        if any(PurePosixPath(n).is_absolute() or '..' in PurePosixPath(n).parts for n in names):
            errors.append('Unsafe ZIP member path')
        if sum(i.file_size for i in z.infolist()) > MAX_UNCOMPRESSED:
            raise ValueError('Delivery exceeds uncompressed size limit')
        if errors:
            report['valid'] = False
            return report, rows
        if z.testzip():
            errors.append('ZIP CRC failure')
        candidates = [p for p in (PREFIX, 'pilot_v1.1/') if p + 'run_manifest.json' in names]
        if len(candidates) != 1:
            raise ValueError('Expected exactly one recognized pilot directory')
        prefix = candidates[0]
        hashed = set()
        if 'ZIP_MANIFEST.sha256' not in names:
            errors.append('Missing outer checksum manifest')
        else:
            for line in z.read('ZIP_MANIFEST.sha256').decode().splitlines():
                if not line.strip():
                    continue
                parts = line.split(maxsplit=1)
                if len(parts) != 2:
                    errors.append('Malformed checksum manifest line')
                    continue
                expected, name = parts
                name = name.strip().lstrip('*')
                if name in hashed:
                    errors.append('Duplicate checksum entry: ' + name)
                hashed.add(name)
                if name not in names or hashlib.sha256(z.read(name)).hexdigest() != expected:
                    errors.append('Checksum mismatch or missing file: ' + name)
            unhashed = set(n for n in names if not n.endswith('/')) - hashed - {'ZIP_MANIFEST.sha256'}
            if unhashed:
                errors.append('Unhashed files: ' + ', '.join(sorted(unhashed)))
        manifest = json.loads(z.read(prefix + 'run_manifest.json'))
        report['run_id'] = manifest.get('run_id')
        report['schema_version'] = manifest.get('schema_version')
        if not isinstance(report['run_id'], str) or not report['run_id'].strip():
            errors.append('Missing run_id')
        if report['schema_version'] != 'sold2move-backup/1.1':
            errors.append('Unsupported schema; expected sold2move-backup/1.1')
        if 'No owner-supplied' in manifest.get('region_manifest_status', '') and manifest.get('region_reconciliation', {}).get('manifest_read_confirmed'):
            warnings.append('Manifest contains contradictory region receipt statements')
        for dataset in FILES:
            name = prefix + dataset + '.jsonl'
            rows[dataset] = [json.loads(line) for line in z.read(name).decode().splitlines() if line.strip()]
            if any(not isinstance(r, dict) for r in rows[dataset]):
                raise ValueError('JSONL rows must be objects: ' + name)
            if manifest.get('counts', {}).get(dataset) != len(rows[dataset]):
                errors.append('Manifest count mismatch: ' + dataset)

    keys = set()
    for r in rows['pilot_listings']:
        key = r.get('listing_key')
        if not isinstance(key, str) or not key or key in keys:
            errors.append('Invalid/duplicate listing_key: ' + str(key))
        keys.add(key)
        if not r.get('property_key'):
            errors.append(str(key) + ': missing property_key')
        for field in ('zpid', 'postal_code', 'mls_number'):
            if r.get(field) is not None and (not isinstance(r[field], str) or not r[field].strip()):
                errors.append(str(key) + ': invalid nullable string ' + field)
        amount = r.get('price_amount')
        if amount is not None and (type(amount) is not int or amount <= 0):
            errors.append(str(key) + ': price_amount must be positive integer or null')
        if r.get('transaction_type') not in {'sale', 'rent', 'unknown'}:
            errors.append(str(key) + ': invalid transaction_type')
        if r.get('transaction_type') == 'rent' and r.get('current_availability') != 'not_confirmed':
            errors.append(str(key) + ': this pilot has no accepted current rental availability proof')

    for dataset in FILES[1:]:
        seen = set()
        for r in rows[dataset]:
            key = r.get('listing_key')
            identity = r.get('observation_id') if dataset == 'listing_observations' else key
            if key not in keys:
                errors.append(dataset + ': orphan listing ' + str(key))
            if not isinstance(identity, str) or not identity or identity in seen:
                errors.append(dataset + ': invalid/duplicate record identity ' + str(identity))
            seen.add(identity)
        if dataset != 'listing_observations' and seen != keys:
            errors.append(dataset + ': must contain exactly one row per pilot listing')

    for r in rows['property_classifications']:
        key = r['listing_key']
        for field in ('listing_categories', 'property_signals'):
            if not isinstance(r.get(field), list) or any(not isinstance(v, str) for v in r.get(field, [])):
                errors.append(key + ': ' + field + ' must be a native string array')
        if isinstance(r.get('listing_categories'), list) and set(r['listing_categories']) - CATEGORIES:
            errors.append(key + ': invalid listing_categories ' + repr(r['listing_categories']))
        if r.get('occupancy_state') not in OCCUPANCY or r.get('market_segment') not in SEGMENTS:
            errors.append(key + ': invalid classification enum')
        if r.get('confidence_label') not in {'low', 'medium', 'high'} or 'classification_confidence' in r:
            errors.append(key + ': use ordinal confidence_label only')
        value = r.get('is_furnished')
        if value is not None and type(value) is not bool:
            errors.append(key + ': is_furnished must be boolean or null')
        state = r.get('occupancy_state')
        expected = True if state in {'furnished', 'partially_furnished'} else False if state in {'empty', 'construction', 'not_applicable'} else None
        if value is not expected:
            errors.append(key + ': occupancy_state/is_furnished mismatch')
        reason = str(r.get('classification_reasons', '')).lower()
        if value is True and ('occupancy cannot be determined' in reason or 'no interior in the sample' in reason):
            errors.append(key + ': furnished result contradicts its retained explanation')

    for r in rows['listing_photos']:
        key = r['listing_key']
        urls, indexes, count = r.get('photo_urls'), r.get('inspected_indexes'), r.get('available_count')
        if not isinstance(urls, list) or any(not isinstance(u, str) or not u.startswith(('https://', 'http://')) for u in urls):
            errors.append(key + ': invalid photo URL array')
        if count is not None and (type(count) is not int or count < 0):
            errors.append(key + ': invalid photo count')
        if isinstance(urls, list) and count is not None and count != len(urls):
            errors.append(key + ': retrieved photo count does not match URL list')
        if not isinstance(indexes, list) or any(type(i) is not int or i < 0 for i in indexes):
            errors.append(key + ': invalid inspected indexes')

    report['counts'] = {k: len(v) for k, v in rows.items()}
    report['valid'] = not errors
    report['production_ready'] = False
    return report, rows


def stage_delivery(db_path, report, rows):
    if not report['valid']:
        raise ValueError('Rejected delivery; no staging writes permitted')
    db = sqlite3.connect(db_path)
    try:
        with db:
            db.execute('CREATE TABLE IF NOT EXISTS receipts (sha256 TEXT PRIMARY KEY, run_id TEXT NOT NULL, schema_version TEXT NOT NULL, staged_at TEXT DEFAULT CURRENT_TIMESTAMP)')
            db.execute('CREATE TABLE IF NOT EXISTS snapshots (delivery_sha256 TEXT, dataset TEXT, record_key TEXT, payload TEXT NOT NULL, PRIMARY KEY(delivery_sha256,dataset,record_key))')
            if db.execute('SELECT 1 FROM receipts WHERE sha256=?', (report['zip_sha256'],)).fetchone():
                return {'status': 'already_staged', 'inserted': 0}
            # A corrected file may reuse a source run ID. Preserve it as another
            # immutable delivery revision; never overwrite the original snapshot.
            inserted = 0
            for dataset, records in rows.items():
                for r in records:
                    key = r['observation_id'] if dataset == 'listing_observations' else r['listing_key']
                    db.execute('INSERT INTO snapshots VALUES (?,?,?,?)', (report['zip_sha256'], dataset, key, json.dumps(r, sort_keys=True)))
                    inserted += 1
            db.execute('INSERT INTO receipts(sha256,run_id,schema_version) VALUES (?,?,?)', (report['zip_sha256'], report['run_id'], report['schema_version']))
            return {'status': 'staged_local_snapshot', 'inserted': inserted}
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('zip_path')
    parser.add_argument('--report', required=True)
    parser.add_argument('--stage-db', help='Optional LOCAL SQLite file; no production integration')
    args = parser.parse_args()
    try:
        report, rows = inspect_delivery(args.zip_path)
        if args.stage_db and report['valid']:
            report['staging'] = stage_delivery(args.stage_db, report, rows)
    except (ValueError, KeyError, OSError, zipfile.BadZipFile, sqlite3.Error) as exc:
        report = {'valid': False, 'production_ready': False, 'errors': [str(exc)]}
    Path(args.report).write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))
    return 0 if report['valid'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
