from datetime import datetime, timezone
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from . import geo_physical_coverage as physical
from . import partnership_run_notifications as reports


class PhysicalCoverageTests(unittest.TestCase):
    def test_daily_site_worker_requires_config_and_launches_once(self):
        with TemporaryDirectory() as temporary:
            out = Path(temporary)
            active = datetime(2026, 11, 23, 12, tzinfo=timezone.utc)
            base = out/'physical-site-reconciliation'
            with patch.object(reports.subprocess, 'Popen') as launch:
                reports.ensure_daily_site_reconciliation(out, out, active)
                launch.assert_not_called()
                base.mkdir()
                (base/'config.json').write_text('{}')
                launch.return_value.pid = 99999999
                reports.ensure_daily_site_reconciliation(out, out, active)
                reports.ensure_daily_site_reconciliation(out, out, active)
                launch.assert_called_once()
                self.assertIn('2026-11-23', launch.call_args.args[0])
                self.assertEqual(reports.read(base/'launch.json')['attempts'], 1)

    def test_foundation_keeps_scope_and_occupancy_separate_from_stock(self):
        city = {'name': 'Fixture', 'geography_id': 'city-a', 'municipality_code': '1',
                'boundary_status': 'downloaded_checksum_verified',
                'place_envelopes_cover_boundary': True}
        addresses = {('1', 'addresses'): {'status': 'empty_source_requires_review',
                     'source_url': 'https://example.test', 'count': 0, 'path': 'receipt.json'}}
        counts = {'city-a': {'saved_locations': 5, 'with_recorded_unit': 3, 'without_primary_domain': 4}}
        result = physical.reconcile([city], [], counts, addresses, '2026-11-22T20:00:00Z')
        self.assertEqual(result['summary']['saved_locations_without_primary_domain'], 4)
        self.assertEqual(result['summary']['addresses_with_reconciled_source_inventory'], 0)
        [entry] = result['municipalities']
        self.assertTrue(entry['observed_source_envelope_covers_boundary'])
        self.assertEqual(entry['occupancy']['state'], 'tenant_scope_unverified')
        layers = {layer['layer']: layer['state'] for layer in entry['layers']}
        self.assertEqual(layers['addresses'], 'empty_source_requires_review')
        self.assertEqual(layers['buildings'], 'source_discovery_pending')
        self.assertEqual(layers['boundary'], 'downloaded_checksum_verified')
        with self.assertRaises(ValueError):
            physical.reconcile([city, city], [], {}, {}, '2026-11-22T20:00:00Z')

    def test_coverage_email_includes_city_with_no_stock(self):
        city = {'name': 'Fixture', 'geography_id': 'city-a', 'municipality_code': '1'}
        counts = {'city-a': {'saved_locations': 5, 'with_recorded_unit': 3, 'without_primary_domain': 4}}
        result = physical.reconcile([city], [], counts, {}, datetime.now(timezone.utc).isoformat())
        with TemporaryDirectory() as temporary:
            out = Path(temporary)
            day = '2026-11-23'
            folder = out/'days'/day
            folder.mkdir(parents=True)
            (out/'physical-foundation.json').write_text(json.dumps(result))
            reports.save(folder/'municipality-candidate-coverage.json', {'municipalities': [
                {'municipality_id': 'city-a', 'stock_state': 'empty', 'selected_candidates': 0}],
                'municipalities_with_candidates': 0, 'empty_municipalities': ['Fixture']})
            reports.save(folder/'report.json', {'city_category': []})
            nar = out/'gis-address-foundation-202606'
            nar.mkdir()
            reports.save(nar/'status.json', {
                'members_verified': 1, 'expected_ontario_members': 7, 'state': 'collecting_ontario_address_members',
                'coverage_basis': 'publisher-name candidate',
                'by_municipality_id': {'city-a': {'addresses': 20, 'addresses_with_recorded_unit': 12}},
            })
            [report] = reports.geographic_coverage_notices(out, day)
            self.assertEqual(report['review'][0]['state'], 'empty')
            self.assertIn('Occupants and suite coverage unverified', report['review'][0]['reasons'])
            self.assertIn('no domain 4', report['review'][0]['reasons'])
            self.assertIn('StatCan candidate addresses 20, with unit 12', report['review'][0]['reasons'])
