import unittest

from scripts.market_map.reconcile_coverage_catalogs import canonical_key, label_id, runtime_array, grome_geography


class CoverageCatalogReconciliationTests(unittest.TestCase):
    def test_spelling_aliases_share_label_identity(self):
        for left, right in [("Mitchell’s Bay", "Mitchell's Bay"), ("Chatham Kent", "Chatham-Kent"),
                            ("Blandford Blenheim", "Blandford-Blenheim"), ("Orléans", "Orleans"),
                            ("Greater Toronto Area", "GTA")]:
            self.assertEqual(label_id(left), label_id(right))

    def test_communities_not_folded_into_parents(self):
        for left, right in [("Chatham", "Chatham-Kent"), ("Windsor", "Essex"), ("Belle River", "Lakeshore"),
                            ("Wyoming", "Plympton-Wyoming"), ("Toronto", "GTA"),
                            ("Richmond", "Richmond Hill"), ("Guelph", "Guelph-Eramosa"),
                            ("Stittsville", "Stittsville Munster Richmond")]:
            self.assertNotEqual(label_id(left), label_id(right))

    def test_does_not_infer_saint_alias_or_remove_qualifiers(self):
        self.assertNotEqual(canonical_key("Saint Thomas"), canonical_key("St. Thomas"))
        self.assertNotEqual(canonical_key("North York"), canonical_key("York"))

    def test_parser_fails_closed_on_missing_arrays(self):
        with self.assertRaises(ValueError):
            runtime_array("export const different=[];", "serviceLocations")
        with self.assertRaises(ValueError):
            runtime_array("export const serviceLocations=[];", "serviceLocations")

    def test_listing_area_keeps_separate_membership(self):
        text = "const seed: any = [['OTTAWA', 'Ottawa', `Ottawa|Richmond`]]; export const slug = 1; export const listingAreas = ['Stittsville Munster Richmond'].map(x=>x);"
        rows = grome_geography(text)
        self.assertEqual([r["source"] for r in rows], ["navigator_primary", "navigator_primary", "navigator_listing"])
        self.assertNotEqual(label_id(rows[1]["label"]), label_id(rows[2]["label"]))


if __name__ == "__main__":
    unittest.main()
