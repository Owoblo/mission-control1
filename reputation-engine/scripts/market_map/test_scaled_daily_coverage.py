from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from . import scaled_daily_preparation as worker


class ScaledDailyCoverageTests(unittest.TestCase):
    def test_unattempted_work_can_be_selected_next_day_without_replaying_holds(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            records = root / 'days' / '2026-11-20' / 'results' / 'records'
            records.mkdir(parents=True)
            states = {
                'no_attempt': {'state': 'verify_contact_context'},
                'unknown_outcome': {'state': 'verify_contact_context', 'verification_attempt_started': 'saved'},
                'verified': {'state': 'verified_contact_inventory', 'verified_routes': [
                    {'value': 'desk@example.test'},
                ]},
                'review': {'state': 'source_review'},
            }
            for identity, state in states.items():
                worker.save(records / (identity + '.json'), {
                    'id': identity, 'name': identity, 'city': 'Windsor', **state,
                })
            with patch.object(worker, 'OUT', root), patch.object(worker, 'PREVIOUS', root / 'previous'):
                seen_ids, seen_orgs, routes = worker.already_investigated()
            chosen, _, _ = worker.select_candidates([
                {'organisation_id': identity, 'name': identity, 'city': 'Windsor',
                 'email_candidate': '', 'sector': 'school'}
                for identity in states
            ], seen_ids, seen_orgs, routes, '2026-11-21', 10)
            self.assertEqual([row['organisation_id'] for row in chosen], ['no_attempt'])
            self.assertEqual(routes, {'desk@example.test'})

    def test_coverage_names_different_actions_for_empty_stock(self):
        stock = {'generated_at': 'snapshot', 'municipalities': [
            {'municipality': 'Windsor', 'saved_map_locations': 100, 'exported': 4},
            {'municipality': 'London', 'saved_map_locations': 50, 'exported': 5},
            {'municipality': 'Essex', 'saved_map_locations': 10, 'exported': 0},
            {'municipality': 'Chatham', 'saved_map_locations': 0, 'exported': 0},
        ]}
        report = worker.coverage_report(stock, {'windsor': {'school': 1}}, [
            {'city': 'Windsor', 'sector': 'school'},
        ])
        self.assertEqual(report['municipalities_with_candidates'], 1)
        self.assertEqual([
            (city['stock_state'], city['next_research_action']) for city in report['municipalities']
        ], [
            ('low', 'continue_city_category_rotation'),
            ('empty', 'replenish_filtered_candidate_stock'),
            ('empty', 'review_mapped_sites_for_source_backed_candidates'),
            ('empty', 'review_municipal_gis_and_source_foundation'),
        ])
