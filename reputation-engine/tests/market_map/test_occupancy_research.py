import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
from market_map.occupancy_research import build_queue


def row(identity, address, name='Fixture'):
    return {'gers': identity, 'address': address, 'name': name}


class OccupancyResearchTests(unittest.TestCase):
    def test_shared_address_keeps_distinct_entities_without_claiming_tenants(self):
        result = build_queue([row('a', '10 Main St'), row('b', '10 MAIN ST', 'Other')], '1')
        self.assertEqual(len(result['queue']), 1)
        group = result['queue'][0]
        self.assertEqual(group['source_record_ids'], ['a', 'b'])
        self.assertIsNone(group['known_suite_count'])
        self.assertIsNone(group['verified_occupant_count'])

    def test_different_suites_are_not_flattened(self):
        self.assertEqual(build_queue([row('a', '10 Main #1'), row('b', '10 Main #2')], '1')['queue'], [])

    def test_duplicates_do_not_inflate_occupancy(self):
        item = row('a', '10 Main')
        self.assertEqual(build_queue([item, item], '1')['queue'], [])

    def test_conflicts_and_missing_addresses_remain_explicit(self):
        result = build_queue([row('a', '10 Main'), row('a', '20 Main'), row('b', '')], '1')
        self.assertEqual(len(result['conflicts']), 1)
        self.assertEqual(result['missing_address_ids'], ['b'])

    def test_stable_research_identity_independent_of_input_order(self):
        rows = [row('a', '10 Main'), row('b', '10 Main')]
        self.assertEqual(build_queue(rows, '1')['queue'][0]['research_id'],
                         build_queue(rows[::-1], '1')['queue'][0]['research_id'])
        self.assertNotEqual(build_queue(rows, '1')['queue'][0]['research_id'],
                            build_queue(rows, '2')['queue'][0]['research_id'])
