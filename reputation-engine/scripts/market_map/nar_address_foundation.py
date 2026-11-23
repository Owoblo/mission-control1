"""Stage Ontario mixed-use and non-residential addresses from a pinned StatCan release.

The ZIP directory identifies province members. Retrieve only those members,
verify their encoded CRC, and keep an atomic per-member receipt. No residential
or unknown-use address rows, contacts, occupancy or outreach jobs are created.
"""
import argparse
from collections import Counter, defaultdict
import csv
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import shutil
import sqlite3
import struct
import subprocess
from tempfile import TemporaryDirectory
import unicodedata
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener
import zlib

URL = 'https://www150.statcan.gc.ca/n1/pub/46-26-0002/2022001/202606.zip'
RELEASE = '2026-06'
ARCHIVE_BYTES = 1665944959
COLUMNS = ('LOC_GUID', 'ADDR_GUID', 'APT_NO_LABEL', 'CIVIC_NO', 'CIVIC_NO_SUFFIX', 'OFFICIAL_STREET_NAME',
           'OFFICIAL_STREET_TYPE', 'OFFICIAL_STREET_DIR', 'PROV_CODE', 'CSD_ENG_NAME', 'CSD_TYPE_ENG_CODE',
           'MAIL_POSTAL_CODE', 'BG_X', 'BG_Y', 'BU_USE')


def canonical(value):
    return ''.join(c.lower() for c in unicodedata.normalize('NFKD', value) if c.isascii() and c.isalnum())


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def fetch_range(path, bounds, cap):
    if not shutil.which('curl'):
        request = Request(URL, headers={'Range': 'bytes=' + bounds,
            'User-Agent': 'SaturnStarResearch/1.0 (public municipal address reconciliation)'})
        try:
            with build_opener(NoRedirects()).open(request, timeout=45) as response:
                match = re.fullmatch(r'bytes (\d+)-(\d+)/(\d+)', response.headers.get('Content-Range', ''))
                if response.status != 206 or not match or int(match[3]) != ARCHIVE_BYTES:
                    raise OSError('Publisher did not honor bounded range')
                size = int(match[2]) - int(match[1]) + 1
                if size != cap:
                    raise OSError('Publisher range length changed')
                with path.open('wb') as target:
                    remaining = size
                    while remaining:
                        chunk = response.read(min(remaining, 1 << 20))
                        if not chunk:
                            raise OSError('Publisher range ended early')
                        target.write(chunk)
                        remaining -= len(chunk)
        except HTTPError as exc:
            raise OSError(f'Publisher range request failed ({exc.code})') from None
        return
    result = subprocess.run(['curl', '-fsS', '--max-time', '160', '--max-filesize', str(cap),
                             '--range', bounds, '--output', str(path), '--write-out', '%{http_code}', URL],
                            capture_output=True, text=True, timeout=165)
    if result.returncode or result.stdout != '206':
        raise OSError('Publisher range request failed (' + (result.stdout.strip() or str(result.returncode)) + ')')


def address_members(tail):
    # Read the central directory from its EOCD pointer. Reject an incomplete or
    # split directory rather than processing a prefix of the provincial release.
    end = tail.rfind(b'PK\x05\x06')
    if end < 0:
        raise ValueError('Publisher ZIP directory missing')
    _, disk, start_disk, on_disk, total, length, offset, comment = struct.unpack_from('<I4H2IH', tail, end)
    start = offset - (ARCHIVE_BYTES - len(tail))
    if (end < 0 or disk or start_disk or on_disk != total or end + 22 + comment != len(tail)
            or start < 0 or start + length != end):
        raise ValueError('Invalid or incomplete source directory')
    found = []
    for _ in range(total):
        if tail[start:start+4] != b'PK\x01\x02':
            raise ValueError('Invalid source member')
        method = struct.unpack_from('<H', tail, start+10)[0]
        crc, compressed, size = struct.unpack_from('<III', tail, start+16)
        name_len, extra_len, note_len = struct.unpack_from('<HHH', tail, start+28)
        address = struct.unpack_from('<I', tail, start+42)[0]
        name = tail[start+46:start+46+name_len].decode()
        if re.fullmatch(r'Addresses/Address_35_part_[1-7]\.csv', name):
            if method != 8 or not 0 < compressed < 64*1024*1024 or size > 220*1024*1024:
                raise ValueError('Unexpected compression or member size')
            found.append((name, address, compressed, size, crc))
        start += 46 + name_len + extra_len + note_len
    if start != end or len(found) != 7 or len({part[0] for part in found}) != 7:
        raise ValueError('Ontario address members do not reconcile')
    return sorted(found)


