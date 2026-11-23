import csv
import json
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from zipfile import ZIP_DEFLATED, ZipFile

from . import nar_address_foundation as nar


class AddressFoundationTests(unittest.TestCase):
    def test_archive_index_requires_all_ontario_members_and_checks_crc(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            path = root/'source.zip'
            with ZipFile(path, 'w', ZIP_DEFLATED) as archive:
                for i in range(1, 8):
                    archive.writestr(f'Addresses/Address_35_part_{i}.csv', f'evidence-{i}\n')
                archive.writestr('Addresses/Address_59_part_1.csv', 'outside Ontario\n')
            raw = path.read_bytes()
            with patch.object(nar, 'ARCHIVE_BYTES', len(raw)):
                members = nar.address_members(raw)
            self.assertEqual(len(members), 7)
            member = members[1]
            path.write_bytes(raw[member[1]:])
            output = root/'decoded.csv'
            nar.decode_member(path, output, member)
            self.assertEqual(output.read_text(), 'evidence-2\n')
            with self.assertRaisesRegex(ValueError, 'checksum'):
                nar.decode_member(path, output, (*member[:4], 0))

    def test_ingest_preserves_suite_and_skips_residential_unknown_and_outside_scope(self):
        with TemporaryDirectory() as directory, sqlite3.connect(':memory:') as db:
            root = Path(directory)
            schema = ','.join(key + (' TEXT PRIMARY KEY' if key == 'ADDR_GUID' else ' TEXT NOT NULL') for key in nar.COLUMNS)
            db.execute('CREATE TABLE addresses(municipality_id TEXT, source_member TEXT,' + schema + ')')
            db.execute('CREATE TABLE checked_members(name TEXT PRIMARY KEY, totals TEXT)')
            path = root/'input.csv'
            with path.open('w') as handle:
                writer = csv.DictWriter(handle, fieldnames=nar.COLUMNS)
                writer.writeheader()
                for i, use, city in [(1, '3', 'Windsor'), (2, '2', 'Windsor'), (3, '1', 'Windsor'),
                                     (4, '4', 'Windsor'), (5, '3', 'Elsewhere')]:
                    writer.writerow({'LOC_GUID': 'same-building', 'ADDR_GUID': str(i), 'APT_NO_LABEL': str(i),
                                     'CIVIC_NO': '123', 'OFFICIAL_STREET_NAME': 'Test', 'PROV_CODE': '35',
                                     'BU_USE': use, 'CSD_ENG_NAME': city})
            nar.import_member(db, path, ('member', 0, 0, 0, 0), {'windsor': 'city-a'})
            self.assertEqual(db.execute('SELECT APT_NO_LABEL FROM addresses ORDER BY ADDR_GUID').fetchall(),
                             [('1',), ('2',)])
            row = json.loads(db.execute('SELECT totals FROM checked_members').fetchone()[0])
            self.assertEqual(row['source_rows'], 5)
            self.assertEqual(row['added_address_ids'], 2)
