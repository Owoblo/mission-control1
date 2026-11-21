import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from scripts.market_map.eastern_sources import inspect, inspect_html, write_ledger, parse_named_section


class EasternSourceTests(unittest.TestCase):
    def test_named_sections_do_not_convert_footer_or_major_employer_role_to_sites_or_ownership(self):
        body = b'<main><p>Many successful and innovative companies call the Mississippi Mills Business Park home.</p><p><a href="https://example.org">Published Business</a> - Industrial Drive</p><h2>Other section</h2><p>Not a roster</p></main><footer>3131 Old Perth Rd, Almonte, ON</footer>'
        rows = parse_named_section(body, 'mississippi-mills-park')
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['source_street_label'], 'Industrial Drive')
        self.assertIsNone(rows[0]['address'])
        self.assertIsNone(rows[0]['city'])
        self.assertIsNone(rows[0]['country'])
        self.assertFalse(rows[0]['tenancy_inferred'])
        employers = parse_named_section(b'<h2>Major Employers</h2><ul><li>Company</li><li>Town</li></ul><h2>Quick Contacts</h2><p>Person Name</p>', 'carleton-place-employers')
        self.assertEqual([r['name'] for r in employers], ['Company', 'Town'])
        self.assertTrue(all(r['employee_count'] is None and r['current_operation_verified'] is False for r in employers))
        with self.assertRaises(ValueError):
            parse_named_section(b'<h2>Major Employers</h2><p>Changed schema</p>', 'carleton-place-employers')

    def test_inspection_preserves_exact_normal_pagination_and_policy_without_company_claim(self):
        result = inspect_html(b'<html><title>Roster</title><a href="/privacy-policy">Privacy</a>'
            b'<a href="/all?start=20" aria-label="Go to page 2">2</a>'
            b'<a href="javascript:loadData(2,10)">2</a><p>Results 1 - 20 of 800 This Category</p>'
            b'<form action="/search"><input name="q"></form></html>', 'https://example.org/all')
        self.assertEqual(result['linked_policy_urls'], ['https://example.org/privacy-policy'])
        self.assertEqual(result['pagination'][0]['url'], 'https://example.org/all?start=20')
        self.assertEqual(len(result['pagination']), 1)
        self.assertIn('800', result['published_count_text'][0])
        self.assertEqual(result['forms'][0]['field_names'], ['q'])

    def test_capacity_guard_prevents_network_and_unsearched_grid_is_not_actual_collection(self):
        with tempfile.TemporaryDirectory() as root:
            with patch('scripts.market_map.eastern_sources.shutil.disk_usage', return_value=SimpleNamespace(free=1)), \
                 patch('scripts.market_map.eastern_sources.Transport') as transport:
                with self.assertRaisesRegex(RuntimeError, '2 GiB'):
                    inspect(root)
                transport.assert_not_called()
            rows = write_ledger(root)
            self.assertEqual(len(rows), 576)
            self.assertEqual(len({r['configured_labels'][0] for r in rows}), 24)
            self.assertTrue(all(r['status'] == 'unsearched' and not r['actual_query_executed'] for r in rows))
            self.assertTrue(all(r['market_completeness_verified'] is False for r in rows))
            saved = [json.loads(line) for line in (Path(root) / 'discovery-operations.jsonl').read_text().splitlines()]
            self.assertEqual(saved, rows)


if __name__ == '__main__':
    unittest.main()
