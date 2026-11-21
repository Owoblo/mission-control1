import unittest
from scripts.market_map.relationship_review import qualification


class RelationshipReviewTests(unittest.TestCase):
    def claim(self,**values):
        return {'target_company_or_association_label':'Company Ltd','target_website':'https://company.ca/','short_context':'Our clients',
                'source_page_title':'Our Clients | Fixture Industrial','source_page_url':'https://fixture.ca/clients',
                'source_organisation_id':'source','logo_only':False,**values}
    def test_real_context_remains_unverified_review(self):
        self.assertEqual(qualification(self.claim(),{'status':'bounded_discovery_pages_observed'}),'directional_or_contextual_publisher_claim_review')
    def test_company_name_partners_does_not_establish_relationship_context(self):
        row=self.claim(source_page_title='Home | Fixture Wealth Partners',source_page_url='https://fixture.ca/',short_context='Other Company')
        self.assertEqual(qualification(row,{'status':'bounded_discovery_pages_observed'}),'contextual_link_role_not_established')
    def test_media_query_and_policy_optout_are_excluded(self):
        for url in ['https://images.ca/a.jpg?fit=400','https://optout.aboutads.info/choices']:
            self.assertEqual(qualification(self.claim(target_website=url),{'status':'bounded_discovery_pages_observed'}),'non_relationship_media_action_or_technical_link')
    def test_hold_or_unknown_source_cannot_be_graph_edge(self):
        self.assertEqual(qualification(self.claim(),{'status':'publisher_access_hold'}),'held_source_identity_access_or_reuse')
        self.assertEqual(qualification(self.claim(source_organisation_id=None),{'status':'bounded_discovery_pages_observed'}),'source_identity_unresolved')


if __name__=='__main__':unittest.main()
