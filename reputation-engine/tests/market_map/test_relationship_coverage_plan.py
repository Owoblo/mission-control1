import unittest
from scripts.market_map.relationship_coverage_plan import rotate, SOURCES


class RotationTest(unittest.TestCase):
    def test_all_city_category_sources_without_duplicates_or_starvation(self):
        cities = [dict(geography_id=str(i), name='City '+str(i)) for i in range(5)]
        categories = [dict(category_id=str(i), category='Category '+str(i)) for i in range(3)]
        batches = [rotate(cities, categories, wave, 5) for wave in range(3*len(SOURCES))]
        tasks = [row for batch in batches for row in batch]
        self.assertEqual(len({r['task_id'] for r in tasks}), 5*3*len(SOURCES))
        for batch in batches:
            self.assertEqual(len({r['municipality_id'] for r in batch}), 5)
            self.assertTrue(all(not r['automatic_send'] and not r['paid_research_authorized_by_plan'] for r in batch))
        self.assertEqual(rotate(cities, categories, 0, 5), batches[0])

    def test_invalid_requests(self):
        for wave, limit in [(-1, 5), (0, 0)]:
            with self.assertRaises(ValueError):
                rotate([], [], wave, limit)


if __name__ == '__main__':
    unittest.main()
