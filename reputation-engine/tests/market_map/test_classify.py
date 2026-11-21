import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from market_map.store import MarketMap
from market_map.classify import classify


class ClassificationTests(unittest.TestCase):
    def setUp(self):
        self.store = MarketMap(":memory:")
        self.store.upsert_source({"id": "test", "name": "Fixture", "source_url": "https://fixture.test"})

    def tearDown(self):
        self.store.close()

    def test_source_labels_map_with_evidence_and_replay(self):
        self.store.ingest("test", [{"name": "Fixture Shop", "source_record_id": "1", "categories": "furniture_store", "taxonomy": "Overture Places"}])
        result = classify(self.store)
        self.assertEqual(result["new_classifications_by_family"], {"retail_franchises": 1})
        row = self.store.db.execute("SELECT * FROM classifications WHERE taxonomy='ssm_industry_family'").fetchone()
        self.assertIsNotNone(row["evidence_id"])
        self.assertEqual(row["review_status"], "source_mapped")
        self.assertEqual(classify(self.store)["new_industry_classifications"], 0)

    def test_name_does_not_classify_and_broad_source_text_remains_unknown(self):
        self.store.ingest("test", [{"name": "Factory Manufacturing OEM Corporation", "source_record_id": "1"},
                                  {"name": "Other", "source_record_id": "2", "categories": "Construction", "taxonomy": "source_category"}])
        self.assertEqual(classify(self.store)["new_industry_classifications"], 0)

    def test_naics_uses_most_specific_supported_prefix(self):
        self.store.ingest("test", [{"name": "Fixture", "source_record_id": "1", "naics": "541510", "naics_taxonomy": "NAICS-CA-2022"}])
        self.assertEqual(classify(self.store)["new_classifications_by_family"], {"technology_telecom": 1})

    def test_nonbusiness_place_is_flagged_without_buyer_or_capability(self):
        self.store.ingest("test", [{"name": "Fixture Park", "source_record_id": "1", "categories": "park", "taxonomy": "Overture Places", "entity_type": "place_candidate"}])
        self.assertEqual(classify(self.store)["new_non_organisation_place_flags"], 1)
        self.assertEqual(self.store.db.execute("SELECT COUNT(*) FROM classifications WHERE taxonomy='ssm_service_opportunity'").fetchone()[0], 0)

    def test_labour_organisation_and_credit_union_keep_distinct_industries(self):
        self.store.ingest("test", [{"name": "Fixture workers", "source_record_id": "1", "categories": "labor_union", "taxonomy": "Overture Places"},
                                  {"name": "Fixture financial cooperative", "source_record_id": "2", "categories": "credit_union", "taxonomy": "Overture Places"}])
        result = classify(self.store)
        self.assertEqual(result["new_classifications_by_family"], {"nonprofit_community": 1, "finance_insurance": 1})

    def test_interrupted_bounded_classification_resumes_without_skipping_source_labels(self):
        categories = ["furniture_store", "mosque", "automotive_supplier", "park"]
        self.store.ingest("test", [{"name": "Fixture " + str(i), "source_record_id": str(i),
            "categories": category, "taxonomy": "Overture Places"}
            for i, category in enumerate(categories)])
        def interrupt_after_commit(event):
            self.assertEqual(event["source_classifications_examined"], 1)
            derived = self.store.db.execute("SELECT COUNT(*) FROM classifications WHERE taxonomy IN ('ssm_industry_family','ssm_discovery_context')").fetchone()[0]
            self.assertEqual(derived, 1)
            raise RuntimeError("simulated process interruption")
        with self.assertRaisesRegex(RuntimeError, "simulated process interruption"):
            classify(self.store, batch_size=1, progress=interrupt_after_commit)
        progress = []
        result = classify(self.store, batch_size=1, progress=progress.append)
        self.assertEqual(result["source_classifications_examined"], 4)
        self.assertEqual([event["source_classifications_examined"] for event in progress], [1, 2, 3, 4])
        self.assertEqual(self.store.db.execute("SELECT COUNT(*) FROM classifications WHERE taxonomy='ssm_industry_family'").fetchone()[0], 3)
        self.assertEqual(self.store.db.execute("SELECT COUNT(*) FROM classifications WHERE taxonomy='ssm_discovery_context'").fetchone()[0], 1)
        replay = classify(self.store, batch_size=2)
        self.assertEqual(replay["source_classifications_examined"], 4)
        self.assertEqual(replay["new_industry_classifications"], 0)
        self.assertEqual(replay["new_non_organisation_place_flags"], 0)


if __name__ == "__main__":
    unittest.main()