def decode_member(raw, output, member):
    name, _, compressed, size, expected_crc = member
    with raw.open('rb') as source, output.open('wb') as target:
        header = source.read(30)
        if header[:4] != b'PK\x03\x04':
            raise ValueError('ZIP member header missing')
        name_length, extra_length = struct.unpack_from('<HH', header, 26)
        if source.read(name_length).decode() != name:
            raise ValueError('Publisher returned the wrong member')
        source.read(extra_length)
        decoder = zlib.decompressobj(-15)
        remaining, emitted, crc = compressed, 0, 0
        while remaining:
            chunk = source.read(min(remaining, 65536))
            if not chunk:
                raise ValueError('Incomplete member transfer')
            remaining -= len(chunk)
            plain = decoder.decompress(chunk)
            emitted += len(plain)
            if emitted > size:
                raise ValueError('Unexpected expanded size')
            crc = zlib.crc32(plain, crc)
            target.write(plain)
        if not decoder.eof or emitted != size or crc != expected_crc:
            raise ValueError('Publisher member length or checksum mismatch')


def scope_names(ledger):
    names = defaultdict(set)
    for city in ledger['municipalities']:
        names[canonical(city['municipality'])].add(city['municipality_id'])
    return {name: next(iter(ids)) for name, ids in names.items() if len(ids) == 1}


def import_member(db, csv_path, member, names):
    rows = Counter()
    before = db.total_changes
    with csv_path.open(encoding='utf-8-sig', newline='') as source, db:
        reader = csv.DictReader(source)
        if not set(COLUMNS) <= set(reader.fieldnames or []):
            raise ValueError('Unexpected Ontario address schema')
        chunk = []
        for row in reader:
            rows['source_rows'] += 1
            if row['PROV_CODE'] != '35':
                raise ValueError('Unexpected province in Ontario member')
            muni = names.get(canonical(row['CSD_ENG_NAME']))
            if not muni:
                continue
            rows['configured_exact_name_rows'] += 1
            use = row['BU_USE'].strip()
            rows['use_' + use if use in ('1', '2', '3', '4') else 'unknown_use'] += 1
            if use not in ('2', '3'):
                continue
            if not all(row[key] for key in ('LOC_GUID', 'ADDR_GUID', 'CIVIC_NO', 'OFFICIAL_STREET_NAME')):
                rows['nonresidential_missing_core_fields'] += 1
                continue
            chunk.append((muni, member[0], *(row[key] for key in COLUMNS)))
            rows['address_rows_in_scope'] += 1
            if len(chunk) >= 2000:
                db.executemany(INSERT, chunk)
                chunk.clear()
        if chunk:
            db.executemany(INSERT, chunk)
        rows['added_address_ids'] = db.total_changes - before
        rows['repeated_address_ids'] = rows['address_rows_in_scope'] - rows['added_address_ids']
        rows['source_member_crc32'] = f'{member[4]:08x}'
        db.execute('INSERT INTO checked_members VALUES(?,?)', (member[0], json.dumps(rows)))
    return dict(rows)


INSERT = ('INSERT OR IGNORE INTO addresses VALUES(' + ','.join('?' for _ in range(2 + len(COLUMNS))) + ')')


