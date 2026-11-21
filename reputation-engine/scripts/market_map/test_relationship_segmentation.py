import unittest
from .relationship_segmentation import employee_size, segment_business, city_sector_cohorts

class SegmentationTests(unittest.TestCase):
    def test_size_requires_evidence_not_sector_or_company_name(self):
        s = segment_business({"name": "Big Hospital Warehouse", "paid_employees": 800}, ["healthcare"])
        self.assertEqual(s["organization_scale"]["band"], "unknown")
        self.assertEqual(employee_size(99, "official staff page"), "small")
        self.assertEqual(employee_size(100, "official staff page"), "medium")
        self.assertEqual(employee_size(500, "official staff page"), "large")
        self.assertEqual(employee_size(True, "source"), "unknown")
        self.assertEqual(employee_size(0, "verified no paid staff"), "non_employer")
        self.assertEqual(employee_size(0), "unknown")

    def test_enterprise_size_does_not_determine_project_size(self):
        s = segment_business({"paid_employees": 800, "employee_count_evidence": "report", "project_scope": "two office desks"}, ["professional_offices"])
        self.assertEqual(s["organization_scale"]["band"], "large")
        self.assertEqual(s["project_scope"], "two office desks")

    def test_retail_does_not_prove_franchise_or_buying_role(self):
        s = segment_business({"account_structure": "franchisee"}, ["retail_franchises"])
        self.assertEqual(s["account_structure"], "unknown")
        self.assertEqual(s["verified_relationship_roles"], [])

    def test_existing_conversation_overrides_generic_sector_intro(self):
        s = segment_business({"relationship_state": "customer_led_wait", "professional_route_evidence": "website"}, ["retail_franchises"])
        self.assertEqual(s["message_strategy"], "existing_context_and_commitments_first")
        s = segment_business({"professional_route_evidence": "business contact page"}, ["professional_offices"])
        self.assertEqual(s["message_strategy"], "business_team_introduction_without_invented_name")
        self.assertEqual(s["organization_scale"]["band"], "unknown")

    def test_overlapping_sectors_preserve_one_identity_and_no_send(self):
        s = segment_business({"id": "one", "paused": True, "signals": ["listing", "opening"]}, ["healthcare", "professional_offices", "healthcare"])
        self.assertEqual(s["industry_families"], ["healthcare", "professional_offices"])
        self.assertIn("preserve_existing_pause", s["review_reasons"])
        self.assertFalse(s["outreach_eligible"])
        self.assertFalse(s["automatic_send"])

    def test_unknown_sector_and_city_remain_visible(self):
        s = segment_business({})
        self.assertIn("industry_unresolved", s["review_reasons"])
        self.assertIn("geography_unresolved", s["review_reasons"])

    def test_non_business_places_do_not_get_business_messaging(self):
        s = segment_business({"non_organisation_place_candidate": True}, ["hospitality"])
        self.assertEqual(s["entity_disposition"], "context_only")
        self.assertEqual(s["service_hypotheses"], [])
        self.assertEqual(s["research_role_targets"], [])

    def test_sensitive_sector_does_not_claim_specialist_capability(self):
        s = segment_business({}, ["healthcare"])
        self.assertTrue(any("capability review" in a for a in s["message_angles_for_review"]))

    def test_all_cities_get_all_twenty_sectors_without_false_completeness(self):
        cities = [{"id": "w", "name": "Windsor"}, {"id": "l", "name": "London"}]
        rows = city_sector_cohorts(cities)
        self.assertEqual(len(rows), 40)
        self.assertEqual(len({r['cohort_id'] for r in rows}), 40)
        for city in cities:
            self.assertEqual(len({r['sector_code'] for r in rows if r['municipality_id'] == city['id']}), 20)
        self.assertTrue(all(r['coverage_percent'] is None and not r['automatic_send'] for r in rows))
        with self.assertRaises(ValueError): city_sector_cohorts([cities[0], cities[0]])

if __name__ == "__main__": unittest.main()
