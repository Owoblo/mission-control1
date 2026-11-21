import unittest
from scripts.market_map.windsor_evidence_inventory import compare_observation


class InventoryEvidenceTests(unittest.TestCase):
    def observation(self, name='Alpha', address='12 Main St', unit=None):
        return dict(organization=name,address=address,unit_or_floor=unit,source_url='https://example.com',status='website_supported')

    def test_shared_address_does_not_merge_organizations(self):
        result=compare_observation(self.observation(),[dict(trading_name='Beta',address_raw='12 Main Street')])
        self.assertEqual(result['inventory_comparison_status'],'address_only_candidates_identity_unresolved')

    def test_unit_mismatch_stays_reviewable(self):
        result=compare_observation(self.observation(unit='3rd Floor'),[dict(trading_name='Alpha',address_raw='12 Main St 2nd Floor')])
        self.assertEqual(result['inventory_comparison_status'],'existing_name_address_differs_review')

    def test_known_name_new_address_preserves_prior_candidate(self):
        result=compare_observation(self.observation(address='40 Main St'),[dict(trading_name='Alpha',address_raw='12 Main St')])
        self.assertEqual(result['candidates'][0]['address_raw'],'12 Main St')
        self.assertIsNone(result['net_new_verified_organization'])

    def test_absence_is_not_new_verified_organization(self):
        result=compare_observation(self.observation(),[])
        self.assertEqual(result['inventory_comparison_status'],'no_exact_candidate_not_proof_of_new_organization')
        self.assertIsNone(result['net_new_verified_organization'])

    def test_missing_street_type_explained_without_auto_match(self):
        result=compare_observation(self.observation(address='12 Main'),[dict(trading_name='Alpha',address_raw='12 Main St')])
        self.assertEqual(result['inventory_comparison_status'],'existing_name_address_differs_review')
        self.assertIn('street_type_omitted',result['candidates'][0]['address_difference_hint'])
        result=compare_observation(self.observation(address='12 Main St E'),[dict(trading_name='Alpha',address_raw='12 Main St W')])
        self.assertNotIn('street_type_omitted',result['candidates'][0]['address_difference_hint'])


if __name__=='__main__':unittest.main()
