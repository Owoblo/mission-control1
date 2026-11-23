from datetime import datetime, timezone
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from . import geo_physical_coverage as physical
from . import geo_site_sources as sources
from . import partnership_run_notifications as reports
from .transport import Response, SourceBlocked


class PhysicalCoverageTests(unittest.TestCase):
    def test_source_discovery_retains_holds_and_rotates_without_live_fetches(self):
        with TemporaryDirectory() as temporary:
            out = Path(temporary)
            base = out/'physical-site-reconciliation'
            base.mkdir()
            cities = [{'municipality': f'Test City {code}', 'municipality_code': str(code),
                       'layers': [{'layer': 'zoning', 'state': 'source_discovery_pending'}]}
                      for code in range(100, 119)]
            reports.save(out/'physical-foundation.json', {'municipalities': cities})
            results = {'results': [{'id': 'a'*32, 'title': 'Test City 100 Zoning',
                                    'type': 'Feature Service', 'owner': 'unreviewed'},
                                   {'id': 'b'*32, 'title': 'Test City 101 Zoning',
                                    'type': 'Feature Service', 'extent': [[-106, 39], [-105, 40]]}],
                       'nextStart': -1}
            with patch.object(sources.Transport, 'fetch', return_value=Response(json.dumps(results).encode(), {}, '')):
                first = sources.run(base, {'municipalities': []}, '2026-11-22')
                self.assertEqual(first['municipalities_checked_today'], 16)
                self.assertEqual(first['layer_states']['candidate_scope_and_licence_review'], 1)
            with patch.object(sources.Transport, 'fetch', side_effect=SourceBlocked('fixture')):
                self.assertEqual(sources.run(base, {'municipalities': []}, '2026-11-22'), first)
                second = sources.run(base, {'municipalities': []}, '2026-11-23')
                self.assertEqual(second['municipalities_ever_checked'], 19)
                self.assertEqual(second['layer_states']['catalogue_access_or_format_held'], 3)

    def test_reviewed_acquisition_resumes_then_publishes_once(self):
        with TemporaryDirectory() as temporary:
            base = Path(temporary)
            row = {'municipality_code': '1', 'layer': 'buildings', 'review_evidence': 'official licence receipt',
                   'url': 'https://example.test/arcgis/FeatureServer/1',
                   'licence_url': 'https://example.test/open', 'fields': ['OBJECTID'], 'attribution': 'Test City'}
            config = {'municipalities': [{'municipality_code': '1', 'bundle': 'sources/1'}],
                      'reviewed_arcgis_layers': [row]}
            def collect(stage, **kwargs):
                folder = stage/'buildings'
                if not folder.exists():
                    folder.mkdir()
                    raise sources.BudgetExceeded('fixture cursor')
                reports.save(folder/'manifest.json', {'count': 1})
                return {'buildings': 1}
            with patch.object(sources, 'collect', side_effect=collect), patch.object(
                    sources.shutil, 'disk_usage', return_value=type('Space', (), {'free': 3_000_000_000})()):
                self.assertEqual(sources.acquire_reviewed(base, config, '2026-11-22')['state'], 'acquisition_checkpointed')
                self.assertIsNone(sources.acquire_reviewed(base, config, '2026-11-22'))
                self.assertEqual(sources.acquire_reviewed(base, config, '2026-11-23')['state'], 'publisher_inventory_acquired')
                self.assertIsNone(sources.acquire_reviewed(base, config, '2026-11-24'))
                self.assertTrue((base/'sources/1/buildings/manifest.json').is_file())

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