def report(output, db, state, failure=None):
    members = dict(db.execute('SELECT name,totals FROM checked_members ORDER BY name'))
    rows = list(db.execute("""
        SELECT municipality_id, count(*) AS addresses, count(DISTINCT LOC_GUID) AS source_locations,
               sum(APT_NO_LABEL <> '') AS addresses_with_recorded_unit,
               sum(BU_USE = '3') AS nonresidential_addresses,
               sum(BU_USE = '2') AS partially_residential_addresses
        FROM addresses GROUP BY municipality_id
    """))
    result = {'at': datetime.now(timezone.utc).isoformat(), 'release': RELEASE, 'state': state,
              'source_url': URL, 'expected_ontario_members': 7, 'members_verified': len(members),
              'coverage_basis': 'exact publisher census-subdivision name candidate; municipal boundary and occupant joins pending',
              'member_receipts': {name: json.loads(value) for name, value in members.items()},
              'by_municipality_id': {row[0]: dict(zip(('addresses', 'source_locations', 'addresses_with_recorded_unit',
                    'nonresidential_addresses', 'partially_residential_addresses'), row[1:])) for row in rows}}
    if failure:
        result['issue'] = failure
    tmp = output/'status.next'
    tmp.write_text(json.dumps(result, separators=(',', ':')))
    tmp.replace(output/'status.json')
    return result


def collect(ledger_path, output):
    import fcntl
    output.mkdir(parents=True, exist_ok=True)
    names = scope_names(json.loads(ledger_path.read_text()))
    with (output/'source.lock').open('a+b') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with sqlite3.connect(output/'research-addresses.sqlite3') as db:
            db.execute('PRAGMA journal_mode=WAL')
            schema = ','.join(key + (' TEXT PRIMARY KEY' if key == 'ADDR_GUID' else ' TEXT NOT NULL') for key in COLUMNS)
            db.execute('CREATE TABLE IF NOT EXISTS addresses(municipality_id TEXT, source_member TEXT,' + schema + ')')
            db.execute('CREATE TABLE IF NOT EXISTS checked_members(name TEXT PRIMARY KEY, totals TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS source_scope(scope TEXT PRIMARY KEY)')
            fingerprint = json.dumps(names, sort_keys=True)
            scope = db.execute('SELECT scope FROM source_scope').fetchone()
            if scope and scope[0] != fingerprint:
                raise ValueError('Municipal scope changed; reconcile before replay')
            db.execute('INSERT OR IGNORE INTO source_scope VALUES(?)', (fingerprint,))
            db.commit()
            if db.execute('SELECT count(*) FROM checked_members').fetchone()[0] == 7:
                return report(output, db, 'ontario_address_members_verified')
            try:
                if shutil.disk_usage(output).free < 3 * 1024**3:
                    raise OSError('Storage reserve reached')
                report(output, db, 'starting')
                with TemporaryDirectory(dir=output) as temporary:
                    root = Path(temporary)
                    tail = root/'directory.bin'
                    fetch_range(tail, '-65536', 65536)
                    for member in address_members(tail.read_bytes()):
                        name, start, length, _, _ = member
                        if db.execute('SELECT 1 FROM checked_members WHERE name=?', (name,)).fetchone():
                            continue
                        if shutil.disk_usage(output).free < 3 * 1024**3:
                            raise OSError('Storage reserve reached')
                        raw, expanded = root/'member.bin', root/'member.csv'
                        cap = length + 4096
                        fetch_range(raw, f'{start}-{start+cap-1}', cap)
                        decode_member(raw, expanded, member)
                        import_member(db, expanded, member, names)
                        report(output, db, 'collecting_ontario_address_members')
                return report(output, db, 'ontario_address_members_verified')
            except (OSError, ValueError, struct.error, subprocess.TimeoutExpired) as exc:
                return report(output, db, 'source_acquisition_held', f'{type(exc).__name__} · {str(exc)[:160]}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ledger', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = collect(args.ledger, args.output)
    print(json.dumps({k: result.get(k) for k in ('state', 'members_verified', 'issue')}), flush=True)


if __name__ == '__main__':
    main()
