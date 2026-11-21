import unittest
from scripts.market_map.windsor_address_pilot import address_key, classify, relevant_zone
from scripts.market_map.windsor_address_investigation import group_addresses, comparison_address, reconcile_evidence


class AddressPilotTests(unittest.TestCase):
    def test_evidence_reconciliation_is_candidate_only_and_preserves_units(self):
        self.assertEqual(comparison_address('12 Main Street East'), comparison_address('12 Main St. E'))
        self.assertNotEqual(comparison_address('12 Main St #1'), comparison_address('12 Main St #2'))
        obs = {'observations': [{'address': '12 Main Street', 'organization': 'Example'}]}
        places = {'g': {'address': '12 Main St'}, 'suite': {'address': '12 Main St #2'}}
        result = reconcile_evidence(obs, [{'building_id': 'b', 'parcel_address_candidates': ['12 MAIN ST'],
                                          'covering_place_ids': [], 'business_zone_research_candidate': False}], places)[0]
        self.assertEqual(result['candidate_existing_place_ids'], ['g'])
        self.assertEqual(result['outside_original_filter_feature_count'], 1)
        self.assertIsNone(result['incremental_verified_organization'])

    def test_address_queue_reuses_address_but_retains_units_and_outside_zone(self):
        def row(bid, zone, gids):
            return {'building_id': bid, 'business_zone_research_candidate': zone,
                    'covering_place_ids': gids, 'parcel_address_candidates': ['12 MAIN ST'],
                    'status': 'address_candidate'}
        places = {'one': {'address': '12 Main St #1'}, 'two': {'address': '12 Main St #2'}}
        grouped = group_addresses([row('a', True, ['one']), row('b', False, ['two']), row('c', False, [])], places)
        self.assertEqual(len(grouped), 3)
        base = next(g for g in grouped if g['address'] == '12 MAIN ST')
        self.assertEqual(base['building_ids'], ['a', 'b'])
        self.assertEqual(base['reported_place_ids'], [])
        self.assertEqual(len({g['address_id'] for g in grouped}), 3)

    def test_units_and_directions_remain_distinct(self):
        self.assertNotEqual(address_key('12 Main St #1'), address_key('12 Main St #2'))
        self.assertNotEqual(address_key('12 Main St E'), address_key('12 Main St W'))
        self.assertEqual(address_key(' 12  Main St '), address_key('12 main st'))

    def test_conflicts_not_hidden_by_place_points(self):
        self.assertEqual(classify(['12 Main', '14 Main'], ['place1']), 'address_conflict')
        self.assertEqual(classify(['12 Main', '12 MAIN'], []), 'address_candidate')
        self.assertEqual(classify([], ['place1']), 'reported_place')
        self.assertEqual(classify([], []), 'address_unresolved')

    def test_research_zone_is_explicit(self):
        self.assertTrue(relevant_zone('RD1.1, CD2.1'))
        self.assertTrue(relevant_zone('MD1.2'))
        self.assertFalse(relevant_zone('RD1.1'))
        self.assertFalse(relevant_zone('unknown'))

    def test_unmatched_source_addresses_and_units_stay_in_queue(self):
        from scripts.market_map.windsor_address_investigation import include_evidence_addresses
        observations = [{'address': '400 Main St', 'unit_or_floor': unit,
                         'candidate_building_ids': []} for unit in (None, '2nd floor')]
        grouped = include_evidence_addresses([], observations)
        self.assertEqual(len(grouped), 2)
        self.assertTrue(all(g['needs_address_review'] for g in grouped))
        self.assertTrue(all(g['building_ids'] == [] for g in grouped))
        self.assertEqual(grouped, include_evidence_addresses(grouped, observations))


if __name__ == '__main__':
    unittest.main()
