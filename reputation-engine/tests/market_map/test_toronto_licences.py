import json
import sys
import tempfile
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from market_map.toronto_licences import collect_toronto_licences, normalise_licence
from market_map.transport import SourceBlocked


def licence(ident, cancel=None):
    return {"_id": ident, "Licence No.": f"B99-{ident:07d}", "Operating Name": "Fixture Trading Business",
            "Client Name": "Fixture Licencee", "Licence Address Line 1": "10 Fixture Road",
            "Licence Address Line 2": "TORONTO, ON", "Licence Address Line 3": "M1M1M1",
            "Category": "FIXTURE TRADE", "Cancel Date": cancel, "Last Record Update": "2026-10-24"}


class FakeTransport:
    def __init__(self, records, repeat=False):
        self.records = records
        self.repeat = repeat
        self.requests = self.bytes_fetched = 0

    def fetch(self, url, **kwargs):
        self.requests += 1
        self.bytes_fetched += 100
        query = parse_qs(urlsplit(url).query)
        offset, limit = int(query['offset'][0]), int(query['limit'][0])
        page = self.records[:limit] if self.repeat else self.records[offset:offset + limit]
        payload = {'success': True, 'result': {'records': page, 'total': len(self.records)}}
        return type('Response', (), {'url': url, 'json': lambda self: payload})()


class TorontoLicenceTests(unittest.TestCase):
    def setUp(self):
        self.source = {'id': 'fixture-toronto', 'source_url': 'https://toronto.test/licences', 'rights_status': 'permitted'}

    def test_full_roster_reconciled_then_explicit_cancellation_scope_applied(self):
        transport = FakeTransport([licence(1, '2020-01-01'), licence(2), licence(3, '')])
        with tempfile.TemporaryDirectory() as folder:
            result = collect_toronto_licences(self.source, transport=transport, output_path=folder, page_size=2)
            self.assertTrue(result['metadata']['coverage_complete'])
            self.assertEqual(result['metadata']['licence_records_read'], 3)
            self.assertEqual(result['metadata']['cancelled_licence_records_excluded_from_account_candidates'], 1)
            self.assertEqual(len(result['rows']), 2)
            self.assertTrue(all(r['entity_type'] == 'licensed_business_candidate' for r in result['rows']))
            self.assertTrue(all(r['source_licence_cancellation_status'] == 'no_cancellation_recorded' for r in result['rows']))
            self.assertNotIn('legal_name', result['rows'][0])
            self.assertEqual(result['rows'][0]['city'], 'TORONTO')
            before = transport.requests
            again = collect_toronto_licences(self.source, transport=transport, output_path=folder, page_size=2)
            self.assertEqual(len(again['rows']), 2)
            self.assertEqual(transport.requests, before)

    def test_record_cap_stays_partial_and_resume_does_not_lose_licences(self):
        transport = FakeTransport([licence(1), licence(2), licence(3)])
        with tempfile.TemporaryDirectory() as folder:
            partial = collect_toronto_licences(self.source, transport=transport, output_path=folder, max_records=2, page_size=2)
            self.assertFalse(partial['metadata']['coverage_complete'])
            complete = collect_toronto_licences(self.source, transport=transport, output_path=folder, max_records=5, page_size=2)
            self.assertTrue(complete['metadata']['coverage_complete'])
            self.assertEqual(len(complete['rows']), 3)

    def test_duplicate_page_is_held_without_claiming_complete(self):
        transport = FakeTransport([licence(1), licence(2), licence(3)], repeat=True)
        with tempfile.TemporaryDirectory() as folder:
            result = collect_toronto_licences(self.source, transport=transport, output_path=folder, page_size=2)
            self.assertFalse(result['metadata']['coverage_complete'])
            self.assertEqual(result['metadata']['licence_records_read'], 2)
            self.assertIn('non-advancing', result['metadata']['cursor_checkpoint']['error'])

    def test_missing_permission_or_licence_identifier_is_not_invented(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(SourceBlocked):
                collect_toronto_licences({**self.source, 'rights_status': 'unreviewed'}, transport=FakeTransport([]), output_path=folder)
        with self.assertRaises(SourceBlocked):
            normalise_licence({**licence(1), 'Licence No.': None}, self.source, '2026-10-26T00:00:00Z')

    def test_literal_null_placeholders_are_held_with_publisher_object_ids(self):
        bad = {**licence(2), 'Licence No.': 'None', 'Operating Name': 'None', 'Client Name': 'None'}
        third = {**licence(3), 'Operating Name': 'None', 'Client Name': 'Fixture Legal Client', 'Business Phone': 'None'}
        transport = FakeTransport([licence(1), bad, third, licence(4, '2020-01-01')])
        with tempfile.TemporaryDirectory() as folder:
            result = collect_toronto_licences(self.source, transport=transport, output_path=folder)
            self.assertEqual(len(result['rows']), 2)
            self.assertEqual(result['rows'][1]['name'], 'Fixture Legal Client')
            self.assertIsNone(result['rows'][1]['phone'])
            self.assertEqual(result['metadata']['quarantined_count'], 1)
            self.assertEqual(result['metadata']['cancelled_licence_records_excluded_from_account_candidates'], 1)
            self.assertEqual(result['metadata']['licence_records_read'], 4)
            held = json.loads((Path(folder) / 'quarantined-licence-records.json').read_text())
            self.assertEqual(held['records'][0]['publisher_object_id'], 2)
            self.assertEqual(held['records'][0]['raw_payload'], bad)
            before = transport.requests
            replay = collect_toronto_licences(self.source, transport=transport, output_path=folder)
            self.assertEqual(replay['metadata']['quarantined_count'], 1)
            self.assertEqual(transport.requests, before)


if __name__ == '__main__':
    unittest.main()
