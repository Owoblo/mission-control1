import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from market_map.geography import configured_footprint, seed_geographies, resolve_geography, municipality_for
from market_map.store import MarketMap


class GeographyTests(unittest.TestCase):
    def setUp(self):
        self.store = MarketMap(":memory:")
        self.report = seed_geographies(self.store)

    def tearDown(self):
        self.store.close()

    def test_every_configured_runtime_label_retained_including_inactive_ottawa(self):
        labels = {r[0] for r in self.store.db.execute("SELECT configured_label FROM geography_service_areas")}
        self.assertEqual(labels, {r["label"] for r in configured_footprint()})
        ottawa = self.store.db.execute("SELECT sending_status FROM geography_service_areas WHERE configured_label='Ottawa'").fetchone()
        self.assertEqual(ottawa[0], "not_in_active_runtime")
        self.assertIsNotNone(resolve_geography(self.store, "Ottawa"))
        self.assertGreater(self.report["configured_labels"], 240)

    def test_aliases_do_not_create_duplicate_municipalities(self):
        self.assertEqual(resolve_geography(self.store, "Blandford Blenheim"), resolve_geography(self.store, "Blandford-Blenheim"))
        self.assertEqual(resolve_geography(self.store, "Chatham Kent"), resolve_geography(self.store, "Chatham-Kent"))
        self.assertLess(self.report["unique_configured_geographies"], self.report["configured_labels"])
        self.assertIsNone(resolve_geography(self.store, "GTA"))
        self.assertEqual(resolve_geography(self.store, 'TORONTO NORTH YORK'), resolve_geography(self.store, 'North York'))
        self.assertEqual(resolve_geography(self.store, 'North York, Toronto'), resolve_geography(self.store, 'North York'))
        self.assertIsNone(resolve_geography(self.store, 'London North York'))

    def test_locality_parent_and_service_catchment_are_separate(self):
        locality = resolve_geography(self.store, "Wheatley")
        municipality = municipality_for(self.store, locality)
        self.assertEqual(self.store.db.execute("SELECT name FROM geographies WHERE id=?", (municipality,)).fetchone()[0], "Chatham-Kent")
        catchment = self.store.db.execute("""SELECT g.name FROM geography_service_areas m
            JOIN geographies g ON g.id=m.service_area_id WHERE m.configured_label='Wheatley'""").fetchone()[0]
        self.assertEqual(catchment, "Windsor / Essex County")
        self.assertNotEqual(locality, municipality)

    def test_official_oakland_homonyms_require_qualified_context_and_respect_conflicting_region(self):
        self.assertIsNone(resolve_geography(self.store, "Oakland"))
        qualified = resolve_geography(self.store, "Oakland, Brant")
        self.assertIsNotNone(qualified)
        self.assertEqual(municipality_for(self.store, qualified), resolve_geography(self.store, "Brant"))
        self.assertEqual(resolve_geography(self.store, "Oakland", "Brant"), qualified)
        self.assertIsNone(resolve_geography(self.store, "Oakland", "Essex"))
        self.assertIsNone(resolve_geography(self.store, "Oakland", "Ontario"))
        self.assertIsNone(resolve_geography(self.store, "Oakland Brant", "Essex"))
        self.assertIsNone(resolve_geography(self.store, "North York", "London"))
        self.assertEqual(resolve_geography(self.store, "North York", "Toronto"), resolve_geography(self.store, "North York"))

    def test_ambiguous_boundary_and_composite_labels_need_review(self):
        for label in ["McGregor", "Beachville", "Dashwood", "Lower Town Sandy Hill", "Stittsville Munster Richmond"]:
            self.assertIsNone(resolve_geography(self.store, label), label)
        self.assertGreaterEqual(self.store.db.execute("SELECT COUNT(*) FROM review_queue WHERE issue_type='geography_mapping'").fetchone()[0], 5)
        self.assertEqual(self.store.db.execute("SELECT COUNT(*) FROM geographies WHERE official_id IS NOT NULL").fetchone()[0], 0)

    def test_repeat_seed_does_not_duplicate_geographies_or_reviews(self):
        before = {t: self.store.db.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in ["geographies", "geography_aliases", "geography_service_areas", "review_queue", "discovery_queue"]}
        again = seed_geographies(self.store)
        self.assertEqual(again["new_geographies"], 0)
        self.assertEqual(again["new_mapping_reviews"], 0)
        self.assertEqual(before, {t: self.store.db.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in before})

    def test_seed_summary_reports_existing_official_ids(self):
        self.store.db.execute("UPDATE geographies SET official_id='fixture:official' WHERE id=?", (resolve_geography(self.store, 'Windsor'),))
        self.store.db.commit()
        report = seed_geographies(self.store)
        self.assertEqual(report['official_ids_loaded'], 1)
        self.assertEqual(report['official_ids_added_by_service_seed'], 0)

    def test_corridor_frontier_retains_unresolved_user_road_without_guessing(self):
        rows = [dict(r) for r in self.store.db.execute("SELECT * FROM discovery_queue WHERE task_type='corridor_source_discovery'")]
        self.assertEqual(len(rows), 4)
        lowson = next(r for r in rows if 'Lowson Road' in r['target_url_or_query'])
        self.assertEqual(lowson['status'], 'review_required')
        self.assertIsNone(json.loads(lowson['metadata_json'])['city'])
        self.assertNotIn('Lawson Road', lowson['target_url_or_query'])
        self.assertTrue(all(r['attempts'] == 0 for r in rows))


if __name__ == "__main__":
    unittest.main()
