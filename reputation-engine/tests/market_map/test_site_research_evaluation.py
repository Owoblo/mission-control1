import unittest
from scripts.market_map.site_research_evaluation import make_manifest, summarize_measurements, compare


def site(i, district='Centre', places=(), zone='CD1', state='pending'):
    return dict(site_id='site:'+str(i),district=district,municipality='Windsor',state=state,
        addresses=[str(i)+' MAIN ST'], members=[dict(building_id='building:'+str(i),
        reported_place_names=list(places),queue_snapshot={'zoning_codes':[zone]})])


class EvaluationTests(unittest.TestCase):
    def test_sample_deterministic_and_spreads_proxy_strata(self):
        sites=[site(i,'Centre' if i%2 else 'West',places=['A','B'] if i%3==0 else [],
                    zone='MD1' if i%5==0 else 'CD1') for i in range(100)]
        a,b=make_manifest(sites,50),make_manifest(list(reversed(sites)),50)
        self.assertEqual(a,b)
        self.assertEqual(a['sample_sites'],50)
        self.assertEqual(len({s['site_id'] for s in a['sites']}),50)
        self.assertEqual(len(a['sample_districts']),2)
        self.assertTrue(all(s['expected_current_occupants'] is None for s in a['sites']))

    def test_small_population_terminates(self):
        self.assertEqual(make_manifest([site(1)],50)['sample_sites'],1)
        self.assertEqual(make_manifest([],50)['sample_sites'],0)

    def test_unknown_truth_is_not_zero_errors(self):
        sample=make_manifest([site(1)])
        result=summarize_measurements([{'site_id':'site:1','elapsed_seconds':10,
            'predicted_occupants':['A']}],sample)
        self.assertIsNone(result['missed_occupants'])
        self.assertIsNone(result['false_matches'])
        self.assertIsNone(result['metrics']['cost_usd']['total'])

    def test_known_truth_counts_misses_and_false_matches(self):
        sample=make_manifest([site(1)])
        sample['sites'][0].update(reference_review_status='independently_labeled',
                                  expected_current_occupants=['A','B'])
        result=summarize_measurements([{'site_id':'site:1','predicted_occupants':['A','C']}],sample)
        self.assertEqual(result['missed_occupants'],1)
        self.assertEqual(result['false_matches'],1)
        self.assertEqual(result['correctly_matched_occupants'],1)

    def test_duplicate_and_foreign_sites_rejected(self):
        sample=make_manifest([site(1)])
        for rows in ([{'site_id':'site:1'}]*2,[{'site_id':'missing'}]):
            with self.assertRaises(ValueError):summarize_measurements(rows,sample)

    def test_comparison_does_not_certify_quality(self):
        sample=make_manifest([site(1),site(2)])
        result=compare(sample,[],[{'site_id':'site:1'}])
        self.assertFalse(result['same_sample_fully_measured'])
        self.assertFalse(result['quality_equivalence_established'])
        self.assertEqual(result['redesigned']['missing_sites'],['site:2'])


if __name__=='__main__':unittest.main()
