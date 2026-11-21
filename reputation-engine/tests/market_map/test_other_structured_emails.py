import unittest

from scripts.market_map.other_structured_emails import explicit_email_fields, structured_facts


class OtherStructuredEmailsTests(unittest.TestCase):
    def facts(self, row):
        return list(structured_facts(row, {'source_id': 'publisher', 'source_url': 'https://publisher.test/list',
            'rights_status': 'licensed_open', 'source_cohort': 'saved', 'observed_at': '2026-10-27T00:00:00Z'}))

    def test_contact_url_literal_inbox_recovers_cra_like_business_field(self):
        facts = self.facts({'source_record_id': 'BN123RR0001', 'name': 'Published Charity', 'raw_payload': {
            'published_web_url_records': [{'Contact URL': 'Office@charity.test'}, {'Contact URL': 'https://user@website.test/path'}]}})
        self.assertEqual([r['email'] for r in facts], ['Office@charity.test'])
        self.assertEqual(facts[0]['source_field_paths'], ['/raw_payload/published_web_url_records/0/Contact URL'])

    def test_mail_fields_never_confused_with_postal_mailing_or_narratives(self):
        facts = self.facts({'source_record_id': 'ID', 'raw_payload': {'attributes': {'Mailing_Address1': 'not-an-email',
            'Business_Description': 'narrative@example.test', 'Email_Address': 'office@business.test', 'CreatorEmail': 'editor@publisher.test'}},
            'source_metadata': {'email': 'maintainer@publisher.test'}})
        self.assertEqual([r['email'] for r in facts], ['office@business.test'])

    def test_explicit_email_hidden_flag_honored_but_address_hidden_is_independent(self):
        base = {'source_record_id': 'ID', 'raw_payload': {'email_display_allowed': False, 'email': 'hidden@business.test'}}
        self.assertEqual(self.facts(base), [])
        base['raw_payload'] = {'address_display_allowed': False, 'email': 'public@business.test'}
        self.assertEqual([r['email'] for r in self.facts(base)], ['public@business.test'])

    def test_multiple_source_role_fields_preserved_without_authority_or_person_guess(self):
        facts = self.facts({'source_record_id': 'ID', 'raw_payload': {'contactDetails': {'executiveEmail': 'one@business.test', 'salesEmail': 'two@business.test'}}})
        self.assertEqual(len(facts), 2);self.assertTrue(all(r['person_name_or_authority_inferred'] is False for r in facts))


if __name__ == '__main__': unittest.main()
